"""File d'exécution : concurrence bornée (globale et par fournisseur), reprise au démarrage, annulation, approbation."""
from __future__ import annotations

import asyncio
import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import Settings
from .db import Database, new_id, now_iso
from .events import EventJournal
from .executor import Executor
from .providers import Adapter, ClaudeAdapter, CodexAdapter, RunContext
from .briefs import extract_brief
from .providers.claude import apply_memory_update
from .providers.status import ProviderStatus
from .redact import redact_text

ADAPTERS: dict[str, type[Adapter]] = {"claude": ClaudeAdapter, "codex": CodexAdapter}
MAX_EVENTS_PER_RUN = 4000
PAUSED_MESSAGE = "Arrêt d'urgence actif : aucun nouveau lancement n'est possible."


class PausedError(Exception):
    """Levée quand un lancement est demandé pendant un arrêt d'urgence."""


@dataclass
class Handle:
    task: asyncio.Task
    cancel: asyncio.Event
    provider: str


def conversation_kind(trigger: str | None, notify_target: str | None) -> str | None:
    """Échange en direct avec l'utilisateur : « discord » (/parler), « chat » (page Chat, réponses), sinon None (mission)."""
    if notify_target == "discord":
        return "discord"
    if notify_target == "chat" or trigger == "reply":
        return "chat"
    return None


def agent_dict(row) -> dict[str, Any]:
    d = dict(row)
    d["avatar"] = json.loads(d.pop("avatar_json"))
    d["config"] = json.loads(d.pop("config_json"))
    d["enabled"] = bool(d["enabled"])
    return d


