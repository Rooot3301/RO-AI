"""Masquage des secrets et troncature, appliqués à tout ce qui entre dans le journal d'événements."""
from __future__ import annotations

import re
from typing import Any

MASK = "[masqué]"
MAX_STR = 4000

_PATTERNS = [
    re.compile(r"https?://(?:[a-z]+\.)?discord(?:app)?\.com/api/(?:v\d+/)?webhooks/\d+/[A-Za-z0-9_\-]+"),  # webhook Discord : secret d'envoi
    re.compile(r"sk-ant-[A-Za-z0-9_\-]{8,}"),
    re.compile(r"sk-[A-Za-z0-9_\-]{20,}"),
    re.compile(r"eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}"),  # JWT
    re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(r"[MNO][A-Za-z0-9_\-]{23,28}\.[A-Za-z0-9_\-]{6}\.[A-Za-z0-9_\-]{27,}"),  # jeton de bot Discord
    re.compile(r"(?i)\b(authorization|bearer)\b\s*[:=]?\s*[A-Za-z0-9._\-~+/]{16,}=*"),
    re.compile(r"(?i)\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|CREDENTIAL)[A-Z0-9_]*)\b(\s*[=:]\s*)(\S+)"),
]
_KV = _PATTERNS[-1]


def redact_text(s: str, limit: int = MAX_STR) -> str:
    for p in _PATTERNS[:-1]:
        s = p.sub(MASK, s)
    s = _KV.sub(lambda m: f"{m.group(1)}{m.group(2)}{MASK}", s)
    if len(s) > limit:
        s = s[:limit] + f"… [{len(s) - limit} caractères tronqués]"
    return s


def redact(obj: Any, limit: int = MAX_STR, _depth: int = 0) -> Any:
    if _depth > 8:
        return MASK
    if isinstance(obj, str):
        return redact_text(obj, limit)
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            ks = str(k)
            if re.search(r"(?i)(token|secret|password|api_?key|credential|authorization)", ks) and isinstance(v, str):
                out[ks] = MASK
            else:
                out[ks] = redact(v, limit, _depth + 1)
        return out
    if isinstance(obj, (list, tuple)):
        return [redact(v, limit, _depth + 1) for v in list(obj)[:200]]
    return obj
