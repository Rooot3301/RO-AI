import json, time

AGENT = {"name": "Veilleur CVE", "provider": "claude", "mission": "Tu surveilles les CVE.", "default_prompt": "Fais le point",
         "department": "Veille", "config": {"allowed_tools": ["Read", "Grep"], "max_runtime_s": 30}}


def wait_run(client, rid, want=("succeeded", "failed", "cancelled"), timeout=15):
    t0 = time.time()
    while time.time() - t0 < timeout:
        r = client.get(f"/api/runs/{rid}").json()
        if r["status"] in want:
            return r
        time.sleep(0.15)
    raise AssertionError(f"timeout, état {r['status']}")


def types(client, rid):
    return [e["type"] for e in client.get(f"/api/runs/{rid}/events").json()["events"]]


def test_health_system_providers(client):
    assert client.get("/api/health").json()["status"] == "ok"
    sysinfo = client.get("/api/system").json()
    assert sysinfo["mem"]["total"] > 0 and "queue_depth" in sysinfo
    provs = {p["id"]: p for p in client.get("/api/providers").json()}
    assert provs["claude"]["auth"]["state"] == "logged_in" and provs["claude"]["version"] == "9.9.9" and provs["codex"]["version"] == "9.9.9"
    assert provs["codex"]["auth"]["state"] == "logged_in"
    assert "token" not in json.dumps(provs).lower()


def test_agent_crud_and_validation(client):
    r = client.post("/api/agents", json=AGENT)
    assert r.status_code == 201
    a = r.json()
    assert a["slug"] == "veilleur-cve" and a["state"] == "idle" and a["avatar"] == {"sprite": 0}
    assert client.post("/api/agents", json={**AGENT, "slug": "veilleur-cve"}).status_code == 409
    assert client.post("/api/agents", json={**AGENT, "config": {"sandbox": "danger-full-access"}}).status_code == 422
    pro = client.post("/api/agents", json={**AGENT, "name": "Agent pro", "domain": "pro"})
    assert pro.status_code == 201 and pro.json()["domain"] == "pro"       # simple étiquette : mêmes comptes fournisseurs
    ev = [e for e in client.get("/api/events?type_prefix=agent.created").json()["events"] if e["agent_id"] == pro.json()["id"]][0]
    assert ev["domain"] == "pro"                                           # le journal porte le domaine de l'agent
    assert client.post("/api/agents", json={**AGENT, "name": "Autre", "domain": "autre"}).status_code == 422
    assert client.post("/api/agents", json={**AGENT, "provider": "gemini"}).status_code == 422
    assert client.post("/api/agents", json={**AGENT, "avatar": {"sprite": 9}}).status_code == 422
    a["name"] = "Veilleur 2"
    up = client.put(f"/api/agents/{a['id']}", json={**AGENT, "name": "Veilleur 2", "enabled": False}).json()
    assert up["name"] == "Veilleur 2" and up["state"] == "disabled"
    assert client.post(f"/api/agents/{a['id']}/run", json={}).status_code == 409
    assert client.delete(f"/api/agents/{a['id']}").status_code == 204
    assert client.get(f"/api/agents/{a['id']}").status_code == 404


def test_claude_run_end_to_end(client):
    a = client.post("/api/agents", json=AGENT).json()
    run = client.post(f"/api/agents/{a['id']}/run", json={"prompt": "Résume les CVE du jour"}).json()
    assert run["status"] in ("queued", "running")
    done = wait_run(client, run["id"])
    assert done["status"] == "succeeded", done
    assert done["session_id"] == "sess-1234" and done["num_turns"] == 2
    assert done["cost_usd_estimate"] == 0.0123 and done["usage"] == {"input_tokens": 100, "output_tokens": 20}
    assert done["result_text"].startswith("Terminé")
    ts = types(client, run["id"])
    for t in ("run.queued", "run.started", "run.session", "tool.call", "tool.result", "tool.denied", "run.succeeded"):
        assert t in ts, (t, ts)
    evs = client.get(f"/api/runs/{run['id']}/events").json()["events"]
    msg = next(e for e in evs if e["type"] == "run.message")
    assert "SECRETSECRET" not in json.dumps(evs) and "[masqué]" in msg["payload"]["text"]
    call = next(e for e in evs if e["type"] == "tool.call")
    assert call["payload"]["kind"] == "read" and "/tmp/x.txt" in call["payload"]["summary"]
    assert client.get(f"/api/agents/{a['id']}").json()["last_run"]["status"] == "succeeded"
    assert done["model"] == "fake" and "run.model" in ts      # Claude annonce le modèle dans system/init


