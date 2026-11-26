"""Événements RO·AI -> notifications Discord. Logique pure (sans discord.py) : testable hors ligne.
Une notification est une description d'embed (dict) ; la couche Discord la traduit."""
from __future__ import annotations

import re

from dataclasses import dataclass, field
from typing import Any, Callable

from .discord_settings import DiscordSettings
from .redact import redact_text

COLORS = {"err": 0xF26D5D, "warn": 0xF5A742, "ok": 0x4CCAA1, "info": 0x6FB0F2}
PROVIDER_NAME = {"claude": "Claude Code", "codex": "Codex CLI"}
LOGIN_CMD = {"claude": "roai-login claude", "codex": "roai-login codex"}
ERROR_LABEL = {"auth_expired": "Connexion expirée", "rate_limited": "Limite d'usage atteinte", "denied": "Action refusée",
               "timeout": "Durée maximale dépassée", "transient": "Erreur temporaire", "failed": "Échec"}
WINDOWS = {"five_hour": "5 heures", "seven_day": "7 jours", "seven_day_opus": "7 jours (Opus)", "seven_day_sonnet": "7 jours (Sonnet)"}
LIMITED = {"rejected", "limited", "exceeded"}


@dataclass
class Notification:
    category: str
    embed: dict[str, Any]
    run_id: str | None = None      # présent : l'approbation propose des boutons
    key: str | None = None         # clé de dédoublonnage
    mention: bool = False          # mentionner le propriétaire (mode salon)
    fields_order: list = field(default_factory=list)
    report: list | None = None     # rapport complet : liste d'embeds à envoyer à la suite
    texts: list | None = None      # même rapport en messages texte classiques (format « classique » ou « les deux »)
    embeds_on_webhook: bool = True  # format « classique » seul : pas d'embed par webhook (le bot garde les embeds)
    public: bool = False           # salon public : ni nom RO·AI, ni signature, ni lien interne
    webhook: str | None = None     # webhook propre à l'agent (prioritaire sur le webhook global)


def _clip(s: Any, n: int) -> str:
    s = redact_text(str(s or ""), n + 20)
    return s if len(s) <= n else s[: n - 1] + "…"


def _embed(title: str, color: str, description: str = "", fields: list[tuple[str, str, bool]] | None = None,
           url: str | None = None, ts: str | None = None) -> dict[str, Any]:
    return {"title": _clip(title, 250), "description": _clip(description, 1500), "color": COLORS[color],
            "fields": [(_clip(n, 250), _clip(v, 900) or "—", i) for n, v, i in (fields or [])][:8],
            "url": url, "timestamp": ts, "footer": "RO·AI"}


def build(ev: dict, s: DiscordSettings, agent_name: Callable[[str | None], str], run_provider: Callable[[str | None], str | None]) -> Notification | None:
    """Retourne la notification à envoyer pour cet événement, ou None (non concerné ou catégorie désactivée)."""
    t, p, rid, ts = ev["type"], ev.get("payload") or {}, ev.get("run_id"), ev.get("ts")
    base = s.dashboard_url
    run_url = f"{base}/runs/{rid}" if rid and base else None
    who = agent_name(ev.get("agent_id")) if ev.get("agent_id") else ""
    n = s.notify
    if t == "run.awaiting_approval" and n.approvals:
        return Notification("approvals", _embed(f"Approbation requise : {who}", "warn", p.get("prompt_preview", ""), url=run_url, ts=ts),
                            run_id=rid if s.commands.approve else None, key=f"ap:{rid}", mention=True)
    if t == "run.failed" and n.failures:
        cls = p.get("error_class") or "failed"
        fields = [("Cause", ERROR_LABEL.get(cls, cls), True)]
        if p.get("duration_ms") is not None:
            fields.append(("Durée", f"{p['duration_ms'] / 1000:.1f} s", True))
        if p.get("error_message"):
            fields.append(("Détail", p["error_message"], False))
        hint = ""
        if cls == "auth_expired":
            prov = run_provider(rid)
            if prov in LOGIN_CMD:
                hint = f"Reconnectez le fournisseur sur le serveur : `{LOGIN_CMD[prov]}`"
        elif cls == "rate_limited":
            hint = "La limite se réinitialise automatiquement ; relancez l'exécution ensuite."
        return Notification("failures", _embed(f"Échec : {who}", "err", hint, fields, url=run_url, ts=ts), key=f"fail:{rid}", mention=True)
    if t == "run.succeeded" and n.completions:
        return Notification("completions", _embed(f"Terminé : {who}", "ok", p.get("result_preview", ""), url=run_url, ts=ts), key=f"ok:{rid}")
    if t == "system.emergency_stop" and n.emergency:
        return Notification("emergency", _embed("Arrêt d'urgence activé", "err",
                                                f"{p.get('cancelled', 0)} exécution(s) annulée(s). Les lancements et planifications sont suspendus jusqu'à la reprise."
                                                + (f"\nMotif : {p['reason']}" if p.get("reason") else ""), url=base or None, ts=ts),
                            key=f"stop:{ev['seq']}", mention=True)
    if t == "system.resumed" and n.emergency:
        return Notification("emergency", _embed("Reprise", "ok", "Les lancements et planifications sont de nouveau actifs.", url=base or None, ts=ts), key=f"res:{ev['seq']}")
    if t == "provider.auth" and n.auth:
        prov, state = p.get("provider"), p.get("state")
        name = PROVIDER_NAME.get(prov, str(prov))
        if state == "logged_in":
            return Notification("auth", _embed(f"Connexion rétablie : {name}", "ok", ts=ts), key=f"auth:{prov}:{state}:{ev['seq']}")
        return Notification("auth", _embed(f"Connexion perdue : {name}", "err", f"Reconnectez-vous sur le serveur : `{LOGIN_CMD.get(prov, 'roai-login')}`", ts=ts),
                            key=f"auth:{prov}:{state}", mention=True)
    if t == "run.rate_limit" and n.limits and p.get("status") in LIMITED:
        prov = run_provider(rid) or "claude"
        win = WINDOWS.get(p.get("window") or "", p.get("window") or "")
        fields = [("Fournisseur", PROVIDER_NAME.get(prov, prov), True)]
        if win:
            fields.append(("Fenêtre", win, True))
        if p.get("resets_at"):
            fields.append(("Réinitialisation", p["resets_at"].replace("T", " ").replace("Z", " UTC"), False))
        return Notification("limits", _embed("Limite d'usage atteinte", "warn", fields=fields, ts=ts), key=f"rl:{prov}:{p.get('resets_at')}")
    if t == "system.notice" and p.get("level") == "error" and n.system_errors:
        return Notification("system_errors", _embed("Erreur du noyau", "err", p.get("message", ""), ts=ts), key=f"sys:{p.get('message', '')[:80]}")
    if t == "system.notice" and str(p.get("message", "")).startswith("Noyau démarré") and n.startup:
        return Notification("startup", _embed("Noyau démarré", "info", p.get("message", ""), ts=ts), key=f"start:{ev['seq']}")
    return None


