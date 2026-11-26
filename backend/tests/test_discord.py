import asyncio, json, os, stat, time
from pathlib import Path
import pytest

OWNER = "123456789012345678"
TOKEN = "A" * 24 + "." + "B" * 6 + "." + "C" * 38   # forme d'un jeton de bot, factice
APP_ID = "987654321098765432"


# ----------------------------------------------------------------- logique pure
def _cfg(**kw):
    from roai.discord_settings import DiscordSettings, DiscordNotify, DiscordCommands
    notify = kw.pop("notify", {})
    commands = kw.pop("commands", {})
    kw.setdefault("dashboard_url", "https://ro-ai.lan")
    return DiscordSettings(enabled=True, owner_id=OWNER, notify=DiscordNotify(**notify), commands=DiscordCommands(**commands), **kw)


def _ev(type_, seq=1, run_id="run_1", agent_id="ag_1", **payload):
    return {"seq": seq, "ts": "2026-11-24T10:00:00Z", "schema": 1, "domain": "perso", "type": type_, "agent_id": agent_id, "run_id": run_id, "payload": payload}


NAME = lambda aid: "Veilleur CVE"
PROV = lambda rid: "claude"


def test_build_notifications():
    from roai.discord_notify import build
    c = _cfg()
    n = build(_ev("run.failed", error_class="auth_expired", error_message="Please run /login", duration_ms=1500), c, NAME, PROV)
    assert n.category == "failures" and "Veilleur CVE" in n.embed["title"] and "roai-login claude" in n.embed["description"]
    assert ("Cause", "Connexion expirée", True) in n.embed["fields"] and n.embed["url"].endswith("/runs/run_1")
    n = build(_ev("run.failed", error_class="rate_limited", error_message="x"), c, NAME, PROV)
    assert "automatiquement" in n.embed["description"]
    n = build(_ev("run.awaiting_approval", prompt_preview="Fais le point"), c, NAME, PROV)
    assert n.category == "approvals" and n.run_id == "run_1"                       # boutons proposés
    n = build(_ev("run.awaiting_approval", prompt_preview="x"), _cfg(commands={"approve": False}), NAME, PROV)
    assert n.run_id is None                                                          # pas de boutons si l'approbation est interdite
    assert build(_ev("run.succeeded", result_preview="ok"), c, NAME, PROV) is None  # bavard : désactivé par défaut
    assert build(_ev("run.succeeded", result_preview="ok"), _cfg(notify={"completions": True}), NAME, PROV).category == "completions"
    assert build(_ev("run.failed", error_class="failed"), _cfg(notify={"failures": False}), NAME, PROV) is None
    n = build(_ev("system.emergency_stop", agent_id=None, run_id=None, cancelled=3, reason="test"), c, NAME, PROV)
    assert n.category == "emergency" and "3 exécution" in n.embed["description"] and "test" in n.embed["description"]
    assert build(_ev("system.resumed", agent_id=None, run_id=None), c, NAME, PROV).embed["title"] == "Reprise"
    n = build(_ev("provider.auth", agent_id=None, run_id=None, provider="codex", state="logged_out"), c, NAME, PROV)
    assert "Codex CLI" in n.embed["title"] and "roai-login codex" in n.embed["description"]
    n = build(_ev("run.rate_limit", status="rejected", resets_at="2026-11-24T15:40:00Z", window="five_hour"), c, NAME, PROV)
    assert n.category == "limits" and ("Fenêtre", "5 heures", True) in n.embed["fields"]
    assert build(_ev("run.rate_limit", status="allowed", window="five_hour"), c, NAME, PROV) is None   # pas de bruit quand tout va bien
    assert build(_ev("system.notice", agent_id=None, run_id=None, level="warn", message="m"), c, NAME, PROV) is None
    assert build(_ev("system.notice", agent_id=None, run_id=None, level="error", message="boum"), c, NAME, PROV).category == "system_errors"
    assert build(_ev("tool.call", tool="Read"), c, NAME, PROV) is None