def test_codex_run(client):
    a = client.post("/api/agents", json={**AGENT, "name": "Codeur", "provider": "codex", "config": {"sandbox": "workspace-write"}}).json()
    run = client.post(f"/api/agents/{a['id']}/run", json={"prompt": "écris un test"}).json()
    done = wait_run(client, run["id"])
    assert done["status"] == "succeeded" and done["session_id"] == "0199aaaa-bbbb-7ccc-8ddd-eeeeffff0001" and done["usage"] == {"input_tokens": 50, "output_tokens": 7}
    ts = types(client, run["id"])
    assert "tool.call" in ts and "tool.result" in ts and "run.message" in ts
    # Codex n'annonce pas le modèle : il est lu dans son fichier de session
    assert done["model"] == "gpt-fake-codex" and ts.count("run.model") == 1
    assert client.get(f"/api/agents/{a['id']}").json()["last_model"] == "gpt-fake-codex"


def test_codex_model_resolution_is_safe(tmp_path):
    from roai.providers import CodexAdapter
    ad = CodexAdapter()
    assert ad.resolve_model(tmp_path) is None                       # pas encore de session
    ad.parse('{"type": "thread.started", "thread_id": "../../etc/*"}')
    assert ad.resolve_model(tmp_path) is None                       # identifiant suspect : aucune recherche
    ad = CodexAdapter(); ad.parse('{"type": "thread.started", "thread_id": "0199aaaa-0000-7000-8000-000000000002"}')
    d = tmp_path / ".codex/sessions/2026/11/24"; d.mkdir(parents=True)
    (d / "rollout-x-0199aaaa-0000-7000-8000-000000000002.jsonl").write_text(
        '{"type":"turn_context","payload":{"model":"gpt-a"}}\nnot json\n{"type":"turn_context","payload":{"model":"bad model; rm"}}\n'
        '{"type":"turn_context","payload":{"model":"gpt-b"}}\n')
    assert ad.resolve_model(tmp_path) == "gpt-b"                    # dernier tour, valeurs invalides ignorées


def test_error_classification(client):
    a = client.post("/api/agents", json=AGENT).json()
    r1 = wait_run(client, client.post(f"/api/agents/{a['id']}/run", json={"prompt": "FAIL_AUTH"}).json()["id"])
    assert r1["status"] == "failed" and r1["error_class"] == "auth_expired"
    r2 = wait_run(client, client.post(f"/api/agents/{a['id']}/run", json={"prompt": "FAIL_RATE"}).json()["id"])
    assert r2["status"] == "failed" and r2["error_class"] == "rate_limited"
    prov = {p["id"]: p for p in client.get("/api/providers").json()}["claude"]
    assert prov["limits"]["status"] == "limited" and prov["limits"]["window"] == "five_hour"
    snap = client.get("/api/office/snapshot").json()
    assert snap["agents"][0]["state"] == "error" and snap["agents"][0]["error_class"] == "rate_limited"


def test_timeout_and_cancel(client):
    a = client.post("/api/agents", json={**AGENT, "config": {"max_runtime_s": 30}}).json()
    run = client.post(f"/api/agents/{a['id']}/run", json={"prompt": "SLOW"}).json()
    t0 = time.time()
    while client.get(f"/api/runs/{run['id']}").json()["status"] != "running" and time.time() - t0 < 10:
        time.sleep(0.1)
    snap = client.get("/api/office/snapshot").json()["agents"][0]
    assert snap["state"] == "working" and snap["run_id"] == run["id"]
    assert client.post(f"/api/runs/{run['id']}/cancel").status_code == 200
    done = wait_run(client, run["id"])
    assert done["status"] == "cancelled"
    assert "run.cancelled" in types(client, run["id"])


