import asyncio, json, time
from pathlib import Path
from test_core import AGENT, wait_run


def _ctx(cfg, resume=None, mission="Mission X"):
    from roai.providers import RunContext
    return RunContext("r", {"config": cfg, "mission": mission, "model": None}, "Et ensuite ?", Path("/ws"), Path("/rd"), 60, Path("/h"), "/bin/x", resume_session=resume)


def test_resume_command_lines():
    from roai.providers import ClaudeAdapter, CodexAdapter
    c = ClaudeAdapter().build(_ctx({}, resume="sess-1"))
    assert c.argv[c.argv.index("--resume") + 1] == "sess-1" and "--dangerously-skip-permissions" not in c.argv
    assert "--resume" not in ClaudeAdapter().build(_ctx({})).argv
    x = CodexAdapter().build(_ctx({"sandbox": "workspace-write", "web_search": True}, resume="th-9"))
    assert x.argv[1:4] == ["exec", "resume", "th-9"] and "--json" in x.argv and x.argv[-1] == "-"
    assert 'sandbox_mode="workspace-write"' in x.argv and 'web_search="live"' in x.argv     # bac à sable imposé à la reprise
    assert x.stdin == "Et ensuite ?"                                                        # pas de mission renvoyée à la reprise
    assert "Mission X" in CodexAdapter().build(_ctx({})).stdin                              # la mission est dans le premier message
    bad = CodexAdapter().build(_ctx({"sandbox": "danger-full-access"}, resume="t"))
    assert 'sandbox_mode="read-only"' in bad.argv and not any("danger" in a for a in bad.argv)


def test_reply_flow_and_conversation(client):
    a = client.post("/api/agents", json=AGENT).json()
    first = wait_run(client, client.post(f"/api/agents/{a['id']}/run", json={"prompt": "Bonjour"}).json()["id"])
    assert first["session_id"] == "sess-1234" and first["conversation_id"] is None
    r2 = client.post(f"/api/runs/{first['id']}/reply", json={"prompt": "Et ensuite ?"})
    assert r2.status_code == 202
    second = r2.json()
    assert second["trigger"] == "reply" and second["parent_run_id"] == first["id"] and second["conversation_id"] == first["id"]
    second = wait_run(client, second["id"])
    assert second["status"] == "succeeded"
    conv = client.get(f"/api/conversations/{first['id']}").json()
    assert [r["id"] for r in conv["runs"]] == [first["id"], second["id"]] and conv["agent_name"] == AGENT["name"]
    assert conv["runs"][0]["conversation_id"] == first["id"]                               # la racine est rattachée à la conversation
    third = client.post(f"/api/runs/{second['id']}/reply", json={"prompt": "SLOW"}).json()
    assert third["conversation_id"] == first["id"]
    t0 = time.time()
    while client.get(f"/api/runs/{third['id']}").json()["status"] not in ("running",) and time.time() - t0 < 10:
        time.sleep(0.1)
    busy = client.post(f"/api/runs/{third['id']}/reply", json={"prompt": "vite"})
    assert busy.status_code == 409 and "pas terminée" in busy.json()["detail"]
    client.post(f"/api/runs/{third['id']}/cancel")
    wait_run(client, third["id"])
    ids = [r["id"] for r in client.get(f"/api/runs?conversation_id={first['id']}").json()]
    assert set(ids) == {first["id"], second["id"], third["id"]}
    assert client.get("/api/conversations/inconnue").status_code == 404
    assert client.post(f"/api/runs/{first['id']}/reply", json={"prompt": ""}).status_code == 422


def test_reply_refusals(client):
    a = client.post("/api/agents", json={**AGENT, "name": "Sans session", "provider": "codex"}).json()
    st = client.app_state
    r = wait_run(client, client.post(f"/api/agents/{a['id']}/run", json={"prompt": "x"}).json()["id"])
    st.db.execute("UPDATE runs SET session_id=NULL WHERE id=?", (r["id"],))
    nos = client.post(f"/api/runs/{r['id']}/reply", json={"prompt": "y"})
    assert nos.status_code == 409 and "session" in nos.json()["detail"]
    st.db.execute("UPDATE runs SET session_id='th-1' WHERE id=?", (r["id"],))
    client.post("/api/control/emergency-stop", json={})
    assert client.post(f"/api/runs/{r['id']}/reply", json={"prompt": "y"}).status_code == 409
    client.post("/api/control/resume")
    client.put(f"/api/agents/{a['id']}", json={**AGENT, "name": "Sans session", "provider": "codex", "enabled": False})
    assert client.post(f"/api/runs/{r['id']}/reply", json={"prompt": "y"}).status_code == 409


def test_discord_chat_reply_goes_to_bot_not_webhook(env):
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
    from test_discord import TOKEN, OWNER, WEBHOOK

    webhook_posts = []

    async def main():
        db = Database(env.db_path)
        journal = EventJournal(db, "perso")
        status = ProviderStatus(env, db, lambda p, s: None)
        ex = Executor(env); await ex.detect()
        worker = Worker(env, db, journal, ex, status); await worker.start()
        svc = DiscordService(env, db, journal, worker, status, Scheduler(db, journal, worker))

        async def no_client(): return None
        svc._run_client = no_client
        svc._http_factory = lambda: httpx.AsyncClient(transport=httpx.MockTransport(lambda r: (webhook_posts.append(r), httpx.Response(204))[1]))
        bot = []

        async def fake_deliver(n):
            bot.append(n); return {"ok": True, "error": None}
        svc._deliver = fake_deliver
        await svc.start()
        await svc.update(DiscordSettingsIn(token=TOKEN, owner_id=OWNER, enabled=True, webhook_url=WEBHOOK))
        svc._ready.set()
        aid = new_id("ag")
        db.execute("INSERT INTO agents(id,slug,name,provider,mission,default_prompt,department,domain,config_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                   (aid, "bavard", "Bavard", "claude", "m", "x", "Veille", "perso", "{}", now_iso(), now_iso()))
        worker.create_run(db.one("SELECT * FROM agents WHERE id=?", (aid,)), "Salut", "api", notify_target="discord")
        await asyncio.sleep(5)
        chat = [n for n in bot if n.category == "chat"]
        assert chat and chat[0].embed["title"] == "Réponse de Bavard" and "Terminé" in chat[0].embed["description"]
        assert "/parler" in chat[-1].embed["footer"]
        assert not webhook_posts                                    # jamais par le webhook du salon
        await svc.stop(); await worker.stop()

    asyncio.run(main())
