"""Sonde d'état des fournisseurs. N'appelle que les sous-commandes d'état des clients officiels ;
aucun fichier d'identifiants n'est lu."""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
from pathlib import Path
from typing import Any, Callable

from ..config import Settings
from ..db import Database, now_iso
from .base import base_env, RunContext


async def _run(argv: list[str], env: dict[str, str], timeout: float = 20.0) -> tuple[int, str]:
    try:
        p = await asyncio.create_subprocess_exec(*argv, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, env=env,
                                                 stdin=asyncio.subprocess.DEVNULL)
        out, _ = await asyncio.wait_for(p.communicate(), timeout)
        return p.returncode or 0, out.decode("utf-8", "replace").strip()
    except (asyncio.TimeoutError, FileNotFoundError, PermissionError) as e:
        return 127, str(e)


def parse_claude_status(rc: int, text: str) -> dict[str, Any]:
    try:
        j = json.loads(text)
    except json.JSONDecodeError:
        return {"state": "unknown", "method": None, "plan": None, "detail": (text or "état illisible")[:200], "expires_at": None}
    if j.get("loggedIn"):
        method = j.get("authMethod")
        detail = f"Connecté ({method})" if method else "Connecté"
        if j.get("apiProvider") and j["apiProvider"] != "firstParty":
            detail += f", fournisseur {j['apiProvider']}"
        return {"state": "logged_in", "method": method, "plan": j.get("subscriptionType") or j.get("plan"), "detail": detail,
                "expires_at": j.get("loginExpiresAt")}
    return {"state": "logged_out", "method": None, "plan": None, "detail": "Non connecté", "expires_at": None}


def parse_codex_status(rc: int, text: str) -> dict[str, Any]:
    low = text.lower()
    if "not logged in" in low or "non connect" in low:
        return {"state": "logged_out", "method": None, "plan": None, "detail": "Non connecté", "expires_at": None}
    if rc == 0 and "logged in" in low:
        method = "chatgpt" if "chatgpt" in low else ("api_key" if "api key" in low else None)
        return {"state": "logged_in", "method": method, "plan": None, "detail": text.splitlines()[0][:120], "expires_at": None}
    return {"state": "unknown", "method": None, "plan": None, "detail": (text or "état illisible")[:200], "expires_at": None}


class ProviderStatus:
    def __init__(self, settings: Settings, db: Database, on_change: Callable[[str, str], None]):
        self.s, self.db, self.on_change = settings, db, on_change
        self._cache: dict[str, dict] = {}
        self._limits: dict[str, dict] = db.kv_get("provider_limits", {}) or {}
        self._lock = asyncio.Lock()

    def _env(self) -> dict[str, str]:
        ctx = RunContext("", {}, "", Path("/"), Path("/"), 0, self.s.agent_home, "")
        return base_env(ctx)

    def note_rate_limit(self, provider: str, status: str, resets_at: str | None, window: str | None,
                        used_percent: float | None = None) -> None:
        """Mémorise une fenêtre de limite (signal réel du client officiel). `limits` garde son ancien format
        (statut ok / limited de la fenêtre la plus contraignante) et gagne le détail par fenêtre."""
        level = ("limited" if status in ("rejected", "limited", "exceeded")
                 else "warning" if status in ("allowed_warning", "warning") else "ok")
        win = window if isinstance(window, str) and re.fullmatch(r"[a-z0-9_]{1,30}", window) else "inconnue"
        try:
            used = None if used_percent is None else round(max(0.0, min(100.0, float(used_percent))), 1)
        except (TypeError, ValueError):
            used = None
        ts = now_iso()
        cur = self._limits.get(provider) or {}
        windows = dict(cur.get("windows") or {})
        windows[win] = {"level": level, "used_percent": used, "resets_at": resets_at, "updated_at": ts}
        live = {k: w for k, w in windows.items() if not w.get("resets_at") or w["resets_at"] > ts} or {win: windows[win]}
        rank = {"limited": 2, "warning": 1, "ok": 0}
        top_k = max(live, key=lambda k: (rank.get(live[k]["level"], 0), live[k].get("used_percent") or 0, live[k]["updated_at"]))
        top = live[top_k]
        self._limits[provider] = {"status": "limited" if top["level"] == "limited" else "ok", "resets_at": top["resets_at"],
                                  "window": top_k, "updated_at": ts, "windows": windows}
        self.db.kv_set("provider_limits", self._limits)

    def limits_view(self) -> dict[str, list[dict]]:
        """Fenêtres connues par fournisseur, pour l'affichage (aucun appel réseau, aucun appel aux clients)."""
        out: dict[str, list[dict]] = {}
        for pid in ("claude", "codex"):
            wins = (self._limits.get(pid) or {}).get("windows") or {}
            old = self._limits.get(pid)
            if not wins and old and old.get("window"):   # format antérieur : une seule fenêtre, sans pourcentage
                wins = {old["window"]: {"level": "limited" if old.get("status") == "limited" else "ok", "used_percent": None,
                                        "resets_at": old.get("resets_at"), "updated_at": old.get("updated_at")}}
            order = {"five_hour": 0, "seven_day": 1}
            out[pid] = [{"window": k, **w} for k, w in sorted(wins.items(), key=lambda kv: (order.get(kv[0], 2), kv[0]))]
        return out

    async def refresh(self, pid: str) -> dict:
        async with self._lock:
            env = self._env()
            if pid == "claude":
                binp, name, status_cmd, parser = self.s.claude_bin, "Claude Code", ["auth", "status"], parse_claude_status
            elif pid == "codex":
                binp, name, status_cmd, parser = self.s.codex_bin, "Codex CLI", ["login", "status"], parse_codex_status
            else:
                raise KeyError(pid)
            installed = bool(binp) and os.access(binp, os.X_OK)
            version, auth = None, {"state": "unknown", "method": None, "plan": None, "detail": "Client non installé", "expires_at": None}
            if installed:
                _, vtxt = await _run([binp, "--version"], env, 15)
                m = re.search(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.\-]+)?", vtxt)
                version = m.group(0) if m else None
                rc, txt = await _run([binp, *status_cmd], env, 25)
                auth = parser(rc, txt)
            old = self._cache.get(pid, {}).get("auth", {}).get("state")
            info = {"id": pid, "name": name, "installed": installed, "version": version, "auth": auth,
                    "limits": self._limits.get(pid), "checked_at": now_iso()}
            self._cache[pid] = info
            if old is not None and old != auth["state"]:
                self.on_change(pid, auth["state"])
            return info

    async def all(self, max_age_s: float = 60.0) -> list[dict]:
        from datetime import datetime, timezone
        out = []
        for pid in ("claude", "codex"):
            c = self._cache.get(pid)
            fresh = False
            if c:
                age = (datetime.now(timezone.utc) - datetime.strptime(c["checked_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)).total_seconds()
                fresh = age < max_age_s
            if not fresh:
                c = await self.refresh(pid)
            else:
                c = {**c, "limits": self._limits.get(pid)}
            out.append(c)
        return out