def test_approval_flow(client):
    a = client.post("/api/agents", json={**AGENT, "config": {"require_approval": True}}).json()
    run = client.post(f"/api/agents/{a['id']}/run", json={"prompt": "ok"}).json()
    assert run["status"] == "awaiting_approval"
    assert client.get("/api/office/snapshot").json()["agents"][0]["state"] == "waiting"
    time.sleep(0.6)
    assert client.get(f"/api/runs/{run['id']}").json()["status"] == "awaiting_approval"  # rien ne démarre sans approbation
    assert client.post(f"/api/runs/{run['id']}/approve").status_code == 200
    assert wait_run(client, run["id"])["status"] == "succeeded"
    assert client.post(f"/api/runs/{run['id']}/approve").status_code == 409
    run2 = client.post(f"/api/agents/{a['id']}/run", json={"prompt": "non"}).json()
    assert client.post(f"/api/runs/{run2['id']}/reject").json()["status"] == "cancelled"


def test_schedules(client):
    a = client.post("/api/agents", json=AGENT).json()
    assert client.post("/api/schedules", json={"agent_id": a["id"], "name": "x", "cron": "pas un cron"}).status_code == 422
    s = client.post("/api/schedules", json={"agent_id": a["id"], "name": "Matin", "cron": "0 8 * * 1-5", "timezone": "Europe/Paris"}).json()
    assert s["next_run_at"] and s["enabled"]
    fired = client.post(f"/api/schedules/{s['id']}/run-now").json()
    assert fired["trigger"] == "schedule" and fired["schedule_id"] == s["id"]
    wait_run(client, fired["id"])
    # le tick réel : on force l'échéance dans le passé
    st = client.app_state
    st.db.execute("UPDATE schedules SET next_run_at='2020-01-01T00:00:00Z' WHERE id=?", (s["id"],))
    from roai.scheduler import Scheduler
    Scheduler(st.db, st.journal, st.worker).tick()
    s2 = client.get("/api/schedules").json()[0]
    assert s2["next_run_at"] > "2026" and s2["last_run_id"] != fired["id"]
    assert wait_run(client, s2["last_run_id"])["status"] == "succeeded"
    assert client.delete(f"/api/schedules/{s['id']}").status_code == 204


def test_events_api_and_resync(client):
    a = client.post("/api/agents", json=AGENT).json()
    evs = client.get("/api/events?since=0").json()
    assert any(e["type"] == "agent.created" and e["agent_id"] == a["id"] for e in evs["events"])
    assert evs["last_seq"] == evs["events"][-1]["seq"]
    assert client.get("/api/events?type_prefix=agent.").json()["events"][0]["type"].startswith("agent.")
    assert all(e["type"].startswith("agent.") for e in client.get("/api/events?type_prefix=agent.").json()["events"])