def test_build_masks_secrets_and_truncates():
    from roai.discord_notify import build
    n = build(_ev("run.failed", error_class="failed", error_message="token sk-ant-oat01-SECRETSECRETSECRET " + "x" * 5000), _cfg(), NAME, PROV)
    blob = json.dumps(n.embed)
    assert "SECRETSECRET" not in blob and len(n.embed["fields"][-1][1]) <= 900


def test_dedupe_and_batch():
    from roai.discord_notify import Dedupe, batch, Notification
    t = [0.0]
    d = Dedupe(10, clock=lambda: t[0])
    assert d.fresh("a") and not d.fresh("a") and d.fresh("b") and d.fresh(None) and d.fresh(None)
    t[0] = 11
    assert d.fresh("a")
    items = [Notification("failures", {}) for _ in range(8)]
    send, extra = batch(items)
    assert len(send) == 5 and extra == 3


# ----------------------------------------------------------------- réglages et API
def test_settings_api_never_leaks_token(client, env):
    st = client.app_state

    async def noop():
        return None
    st.discord._run_client = noop            # ne jamais joindre le vrai Discord dans les tests
    g = client.get("/api/settings/discord").json()
    assert g["enabled"] is False and g["token_set"] is False and g["invite_url"] is None and g["status"]["state"] == "disabled"
    assert g["notify"]["failures"] is True and g["notify"]["completions"] is False and g["commands"]["run"] is False
    bad = client.put("/api/settings/discord", json={"owner_id": "abc"})
    assert bad.status_code == 422 and isinstance(bad.json()["detail"], str) and "identifiant" in bad.json()["detail"]
    assert client.put("/api/settings/discord", json={"token": "trop-court"}).status_code == 422
    assert client.put("/api/settings/discord", json={"enabled": True}).status_code == 422           # activer sans jeton ni identifiant
    assert client.put("/api/settings/discord", json={"delivery": "channel"}).status_code == 422     # salon sans identifiant
    r = client.put("/api/settings/discord", json={"token": TOKEN, "owner_id": OWNER, "application_id": APP_ID, "enabled": True})
    assert r.status_code == 200
    body = r.json()
    assert body["token_set"] is True and body["enabled"] is True and f"client_id={APP_ID}" in body["invite_url"]
    assert "permissions=19456" in body["invite_url"] and body["status"]["state"] == "connecting"
    for resp in (r, client.get("/api/settings/discord")):
        assert TOKEN not in resp.text and "AAAAAAAA" not in resp.text and "token\"" not in resp.text.replace("token_set", "")
    f = env.config_dir / "discord.json"
    assert f.exists() and stat.S_IMODE(f.stat().st_mode) == 0o600
    # une mise à jour sans jeton le conserve ; une mise à jour partielle garde le reste
    r2 = client.put("/api/settings/discord", json={"notify": {"completions": True}, "dashboard_url": "https://ro-ai.example:8443/"}).json()
    assert r2["token_set"] is True and r2["owner_id"] == OWNER and r2["notify"]["completions"] is True and r2["dashboard_url"] == "https://ro-ai.example:8443"
    assert client.put("/api/settings/discord", json={"dashboard_url": "javascript:alert(1)"}).status_code == 422
    # le jeton n'apparaît dans aucun événement du journal
    assert TOKEN not in json.dumps(client.get("/api/events?limit=1000").json())
    cleared = client.put("/api/settings/discord", json={"clear_token": True, "enabled": False}).json()
    assert cleared["token_set"] is False and cleared["status"]["state"] == "disabled"
    assert json.loads(f.read_text())["token"] is None
    assert client.post("/api/settings/discord/test").json()["ok"] is False                           # pas connecté : refus lisible


# ----------------------------------------------------------------- circuit complet hors ligne
class FakeResp:
    def __init__(self): self.sent, self.edited, self._done = [], [], False
    def is_done(self): return self._done
    async def send_message(self, *a, **k): self.sent.append((a, k)); self._done = True
    async def edit_message(self, **k): self.edited.append(k); self._done = True


class FakeFollowup:
    def __init__(self): self.sent = []
    async def send(self, *a, **k): self.sent.append((a, k))


