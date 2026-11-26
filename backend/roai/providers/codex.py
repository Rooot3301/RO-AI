"""Adaptateur Codex CLI : `codex exec --json` (binaire officiel, connexion ChatGPT)."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from ..redact import redact_text
from .base import clean_model, Adapter, Command, Event, Outcome, RunContext, base_env, classify_error


class CodexAdapter(Adapter):
    name = "codex"

    def __init__(self) -> None:
        self._session: str | None = None
        self._last_text = ""
        self._usage: dict[str, int] | None = None
        self._turns = 0
        self._failed: str | None = None
        self._completed = False

    @property
    def session_id(self) -> str | None:
        return self._session

    def build(self, ctx: RunContext) -> Command:
        cfg = ctx.agent.get("config") or {}
        free = bool(cfg.get("unrestricted"))
        domains = [d for d in (cfg.get("network_domains") or []) if d]
        sandbox = cfg.get("sandbox") or "read-only"
        if sandbox not in ("read-only", "workspace-write"):
            sandbox = "read-only"
        if domains:
            sandbox = "workspace-write"  # l'accès réseau de Codex n'existe que dans ce mode
        if ctx.resume_session:
            argv = [ctx.bin_path, "exec", "resume", ctx.resume_session, "--json", "--skip-git-repo-check"]
            argv += ["--dangerously-bypass-approvals-and-sandbox"] if free else ["-c", f'sandbox_mode="{sandbox}"']
        else:
            argv = [ctx.bin_path, "exec", "--json", "-C", str(ctx.cwd), "--skip-git-repo-check"]
            argv += ["--dangerously-bypass-approvals-and-sandbox"] if free else ["--sandbox", sandbox]
        if domains and not free:
            allow = ", ".join(f'"{d}" = "allow"' for d in domains)
            argv += ["-c", "sandbox_workspace_write.network_access=true", "-c", "features.network_proxy.enabled=true",
                     "-c", f"features.network_proxy.domains={{{allow}}}"]
        if ctx.agent.get("model"):
            argv += ["-m", ctx.agent["model"]]
        if cfg.get("reasoning_effort") in ("low", "medium", "high", "xhigh", "max", "ultra"):
            argv += ["-c", f'model_reasoning_effort="{cfg["reasoning_effort"]}"']
        if cfg.get("web_search"):
            argv += ["-c", 'web_search="live"']
        for s in cfg.get("mcp_servers") or []:
            n = s["name"]
            argv += ["-c", f"mcp_servers.{n}.command={json.dumps(s['command'])}"]
            if s.get("args"):
                argv += ["-c", f"mcp_servers.{n}.args={json.dumps(s['args'])}"]
            if s.get("auto_approve"):
                argv += ["-c", f'mcp_servers.{n}.default_tools_approval_mode="approve"']
        mission = (ctx.agent.get("mission") or "").strip()
        # la mission n'est envoyée qu'au premier message : en reprise, elle est déjà dans le contexte de la session
        prompt = f"# Mission permanente\n{mission}\n\n# Tâche\n{ctx.prompt}" if (mission and not ctx.resume_session) else ctx.prompt
        argv.append("-")  # le prompt est lu sur l'entrée standard
        return Command(argv=argv, env=base_env(ctx), stdin=prompt, hide=[str(ctx.home / ".claude"), str(ctx.home / ".claude.json")])

    def _rollout(self, home: Path) -> Path | None:
        sid = self._session
        if not sid or not re.fullmatch(r"[A-Za-z0-9\-]{8,80}", sid):
            return None
        files = sorted((home / ".codex" / "sessions").glob(f"*/*/*/rollout-*{sid}.jsonl"))
        return files[-1] if files else None

    def resolve_rate_limits(self, home: Path) -> list[dict]:
        """Limites d'usage de l'abonnement telles que Codex les a reçues pendant cette session (dernière entrée
        `rate_limits` du fichier de session). Lecture seule : pourcentages et heures de remise à zéro uniquement."""
        f = self._rollout(home)
        return read_rollout_limits(f) if f else []

    def resolve_model(self, home: Path) -> str | None:
        """`codex exec --json` n'annonce pas le modèle : on le lit dans le fichier de session que Codex écrit
        (~/.codex/sessions/…/rollout-…-<thread>.jsonl, entrée `turn_context`). Lecture seule, seul ce champ est extrait."""
        rollout = self._rollout(home)
        if not rollout:
            return None
        model = None
        try:
            with rollout.open(encoding="utf-8", errors="replace") as f:
                for line in f:
                    if '"turn_context"' not in line[:200]:
                        continue
                    try:
                        d = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if d.get("type") == "turn_context":
                        model = clean_model((d.get("payload") or {}).get("model")) or model
        except OSError:
            return None
        return model

    def parse(self, line: str) -> list[Event]:
        line = line.strip()
        if not line.startswith("{"):
            return []
        try:
            m = json.loads(line)
        except json.JSONDecodeError:
            return []
        out: list[Event] = []
        t = m.get("type", "")
        if t == "thread.started" and m.get("thread_id"):
            self._session = m["thread_id"]
            out.append(("run.session", {"session_id": self._session}))
        elif t == "turn.started":
            self._turns += 1
        elif t in ("item.started", "item.completed"):
            item = m.get("item") or {}
            it = item.get("type", "")
            iid = item.get("id")
            started = t == "item.started"
            if it == "agent_message" and not started and item.get("text"):
                self._last_text = item["text"]
                out.append(("run.message", {"text": item["text"]}))
            elif it == "command_execution":
                if started:
                    out.append(("tool.call", {"tool_id": iid, "tool": "shell", "kind": "exec",
                                              "summary": redact_text(str(item.get("command", "")), 300)}))
                else:
                    ok = item.get("exit_code") in (0, None) and item.get("status") != "failed"
                    out.append(("tool.result", {"tool_id": iid, "ok": bool(ok),
                                                "summary": redact_text(str(item.get("aggregated_output", ""))[-300:], 300)}))
            elif it == "file_change" and not started:
                changes = item.get("changes") or []
                names = ", ".join(str(c.get("path", "")) for c in changes[:4] if isinstance(c, dict))
                out.append(("tool.call", {"tool_id": iid, "tool": "apply_patch", "kind": "write", "summary": redact_text(names or "modification", 300)}))
                out.append(("tool.result", {"tool_id": iid, "ok": item.get("status") != "failed", "summary": ""}))
            elif it == "mcp_tool_call":
                label = f"{item.get('server', '')}.{item.get('tool', '')}"
                if started:
                    out.append(("tool.call", {"tool_id": iid, "tool": label, "kind": "mcp", "summary": redact_text(label, 300)}))
                else:
                    out.append(("tool.result", {"tool_id": iid, "ok": item.get("status") != "failed", "summary": ""}))
            elif it == "web_search":
                q = redact_text(str(item.get("query", "")), 300)
                if started:
                    out.append(("tool.call", {"tool_id": iid, "tool": "web_search", "kind": "web", "summary": q or "Recherche web"}))
                else:
                    out.append(("tool.result", {"tool_id": iid, "ok": item.get("status") != "failed", "summary": q}))
            elif it == "error" and item.get("message"):
                self._failed = str(item["message"])
        elif t == "turn.completed":
            self._completed = True
            u = m.get("usage") or {}
            self._usage = {"input_tokens": int(u.get("input_tokens", 0)), "output_tokens": int(u.get("output_tokens", 0))}
        elif t in ("turn.failed", "error"):
            err = m.get("error")
            self._failed = str(err.get("message") if isinstance(err, dict) else (err or m.get("message") or "échec"))
        return out

    def finish(self, returncode: int, stderr_tail: str, timed_out: bool, cancelled: bool) -> Outcome:
        common = dict(num_turns=self._turns or None, usage=self._usage, session_id=self._session, cost_usd_estimate=None)
        if cancelled:
            return Outcome(status="cancelled", **common)
        if timed_out:
            return Outcome(status="failed", error_class="timeout", error_message="Durée maximale dépassée", **common)
        if returncode == 0 and self._completed and not self._failed:
            return Outcome(status="succeeded", result_text=self._last_text, **common)
        blob = " ".join(x for x in [self._failed, stderr_tail] if x)
        msg = redact_text((self._failed or stderr_tail or f"Le client a quitté avec le code {returncode}").strip(), 600)
        return Outcome(status="failed", error_class=classify_error(blob), error_message=msg, result_text=self._last_text or None, **common)


_WINDOW_NAME = {300: "five_hour", 10080: "seven_day"}


def _limit_window(w: Any, ts: str | None) -> dict | None:
    """Une fenêtre `rate_limits.primary|secondary` de Codex -> {window, status, used_percent, resets_at}."""
    from datetime import datetime, timedelta, timezone
    if not isinstance(w, dict):
        return None
    try:
        used = float(w.get("used_percent"))
    except (TypeError, ValueError):
        return None
    mins = w.get("window_minutes")
    mins = int(mins) if isinstance(mins, (int, float)) and 0 < mins < 10 ** 6 else None
    resets = None
    if isinstance(w.get("resets_at"), (int, float)):
        resets = datetime.fromtimestamp(float(w["resets_at"]), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    elif isinstance(w.get("resets_in_seconds"), (int, float)) and ts:
        try:
            base = datetime.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
            resets = (base + timedelta(seconds=float(w["resets_in_seconds"]))).strftime("%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            resets = None
    used = max(0.0, min(100.0, used))
    return {"window": _WINDOW_NAME.get(mins or 0) or (f"{mins}_min" if mins else "inconnue"),
            "status": "limited" if used >= 100 else ("warning" if used >= 80 else "ok"),
            "used_percent": round(used, 1), "resets_at": resets}


def read_rollout_limits(path: Path, max_bytes: int = 4 * 1024 * 1024) -> list[dict]:
    """Dernières limites d'usage notées dans un fichier de session Codex (lecture seule, fin du fichier seulement)."""
    last: tuple[dict, str | None] | None = None
    try:
        with path.open("rb") as f:
            size = f.seek(0, 2)
            f.seek(max(0, size - max_bytes))
            for raw in f:
                if b'"rate_limits"' not in raw:
                    continue
                try:
                    d = json.loads(raw.decode("utf-8", errors="replace"))
                except json.JSONDecodeError:
                    continue
                p = d.get("payload") if isinstance(d.get("payload"), dict) else d
                rl = p.get("rate_limits") if isinstance(p, dict) else None
                if isinstance(rl, dict):
                    last = (rl, d.get("timestamp"))
    except OSError:
        return []
    if not last:
        return []
    rl, ts = last
    return [x for x in (_limit_window(rl.get("primary"), ts), _limit_window(rl.get("secondary"), ts)) if x]


def latest_rollout_limits(home: Path) -> list[dict]:
    """Limites relevées dans la session Codex la plus récente (amorçage au démarrage, avant toute exécution)."""
    root = home / ".codex" / "sessions"
    try:
        days = sorted(root.glob("*/*/*"))[-3:]
        files = sorted((f for d in days for f in d.glob("rollout-*.jsonl")), key=lambda f: f.stat().st_mtime)
    except OSError:
        return []
    for f in reversed(files[-5:]):
        lim = read_rollout_limits(f)
        if lim:
            return lim
    return []