def test_emergency_stop_blocks_cancels_and_resumes(client):
    a = client.post("/api/agents", json={**AGENT, "name": "Lent", "config": {"max_runtime_s": 60}}).json()
    appr = client.post("/api/agents", json={**AGENT, "name": "Prudent", "config": {"require_approval": True}}).json()
    s = client.post("/api/schedules", json={"agent_id": a["id"], "name": "Chaque minute", "cron": "* * * * *"}).json()
    r1 = client.post(f"/api/agents/{a['id']}/run", json={"prompt": "SLOW"}).json()
    r2 = client.post(f"/api/agents/{a['id']}/run", json={"prompt": "SLOW"}).json()
    r3 = client.post(f"/api/agents/{a['id']}/run", json={"prompt": "SLOW"}).json()          # reste en file (limite de concurrence)
    r4 = client.post(f"/api/agents/{appr['id']}/run", json={"prompt": "x"}).json()          # attend une approbation
    t0 = time.time()
    while client.get(f"/api/runs/{r1['id']}").json()["status"] != "running" and time.time() - t0 < 10:
        time.sleep(0.1)
    assert client.get("/api/control").json()["paused"] is False
    stop = client.post("/api/control/emergency-stop", json={"reason": "test d'arrêt"})
    assert stop.status_code == 200
    c = stop.json()
    assert c["paused"] is True and c["reason"] == "test d'arrêt" and c["cancelled"] == 4 and c["since"]
    for r in (r1, r2, r3, r4):
        assert wait_run(client, r["id"], timeout=20)["status"] == "cancelled", r["id"]
    assert client.get("/api/system").json()["agents_running"] == 0
    # plus aucun lancement possible, sous aucune forme
    for call in (lambda: client.post(f"/api/agents/{a['id']}/run", json={"prompt": "x"}),
                 lambda: client.post("/api/runs", json={"agent_id": a["id"], "prompt": "x"}),
                 lambda: client.post(f"/api/schedules/{s['id']}/run-now")):
        resp = call()
        assert resp.status_code == 409 and "Arrêt d'urgence" in resp.json()["detail"]
    # le planificateur ne déclenche rien et ne prépare aucun rattrapage
    st = client.app_state
    st.db.execute("UPDATE schedules SET next_run_at='2020-01-01T00:00:00Z' WHERE id=?", (s["id"],))
    from roai.scheduler import Scheduler
    Scheduler(st.db, st.journal, st.worker).tick()
    sc = client.get("/api/schedules").json()[0]
    assert sc["last_run_id"] is None and sc["next_run_at"] > "2026"
    # persistance : l'état survit à un redémarrage (relu depuis la base)
    assert st.db.kv_get("control")["paused"] is True
    evs = [e for e in client.get("/api/events?type_prefix=system.emergency").json()["events"]]
    assert evs and evs[-1]["payload"]["cancelled"] == 4
    # reprise : tout redevient possible, sans rafale de rattrapage
    res = client.post("/api/control/resume").json()
    assert res["paused"] is False and res["cancelled"] is None
    assert any(e["type"] == "system.resumed" for e in client.get("/api/events?type_prefix=system.").json()["events"])
    run = client.post(f"/api/agents/{a['id']}/run", json={"prompt": "ok rapide"}).json()
    assert wait_run(client, run["id"])["status"] == "succeeded"
    assert client.get("/api/schedules").json()[0]["last_run_id"] is None


def test_emergency_stop_is_idempotent_and_reload_safe(client, env):
    st = client.app_state
    assert client.post("/api/control/emergency-stop", json={}).json()["paused"] is True
    first = client.get("/api/control").json()["since"]
    again = client.post("/api/control/emergency-stop", json={"reason": "second appel"}).json()
    assert again["paused"] is True and again["since"] == first
    from roai.worker import Worker
    w2 = Worker(env, st.db, st.journal, st.worker.executor, st.worker.status)
    assert w2.is_paused() is True                      # un nouveau worker (redémarrage) reste en pause
    assert client.post("/api/control/resume").json()["paused"] is False
    assert client.post("/api/control/resume").json()["paused"] is False   # reprise répétée sans effet