class FakeInteraction:
    def __init__(self, user_id, custom_id):
        self.user = type("U", (), {"id": user_id})()
        self.data = {"custom_id": custom_id}
        self.response, self.followup = FakeResp(), FakeFollowup()


def test_full_pipeline_offline(env):
    from roai.core_api import create_app  # noqa: F401  (initialise la référence de base)
    from roai.db import Database, new_id, now_iso
    from roai.events import EventJournal
    from roai.executor import Executor
    from roai.providers.status import ProviderStatus
    from roai.scheduler import Scheduler
    from roai.worker import Worker
    from roai.discord_service import DiscordService
    from roai.discord_settings import DiscordSettingsIn

    async def main():
        db = Database(env.db_path)
        journal = EventJournal(db, "perso")
        status = ProviderStatus(env, db, lambda p, s: journal.emit("provider.auth", payload={"provider": p, "state": s}))
        ex = Executor(env); await ex.detect()
        worker = Worker(env, db, journal, ex, status); await worker.start()
        sched = Scheduler(db, journal, worker)
        svc = DiscordService(env, db, journal, worker, status, sched)

        async def no_client(): return None
        svc._run_client = no_client
        sent = []

        async def fake_deliver(n):
            sent.append(n); return {"ok": True, "error": None}
        svc._deliver = fake_deliver
        await svc.start()
        await svc.update(DiscordSettingsIn(token=TOKEN, owner_id=OWNER, application_id=APP_ID, enabled=True))
        svc._ready.set()
        await asyncio.sleep(0.3)

        def mk(name, **cfg):
            aid = new_id("ag")
            db.execute("INSERT INTO agents(id,slug,name,provider,mission,default_prompt,department,domain,config_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                       (aid, name.lower().replace(" ", "-"), name, "claude", "m", "x", "Veille", "perso", json.dumps(cfg), now_iso(), now_iso()))
            return db.one("SELECT * FROM agents WHERE id=?", (aid,))

        a = mk("Agent Cassé")
        worker.create_run(a, "FAIL_RATE", "manual")
        b = mk("Agent Prudent", require_approval=True)
        pending = worker.create_run(b, "go", "manual")
        await asyncio.sleep(4.5)                                          # fenêtre de regroupement de l'envoi
        cats = [n.category for n in sent]
        assert "failures" in cats and "approvals" in cats and "limits" in cats, cats
        approval = next(n for n in sent if n.category == "approvals")
        assert approval.run_id == pending["id"] and "Agent Prudent" in approval.embed["title"]
        fail = next(n for n in sent if n.category == "failures")
        assert "Agent Cassé" in fail.embed["title"] and ("Cause", "Limite d'usage atteinte", True) in fail.embed["fields"]

        # propriétaire : le bouton « Approuver » fonctionne ; un autre utilisateur est refusé
        stranger = FakeInteraction(555, f"roai:ap:{pending['id']}:ok")
        await svc._on_component(stranger)
        assert stranger.response.sent and "privé" in stranger.response.sent[0][0][0]
        assert db.one("SELECT status FROM runs WHERE id=?", (pending["id"],))["status"] == "awaiting_approval"
        owner = FakeInteraction(int(OWNER), f"roai:ap:{pending['id']}:ok")
        await svc._on_component(owner)
        assert owner.response.edited and "approuvée" in owner.response.edited[0]["content"]
        assert db.one("SELECT status FROM runs WHERE id=?", (pending["id"],))["status"] in ("queued", "running", "succeeded")
        # commandes désactivées : les boutons d'approbation sont refusés
        await svc.update(DiscordSettingsIn(commands={"read": True, "control": True, "approve": False, "run": False}))
        c2 = mk("Agent Prudent 2", require_approval=True)
        p2 = worker.create_run(c2, "go", "manual")
        denied = FakeInteraction(int(OWNER), f"roai:ap:{p2['id']}:ok")
        await svc._on_component(denied)
        assert "désactivée" in denied.response.sent[0][0][0]
        assert db.one("SELECT status FROM runs WHERE id=?", (p2["id"],))["status"] == "awaiting_approval"
        # arrêt d'urgence par bouton avec confirmation
        await svc.update(DiscordSettingsIn(commands={"read": True, "control": True, "approve": True, "run": False}))
        svc._pending_stop["n1"] = "depuis le test"
        stop = FakeInteraction(int(OWNER), "roai:stop:n1")
        await svc._on_component(stop)
        assert worker.is_paused() and db.one("SELECT status FROM runs WHERE id=?", (p2["id"],))["status"] == "cancelled"
        assert stop.followup.sent and "Arrêt d'urgence actif" in stop.followup.sent[0][0][0]
        # contenus des commandes
        emb = await svc.embed_status()
        assert emb["title"] == "État de RO·AI" and any("ARRÊT D'URGENCE" in v for _, v, _ in emb["fields"])
        assert "Agent" in svc.embed_runs(5)["description"]
        # rien de secret dans ce qui a été « envoyé »
        assert TOKEN not in json.dumps([n.embed for n in sent])
        await svc.stop(); await worker.stop()

    asyncio.run(main())


# ----------------------------------------------------------------- rapports par webhook
WEBHOOK = "https://discord.com/api/webhooks/111111111111111111/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-"


def test_report_embeds_chunking_and_masking():
    from roai.discord_notify import report_embeds
    text = "\n".join(f"## Section {i}\n- point {i} avec un lien https://exemple.test/{i} " + "x" * 300 for i in range(40))
    text += "\ntoken sk-ant-oat01-SECRETSECRETSECRET et " + WEBHOOK
    es = report_embeds("Rapport : Veille", text, "https://ro-ai.lan/runs/run_1", "2026-11-24T10:00:00Z")
    assert 1 < len(es) <= 8 and all(len(e["description"]) <= 3800 for e in es)
    assert es[0]["title"] == "Rapport : Veille" and es[0]["url"].endswith("run_1") and es[-1]["timestamp"] and es[0]["timestamp"] is None
    blob = json.dumps(es)
    assert "SECRETSECRET" not in blob and "AbCdEfGhIj" not in blob                    # jeton et webhook masqués
    short = report_embeds("T", "## Court\n- un point")
    assert len(short) == 1 and short[0]["description"].startswith("## Court")
    giant = report_embeds("T", "z" * 90000)
    assert len(giant) == 8 and "tronqué" in giant[-1]["description"]                 # plafond : pas de flot de messages
    assert report_embeds("T", "")[0]["description"] == "(rapport vide)"


def test_webhook_setting_is_write_only_and_validated(client, env):
    async def noop():
        return None
    client.app_state.discord._run_client = noop
    for bad in ("http://discord.com/api/webhooks/123/abc", "https://evil.example/api/webhooks/111111111111111111/AbCdEfGhIjKlMnOpQrStUvWxYz", "https://discord.com/api/webhooks/abc/def"):
        assert client.put("/api/settings/discord", json={"webhook_url": bad}).status_code == 422, bad    # uniquement discord.com
    r = client.put("/api/settings/discord", json={"webhook_url": WEBHOOK})
    assert r.status_code == 200 and r.json()["webhook_set"] is True
    for resp in (r, client.get("/api/settings/discord")):
        assert "AbCdEfGhIj" not in resp.text and "webhooks/1485" not in resp.text
    assert "AbCdEfGhIj" not in json.dumps(client.get("/api/events?limit=1000").json())
    f = env.config_dir / "discord.json"
    assert stat.S_IMODE(f.stat().st_mode) == 0o600 and json.loads(f.read_text())["webhook"] == WEBHOOK
    assert client.put("/api/settings/discord", json={"notify": {"completions": True}}).json()["webhook_set"] is True   # conservé
    assert client.put("/api/settings/discord", json={"clear_webhook": True}).json()["webhook_set"] is False
    assert client.post("/api/settings/discord/test", json={"target": "webhook"}).json()["ok"] is False


def test_codex_web_search_events():
    from roai.providers import CodexAdapter
    a = CodexAdapter()
    ev1 = a.parse(json.dumps({"type": "item.started", "item": {"id": "w1", "type": "web_search"}}))
    ev2 = a.parse(json.dumps({"type": "item.completed", "item": {"id": "w1", "type": "web_search", "query": "star citizen 4.10 patch notes"}}))
    assert ev1[0][0] == "tool.call" and ev1[0][1]["kind"] == "web" and ev1[0][1]["summary"] == "Recherche web"
    assert ev2[0][0] == "tool.result" and ev2[0][1]["tool_id"] == "w1" and "patch notes" in ev2[0][1]["summary"]   # plus de « en cours… » éternel


def test_report_pipeline_via_webhook_without_bot(env):
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

    posts, mode = [], {"fail": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        posts.append((str(req.url), body))
        if mode["fail"] == 1 and len(posts) == 1:                    # première réponse : limite de débit
            return httpx.Response(429, json={"retry_after": 0.2})
        return httpx.Response(204)

    async def main():
        db = Database(env.db_path)
        journal = EventJournal(db, "perso")
        status = ProviderStatus(env, db, lambda p, s: None)
        ex = Executor(env); await ex.detect()
        worker = Worker(env, db, journal, ex, status); await worker.start()
        svc = DiscordService(env, db, journal, worker, status, Scheduler(db, journal, worker))
        svc._http_factory = lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))
        await svc.start()
        await svc.update(DiscordSettingsIn(webhook_url=WEBHOOK))      # pas de bot : seulement le webhook
        assert svc.state() == "disabled" and svc.public()["webhook_set"] is True

        def mk(name, report):
            aid = new_id("ag")
            db.execute("INSERT INTO agents(id,slug,name,provider,mission,default_prompt,department,domain,config_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                       (aid, name.lower().replace(" ", "-"), name, "codex", "m", "x", "Veille", "perso", json.dumps({"discord_report": report}), now_iso(), now_iso()))
            return db.one("SELECT * FROM agents WHERE id=?", (aid,))

        mode["fail"] = 1
        worker.create_run(mk("Veille SC", True), "rapport de la semaine", "manual")
        worker.create_run(mk("Sans rapport", False), "ras", "manual")
        await asyncio.sleep(7)
        ok = [(u, b) for u, b in posts if "Veille SC" in json.dumps(b)]
        assert len(posts) >= 2 and posts[0][0] == WEBHOOK and ok, posts                       # 429 puis reprise réussie
        body = ok[-1][1]
        assert body["allowed_mentions"] == {"parse": []} and body["username"] == "RO·AI"
        assert "Fait : " in body["embeds"][0]["description"] and body["embeds"][0]["title"] == "Rapport : Veille SC"
        assert not any("Sans rapport" in json.dumps(b) for _, b in posts)                      # seul l'agent qui l'a demandé envoie
        assert svc.public()["status"]["webhook"]["last_sent_at"] and svc.public()["status"]["webhook"]["last_error"] is None
        assert WEBHOOK.split("/")[-1] not in json.dumps(svc.public())
        # webhook supprimé côté Discord : erreur lisible
        posts.clear()
        svc._http_factory = lambda: httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(404, json={"message": "Unknown Webhook"})))
        res = await svc.send_test("webhook")
        assert res["ok"] is False and "nouveau" in res["error"] and svc.public()["status"]["webhook"]["last_error"] == res["error"]
        await svc.stop(); await worker.stop()

    asyncio.run(main())