class Worker:
    def __init__(self, settings: Settings, db: Database, journal: EventJournal, executor: Executor, status: ProviderStatus):
        self.s, self.db, self.journal, self.executor, self.status = settings, db, journal, executor, status
        self._running: dict[str, Handle] = {}
        self._wake = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._control = db.kv_get("control", None) or {"paused": False, "since": None, "reason": None, "cancelled": None}

    # --- cycle de vie ---------------------------------------------------------
    async def start(self) -> None:
        await self.executor.stop_stale_units()
        self._recover()
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
        for h in list(self._running.values()):
            h.cancel.set()
        if self._running:
            await asyncio.wait([h.task for h in self._running.values()], timeout=20)

    def _recover(self) -> None:
        for r in self.db.all("SELECT * FROM runs WHERE status='running'"):
            self._finalize(r["id"], r["agent_id"], status="failed", error_class="transient",
                           error_message="Interrompue par le redémarrage du noyau", duration_ms=None)

    # --- arrêt d'urgence --------------------------------------------------------
    def is_paused(self) -> bool:
        return bool(self._control.get("paused"))

    def control(self) -> dict:
        c = self._control
        return {"paused": bool(c.get("paused")), "since": c.get("since"), "reason": c.get("reason"), "cancelled": c.get("cancelled")}

    def _save_control(self, **changes) -> None:
        self._control = {**self._control, **changes}
        self.db.kv_set("control", self._control)

    async def emergency_stop(self, reason: str | None = None) -> dict:
        """Bloque tout nouveau lancement PUIS annule ce qui est actif : en cours, en file, en attente d'approbation."""
        reason = redact_text((reason or "").strip(), 300) or None
        first = not self.is_paused()
        if first:
            self._save_control(paused=True, since=now_iso(), reason=reason, cancelled=0)
        n = 0
        for h in list(self._running.values()):  # exécutions en cours : arrêt du cgroup par l'exécuteur
            h.cancel.set()
            n += 1
        pending = self.db.all("SELECT id, agent_id FROM runs WHERE status IN ('queued','awaiting_approval')")
        for r in pending:
            cur = self.db.execute("UPDATE runs SET status='cancelled', finished_at=? WHERE id=? AND status IN ('queued','awaiting_approval')", (now_iso(), r["id"]))
            if cur.rowcount:
                self.journal.emit("run.cancelled", agent_id=r["agent_id"], run_id=r["id"], payload={"reason": "arrêt d'urgence"})
                n += 1
        await self.executor.stop_stale_units()  # filet de sécurité : plus aucune unité d'exécution ne doit survivre
        total = int(self._control.get("cancelled") or 0) + n
        self._save_control(cancelled=total)
        if first or n:
            self.journal.emit("system.emergency_stop", payload={"reason": reason or "", "cancelled": total})
        return self.control()

    def resume(self) -> dict:
        if self.is_paused():
            self._save_control(paused=False, since=None, reason=None, cancelled=None)
            self.journal.emit("system.resumed", payload={})
            self._wake.set()
        return self.control()

    @property
    def running_count(self) -> int:
        return len(self._running)

    def queue_depth(self) -> int:
        return int(self.db.one("SELECT COUNT(*) AS n FROM runs WHERE status='queued'")["n"])

    # --- création et décisions humaines --------------------------------------
    def create_run(self, agent, prompt: str, trigger: str, schedule_id: str | None = None, parent_run_id: str | None = None,
                   conversation_id: str | None = None, notify_target: str | None = None) -> dict:
        if self.is_paused():
            raise PausedError(PAUSED_MESSAGE)
        a = agent_dict(agent) if not isinstance(agent, dict) else agent
        need_ok = bool(a["config"].get("require_approval"))
        status = "awaiting_approval" if need_ok else "queued"
        rid = new_id("run")
        self.db.execute("INSERT INTO runs(id,agent_id,provider,status,trigger,prompt,created_at,schedule_id,parent_run_id,conversation_id,notify_target) "
                        "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                        (rid, a["id"], a["provider"], status, trigger, prompt, now_iso(), schedule_id, parent_run_id, conversation_id, notify_target))
        preview = redact_text(prompt, 200)
        self.journal.emit("run.queued", agent_id=a["id"], run_id=rid, payload={"trigger": trigger, "prompt_preview": preview,
                                                                          "conversation": conversation_kind(trigger, notify_target)})
        if need_ok:
            self.journal.emit("run.awaiting_approval", agent_id=a["id"], run_id=rid, payload={"prompt_preview": preview})
        else:
            self._wake.set()
        return dict(self.db.one("SELECT * FROM runs WHERE id=?", (rid,)))

    def approve(self, run_id: str) -> bool:
        if self.is_paused():
            raise PausedError(PAUSED_MESSAGE)
        cur = self.db.execute("UPDATE runs SET status='queued' WHERE id=? AND status='awaiting_approval'", (run_id,))
        if cur.rowcount:
            r = self.db.one("SELECT agent_id FROM runs WHERE id=?", (run_id,))
            self.journal.emit("run.approved", agent_id=r["agent_id"], run_id=run_id)
            self._wake.set()
        return bool(cur.rowcount)

    def reject(self, run_id: str) -> bool:
        cur = self.db.execute("UPDATE runs SET status='cancelled', finished_at=? WHERE id=? AND status='awaiting_approval'", (now_iso(), run_id))
        if cur.rowcount:
            r = self.db.one("SELECT agent_id FROM runs WHERE id=?", (run_id,))
            self.journal.emit("run.rejected", agent_id=r["agent_id"], run_id=run_id)
            self.journal.emit("run.cancelled", agent_id=r["agent_id"], run_id=run_id)
        return bool(cur.rowcount)

    def cancel(self, run_id: str) -> bool:
        h = self._running.get(run_id)
        if h:
            h.cancel.set()
            return True
        cur = self.db.execute("UPDATE runs SET status='cancelled', finished_at=? WHERE id=? AND status IN ('queued','awaiting_approval')",
                              (now_iso(), run_id))
        if cur.rowcount:
            r = self.db.one("SELECT agent_id FROM runs WHERE id=?", (run_id,))
            self.journal.emit("run.cancelled", agent_id=r["agent_id"], run_id=run_id)
        return bool(cur.rowcount)

    # --- boucle ---------------------------------------------------------------
    async def _loop(self) -> None:
        while True:
            try:
                await asyncio.wait_for(self._wake.wait(), 3.0)
            except asyncio.TimeoutError:
                pass
            self._wake.clear()
            try:
                while self._dispatch_one():
                    pass
            except Exception as e:  # noqa: BLE001
                self.journal.emit("system.notice", payload={"level": "error", "message": f"file d'exécution : {e}"})

    def _dispatch_one(self) -> bool:
        if self.is_paused() or len(self._running) >= self.s.max_concurrency:
            return False
        per: dict[str, int] = {}
        for h in self._running.values():
            per[h.provider] = per.get(h.provider, 0) + 1
        for r in self.db.all("SELECT * FROM runs WHERE status='queued' ORDER BY created_at, rowid LIMIT 50"):
            if r["id"] in self._running:
                continue
            if per.get(r["provider"], 0) >= self.s.provider_limits.get(r["provider"], 1):
                continue
            ag = self.db.one("SELECT * FROM agents WHERE id=?", (r["agent_id"],))
            if ag is None:
                self.db.execute("UPDATE runs SET status='failed', error_class='failed', error_message='agent supprimé', finished_at=? WHERE id=?", (now_iso(), r["id"]))
                continue
            cancel = asyncio.Event()
            self.db.execute("UPDATE runs SET status='running', started_at=? WHERE id=?", (now_iso(), r["id"]))
            resume = None
            if r["parent_run_id"]:
                p = self.db.one("SELECT session_id FROM runs WHERE id=?", (r["parent_run_id"],))
                resume = p["session_id"] if p else None
            task = asyncio.create_task(self._execute(r["id"], agent_dict(ag), r["prompt"], cancel, resume))
            self._running[r["id"]] = Handle(task, cancel, r["provider"])
            return True
        return False

    # --- exécution d'un run ---------------------------------------------------
    async def _execute(self, run_id: str, agent: dict, prompt: str, cancel: asyncio.Event, resume: str | None = None) -> None:
        t0 = asyncio.get_event_loop().time()
        aid = agent["id"]
        count = 0

        def emit(type_: str, payload: dict | None = None) -> None:
            nonlocal count
            count += 1
            if count <= MAX_EVENTS_PER_RUN:
                self.journal.emit(type_, agent_id=aid, run_id=run_id, payload=payload)

        try:
            self.db.execute("UPDATE runs SET started_at=? WHERE id=?", (now_iso(), run_id))
            emit("run.started", {"provider": agent["provider"], "model": agent.get("model")})
            info = await self.status.refresh(agent["provider"])
            if not info["installed"]:
                return self._fail(run_id, aid, "failed", f"Client {info['name']} non installé", t0)
            if info["auth"]["state"] == "logged_out":
                return self._fail(run_id, aid, "auth_expired", f"{info['name']} n'est pas connecté : connectez-vous en SSH (voir Fournisseurs)", t0)
            adapter = ADAPTERS[agent["provider"]]()
            cwd = self.s.workspace_dir / agent["slug"]
            cwd.mkdir(parents=True, exist_ok=True)
            run_dir = self.s.data_dir / "runs" / run_id
            run_dir.mkdir(parents=True, exist_ok=True)
            timeout_s = int((agent["config"] or {}).get("max_runtime_s") or self.s.default_timeout_s)
            binp = self.s.claude_bin if agent["provider"] == "claude" else self.s.codex_bin
            ctx = RunContext(run_id, agent, prompt, cwd, run_dir, timeout_s, self.s.agent_home, binp, resume_session=resume)
            cmd = adapter.build(ctx)
            for p, content in cmd.files.items():
                p.write_text(content, encoding="utf-8")
                p.chmod(0o600)

            model_seen = False

            def note_model(m: str | None) -> None:
                nonlocal model_seen
                if m and not model_seen:
                    model_seen = True
                    self.db.execute("UPDATE runs SET model=? WHERE id=?", (m, run_id))
                    emit("run.model", {"model": m})

            def on_line(line: str) -> None:
                for typ, payload in adapter.parse(line):
                    if typ == "run.model":
                        note_model(payload.get("model"))
                        continue
                    if not model_seen and typ in ("run.message", "tool.call") and adapter.session_id:
                        note_model(adapter.resolve_model(self.s.agent_home))
                    if typ == "run.session":
                        self.db.execute("UPDATE runs SET session_id=? WHERE id=?", (payload["session_id"], run_id))
                    if typ == "run.rate_limit":
                        self.status.note_rate_limit(agent["provider"], payload.get("status", ""), payload.get("resets_at"),
                                                    payload.get("window"), payload.get("used_percent"))
                    emit(typ, payload)

            res = await self.executor.run(cmd, unit=f"roai-run-{run_id}", cwd=cwd, timeout_s=timeout_s, on_line=on_line, cancel=cancel)
            if not model_seen:
                note_model(adapter.resolve_model(self.s.agent_home))
            try:  # Codex : limites lues dans son fichier de session (jamais bloquant pour l'exécution)
                for lim in adapter.resolve_rate_limits(self.s.agent_home):
                    self.status.note_rate_limit(agent["provider"], lim["status"], lim["resets_at"], lim["window"], lim["used_percent"])
                    emit("run.rate_limit", lim)
            except Exception:  # noqa: BLE001
                pass
            out = adapter.finish(res.returncode, res.stderr_tail, res.timed_out, res.cancelled)
            dur = int((asyncio.get_event_loop().time() - t0) * 1000)
            result_text = out.result_text
            if out.status == "succeeded" and agent["provider"] == "claude":
                # mode léger avec fichier mémoire : RO·AI enregistre la mise à jour renvoyée dans la réponse
                result_text, wrote = apply_memory_update(cwd, agent["config"] or {}, result_text)
                if wrote is not None:
                    emit("agent.memory", {"file": (agent["config"] or {}).get("memory_file"), "bytes": wrote})
            if out.status == "succeeded" and (agent["config"] or {}).get("discord_brief"):
                # résumé Discord marqué par l'agent : retiré du résultat, envoyé seul par le service Discord
                result_text, brief = extract_brief(result_text)
                if brief:
                    emit("discord.brief", {"text": brief})
            self._finalize(run_id, aid, status=out.status, error_class=out.error_class, error_message=out.error_message,
                           duration_ms=dur, num_turns=out.num_turns, cost=out.cost_usd_estimate, usage=out.usage,
                           result_text=result_text, session_id=out.session_id)
        except Exception as e:  # noqa: BLE001
            self._fail(run_id, aid, "failed", f"erreur interne : {type(e).__name__}: {e}", t0)
        finally:
            self._running.pop(run_id, None)
            shutil.rmtree(self.s.data_dir / "runs" / run_id, ignore_errors=True)
            self._wake.set()

    def _fail(self, run_id: str, aid: str, cls: str, msg: str, t0: float) -> None:
        dur = int((asyncio.get_event_loop().time() - t0) * 1000)
        self._finalize(run_id, aid, status="failed", error_class=cls, error_message=msg, duration_ms=dur)

    def _finalize(self, run_id: str, aid: str, *, status: str, error_class: str | None = None, error_message: str | None = None,
                  duration_ms: int | None = None, num_turns: int | None = None, cost: float | None = None,
                  usage: dict | None = None, result_text: str | None = None, session_id: str | None = None) -> None:
        self.db.execute(
            "UPDATE runs SET status=?, finished_at=?, duration_ms=?, error_class=?, error_message=?, num_turns=?, cost_usd_estimate=?, "
            "input_tokens=?, output_tokens=?, result_text=?, session_id=COALESCE(?, session_id) WHERE id=?",
            (status, now_iso(), duration_ms, error_class, redact_text(error_message or "", 1000) or None, num_turns, cost,
             (usage or {}).get("input_tokens"), (usage or {}).get("output_tokens"),
             redact_text(result_text, 20000) if result_text else None, session_id, run_id))
        if status == "succeeded":
            self.journal.emit("run.succeeded", agent_id=aid, run_id=run_id,
                              payload={"duration_ms": duration_ms, "num_turns": num_turns, "cost_usd_estimate": cost,
                                       "result_preview": redact_text(result_text or "", 400)})
        elif status == "cancelled":
            self.journal.emit("run.cancelled", agent_id=aid, run_id=run_id)
        else:
            self.journal.emit("run.failed", agent_id=aid, run_id=run_id,
                              payload={"error_class": error_class, "error_message": error_message, "duration_ms": duration_ms})
