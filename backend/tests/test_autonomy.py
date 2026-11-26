import asyncio, json, stat
from pathlib import Path
from test_core import AGENT, wait_run

AGENT_HOOK = "https://discord.com/api/webhooks/222222222222222222/" + "Agt_" * 12
GLOBAL_HOOK = "https://discord.com/api/webhooks/333333333333333333/" + "Glb_" * 12


def _ctx(cfg, resume=None):
    from roai.providers import RunContext
    return RunContext("r", {"config": cfg, "mission": "", "model": None}, "p", Path("/ws"), Path("/rd"), 60, Path("/home/agent"), "/bin/x", resume_session=resume)


def _settings(argv):
    return json.loads(argv[argv.index("--settings") + 1])


def test_claude_sandbox_network_and_free_mode():
    from roai.providers import ClaudeAdapter
    base = ClaudeAdapter().build(_ctx({"allowed_tools": ["Read"]}))
    sb = _settings(base.argv)["sandbox"]
    assert sb == {"enabled": True, "failIfUnavailable": True, "allowUnsandboxedCommands": False}            # aucun réseau par défaut
    assert "--dangerously-skip-permissions" not in base.argv and base.argv[base.argv.index("--allowedTools") + 1] == "Read"
    assert "/home/agent/.codex" in base.hide                                                                 # identifiants de Codex invisibles
    net = ClaudeAdapter().build(_ctx({"allowed_tools": ["Read"], "network_domains": ["discord.com", "*.github.com"]}))
    s2 = _settings(net.argv)["sandbox"]
    assert s2["network"] == {"allowedDomains": ["discord.com", "*.github.com"], "strictAllowlist": True} and s2["enabled"] is True
    assert net.argv[net.argv.index("--allowedTools") + 1] == "Read,Bash"                                    # Bash ajouté, toujours sandboxé
    free = ClaudeAdapter().build(_ctx({"unrestricted": True, "allowed_tools": ["Read"]}))
    assert "--dangerously-skip-permissions" in free.argv and "--allowedTools" not in free.argv and "--permission-mode" not in free.argv
    assert _settings(free.argv) == {"sandbox": {"enabled": False}}


def test_codex_network_and_free_mode():
    from roai.providers import CodexAdapter
    base = CodexAdapter().build(_ctx({}))
    assert base.argv[base.argv.index("--sandbox") + 1] == "read-only" and not any("network" in a for a in base.argv)
    assert "/home/agent/.claude" in base.hide and "/home/agent/.claude.json" in base.hide
    net = CodexAdapter().build(_ctx({"network_domains": ["discord.com"]}))
    assert net.argv[net.argv.index("--sandbox") + 1] == "workspace-write"
    assert "sandbox_workspace_write.network_access=true" in net.argv and "features.network_proxy.enabled=true" in net.argv
    assert 'features.network_proxy.domains={"discord.com" = "allow"}' in net.argv
    rnet = CodexAdapter().build(_ctx({"network_domains": ["discord.com"]}, resume="t1"))
    assert 'sandbox_mode="workspace-write"' in rnet.argv and "features.network_proxy.enabled=true" in rnet.argv
    for free in (CodexAdapter().build(_ctx({"unrestricted": True})), CodexAdapter().build(_ctx({"unrestricted": True, "network_domains": ["x.com"]}, resume="t1"))):
        assert "--dangerously-bypass-approvals-and-sandbox" in free.argv and "--sandbox" not in free.argv
        assert not any(a.startswith("sandbox_mode") or "network_proxy" in a for a in free.argv)


def test_executor_hides_secrets(env):
    from roai.executor import Executor
    from roai.providers.base import Command
    ex = Executor(env); ex.mode = "systemd"
    argv, _ = ex._wrap(Command(["/bin/true"], {}, hide=["/home/agent/.codex"]), "u", Path("/ws"), 30)
    paths = argv[argv.index(next(a for a in argv if a.startswith("InaccessiblePaths=")))].split("=", 1)[1].split()
    assert f"-{env.config_dir}" in paths and f"-{env.db_path}" in paths and f"-{env.db_path}-wal" in paths and "-/home/agent/.codex" in paths


def test_free_mode_forces_approval_and_is_logged(client):
    a = client.post("/api/agents", json={**AGENT, "config": {"unrestricted": True, "require_approval": False}})
    assert a.status_code == 201 and a.json()["config"]["require_approval"] is True and a.json()["config"]["unrestricted"] is True
    run = client.post(f"/api/agents/{a.json()['id']}/run", json={"prompt": "x"}).json()
    assert run["status"] == "awaiting_approval"                                                             # jamais de lancement direct
    notes = [e for e in client.get("/api/events?type_prefix=system.notice").json()["events"] if "Mode libre" in e["payload"]["message"]]
    assert len(notes) == 1
    up = client.put(f"/api/agents/{a.json()['id']}", json={**AGENT, "config": {"unrestricted": True, "require_approval": False}}).json()
    assert up["config"]["require_approval"] is True
    assert len([e for e in client.get("/api/events?type_prefix=system.notice").json()["events"] if "Mode libre" in e["payload"]["message"]]) == 1


