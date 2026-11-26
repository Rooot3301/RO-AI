"""API du noyau (contrat docs/API.md). Écoute sur un socket Unix ; seul le serveur web y accède."""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import psutil
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response, StreamingResponse

from . import __version__
from .config import Settings
from .db import Database, new_id, now_iso
from .devwork import DevWork
from .inbox import Inbox, InboxError
from .society import Society
from .discord_service import DiscordService
from .discord_settings import AgentWebhookIn, DiscordSettingsIn, DiscordTestIn
from .events import EventJournal
from .executor import Executor
from .office_boards import planning as office_planning
from .models import AgentIn, AgentRunIn, ControlStopIn, InboxSourceIn, RunIn, RunReplyIn, ScheduleIn
from .profile_api import register_profiles
from .providers.catalog import codex_models
from .providers.codex import latest_rollout_limits
from .providers.status import ProviderStatus
from .scheduler import Scheduler, next_run, validate_cron
from .worker import ADAPTERS, PausedError, Worker, agent_dict, conversation_kind

STARTED = time.time()
DEPT_PRESETS = ["Veille", "Infrastructure", "Développement", "Documentation", "Direction"]


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower().replace("é", "e").replace("è", "e").replace("à", "a").replace("ç", "c")).strip("-")
    return (s or "agent")[:36]


def run_out(r, agent_name: str | None = None) -> dict:
    d = dict(r)
    if agent_name is None:
        a = APP_DB().one("SELECT name FROM agents WHERE id=?", (d["agent_id"],))
        agent_name = a["name"] if a else "(supprimé)"
    usage = {"input_tokens": d["input_tokens"], "output_tokens": d["output_tokens"]} if d.get("input_tokens") is not None else None
    return {"id": d["id"], "agent_id": d["agent_id"], "agent_name": agent_name, "provider": d["provider"], "status": d["status"],
            "trigger": d["trigger"], "prompt": d["prompt"], "session_id": d["session_id"], "created_at": d["created_at"],
            "started_at": d["started_at"], "finished_at": d["finished_at"], "duration_ms": d["duration_ms"],
            "error_class": d["error_class"], "error_message": d["error_message"], "num_turns": d["num_turns"],
            "cost_usd_estimate": d["cost_usd_estimate"], "usage": usage, "result_text": d["result_text"], "schedule_id": d["schedule_id"],
            "parent_run_id": d.get("parent_run_id"), "conversation_id": d.get("conversation_id"),
            "model": d.get("model")}


_db_ref: dict[str, Database] = {}
_hooks_ref: dict = {}


def APP_DB() -> Database:
    return _db_ref["db"]


def derive_state(agent: dict, latest) -> tuple[str, str | None]:
    """État dérivé d'un agent (voir docs/API.md) : strictement fonction du journal des exécutions."""
    if not agent["enabled"]:
        return "disabled", None
    db = APP_DB()
    if db.one("SELECT 1 FROM runs WHERE agent_id=? AND status='running' LIMIT 1", (agent["id"],)):
        return "working", None
    if db.one("SELECT 1 FROM runs WHERE agent_id=? AND status IN ('queued','awaiting_approval') LIMIT 1", (agent["id"],)):
        return "waiting", None
    if latest is not None and latest["status"] == "failed":
        return "error", latest["error_class"]
    return "idle", None


def agent_out(row) -> dict:
    a = agent_dict(row)
    db = APP_DB()
    latest = db.one("SELECT * FROM runs WHERE agent_id=? AND status NOT IN ('queued','awaiting_approval','running') ORDER BY created_at DESC, rowid DESC LIMIT 1", (a["id"],))
    a["state"], _ = derive_state(a, latest)
    hooks = _hooks_ref.get("hooks")
    a["discord_webhook_set"] = bool(hooks and hooks.has(a["id"]))
    lm = db.one("SELECT model FROM runs WHERE agent_id=? AND model IS NOT NULL ORDER BY created_at DESC, rowid DESC LIMIT 1", (a["id"],))
    a["last_model"] = lm["model"] if lm else None
    a["last_run"] = ({"id": latest["id"], "status": latest["status"], "finished_at": latest["finished_at"], "error_class": latest["error_class"]}
                     if latest else None)
    return a


def schedule_out(r) -> dict:
    d = dict(r)
    d["enabled"] = bool(d["enabled"])
    d.pop("created_at", None)
    return d


CONV_LINGER_S = 300   # après sa dernière réponse, l'agent reste en salle de réunion 5 min (la conversation peut reprendre)


