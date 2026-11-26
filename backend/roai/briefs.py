"""Résumé Discord marqué par l'agent (option « discord_brief ») : l'agent termine sa réponse par un bloc
<<<DISCORD … DISCORD>>> ; RO·AI le retire du résultat affiché et l'envoie seul sur Discord (événement `discord.brief`).
Sans bloc, rien n'est envoyé : l'agent décide lui-même ce qui mérite de vous déranger. Aucun appel IA supplémentaire.
"""
from __future__ import annotations

import re

from .redact import redact_text

BRIEF_OPEN, BRIEF_CLOSE = "<<<DISCORD", "DISCORD>>>"
BRIEF_MAX = 1800
_RE = re.compile(re.escape(BRIEF_OPEN) + r"\s*\n?(.*?)\n?\s*" + re.escape(BRIEF_CLOSE), re.S)


def extract_brief(text: str | None) -> tuple[str | None, str | None]:
    """(résultat sans le bloc, texte du résumé masqué et borné) ; résumé None s'il n'y a pas de bloc non vide."""
    if not text or BRIEF_OPEN not in text:
        return text, None
    m = _RE.search(text)
    if not m:
        return text, None
    brief = m.group(1).strip()
    clean = (text[: m.start()] + text[m.end():]).strip()
    if not brief:
        return clean or text, None
    brief = redact_text(brief, 100_000)
    if len(brief) > BRIEF_MAX:
        brief = brief[: BRIEF_MAX - 1].rstrip() + "…"
    return clean or brief, brief