def test_stats(client):
    a = client.post("/api/agents", json=AGENT).json()
    ok = wait_run(client, client.post(f"/api/agents/{a['id']}/run", json={"prompt": "ras"}).json()["id"])
    ko = wait_run(client, client.post(f"/api/agents/{a['id']}/run", json={"prompt": "FAIL_RATE"}).json()["id"])
    assert ok["status"] == "succeeded" and ko["error_class"] == "rate_limited"
    s = client.get("/api/stats?days=7").json()
    assert s["days"] == 7 and len(s["by_day"]) == 7 and s["by_day"][-1]["date"] == s["to"]
    t = s["totals"]
    assert t["runs"] == 2 and t["succeeded"] == 1 and t["failed"] == 1 and t["success_rate"] == 0.5
    assert t["input_tokens"] == 100 and t["output_tokens"] == 20 and t["cost_usd_estimate"] == 0.0123 and t["duration_ms_avg"] is not None
    today = s["by_day"][-1]
    assert today["runs"] == 2 and today["succeeded"] == 1 and today["failed"] == 1 and sum(d["runs"] for d in s["by_day"]) == 2
    ag = s["by_agent"][0]
    assert ag["name"] == AGENT["name"] and ag["runs"] == 2 and ag["success_rate"] == 0.5
    assert s["by_provider"][0]["provider"] == "claude" and s["by_provider"][0]["rate_limited"] == 1
    assert s["errors"] == [{"error_class": "rate_limited", "count": 1}]
    assert len(s["by_hour"]) == 24 and sum(s["by_hour"]) == 2
    assert client.get("/api/stats?days=0").status_code == 422 and client.get("/api/stats?days=400").status_code == 422
    empty = client.get("/api/stats?days=1").json()
    assert empty["totals"]["runs"] == 2


def test_stats_empty(client):
    s = client.get("/api/stats?days=30").json()
    assert s["totals"]["runs"] == 0 and s["totals"]["success_rate"] is None and s["totals"]["duration_ms_avg"] is None
    assert len(s["by_day"]) == 30 and s["by_agent"] == [] and s["errors"] == [] and s["by_hour"] == [0] * 24


def test_codex_web_search_option(client):
    from pathlib import Path
    from roai.providers import CodexAdapter, RunContext
    a = client.post("/api/agents", json={**AGENT, "name": "Veille web", "provider": "codex", "config": {"sandbox": "read-only", "web_search": True}}).json()
    assert a["config"]["web_search"] is True
    def argv(cfg):
        ctx = RunContext("r", {"config": cfg, "mission": "", "model": None}, "p", Path("/x"), Path("/y"), 60, Path("/h"), "/bin/codex")
        return CodexAdapter().build(ctx).argv
    on, off = argv({"web_search": True}), argv({})
    assert 'web_search="live"' in on and on[on.index('web_search="live"') - 1] == "-c"
    assert not any("web_search" in x for x in off)                     # par défaut : aucune recherche web
    assert "danger-full-access" not in on and "read-only" in on        # la recherche n'élargit pas le bac à sable
    run = client.post(f"/api/agents/{a['id']}/run", json={"prompt": "ok"}).json()
    assert wait_run(client, run["id"])["status"] == "succeeded"


def test_codex_catalog_and_effort(client, env):
    import json as _j
    from pathlib import Path
    from roai.providers import CodexAdapter, RunContext
    cache = env.agent_home / ".codex"; cache.mkdir(parents=True, exist_ok=True)
    (cache / "models_cache.json").write_text(_j.dumps({"identity": {"x": "ne doit pas sortir"}, "models": [
        {"slug": "gpt-a", "display_name": "GPT-A", "description": "rapide", "visibility": "list", "default_reasoning_level": "low",
         "supported_reasoning_levels": [{"effort": "low"}, {"effort": "medium"}, {"effort": "ultra"}]},
        {"slug": "gpt-b", "display_name": "GPT-B", "visibility": "list", "supported_reasoning_levels": [{"effort": "low"}, {"effort": "medium"}]},
        {"slug": "cache-interne", "visibility": "hide", "supported_reasoning_levels": []}]}))
    cat = client.get("/api/providers/codex/models").json()
    assert [m["slug"] for m in cat["models"]] == ["gpt-a", "gpt-b"] and cat["models"][0]["efforts"] == ["low", "medium", "ultra"]
    assert "ne doit pas sortir" not in _j.dumps(cat)
    base = {**AGENT, "name": "Effort", "provider": "codex"}
    r = client.post("/api/agents", json={**base, "model": "gpt-b", "config": {"reasoning_effort": "ultra"}})
    assert r.status_code == 422 and "gpt-b" in r.json()["detail"]
    a = client.post("/api/agents", json={**base, "model": "gpt-a", "config": {"reasoning_effort": "ultra"}}).json()
    assert a["config"]["reasoning_effort"] == "ultra"
    assert client.post("/api/agents", json={**base, "config": {"reasoning_effort": "bidon"}}).status_code == 422
    # Claude : réglage ignoré (propre à Codex)
    c = client.post("/api/agents", json={**AGENT, "name": "Claude effort", "config": {"reasoning_effort": "high"}}).json()
    assert "reasoning_effort" not in c["config"]
    ctx = RunContext("r", {**a, "config": {"reasoning_effort": "medium"}}, "p", Path("/w"), Path("/r"), 60, Path("/h"), "codex")
    argv = CodexAdapter().build(ctx).argv
    assert 'model_reasoning_effort="medium"' in argv and argv[argv.index('model_reasoning_effort="medium"') - 1] == "-c"


