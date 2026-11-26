"""Routes des fiches d'identité (décoratives) et de l'agencement persistant du Virtual Office."""
from __future__ import annotations

import asyncio
import json
import secrets
import shutil
from typing import Any

from fastapi import FastAPI, HTTPException

from .db import Database, now_iso
from .events import EventJournal
from .executor import Executor
from .profiles import GenerateIn, ProfileIn, default_profile, detect_theme, generation_prompt, merge_generated
from .providers import RunContext
from .providers.status import ProviderStatus
from .worker import ADAPTERS, Worker, agent_dict

GEN_TIMEOUT_S = 150
LAYOUT_MAX_BYTES = 64 * 1024


def _depth(o: Any, d: int = 0) -> int:
    if d > 12:
        return d
    if isinstance(o, dict):
        return max([_depth(v, d + 1) for v in o.values()] or [d + 1])
    if isinstance(o, list):
        return max([_depth(v, d + 1) for v in o] or [d + 1])
    return d


def register_profiles(app: FastAPI, s, db: Database, journal: EventJournal, executor: Executor, worker: Worker, status: ProviderStatus) -> None:
    generating: dict[str, str] = {}   # agent_id -> horodatage de début
    gen_lock = asyncio.Lock()

    def _agent(aid: str) -> dict:
        row = db.one("SELECT * FROM agents WHERE id=?", (aid,))
        if not row:
            raise HTTPException(404, "agent introuvable")
        return agent_dict(row)

    def profile_out(agent: dict, row=None) -> dict:
        row = row if row is not None else db.one("SELECT * FROM agent_profiles WHERE agent_id=?", (agent["id"],))
        if row:
            data = json.loads(row["data_json"])
            gen = json.loads(row["generation_json"]) if row["generation_json"] else None
            out = {**data, "source": row["source"], "generated_at": row["generated_at"], "updated_at": row["updated_at"], "generation": gen}
        else:
            out = {**default_profile(agent), "source": "default", "generated_at": None, "updated_at": None, "generation": None}
        out["agent_id"] = agent["id"]
        out["department"] = agent.get("department") or ""
        out["generating"] = agent["id"] in generating
        return out

    def all_profiles() -> dict[str, dict]:
        rows = {r["agent_id"]: r for r in db.all("SELECT * FROM agent_profiles")}
        return {a["id"]: profile_out(a, rows.get(a["id"])) for a in (agent_dict(r) for r in db.all("SELECT * FROM agents"))}

    app.state.office_profiles = all_profiles

    def save(aid: str, data: dict, source: str, generation: dict | None = None) -> None:
        ts = now_iso()
        old = db.one("SELECT generated_at, generation_json FROM agent_profiles WHERE agent_id=?", (aid,))
        gen_at = ts if source == "generated" else (old["generated_at"] if old else None)
        gen_json = json.dumps(generation) if generation is not None else (old["generation_json"] if old else None)
        db.execute("INSERT INTO agent_profiles(agent_id, data_json, source, generated_at, generation_json, updated_at) VALUES(?,?,?,?,?,?) "
                   "ON CONFLICT(agent_id) DO UPDATE SET data_json=excluded.data_json, source=excluded.source, generated_at=excluded.generated_at, "
                   "generation_json=excluded.generation_json, updated_at=excluded.updated_at",
                   (aid, json.dumps(data, ensure_ascii=False), source, gen_at, gen_json, ts))

    @app.get("/api/agents/{aid}/profile")
    def profile_get(aid: str):
        return profile_out(_agent(aid))

    @app.put("/api/agents/{aid}/profile")
    def profile_put(aid: str, p: ProfileIn):
        a = _agent(aid)
        row = db.one("SELECT source FROM agent_profiles WHERE agent_id=?", (aid,))
        # une fiche générée puis retouchée reste marquée « générée » (la génération ne se refait pas d'elle-même)
        source = "generated" if row and row["source"] == "generated" else "manual"
        save(aid, p.model_dump(), source)
        journal.emit("agent.profile", agent_id=aid, payload={"action": "updated", "source": source})
        return profile_out(a)

    @app.delete("/api/agents/{aid}/profile", status_code=204)
    def profile_reset(aid: str):
        _agent(aid)
        if aid in generating:
            raise HTTPException(409, "génération en cours")
        db.execute("DELETE FROM agent_profiles WHERE agent_id=?", (aid,))
        journal.emit("agent.profile", agent_id=aid, payload={"action": "reset", "source": "default"})

    async def _generate(agent: dict, base: dict) -> None:
        aid, provider = agent["id"], agent["provider"]
        gid = "prof" + secrets.token_hex(5)
        run_dir = s.data_dir / "runs" / gid
        cwd = s.workspace_dir / "_profiles"
        usage, model, error = None, None, None
        try:
            async with gen_lock:
                theme = detect_theme(agent.get("name", ""), agent.get("department", ""), agent.get("mission", ""), agent.get("description", ""))
                # agent synthétique : aucun outil, aucune mission opérationnelle, sandbox en lecture seule, effort minimal
                synth = {**agent, "mission": "", "model": "haiku" if provider == "claude" else agent.get("model"),
                         "config": {"_text_only": True, "permission_mode": "dontAsk", "sandbox": "read-only", "reasoning_effort": "low"}}
                cwd.mkdir(parents=True, exist_ok=True)
                run_dir.mkdir(parents=True, exist_ok=True)
                adapter = ADAPTERS[provider]()
                binp = s.claude_bin if provider == "claude" else s.codex_bin
                ctx = RunContext(gid, synth, generation_prompt(agent, theme), cwd, run_dir, GEN_TIMEOUT_S, s.agent_home, binp)
                cmd = adapter.build(ctx)
                for p, content in cmd.files.items():
                    p.write_text(content, encoding="utf-8")
                    p.chmod(0o600)
                texts: list[str] = []

                def on_line(line: str) -> None:
                    nonlocal model
                    for typ, payload in adapter.parse(line):
                        if typ == "run.message":
                            texts.append(payload.get("text", ""))
                        elif typ == "run.model":
                            model = payload.get("model")
                res = await executor.run(cmd, unit=f"roai-run-{gid}", cwd=cwd, timeout_s=GEN_TIMEOUT_S, on_line=on_line, cancel=asyncio.Event())
                out = adapter.finish(res.returncode, res.stderr_tail, res.timed_out, res.cancelled)
                usage = out.usage
                model = model or adapter.resolve_model(s.agent_home)
                if out.status != "succeeded":
                    raise ValueError(out.error_message or "échec du client")
                data = merge_generated(base, out.result_text or (texts[-1] if texts else ""))
                save(aid, data, "generated", {"provider": provider, "model": model, "input_tokens": (usage or {}).get("input_tokens"),
                                              "output_tokens": (usage or {}).get("output_tokens")})
        except Exception as e:  # noqa: BLE001
            error = str(e)[:300]
        finally:
            generating.pop(aid, None)
            shutil.rmtree(run_dir, ignore_errors=True)
        journal.emit("agent.profile", agent_id=aid, payload={
            "action": "generated" if not error else "generation_failed", "source": "generated" if not error else None,
            "provider": provider, "model": model, "input_tokens": (usage or {}).get("input_tokens"), "output_tokens": (usage or {}).get("output_tokens"),
            **({"error": error} if error else {})})

    @app.post("/api/agents/{aid}/profile/generate", status_code=202)
    async def profile_generate(aid: str, body: GenerateIn | None = None):
        a = _agent(aid)
        body = body or GenerateIn()
        if aid in generating:
            raise HTTPException(409, "génération déjà en cours")
        if worker.is_paused():
            raise HTTPException(409, "arrêt d'urgence actif : reprise requise avant toute génération")
        row = db.one("SELECT source FROM agent_profiles WHERE agent_id=?", (aid,))
        if row and row["source"] == "generated" and not body.force:
            raise HTTPException(409, "fiche déjà générée : la régénération doit être demandée explicitement")
        info = await status.refresh(a["provider"])
        if not info["installed"] or info["auth"]["state"] == "logged_out":
            raise HTTPException(503, f"{info['name']} n'est pas disponible : la fiche par défaut reste modifiable à la main")
        base = {k: v for k, v in profile_out(a).items() if k in ProfileIn.model_fields}
        generating[aid] = now_iso()
        journal.emit("agent.profile", agent_id=aid, payload={"action": "generating", "provider": a["provider"]})
        asyncio.create_task(_generate(a, base))
        return {"status": "generating"}

    # --- agencement persistant du bureau (éditeur) ------------------------------------------------------
    @app.get("/api/office/layout")
    def layout_get():
        return {"layout": db.kv_get("office_layout") or None}

    @app.put("/api/office/layout")
    def layout_put(body: dict):
        layout = body.get("layout")
        if layout is not None:
            if not isinstance(layout, dict):
                raise HTTPException(422, "agencement invalide")
            raw = json.dumps(layout, ensure_ascii=False, separators=(",", ":"))
            if len(raw.encode()) > LAYOUT_MAX_BYTES or _depth(layout) > 10:
                raise HTTPException(422, "agencement trop volumineux")
            db.kv_set("office_layout", layout)
        else:
            db.kv_set("office_layout", None)
        journal.emit("office.layout", payload={"action": "saved" if layout is not None else "reset"})
        return {"layout": layout}
