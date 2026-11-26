"""Sessions Claude Code qui développent RO·AI sur ce serveur (bureau virtuel : salle serveur).

Les événements arrivent du hook local `deploy/claude-hook.py` (exécuté par Claude Code, déjà réduits : type d'action et
cible courte, jamais de contenu, de message ni de commande complète). Ils sont revalidés ici, gardés en mémoire
seulement (aucune écriture dans le journal d'événements de RO·AI) et oubliés après quelques heures.
"""
from __future__ import annotations

import re
import threading
import time
from collections import deque
from typing import Any

from .redact import redact_text

EVENTS = {"session_start", "prompt", "tool", "waiting", "stop", "session_end"}
KINDS = {"read", "write", "search", "exec", "test", "build", "deploy", "commit", "git", "restart", "web", "delegate", "tool"}
MAX_SESSIONS = 12
ACTIONS_KEPT = 5
LINGER_S = 45          # après la fin d'un tour : le temps de ranger et de sortir
FORGET_IDLE_S = 3 * 3600
FORGET_ENDED_S = 600
_SID = re.compile(r"^[A-Za-z0-9_-]{6,64}$")
_COUNTED = ("write", "test", "build", "deploy", "commit")


def _clip(v: Any, n: int) -> str:
    s = v if isinstance(v, str) else ""
    s = "".join(ch for ch in s if ch.isprintable())
    return redact_text(s.strip(), n)[:n]


class DevWork:
    def __init__(self, clock=time.time):
        self._clock = clock
        self._lock = threading.Lock()
        self._s: dict[str, dict] = {}
        self._seq = 0

    def ingest(self, p: dict) -> bool:
        """Applique un événement ; faux s'il est invalide (ignoré sans erreur bruyante)."""
        if not isinstance(p, dict):
            return False
        ev, sid = p.get("event"), p.get("session")
        if ev not in EVENTS or not isinstance(sid, str) or not _SID.match(sid):
            return False
        now = self._clock()
        with self._lock:
            self._prune(now)
            s = self._s.get(sid)
            if s is None:
                if ev == "session_end" or len(self._s) >= MAX_SESSIONS:
                    return False
                self._seq += 1
                s = self._s[sid] = {"id": sid[:8], "sid": sid, "n": self._seq, "project": _clip(p.get("project"), 40) or "serveur",
                                    "state": "idle", "since": now, "last_at": now, "turn_at": None, "ended_at": None,
                                    "actions": deque(maxlen=ACTIONS_KEPT), "counts": {k: 0 for k in ("tools", *_COUNTED)}}
            s["last_at"] = now
            if ev == "session_start":
                s["state"], s["ended_at"] = "idle", None
            elif ev == "prompt":
                s["state"], s["turn_at"] = "working", now
            elif ev == "tool":
                kind = p.get("kind") if p.get("kind") in KINDS else "tool"
                if s["state"] != "working":
                    s["state"], s["turn_at"] = "working", s["turn_at"] if s["state"] == "waiting" else now
                s["actions"].append({"at": now, "kind": kind, "target": _clip(p.get("target"), 60)})
                s["counts"]["tools"] += 1
                if kind in _COUNTED:
                    s["counts"][kind] += 1
            elif ev == "waiting":
                if s["state"] == "working":
                    s["state"] = "waiting"
            elif ev == "stop":
                s["state"] = "idle"
            elif ev == "session_end":
                s["state"], s["ended_at"] = "ended", now
            return True

    def _prune(self, now: float) -> None:
        for sid, s in list(self._s.items()):
            if (s["state"] == "ended" and now - (s["ended_at"] or now) > FORGET_ENDED_S) or now - s["last_at"] > FORGET_IDLE_S:
                del self._s[sid]

    def view(self) -> list[dict]:
        now = self._clock()
        iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t)) if t else None  # noqa: E731
        with self._lock:
            self._prune(now)
            out = []
            for s in sorted(self._s.values(), key=lambda x: x["n"]):
                present = s["state"] in ("working", "waiting") or (s["state"] == "idle" and s["turn_at"] is not None and now - s["last_at"] < LINGER_S)
                out.append({
                    "id": s["id"], "label": f"Claude Code · {s['id'][:4]}", "project": s["project"], "state": s["state"], "present": present,
                    "since": iso(s["since"]), "last_at": iso(s["last_at"]), "turn_at": iso(s["turn_at"]),
                    "actions": [{"at": iso(a["at"]), "kind": a["kind"], "target": a["target"]} for a in s["actions"]],
                    "counts": dict(s["counts"]),
                })
            return out
