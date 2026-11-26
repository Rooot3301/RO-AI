"""Catalogue des modèles proposés par le client Codex, lu dans le cache que Codex tient lui-même
(~/.codex/models_cache.json). Lecture seule ; seuls les champs descriptifs des modèles sont extraits."""
from __future__ import annotations

import json
from pathlib import Path

from .base import clean_model

EFFORTS = ("low", "medium", "high", "xhigh", "max", "ultra")
_cache: dict[str, tuple[float, list[dict]]] = {}


def codex_models(home: Path) -> list[dict]:
    path = home / ".codex" / "models_cache.json"
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return []
    hit = _cache.get(str(path))
    if hit and hit[0] == mtime:
        return hit[1]
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    out: list[dict] = []
    for m in (raw.get("models") if isinstance(raw, dict) else None) or []:
        if not isinstance(m, dict) or m.get("visibility") != "list" or not clean_model(m.get("slug")):
            continue
        levels = []
        for x in m.get("supported_reasoning_levels") or []:
            e = x.get("effort") if isinstance(x, dict) else x
            if e in EFFORTS:
                levels.append(e)
        default = m.get("default_reasoning_level")
        out.append({"slug": m["slug"], "name": str(m.get("display_name") or m["slug"])[:80],
                    "description": str(m.get("description") or "")[:200],
                    "default_effort": default if default in EFFORTS else None, "efforts": levels})
    _cache[str(path)] = (mtime, out)
    return out