def test_claude_lean_mode_replaces_system_prompt(tmp_path):
    from roai.providers import RunContext
    from roai.providers.claude import ClaudeAdapter
    agent = {"id": "ag", "name": "Plume", "mission": "Tu es Plume.", "model": "haiku",
             "config": {"allowed_tools": ["Read", "Edit"], "permission_mode": "dontAsk", "lean": True}}
    argv = ClaudeAdapter().build(RunContext("r1", agent, "x", tmp_path, tmp_path, 60, tmp_path, "claude")).argv
    assert argv[argv.index("--tools") + 1] == "Read,Edit" and argv[argv.index("--system-prompt") + 1] == "Tu es Plume."
    assert "--append-system-prompt" not in argv and '"sandbox": {"enabled": true' in " ".join(argv).replace("'", '"').lower().replace(" ", " ")
    normal = ClaudeAdapter().build(RunContext("r2", {**agent, "config": {"allowed_tools": ["Read"]}}, "x", tmp_path, tmp_path, 60, tmp_path, "claude")).argv
    assert "--tools" not in normal and normal[normal.index("--append-system-prompt") + 1] == "Tu es Plume."


def test_claude_lean_memory_file(tmp_path):
    from roai.providers import RunContext
    from roai.providers.claude import ClaudeAdapter
    (tmp_path / "style.md").write_text("Tutoiement, phrases courtes.")
    (tmp_path.parent / "secret.txt").write_text("NE PAS LIRE")
    def sp(mem):
        agent = {"id": "ag", "mission": "Tu es Plume.", "config": {"allowed_tools": ["Read"], "lean": True, "memory_file": mem}}
        a = ClaudeAdapter().build(RunContext("r", agent, "x", tmp_path, tmp_path, 60, tmp_path, "claude")).argv
        return a[a.index("--system-prompt") + 1]
    assert sp("style.md").startswith("Tu es Plume.") and "Tutoiement, phrases courtes." in sp("style.md")
    for bad in ("../secret.txt", "absent.md", "/etc/passwd", None):
        assert sp(bad) == "Tu es Plume.", bad


def test_memory_update_block(tmp_path):
    from roai.providers.claude import apply_memory_update
    cfg = {"lean": True, "memory_file": "style.md"}
    (tmp_path / "style.md").write_text("ancien")
    txt, n = apply_memory_update(tmp_path, cfg, "J'ai retenu 3 choses.\n<<<MEMOIRE\n# Style\n- phrases courtes\n- jeton sk-ant-oat01-SECRETSECRETSECRET\nMEMOIRE>>>")
    assert txt == "J'ai retenu 3 choses." and n and "phrases courtes" in (tmp_path / "style.md").read_text()
    assert "SECRET" not in (tmp_path / "style.md").read_text()
    assert apply_memory_update(tmp_path, {"lean": False, "memory_file": "style.md"}, "x\n<<<MEMOIRE\ny\nMEMOIRE>>>")[1] is None
    assert apply_memory_update(tmp_path, {"lean": True, "memory_file": "../evil"}, "x\n<<<MEMOIRE\ny\nMEMOIRE>>>")[1] is None
    assert apply_memory_update(tmp_path, cfg, "sans bloc") == ("sans bloc", None)