def create_app(settings: Settings | None = None) -> FastAPI:
    s = settings or Settings.from_env()
    for p in (s.data_dir, s.workspace_dir, s.logs_dir):
        p.mkdir(parents=True, exist_ok=True)
    os.umask(0o077)
    db = Database(s.db_path)
    _db_ref["db"] = db
    journal = EventJournal(db, s.domain)
    status = ProviderStatus(s, db, lambda pid, st: journal.emit("provider.auth", payload={"provider": pid, "state": st}))
    executor = Executor(s)
    worker = Worker(s, db, journal, executor, status)
    scheduler = Scheduler(db, journal, worker)
    discord_svc = DiscordService(s, db, journal, worker, status, scheduler)
    _hooks_ref["hooks"] = discord_svc.agent_hooks
    psutil.cpu_percent(None)

    async def housekeeping() -> None:
        n = 0
        while True:
            await asyncio.sleep(300)
            try:
                await status.all(max_age_s=0)
                n += 1
                if n % 12 == 0:
                    journal.prune(s.event_retention_days)
            except Exception as e:  # noqa: BLE001
                journal.emit("system.notice", payload={"level": "warn", "message": f"entretien : {e}"})

    async def inbox_loop() -> None:
        """Livraisons : lance le traitement suivant dès qu'un agent est libre ; ménage quotidien (30 jours)."""
        n = 0
        while True:
            await asyncio.sleep(5)
            try:
                inbox.dispatch()
                n += 1
                if n % 17280 == 1:
                    inbox.prune()
            except Exception as e:  # noqa: BLE001
                journal.emit("system.notice", payload={"level": "warn", "message": f"livraisons : {e}"})

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await executor.detect()
        await worker.start()
        tasks = [asyncio.create_task(scheduler.loop()), asyncio.create_task(housekeeping()), asyncio.create_task(inbox_loop()), asyncio.create_task(society.loop())]
        await discord_svc.start()
        for pid in ("claude", "codex"):
            try:
                await status.refresh(pid)
            except Exception:  # noqa: BLE001
                pass
        journal.emit("system.notice", payload={"level": "info" if executor.mode == "systemd" else "warn",
                                               "message": f"Noyau démarré v{__version__}. Exécution : {executor.mode} ({executor.detail})"})
        if worker.is_paused():
            journal.emit("system.notice", payload={"level": "warn", "message": "Arrêt d'urgence actif depuis le dernier démarrage : reprise manuelle requise."})
        try:
            yield
        finally:
            for t in tasks:
                t.cancel()
            await discord_svc.stop()
            await worker.stop()
            db.close()

    app = FastAPI(title="RO·AI noyau", version=__version__, lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings, app.state.db, app.state.journal, app.state.worker = s, db, journal, worker
    app.state.provider_status = status
    app.state.discord = discord_svc
    devwork = app.state.devwork = DevWork()
    inbox = app.state.inbox = Inbox(db, journal, worker, s.workspace_dir)
    society = app.state.society = Society(s, db, journal, executor, worker, status, ADAPTERS)
    register_profiles(app, s, db, journal, executor, worker, status)

    # --- santé et système -----------------------------------------------------
    @app.get("/api/health")
    def health():
        return {"status": "ok", "version": __version__, "uptime_s": int(time.time() - STARTED), "domain": s.domain}

    @app.get("/api/system")
    def system():
        vm, sw = psutil.virtual_memory(), psutil.swap_memory()
        du = psutil.disk_usage("/srv/ai" if Path("/srv/ai").exists() else "/")
        cg = Path("/sys/fs/cgroup/user.slice/user-1000.slice/user@1000.service")
        ai = None
        try:
            cur = int((cg / "memory.current").read_text())
            mx = (cg / "memory.max").read_text().strip()
            ai = {"mem_current": cur, "mem_max": None if mx == "max" else int(mx)}
        except (OSError, ValueError):
            pass
        return {"cpu_percent": psutil.cpu_percent(None), "load": list(os.getloadavg()),
                "mem": {"total": vm.total, "used": vm.total - vm.available, "available": vm.available, "percent": vm.percent},
                "swap": {"total": sw.total, "used": sw.used, "percent": sw.percent},
                "disk": {"total": du.total, "used": du.used, "percent": du.percent},
                "uptime_s": int(time.time() - psutil.boot_time()), "ai_slice": ai,
                "agents_running": worker.running_count, "queue_depth": worker.queue_depth()}

    # --- fournisseurs ---------------------------------------------------------
    @app.get("/api/providers")
    async def providers():
        return await status.all()

    @app.get("/api/providers/codex/models")
    def codex_models_list():
        return {"models": codex_models(s.agent_home)}

    @app.post("/api/providers/{pid}/refresh")
    async def provider_refresh(pid: str):
        if pid not in ("claude", "codex"):
            raise HTTPException(404, "fournisseur inconnu")
        return await status.refresh(pid)

    # --- agents ---------------------------------------------------------------
    def _check_effort(a: AgentIn) -> None:
        """L'effort de raisonnement n'existe que pour Codex et dépend du modèle choisi."""
        eff = a.config.reasoning_effort
        if not eff:
            return
        if a.provider != "codex":
            a.config.reasoning_effort = None
            return
        m = next((x for x in codex_models(s.agent_home) if x["slug"] == a.model), None)
        if m and m["efforts"] and eff not in m["efforts"]:
            raise HTTPException(422, f"le modèle {a.model} n'accepte pas l'effort « {eff} » (possibles : {', '.join(m['efforts'])})")

    def _guard_free_mode(a: AgentIn, name: str, old_cfg: dict | None) -> None:
        """Mode libre : approbation humaine obligatoire avant chaque lancement, sauf choix explicite du mode autonome.
        Chaque changement est tracé dans le journal (et donc notifiable)."""
        old_cfg = old_cfg or {}
        was_free, was_auto = bool(old_cfg.get("unrestricted")), bool(old_cfg.get("unrestricted") and old_cfg.get("autonomous"))
        if not a.config.unrestricted:
            a.config.autonomous = None
            return
        if a.config.autonomous:
            if not was_auto:
                journal.emit("system.notice", payload={"level": "warn", "message": f"Mode libre autonome activé pour l'agent « {name} » : sans sandbox et sans approbation."})
            return
        a.config.autonomous = None
        a.config.require_approval = True
        if not was_free or was_auto:
            journal.emit("system.notice", payload={"level": "warn", "message": f"Mode libre activé pour l'agent « {name} » : sans sandbox, approbation obligatoire."})

    def _check_domain(a: AgentIn) -> str:
        return a.domain or s.domain  # simple étiquette pro/perso : les deux partagent les mêmes comptes fournisseurs

    @app.get("/api/agents")
    def agents_list():
        return [agent_out(r) for r in db.all("SELECT * FROM agents ORDER BY created_at, name")]

    @app.post("/api/agents", status_code=201)
    def agent_create(a: AgentIn):
        dom = _check_domain(a)
        _check_effort(a)
        _guard_free_mode(a, a.name, None)
        slug = a.slug or slugify(a.name)
        if db.one("SELECT 1 FROM agents WHERE slug=?", (slug,)):
            if a.slug:
                raise HTTPException(409, "ce slug existe déjà")
            slug = f"{slug[:30]}-{new_id('x')[2:6]}"
        aid, ts = new_id("ag"), now_iso()
        db.execute("INSERT INTO agents(id,slug,name,description,provider,model,mission,default_prompt,department,domain,avatar_json,enabled,config_json,created_at,updated_at) "
                   "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (aid, slug, a.name, a.description, a.provider, a.model, a.mission, a.default_prompt, a.department, dom,
                    json.dumps(a.avatar.model_dump()), int(a.enabled), json.dumps(a.config.model_dump(exclude_none=True)), ts, ts))
        journal.emit("agent.created", agent_id=aid, payload={"name": a.name})
        return agent_out(db.one("SELECT * FROM agents WHERE id=?", (aid,)))

    def _get_agent(aid: str):
        r = db.one("SELECT * FROM agents WHERE id=?", (aid,))
        if not r:
            raise HTTPException(404, "agent introuvable")
        return r

    @app.get("/api/agents/{aid}")
    def agent_get(aid: str):
        return agent_out(_get_agent(aid))

    @app.put("/api/agents/{aid}")
    def agent_update(aid: str, a: AgentIn):
        old = _get_agent(aid)
        dom = _check_domain(a)
        _check_effort(a)
        _guard_free_mode(a, a.name, json.loads(old["config_json"] or "{}"))
        slug = a.slug or old["slug"]
        if slug != old["slug"] and db.one("SELECT 1 FROM agents WHERE slug=? AND id<>?", (slug, aid)):
            raise HTTPException(409, "ce slug existe déjà")
        db.execute("UPDATE agents SET slug=?,name=?,description=?,provider=?,model=?,mission=?,default_prompt=?,department=?,domain=?,avatar_json=?,enabled=?,config_json=?,updated_at=? WHERE id=?",
                   (slug, a.name, a.description, a.provider, a.model, a.mission, a.default_prompt, a.department, dom,
                    json.dumps(a.avatar.model_dump()), int(a.enabled), json.dumps(a.config.model_dump(exclude_none=True)), now_iso(), aid))
        journal.emit("agent.updated", agent_id=aid, payload={"name": a.name})
        if bool(old["enabled"]) != a.enabled:
            journal.emit("agent.enabled" if a.enabled else "agent.disabled", agent_id=aid, payload={"name": a.name})
        return agent_out(_get_agent(aid))

    @app.delete("/api/agents/{aid}", status_code=204)
    def agent_delete(aid: str):
        old = _get_agent(aid)
        if db.one("SELECT 1 FROM runs WHERE agent_id=? AND status IN ('running','queued','awaiting_approval')", (aid,)):
            raise HTTPException(409, "des exécutions sont en cours ou en attente pour cet agent")
        db.execute("DELETE FROM agents WHERE id=?", (aid,))
        discord_svc.agent_hooks.delete(aid)
        journal.emit("agent.deleted", agent_id=aid, payload={"name": old["name"]})
        return Response(status_code=204)

    @app.put("/api/agents/{aid}/discord-webhook")
    def agent_webhook_put(aid: str, body: AgentWebhookIn):
        _get_agent(aid)
        discord_svc.agent_hooks.set(aid, body.webhook_url)
        return {"discord_webhook_set": True}

    @app.delete("/api/agents/{aid}/discord-webhook")
    def agent_webhook_delete(aid: str):
        _get_agent(aid)
        discord_svc.agent_hooks.delete(aid)
        return {"discord_webhook_set": False}

    @app.post("/api/agents/{aid}/discord-webhook/test")
    async def agent_webhook_test(aid: str):
        ag = _get_agent(aid)
        return await discord_svc.test_agent_webhook(aid, ag["name"])

    @app.post("/api/agents/{aid}/run", status_code=202)
    def agent_run(aid: str, body: AgentRunIn | None = None):
        ag = _get_agent(aid)
        if not ag["enabled"]:
            raise HTTPException(409, "agent désactivé")
        prompt = (body.prompt if body and body.prompt else None) or ag["default_prompt"]
        if not prompt:
            raise HTTPException(422, "aucun prompt fourni et l'agent n'a pas de prompt par défaut")
        return run_out(worker.create_run(ag, prompt, "manual", notify_target="chat" if body and body.via == "chat" else None), ag["name"])

    # --- exécutions -----------------------------------------------------------
    @app.get("/api/runs")
    def runs_list(agent_id: str | None = None, status: str | None = None, limit: int = Query(50, ge=1, le=200), before: str | None = None,
                  conversation_id: str | None = None):
        sql, args = "SELECT r.*, a.name AS agent_name FROM runs r LEFT JOIN agents a ON a.id=r.agent_id WHERE 1=1", []
        if conversation_id:
            sql += " AND (r.conversation_id=? OR r.id=?)"; args += [conversation_id, conversation_id]
        if agent_id:
            sql += " AND r.agent_id=?"; args.append(agent_id)
        if status:
            sql += " AND r.status=?"; args.append(status)
        if before:
            sql += " AND r.created_at<?"; args.append(before)
        sql += " ORDER BY r.created_at DESC, r.rowid DESC LIMIT ?"; args.append(limit)
        return [run_out(r, r["agent_name"] or "(supprimé)") for r in db.all(sql, args)]

    def _get_run(rid: str):
        r = db.one("SELECT * FROM runs WHERE id=?", (rid,))
        if not r:
            raise HTTPException(404, "exécution introuvable")
        return r

    @app.get("/api/runs/{rid}")
    def run_get(rid: str):
        return run_out(_get_run(rid))

    @app.get("/api/runs/{rid}/events")
    def run_events(rid: str, since: int = 0):
        _get_run(rid)
        evs = journal.since(since, limit=1000, run_id=rid)
        return {"events": evs, "last_seq": evs[-1]["seq"] if evs else since}

    @app.post("/api/runs", status_code=202)
    def run_create(body: RunIn):
        ag = _get_agent(body.agent_id)
        if not ag["enabled"]:
            raise HTTPException(409, "agent désactivé")
        return run_out(worker.create_run(ag, body.prompt, "api"), ag["name"])

    @app.post("/api/runs/{rid}/reply", status_code=202)
    def run_reply(rid: str, body: RunReplyIn):
        parent = _get_run(rid)
        ag = _get_agent(parent["agent_id"])
        if not ag["enabled"]:
            raise HTTPException(409, "agent désactivé")
        conv = parent["conversation_id"] or parent["id"]
        if db.one("SELECT 1 FROM runs WHERE (conversation_id=? OR id=?) AND status IN ('queued','awaiting_approval','running') LIMIT 1", (conv, conv)):
            raise HTTPException(409, "la réponse précédente n'est pas terminée")
        if not parent["session_id"]:
            raise HTTPException(409, "cette exécution n'a pas de session à reprendre : démarrez une nouvelle conversation")
        db.execute("UPDATE runs SET conversation_id=? WHERE id=? AND conversation_id IS NULL", (conv, parent["id"]))
        run = worker.create_run(ag, body.prompt, "reply", parent_run_id=parent["id"], conversation_id=conv)
        return run_out(run, ag["name"])

    @app.get("/api/conversations/{cid}")
    def conversation_get(cid: str):
        rows = db.all("SELECT r.*, a.name AS agent_name FROM runs r LEFT JOIN agents a ON a.id=r.agent_id "
                      "WHERE r.conversation_id=? OR r.id=? ORDER BY r.created_at, r.rowid", (cid, cid))
        if not rows:
            raise HTTPException(404, "conversation introuvable")
        return {"conversation_id": cid, "agent_id": rows[0]["agent_id"], "agent_name": rows[0]["agent_name"] or "(supprimé)",
                "runs": [run_out(r, r["agent_name"] or "(supprimé)") for r in rows]}

    @app.post("/api/runs/{rid}/cancel")
    def run_cancel(rid: str):
        r = _get_run(rid)
        if r["status"] not in ("running", "queued", "awaiting_approval"):
            raise HTTPException(409, "l'exécution est déjà terminée")
        worker.cancel(rid)
        return run_out(_get_run(rid))

    @app.post("/api/runs/{rid}/approve")
    def run_approve(rid: str):
        _get_run(rid)
        if not worker.approve(rid):
            raise HTTPException(409, "cette exécution n'attend pas d'approbation")
        return run_out(_get_run(rid))

    @app.post("/api/runs/{rid}/reject")
    def run_reject(rid: str):
        _get_run(rid)
        if not worker.reject(rid):
            raise HTTPException(409, "cette exécution n'attend pas d'approbation")
        return run_out(_get_run(rid))

    # --- planifications -------------------------------------------------------
    def _check_schedule(b: ScheduleIn) -> None:
        _get_agent(b.agent_id)
        try:
            validate_cron(b.cron, b.timezone)
        except ValueError as e:
            raise HTTPException(422, str(e))

    @app.get("/api/schedules")
    def schedules_list():
        return [schedule_out(r) for r in db.all("SELECT * FROM schedules ORDER BY created_at")]

    @app.post("/api/schedules", status_code=201)
    def schedule_create(b: ScheduleIn):
        _check_schedule(b)
        sid = new_id("sch")
        nxt = next_run(b.cron, b.timezone) if b.enabled else None
        db.execute("INSERT INTO schedules(id,agent_id,name,cron,timezone,prompt,enabled,next_run_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                   (sid, b.agent_id, b.name, b.cron, b.timezone, b.prompt, int(b.enabled), nxt, now_iso()))
        journal.emit("schedule.created", agent_id=b.agent_id, payload={"name": b.name, "cron": b.cron})
        return schedule_out(db.one("SELECT * FROM schedules WHERE id=?", (sid,)))

    def _get_schedule(sid: str):
        r = db.one("SELECT * FROM schedules WHERE id=?", (sid,))
        if not r:
            raise HTTPException(404, "planification introuvable")
        return r

    @app.put("/api/schedules/{sid}")
    def schedule_update(sid: str, b: ScheduleIn):
        _get_schedule(sid)
        _check_schedule(b)
        nxt = next_run(b.cron, b.timezone) if b.enabled else None
        db.execute("UPDATE schedules SET agent_id=?,name=?,cron=?,timezone=?,prompt=?,enabled=?,next_run_at=? WHERE id=?",
                   (b.agent_id, b.name, b.cron, b.timezone, b.prompt, int(b.enabled), nxt, sid))
        journal.emit("schedule.updated", agent_id=b.agent_id, payload={"name": b.name, "cron": b.cron})
        return schedule_out(_get_schedule(sid))

    @app.delete("/api/schedules/{sid}", status_code=204)
    def schedule_delete(sid: str):
        r = _get_schedule(sid)
        db.execute("DELETE FROM schedules WHERE id=?", (sid,))
        journal.emit("schedule.deleted", agent_id=r["agent_id"], payload={"name": r["name"], "cron": r["cron"]})
        return Response(status_code=204)

    @app.post("/api/schedules/{sid}/run-now", status_code=202)
    def schedule_run_now(sid: str):
        sc = _get_schedule(sid)
        ag = _get_agent(sc["agent_id"])
        if not ag["enabled"]:
            raise HTTPException(409, "agent désactivé")
        run = worker.create_run(ag, sc["prompt"] or ag["default_prompt"] or "Exécute ta mission.", "schedule", schedule_id=sid)
        db.execute("UPDATE schedules SET last_run_at=?, last_run_id=? WHERE id=?", (now_iso(), run["id"], sid))
        journal.emit("schedule.fired", agent_id=sc["agent_id"], run_id=run["id"], payload={"schedule_id": sid, "name": sc["name"]})
        return run_out(run, ag["name"])

    # --- arrêt d'urgence ------------------------------------------------------
    @app.get("/api/control")
    def control_get():
        return worker.control()

    @app.post("/api/control/emergency-stop")
    async def control_stop(body: ControlStopIn | None = None):
        return await worker.emergency_stop(body.reason if body else None)

    @app.post("/api/control/resume")
    def control_resume():
        was = worker.is_paused()
        out = worker.resume()
        if was:
            scheduler.reschedule_all()
        return out

    @app.exception_handler(PausedError)
    async def _paused(_: Request, exc: PausedError):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    # --- réglages Discord -------------------------------------------------------
    @app.get("/api/settings/discord")
    def discord_get():
        return discord_svc.public()

    @app.put("/api/settings/discord")
    async def discord_put(body: DiscordSettingsIn):
        try:
            return await discord_svc.update(body)
        except ValueError as e:
            raise HTTPException(422, str(e))

    @app.post("/api/settings/discord/test")
    async def discord_test(body: DiscordTestIn | None = None):
        return await discord_svc.send_test(body.target if body else "bot")

    @app.exception_handler(RequestValidationError)
    async def _invalid(_: Request, exc: RequestValidationError):
        msgs = []
        for e in exc.errors():
            loc = ".".join(str(x) for x in e.get("loc", []) if x not in ("body", "query", "path"))
            msg = str(e.get("msg", "")).removeprefix("Value error, ")
            msgs.append(f"{loc} : {msg}" if loc else msg)
        return JSONResponse({"detail": " ; ".join(msgs) or "requête invalide"}, status_code=422)

    # --- statistiques de consommation ------------------------------------------
    @app.get("/api/stats")
    def stats(days: int = Query(30, ge=1, le=365)):
        today = datetime.now().astimezone().date()
        first = today - timedelta(days=days - 1)
        f = first.isoformat()
        dexp = "date(created_at,'localtime')"
        base = f"FROM runs WHERE {dexp} >= ?"
        n = lambda v: int(v or 0)
        t = db.one(f"SELECT COUNT(*) runs, SUM(status='succeeded') ok, SUM(status='failed') ko, SUM(status='cancelled') ca, SUM(status='running') ru, "
                   f"SUM(COALESCE(input_tokens,0)) ti, SUM(COALESCE(output_tokens,0)) tou, SUM(COALESCE(cost_usd_estimate,0)) cost, "
                   f"SUM(CASE WHEN status IN ('succeeded','failed') THEN COALESCE(duration_ms,0) ELSE 0 END) dsum, "
                   f"SUM(CASE WHEN status IN ('succeeded','failed') AND duration_ms IS NOT NULL THEN 1 ELSE 0 END) dn {base}", (f,))
        fin = n(t["ok"]) + n(t["ko"])
        totals = {"runs": n(t["runs"]), "succeeded": n(t["ok"]), "failed": n(t["ko"]), "cancelled": n(t["ca"]), "running": n(t["ru"]),
                  "success_rate": (n(t["ok"]) / fin) if fin else None, "duration_ms_total": n(t["dsum"]),
                  "duration_ms_avg": (n(t["dsum"]) / n(t["dn"])) if n(t["dn"]) else None,
                  "input_tokens": n(t["ti"]), "output_tokens": n(t["tou"]), "cost_usd_estimate": round(float(t["cost"] or 0), 4)}
        rows = {r["d"]: r for r in db.all(f"SELECT {dexp} d, COUNT(*) runs, SUM(status='succeeded') ok, SUM(status='failed') ko, SUM(status='cancelled') ca, "
                                          f"SUM(COALESCE(input_tokens,0)) ti, SUM(COALESCE(output_tokens,0)) tou, SUM(COALESCE(cost_usd_estimate,0)) cost {base} GROUP BY d", (f,))}
        by_day = []
        for i in range(days):
            d = (first + timedelta(days=i)).isoformat()
            r = rows.get(d)
            by_day.append({"date": d, "runs": n(r and r["runs"]), "succeeded": n(r and r["ok"]), "failed": n(r and r["ko"]), "cancelled": n(r and r["ca"]),
                           "input_tokens": n(r and r["ti"]), "output_tokens": n(r and r["tou"]), "cost_usd_estimate": round(float((r and r["cost"]) or 0), 4)})
        by_provider = [{"provider": r["provider"], "runs": n(r["runs"]), "succeeded": n(r["ok"]), "failed": n(r["ko"]), "rate_limited": n(r["rl"]),
                        "input_tokens": n(r["ti"]), "output_tokens": n(r["tou"]), "cost_usd_estimate": round(float(r["cost"] or 0), 4)}
                       for r in db.all(f"SELECT provider, COUNT(*) runs, SUM(status='succeeded') ok, SUM(status='failed') ko, SUM(error_class='rate_limited') rl, "
                                       f"SUM(COALESCE(input_tokens,0)) ti, SUM(COALESCE(output_tokens,0)) tou, SUM(COALESCE(cost_usd_estimate,0)) cost {base} GROUP BY provider ORDER BY runs DESC", (f,))]
        by_agent = []
        for r in db.all(f"SELECT r.agent_id aid, COALESCE(a.name,'(supprimé)') name, r.provider prov, COUNT(*) runs, SUM(r.status='succeeded') ok, SUM(r.status='failed') ko, "
                        f"SUM(CASE WHEN r.status IN ('succeeded','failed') THEN COALESCE(r.duration_ms,0) ELSE 0 END) dsum, "
                        f"SUM(CASE WHEN r.status IN ('succeeded','failed') AND r.duration_ms IS NOT NULL THEN 1 ELSE 0 END) dn, "
                        f"SUM(COALESCE(r.input_tokens,0)) ti, SUM(COALESCE(r.output_tokens,0)) tou, SUM(COALESCE(r.cost_usd_estimate,0)) cost "
                        f"FROM runs r LEFT JOIN agents a ON a.id=r.agent_id WHERE date(r.created_at,'localtime') >= ? GROUP BY r.agent_id, r.provider ORDER BY runs DESC, name", (f,)):
            fin_a = n(r["ok"]) + n(r["ko"])
            by_agent.append({"agent_id": r["aid"], "name": r["name"], "provider": r["prov"], "runs": n(r["runs"]), "succeeded": n(r["ok"]), "failed": n(r["ko"]),
                             "success_rate": (n(r["ok"]) / fin_a) if fin_a else None, "duration_ms_avg": (n(r["dsum"]) / n(r["dn"])) if n(r["dn"]) else None,
                             "input_tokens": n(r["ti"]), "output_tokens": n(r["tou"]), "cost_usd_estimate": round(float(r["cost"] or 0), 4)})
        by_hour = [0] * 24
        for r in db.all(f"SELECT CAST(strftime('%H', started_at, 'localtime') AS INTEGER) h, COUNT(*) c {base} AND started_at IS NOT NULL GROUP BY h", (f,)):
            by_hour[int(r["h"])] = n(r["c"])
        errors = [{"error_class": r["error_class"], "count": n(r["c"])}
                  for r in db.all(f"SELECT error_class, COUNT(*) c {base} AND error_class IS NOT NULL GROUP BY error_class ORDER BY c DESC", (f,))]
        return {"days": days, "from": f, "to": today.isoformat(), "totals": totals, "by_day": by_day, "by_provider": by_provider,
                "by_agent": by_agent, "by_hour": by_hour, "errors": errors}

    # --- événements -----------------------------------------------------------
    @app.get("/api/events")
    def events_list(since: int = 0, limit: int = Query(200, ge=1, le=1000), agent_id: str | None = None, run_id: str | None = None,
                    type_prefix: str | None = None):
        evs = journal.since(since, limit, agent_id, run_id, type_prefix)
        return {"events": evs, "last_seq": evs[-1]["seq"] if evs else max(since, journal.last_seq() if not evs and since == 0 else since)}

    @app.get("/api/events/stream")
    async def events_stream(request: Request, since: int = 0):
        lid = request.headers.get("last-event-id")
        if lid and lid.isdigit():
            since = int(lid)

        async def gen():
            async for ev in journal.stream(since):
                if ev is None:
                    yield ": keepalive\n\n"
                else:
                    yield f"id: {ev['seq']}\nevent: roai\ndata: {json.dumps(ev, ensure_ascii=False)}\n\n"

        return StreamingResponse(gen(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

    # --- bureau virtuel -------------------------------------------------------
    @app.get("/api/office/snapshot")
    def office_snapshot():
        seq = journal.last_seq()
        linger_from = (datetime.now(timezone.utc) - timedelta(seconds=CONV_LINGER_S)).strftime("%Y-%m-%dT%H:%M:%SZ")
        agents = []
        pending = inbox.pending_by_agent()
        for row in db.all("SELECT * FROM agents ORDER BY created_at, name"):
            a = agent_dict(row)
            latest = db.one("SELECT * FROM runs WHERE agent_id=? AND status NOT IN ('queued','awaiting_approval','running') ORDER BY created_at DESC, rowid DESC LIMIT 1", (a["id"],))
            state, err = derive_state(a, latest)
            run_id, activity, kind, since = None, None, None, a["updated_at"]
            if state == "working":
                r = db.one("SELECT id, started_at FROM runs WHERE agent_id=? AND status='running' ORDER BY started_at DESC LIMIT 1", (a["id"],))
                if r:
                    run_id, since = r["id"], r["started_at"] or since
                    ev = db.one("SELECT payload FROM events WHERE run_id=? AND type='tool.call' ORDER BY seq DESC LIMIT 1", (r["id"],))
                    if ev:
                        p = json.loads(ev["payload"])
                        activity, kind = p.get("summary"), p.get("kind")
                    else:
                        activity = "Démarre"
            elif state == "waiting":
                r = db.one("SELECT id, created_at, status FROM runs WHERE agent_id=? AND status IN ('queued','awaiting_approval') ORDER BY created_at DESC LIMIT 1", (a["id"],))
                if r:
                    run_id, since = r["id"], r["created_at"]
                    activity = "Attend une approbation" if r["status"] == "awaiting_approval" else "En file d'attente"
            elif state == "error" and latest:
                run_id, since, activity = latest["id"], latest["finished_at"] or since, (latest["error_message"] or "")[:120] or None
            elif latest:
                since = latest["finished_at"] or since
            # dernières actions réelles de l'exécution en cours (écran du poste), de la plus ancienne à la plus récente
            actions: list[str] = []
            if state == "working" and run_id:
                for ev in db.all("SELECT payload FROM events WHERE run_id=? AND type='tool.call' ORDER BY seq DESC LIMIT 3", (run_id,)):
                    s_ = str(json.loads(ev["payload"]).get("summary") or "")[:80]
                    if s_:
                        actions.insert(0, s_)
            # conversation en direct avec l'utilisateur (Chat, /parler) : en cours, ou dernière réponse depuis moins de CONV_LINGER_S
            conv = None
            cr = db.one("SELECT id, status, trigger, notify_target, created_at, finished_at FROM runs WHERE agent_id=? "
                        "AND (trigger='reply' OR notify_target IN ('chat','discord')) ORDER BY created_at DESC, rowid DESC LIMIT 1", (a["id"],))
            if cr:
                active = cr["status"] in ("queued", "running", "awaiting_approval")
                last = cr["finished_at"] or cr["created_at"]
                if active or (last and last >= linger_from):
                    conv = {"via": conversation_kind(cr["trigger"], cr["notify_target"]), "run_id": cr["id"], "active": active, "last_at": last}
            agents.append({"id": a["id"], "name": a["name"], "department": a["department"], "avatar": a["avatar"], "state": state,
                           "activity": activity, "tool_kind": kind, "run_id": run_id, "error_class": err, "since": since,
                           "provider": a["provider"], "model": a.get("model"), "enabled": a["enabled"],
                           "recent_actions": actions, "conversation": conv, "inbox_pending": pending.get(a["id"], 0)})
        depts = sorted({x["department"] for x in agents}, key=lambda d: (d not in DEPT_PRESETS, DEPT_PRESETS.index(d) if d in DEPT_PRESETS else 0, d))
        ctl = worker.control()
        return {"seq": seq, "now": now_iso(), "departments": depts, "agents": agents, "profiles": app.state.office_profiles(),
                "control": {"paused": bool(ctl.get("paused")), "since": ctl.get("since"), "reason": ctl.get("reason")}}

    @app.get("/api/office/archive")
    def office_archive(limit: int = Query(40, ge=1, le=100)):
        """Bibliothèque du bureau : derniers rapports réels (missions réussies avec un résultat, hors conversations)."""
        rows = db.all("SELECT r.id, r.agent_id, a.name AS agent_name, r.trigger, r.schedule_id, r.finished_at, r.result_text, r.prompt "
                      "FROM runs r JOIN agents a ON a.id = r.agent_id WHERE r.status='succeeded' AND r.result_text IS NOT NULL "
                      "AND r.result_text <> '' AND r.trigger <> 'reply' AND COALESCE(r.notify_target, '') NOT IN ('chat', 'discord') "
                      # début d'un fil de conversation (messages antérieurs au marquage « chat ») : pas un rapport
                      "AND r.conversation_id IS NULL AND NOT EXISTS (SELECT 1 FROM runs c WHERE c.conversation_id = r.id) "
                      "ORDER BY r.finished_at DESC LIMIT ?", (limit,))
        return {"reports": [{"run_id": r["id"], "agent_id": r["agent_id"], "agent_name": r["agent_name"], "trigger": r["trigger"],
                             "scheduled": bool(r["schedule_id"]), "finished_at": r["finished_at"], "chars": len(r["result_text"]),
                             "title": (r["prompt"] or "").strip().splitlines()[0][:120] if (r["prompt"] or "").strip() else "",
                             "preview": r["result_text"][:600]} for r in rows]}

    codex_boot = {"done": False}

    # --- livraisons des outils externes (PerforceBot…) --------------------------------------------------------------
    def _inbox_err(e: InboxError):
        raise HTTPException(e.status, e.msg)

    @app.post("/api/inbox/deliver", status_code=202)
    async def inbox_deliver(request: Request):
        raw = await request.body()
        if len(raw) > 300_000:
            raise HTTPException(413, "livraison trop volumineuse")
        try:
            body = json.loads(raw or b"null")
        except ValueError:
            raise HTTPException(400, "JSON invalide")
        try:
            return inbox.deliver(request.headers.get("authorization"), body)
        except InboxError as e:
            _inbox_err(e)

    @app.get("/api/inbox/sources")
    def inbox_sources():
        return {"sources": inbox.sources()}

    @app.post("/api/inbox/sources", status_code=201)
    def inbox_source_create(b: InboxSourceIn):
        try:
            return inbox.create_source(b.name, b.agent_id, b.auto_run, b.instructions)
        except InboxError as e:
            _inbox_err(e)

    @app.put("/api/inbox/sources/{sid}")
    def inbox_source_update(sid: str, b: InboxSourceIn):
        try:
            return inbox.update_source(sid, b.name, b.agent_id, b.auto_run, b.instructions, b.enabled)
        except InboxError as e:
            _inbox_err(e)

    @app.post("/api/inbox/sources/{sid}/token")
    def inbox_source_token(sid: str):
        try:
            return inbox.rotate_token(sid)
        except InboxError as e:
            _inbox_err(e)

    @app.delete("/api/inbox/sources/{sid}", status_code=204)
    def inbox_source_delete(sid: str):
        try:
            inbox.delete_source(sid)
        except InboxError as e:
            _inbox_err(e)
        return Response(status_code=204)

    @app.get("/api/inbox/deliveries")
    def inbox_deliveries(limit: int = Query(50, ge=1, le=200)):
        return {"deliveries": inbox.deliveries(limit)}

    # --- vie intérieure (journal, fil interne, dialogues ; Claude Haiku, 1 appel par jour, plafonné) -------------------
    @app.get("/api/office/society")
    def society_get():
        return {**society.view(), "blocked": society.blocked_reason(True)}

    @app.post("/api/office/society/generate", status_code=202)
    async def society_generate(request: Request):
        try:
            body = json.loads((await request.body()) or b"{}")
        except ValueError:
            body = {}
        edition = body.get("edition") if isinstance(body, dict) and body.get("edition") in ("morning", "afternoon") else None
        if society.running:
            raise HTTPException(409, "génération déjà en cours")
        why = society.blocked_reason(True)
        if why:
            raise HTTPException(409, why)

        async def go() -> None:
            try:
                await society.generate(True, edition)
            except Exception:  # noqa: BLE001 — erreur enregistrée et diffusée (office.society)
                pass
            finally:
                society.running = False
        society.running = True  # visible immédiatement ; generate le remet à jour
        asyncio.create_task(go())
        return {"status": "generating"}

    @app.put("/api/office/society/settings")
    def society_settings(body: dict):
        return society.set_enabled(bool(body.get("enabled", True)))

    # --- sessions Claude Code qui développent RO·AI (hook local, salle serveur du bureau) -------------------------
    @app.post("/api/devwork/ingest", status_code=204)
    async def devwork_ingest(request: Request):
        """Réservé au hook local (socket du noyau) : le relais web refuse ce chemin. Données en mémoire seulement."""
        raw = await request.body()
        if len(raw) > 2048:
            raise HTTPException(413, "événement trop volumineux")
        try:
            p = json.loads(raw or b"{}")
        except ValueError:
            raise HTTPException(400, "JSON invalide")
        if not devwork.ingest(p):
            raise HTTPException(422, "événement ignoré")
        return Response(status_code=204)

    @app.get("/api/office/devteam")
    def office_devteam():
        return {"now": now_iso(), "sessions": devwork.view()}

    @app.get("/api/office/boards")
    def office_boards():
        """Tableaux du hall (planning du jour) et de la salle serveur (limites d'usage). Lecture seule, sans appel aux clients."""
        if not codex_boot["done"]:   # amorçage : dernières limites Codex connues avant la première exécution de ce noyau
            codex_boot["done"] = True
            if not status.limits_view().get("codex"):
                try:
                    for lim in latest_rollout_limits(s.agent_home):
                        status.note_rate_limit("codex", lim["status"], lim["resets_at"], lim["window"], lim["used_percent"])
                except Exception:  # noqa: BLE001
                    pass
        return {"now": now_iso(), "planning": office_planning(db, paused=worker.is_paused()), "limits": status.limits_view()}

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):
        journal.emit("system.notice", payload={"level": "error", "message": f"erreur API : {type(exc).__name__}"})
        return JSONResponse({"detail": "erreur interne"}, status_code=500)

    return app