class Dedupe:
    """Ignore une notification de même clé revue dans la fenêtre (secondes)."""

    def __init__(self, window_s: float = 300.0, clock: Callable[[], float] | None = None):
        import time
        self.window, self.clock, self._seen = window_s, clock or time.monotonic, {}

    def fresh(self, key: str | None) -> bool:
        if not key:
            return True
        now = self.clock()
        self._seen = {k: t for k, t in self._seen.items() if now - t < self.window}
        if key in self._seen:
            return False
        self._seen[key] = now
        return True


def batch(items: list[Notification], max_individual: int = 5) -> tuple[list[Notification], int]:
    """Limite le débit : les `max_individual` premières partent seules, le reste est résumé par un compte."""
    return items[:max_individual], max(0, len(items) - max_individual)


def summary_embed(extra: int, base_url: str | None) -> dict[str, Any]:
    return _embed(f"{extra} autre(s) notification(s)", "info", "Trop d'événements d'un coup : consultez le journal du Control Center pour le détail.",
                  url=f"{base_url}/logs" if base_url else None)


def public_title(text: str, fallback: str) -> tuple[str, str]:
    """Salon public : la 1re ligne non vide du rapport (titre Markdown ou gras) devient le titre ; le reste, le corps."""
    lines = (text or "").strip().split("\n")
    if lines and lines[0].strip():
        first = re.sub(r"^\s*#{1,6}\s*|\*\*", "", lines[0]).strip()
        if first and len(first) <= 200:
            return first, "\n".join(lines[1:]).strip()
    return fallback, text


def report_texts(title: str, text: str, url: str | None = None, max_chars: int = 1900, max_messages: int = 8) -> list[str]:
    """Même rapport en messages texte classiques (Markdown Discord, 2 000 caractères par message), aux frontières de lignes."""
    body = redact_text((text or "").strip(), 60000) or "(rapport vide)"
    head = f"**{_clip(title, 200)}**"
    tail = f"🔗 <{url}>" if url else ""
    chunks: list[str] = []
    cur = head
    for line in body.split("\n"):
        while len(line) > max_chars:
            chunks.append(cur); cur = ""
            chunks.append(line[:max_chars]); line = line[max_chars:]
        if cur and len(cur) + len(line) + 1 > max_chars:
            chunks.append(cur); cur = line
        else:
            cur = f"{cur}\n{line}" if cur else line
    if cur:
        chunks.append(cur)
    chunks = [c for c in chunks if c.strip()]
    if len(chunks) > max_messages:
        chunks = chunks[:max_messages]
        chunks[-1] = chunks[-1][: max_chars - 80] + "\n… rapport tronqué : la suite est dans le Control Center."
    if tail:
        if len(chunks[-1]) + len(tail) + 2 <= 2000:
            chunks[-1] += "\n\n" + tail
        else:
            chunks.append(tail)
    return chunks


def report_embeds(title: str, text: str, url: str | None = None, ts: str | None = None, max_chars: int = 3800, max_embeds: int = 8) -> list[dict[str, Any]]:
    """Découpe un rapport (Markdown) en embeds de 3 800 caractères au plus, aux frontières de lignes. Masque les secrets."""
    text = redact_text((text or "").strip(), 60000) or "(rapport vide)"
    chunks: list[str] = []
    cur = ""
    for line in text.split("\n"):
        while len(line) > max_chars:                       # ligne démesurée : coupure dure
            if cur:
                chunks.append(cur); cur = ""
            chunks.append(line[:max_chars]); line = line[max_chars:]
        if len(cur) + len(line) + 1 > max_chars and cur:
            chunks.append(cur); cur = line
        else:
            cur = f"{cur}\n{line}" if cur else line
    if cur:
        chunks.append(cur)
    truncated = len(chunks) > max_embeds
    chunks = chunks[:max_embeds]
    if truncated:
        chunks[-1] = chunks[-1][: max_chars - 80] + "\n\n… rapport tronqué : la suite est dans le Control Center."
    out = []
    for i, c in enumerate(chunks):
        e = {"title": _clip(title, 250) if i == 0 else "", "description": c, "color": COLORS["ok"], "fields": [],
             "url": url if i == 0 else None, "timestamp": ts if i == len(chunks) - 1 else None,
             "footer": "RO·AI" + (f" · {i + 1}/{len(chunks)}" if len(chunks) > 1 else "")}
        out.append(e)
    return out