def test_extract_brief():
    from roai.briefs import extract_brief
    assert extract_brief("rapport sans bloc") == ("rapport sans bloc", None)
    clean, brief = extract_brief("## Rapport\nlong\n\n<<<DISCORD\n🟢 RAS ce matin. sk-ant-oat01-SECRETSECRETSECRET\nDISCORD>>>\n")
    assert clean == "## Rapport\nlong" and brief.startswith("🟢 RAS ce matin.") and "SECRET" not in brief
    assert extract_brief("<<<DISCORD\n\nDISCORD>>>")[1] is None
    assert len(extract_brief("<<<DISCORD\n" + "a" * 5000 + "\nDISCORD>>>")[1]) == 1800


def test_brief_pipeline_sends_only_marked_summary(env):
    import httpx
    from roai.db import Database, new_id, now_iso
    from roai.events import EventJournal
    from roai.executor import Executor
    from roai.providers.status import ProviderStatus
    from roai.scheduler import Scheduler
    from roai.worker import Worker
    from roai.discord_service import DiscordService
    from roai.discord_settings import DiscordSettingsIn

    posts = []

    def handler(req: httpx.Request) -> httpx.Response:
        posts.append(json.loads(req.content))
        return httpx.Response(204)

    async def main():
        db = Database(env.db_path)
        journal = EventJournal(db, "perso")
        status = ProviderStatus(env, db, lambda p, s: None)
        ex = Executor(env); await ex.detect()
        worker = Worker(env, db, journal, ex, status); await worker.start()
        svc = DiscordService(env, db, journal, worker, status, Scheduler(db, journal, worker))
        svc._http_factory = lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))
        await svc.start()
        await svc.update(DiscordSettingsIn(webhook_url=WEBHOOK))
        aid = new_id("ag")
        db.execute("INSERT INTO agents(id,slug,name,provider,mission,default_prompt,department,domain,config_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                   (aid, "manager", "Manager", "codex", "m", "x", "Direction", "perso", json.dumps({"discord_brief": True}), now_iso(), now_iso()))
        agent = db.one("SELECT * FROM agents WHERE id=?", (aid,))
        r1 = worker.create_run(agent, "bilan\n<<<DISCORD\nBrief OK\nDISCORD>>>", "manual")   # le faux Codex renvoie les 30 derniers caractères
        r2 = worker.create_run(agent, "alerte banale sans résumé", "manual")
        await asyncio.sleep(7)
        sent = json.dumps(posts, ensure_ascii=False)
        assert len(posts) == 1 and "Brief OK" in sent and "alerte banale" not in sent, posts
        assert posts[0]["embeds"][0]["title"] == "Manager"
        res = db.one("SELECT result_text FROM runs WHERE id=?", (r1["id"],))["result_text"]
        assert "<<<DISCORD" not in res and "Brief OK" not in res, "bloc retiré du rapport affiché"
        assert db.one("SELECT status FROM runs WHERE id=?", (r2["id"],))["status"] == "succeeded"
        await svc.stop(); await worker.stop()

    asyncio.run(main())


def test_dashboard_url_default_comes_from_environment(monkeypatch):
    from roai.discord_settings import DiscordSettings
    monkeypatch.delenv("ROAI_PUBLIC_URL", raising=False)
    assert DiscordSettings().dashboard_url == ""
    monkeypatch.setenv("ROAI_PUBLIC_URL", "https://mon-serveur.lan/")
    assert DiscordSettings().dashboard_url == "https://mon-serveur.lan"


def test_report_texts_chunking():
    from roai.discord_notify import report_texts
    t = report_texts("Rapport hebdo", "## Semaine\n" + "\n".join(f"- point {i} " + "x" * 80 for i in range(60)), "https://ro-ai.lan/runs/r1")
    assert t[0].startswith("**Rapport hebdo**\n## Semaine") and all(len(m) <= 2000 for m in t) and len(t) >= 3
    assert t[-1].endswith("🔗 <https://ro-ai.lan/runs/r1>")
    assert report_texts("T", "court") == ["**T**\ncourt"]
    assert "SECRET" not in "".join(report_texts("T", "token sk-ant-oat01-SECRETSECRETSECRET"))


def test_report_style_both_sends_embed_and_text(env):
    import httpx
    from roai.db import Database, new_id, now_iso
    from roai.events import EventJournal
    from roai.executor import Executor
    from roai.providers.status import ProviderStatus
    from roai.scheduler import Scheduler
    from roai.worker import Worker
    from roai.discord_service import DiscordService
    from roai.discord_settings import DiscordSettingsIn

    posts = []

    def handler(req: httpx.Request) -> httpx.Response:
        posts.append(json.loads(req.content))
        return httpx.Response(204)

    async def main():
        db = Database(env.db_path)
        journal = EventJournal(db, "perso")
        status = ProviderStatus(env, db, lambda p, s: None)
        ex = Executor(env); await ex.detect()
        worker = Worker(env, db, journal, ex, status); await worker.start()
        svc = DiscordService(env, db, journal, worker, status, Scheduler(db, journal, worker))
        svc._http_factory = lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))
        await svc.start()
        await svc.update(DiscordSettingsIn(webhook_url=WEBHOOK))

        def mk(name, style):
            aid = new_id("ag")
            db.execute("INSERT INTO agents(id,slug,name,provider,mission,default_prompt,department,domain,config_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                       (aid, name.lower(), name, "codex", "m", "x", "Prod", "perso", json.dumps({"discord_report": True, "discord_style": style}), now_iso(), now_iso()))
            return db.one("SELECT * FROM agents WHERE id=?", (aid,))
        both_agent = mk("Both", "both")
        worker.create_run(both_agent, "conversation privée", "manual", notify_target="chat")   # jamais dans le salon
        await asyncio.sleep(3)
        assert not posts, posts
        worker.create_run(both_agent, "rapport A", "manual")
        await asyncio.sleep(5)
        both = [p for p in posts if "Both" in json.dumps(p)]
        assert len([p for p in both if "embeds" in p]) == 1 and len([p for p in both if "content" in p]) == 1, both
        assert [p for p in both if "content" in p][0]["content"].startswith("**Rapport : Both**")
        posts.clear()
        worker.create_run(mk("Texte", "text"), "rapport B", "manual")
        await asyncio.sleep(5)
        assert posts and all("content" in p and "embeds" not in p for p in posts), posts
        await svc.stop(); await worker.stop()

    asyncio.run(main())


def test_public_channel_report(env):
    import httpx
    from roai.discord_notify import public_title
    from roai.db import Database, new_id, now_iso
    from roai.events import EventJournal
    from roai.executor import Executor
    from roai.providers.status import ProviderStatus
    from roai.scheduler import Scheduler
    from roai.worker import Worker
    from roai.discord_service import DiscordService
    from roai.discord_settings import DiscordSettingsIn
    assert public_title("# 🍳 Devlog du 23/11\n\nCorps", "x") == ("🍳 Devlog du 23/11", "Corps")
    assert public_title("**Semaine 48**\nCorps", "x") == ("Semaine 48", "Corps")

    posts = []

    def handler(req: httpx.Request) -> httpx.Response:
        posts.append(json.loads(req.content))
        return httpx.Response(204)

    async def main():
        db = Database(env.db_path)
        journal = EventJournal(db, "perso")
        status = ProviderStatus(env, db, lambda p, s: None)
        ex = Executor(env); await ex.detect()
        worker = Worker(env, db, journal, ex, status); await worker.start()
        svc = DiscordService(env, db, journal, worker, status, Scheduler(db, journal, worker))
        svc._http_factory = lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))
        await svc.start()
        await svc.update(DiscordSettingsIn(webhook_url=WEBHOOK, dashboard_url="https://ro-ai.lan"))
        aid = new_id("ag")
        db.execute("INSERT INTO agents(id,slug,name,provider,mission,default_prompt,department,domain,config_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                   (aid, "pub", "Pub", "codex", "m", "x", "Prod", "perso",
                    json.dumps({"discord_report": True, "discord_public": True, "discord_style": "both"}), now_iso(), now_iso()))
        worker.create_run(db.one("SELECT * FROM agents WHERE id=?", (aid,)), "devlog", "manual")
        await asyncio.sleep(5)
        dump = json.dumps(posts, ensure_ascii=False)
        assert len(posts) == 2 and "ro-ai.lan" not in dump and "RO·AI" not in dump and "Rapport : Pub" not in dump, posts
        emb = next(p for p in posts if "embeds" in p)["embeds"][0]
        assert "footer" not in emb and "url" not in emb and emb["title"].startswith("Fait")
        await svc.stop(); await worker.stop()

    asyncio.run(main())