def test_network_domains_validation(client):
    ok = client.post("/api/agents", json={**AGENT, "config": {"network_domains": ["Discord.com", "discord.com", "*.github.com", "api.example.com:8443"]}})
    assert ok.status_code == 201 and ok.json()["config"]["network_domains"] == ["discord.com", "*.github.com", "api.example.com:8443"]
    for bad in (["https://discord.com"], ["*"], ["discord.com/path"], ["localhost"], ["a b.com"]):
        assert client.post("/api/agents", json={**AGENT, "config": {"network_domains": bad}}).status_code == 422, bad
    assert client.post("/api/agents", json={**AGENT, "config": {"network_domains": [f"d{i}.com" for i in range(21)]}}).status_code == 422


def test_agent_webhook_write_only(client, env):
    a = client.post("/api/agents", json=AGENT).json()
    assert a["discord_webhook_set"] is False
    assert client.put(f"/api/agents/{a['id']}/discord-webhook", json={"webhook_url": "https://evil.example/api/webhooks/1/abc"}).status_code == 422
    assert client.put(f"/api/agents/{a['id']}/discord-webhook", json={"webhook_url": AGENT_HOOK}).json() == {"discord_webhook_set": True}
    g = client.get(f"/api/agents/{a['id']}")
    assert g.json()["discord_webhook_set"] is True and "Agt_Agt_" not in g.text and "Agt_Agt_" not in client.get("/api/agents").text
    f = env.config_dir / "agent_webhooks.json"
    assert stat.S_IMODE(f.stat().st_mode) == 0o600 and json.loads(f.read_text())[a["id"]] == AGENT_HOOK
    assert client.delete(f"/api/agents/{a['id']}/discord-webhook").json() == {"discord_webhook_set": False}
    client.put(f"/api/agents/{a['id']}/discord-webhook", json={"webhook_url": AGENT_HOOK})
    assert client.delete(f"/api/agents/{a['id']}").status_code == 204
    assert a["id"] not in json.loads(f.read_text())                                                        # supprimé avec l'agent


def test_report_uses_agent_webhook_first(env):
    import httpx
    from roai.core_api import create_app  # noqa: F401
    from roai.db import Database, new_id, now_iso
    from roai.events import EventJournal
    from roai.executor import Executor
    from roai.providers.status import ProviderStatus
    from roai.scheduler import Scheduler
    from roai.worker import Worker
    from roai.discord_service import DiscordService
    from roai.discord_settings import DiscordSettingsIn
    urls = []

    async def main():
        db = Database(env.db_path)
        journal = EventJournal(db, "perso")
        status = ProviderStatus(env, db, lambda p, s: None)
        ex = Executor(env); await ex.detect()
        worker = Worker(env, db, journal, ex, status); await worker.start()
        svc = DiscordService(env, db, journal, worker, status, Scheduler(db, journal, worker))
        svc._http_factory = lambda: httpx.AsyncClient(transport=httpx.MockTransport(lambda r: (urls.append(str(r.url)), httpx.Response(204))[1]))
        await svc.start()
        await svc.update(DiscordSettingsIn(webhook_url=GLOBAL_HOOK))

        def mk(name):
            aid = new_id("ag")
            db.execute("INSERT INTO agents(id,slug,name,provider,mission,default_prompt,department,domain,config_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                       (aid, name, name, "codex", "m", "x", "Veille", "perso", json.dumps({"discord_report": True}), now_iso(), now_iso()))
            return db.one("SELECT * FROM agents WHERE id=?", (aid,))
        a1, a2 = mk("avec-webhook"), mk("sans-webhook")
        svc.agent_hooks.set(a1["id"], AGENT_HOOK)
        worker.create_run(a1, "r1", "manual")
        await asyncio.sleep(4)
        worker.create_run(a2, "r2", "manual")
        await asyncio.sleep(4)
        assert urls and urls[0] == AGENT_HOOK and GLOBAL_HOOK in urls[1:], urls                           # l'agent avant le global
        await svc.stop(); await worker.stop()
    asyncio.run(main())


def test_autonomous_free_mode_is_explicit_and_logged(client):
    import time as _t
    a = client.post("/api/agents", json={**AGENT, "config": {"unrestricted": True, "autonomous": True, "require_approval": False}}).json()
    assert a["config"]["unrestricted"] and a["config"]["autonomous"] and a["config"]["require_approval"] is False
    notices = [e["payload"].get("message", "") for e in client.get("/api/events?type_prefix=system.notice").json()["events"]]
    assert any("autonome" in m for m in notices)
    # un lancement part directement, sans attente d'approbation
    run = client.post(f"/api/agents/{a['id']}/run", json={"prompt": "go"}).json()
    assert run["status"] in ("queued", "running")
    # repasser en mode libre simple : l'approbation redevient obligatoire, et c'est tracé
    up = client.put(f"/api/agents/{a['id']}", json={**AGENT, "config": {"unrestricted": True, "require_approval": False}}).json()
    assert up["config"]["require_approval"] is True and "autonomous" not in up["config"]
    # « autonome » sans mode libre n'a pas de sens : ignoré
    b = client.post("/api/agents", json={**AGENT, "name": "Autre", "config": {"autonomous": True}}).json()
    assert "autonomous" not in b["config"]
