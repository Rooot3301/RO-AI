from datetime import datetime, timezone

from test_core import AGENT, types, wait_run

from roai.office_boards import planning
from roai.providers.claude import ClaudeAdapter
from roai.providers.codex import read_rollout_limits


def test_codex_limits_from_session_file(client):
    a = client.post("/api/agents", json={**AGENT, "provider": "codex"}).json()
    r = client.post(f"/api/agents/{a['id']}/run", json={"prompt": "liste"}).json()
    assert wait_run(client, r["id"])["status"] == "succeeded"
    lim = client.get("/api/office/boards").json()["limits"]
    wins = {w["window"]: w for w in lim["codex"]}
    assert wins["five_hour"]["used_percent"] == 3.0 and wins["five_hour"]["level"] == "ok"
    assert wins["seven_day"]["used_percent"] == 86.0 and wins["seven_day"]["level"] == "warning"
    assert types(client, r["id"]).count("run.rate_limit") == 2
    # ancien format conservé pour les pages existantes : statut ok / limited
    prov = {p["id"]: p for p in client.get("/api/providers").json()}
    assert prov["codex"]["limits"]["status"] == "ok" and prov["codex"]["limits"]["window"] == "seven_day"


def test_limits_levels_and_bad_input(client):
    s = client.app_state.provider_status
    s.note_rate_limit("claude", "allowed_warning", "2099-01-01T00:00:00Z", "five_hour", 0.0)
    s.note_rate_limit("claude", "rejected", "2099-01-02T00:00:00Z", "seven_day")
    s.note_rate_limit("claude", "allowed", None, "<script>", "abc")
    v = {w["window"]: w for w in s.limits_view()["claude"]}
    assert v["five_hour"]["level"] == "warning" and v["seven_day"]["level"] == "limited" and v["inconnue"]["used_percent"] is None
    assert s._limits["claude"]["status"] == "limited" and s._limits["claude"]["window"] == "seven_day"


def test_claude_utilization_is_optional():
    ad = ClaudeAdapter()
    ev = ad.parse('{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":4102444800,"rateLimitType":"seven_day","utilization":0.82}}')
    assert ev[0][1]["used_percent"] == 82.0 and ev[0][1]["window"] == "seven_day"
    ev = ad.parse('{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":4102444800,"rateLimitType":"five_hour"}}')
    assert "used_percent" not in ev[0][1]


def test_rollout_limits_parser(tmp_path):
    f = tmp_path / "r.jsonl"
    f.write_text('pas du json\n{"type":"event_msg","payload":{"rate_limits":{"primary":{"used_percent":150,"window_minutes":300,"resets_at":1795615664}}}}\n'
                 '{"type":"event_msg","payload":{"rate_limits":{"primary":{"used_percent":"x"}}}}\n')
    assert read_rollout_limits(f) == []   # dernière entrée illisible : rien plutôt qu'une valeur inventée
    f.write_text('{"type":"event_msg","payload":{"rate_limits":{"primary":{"used_percent":150,"window_minutes":60,"resets_at":1795615664}}}}\n')
    (w,) = read_rollout_limits(f)
    assert w["used_percent"] == 100.0 and w["status"] == "limited" and w["window"] == "60_min"
    assert read_rollout_limits(tmp_path / "absent.jsonl") == []


def test_planning_of_the_day(client):
    db = client.app_state.db
    a = client.post("/api/agents", json=AGENT).json()
    b = client.post("/api/agents", json={**AGENT, "name": "Dormeur"}).json()
    s1 = client.post("/api/schedules", json={"agent_id": a["id"], "name": "Matin et soir", "cron": "0 8,20 * * *", "timezone": "Europe/Paris"}).json()
    s2 = client.post("/api/schedules", json={"agent_id": a["id"], "name": "Neuf heures", "cron": "0 9 * * *", "timezone": "Europe/Paris"}).json()
    s3 = client.post("/api/schedules", json={"agent_id": b["id"], "name": "Hebdo", "cron": "0 10 * * 1", "timezone": "Europe/Paris"}).json()
    client.post("/api/schedules", json={"agent_id": a["id"], "name": "Coupée", "cron": "0 11 * * *", "timezone": "Europe/Paris", "enabled": False})
    db.execute("UPDATE schedules SET created_at='2026-01-01T00:00:00Z'")
    db.execute("INSERT INTO runs(id, agent_id, provider, status, trigger, prompt, created_at, schedule_id) VALUES('r_matin', ?, 'claude', 'succeeded', 'schedule', 'p', '2026-11-25T07:00:09Z', ?)", (a["id"], s1["id"]))
    db.execute("INSERT INTO runs(id, agent_id, provider, status, trigger, prompt, created_at, schedule_id) VALUES('r_rattrape', ?, 'claude', 'failed', 'schedule', 'p', '2026-11-25T10:40:00Z', ?)", (a["id"], s2["id"]))
    p = planning(db, now=datetime(2026, 11, 25, 12, 0, tzinfo=timezone.utc))   # mercredi 13 h à Paris
    rows = [(i["name"], i["at"], i["status"], i["run_id"]) for i in p["items"]]
    assert p["date"] == "2026-11-25" and p["paused"] is False
    assert rows == [("Matin et soir", "2026-11-25T07:00:00Z", "succeeded", "r_matin"),
                    ("Neuf heures", "2026-11-25T08:00:00Z", "missed", None),
                    ("Neuf heures", "2026-11-25T10:40:00Z", "failed", "r_rattrape"),
                    ("Matin et soir", "2026-11-25T19:00:00Z", "upcoming", None)]
    assert p["items"][2]["off_schedule"] is True
    assert p["next_after"]["name"] in ("Matin et soir", "Hebdo") and p["next_after"]["at"] == "2026-11-26T07:00:00Z"
    # agent désactivé : l'horaire est signalé comme tel (le planificateur ne le lancera pas)
    client.put(f"/api/agents/{b['id']}", json={**AGENT, "name": "Dormeur", "enabled": False})
    p = planning(db, now=datetime(2026, 11, 30, 6, 0, tzinfo=timezone.utc))   # lundi
    hebdo = [i for i in p["items"] if i["schedule_id"] == s3["id"]]
    assert hebdo and hebdo[0]["agent_enabled"] is False
    assert client.get("/api/office/boards").json()["planning"]["timezone"] == "Europe/Paris"


def test_planning_caps_frequent_cron(client):
    a = client.post("/api/agents", json=AGENT).json()
    client.post("/api/schedules", json={"agent_id": a["id"], "name": "Toutes les 5 min", "cron": "*/5 * * * *", "timezone": "Europe/Paris"})
    client.app_state.db.execute("UPDATE schedules SET created_at='2026-01-01T00:00:00Z'")
    p = planning(client.app_state.db, now=datetime(2026, 11, 25, 12, 0, tzinfo=timezone.utc))
    assert p["truncated"] is True and len(p["items"]) <= 60


def test_snapshot_actions_conversation_control_and_archive(client):
    a = client.post("/api/agents", json=AGENT).json()
    # mission classique : rapport dans la bibliothèque, pas de conversation
    r1 = client.post(f"/api/agents/{a['id']}/run", json={"prompt": "Rapport hebdomadaire\nDétails…"}).json()
    assert wait_run(client, r1["id"])["status"] == "succeeded"
    snap = client.get("/api/office/snapshot").json()
    ag = next(x for x in snap["agents"] if x["id"] == a["id"])
    assert ag["conversation"] is None and ag["recent_actions"] == []
    assert snap["control"] == {"paused": False, "since": None, "reason": None}
    rep = client.get("/api/office/archive").json()["reports"]
    assert [x["run_id"] for x in rep] == [r1["id"]] and rep[0]["title"] == "Rapport hebdomadaire" and rep[0]["preview"]
    # page Chat : conversation (salle de réunion), absente des archives ; événement run.queued marqué
    r2 = client.post(f"/api/agents/{a['id']}/run", json={"prompt": "Salut", "via": "chat"}).json()
    assert wait_run(client, r2["id"])["status"] == "succeeded"
    q = [e for e in client.get(f"/api/events?run_id={r2['id']}&limit=50").json()["events"] if e["type"] == "run.queued"][0]
    assert q["payload"]["conversation"] == "chat"
    ag = next(x for x in client.get("/api/office/snapshot").json()["agents"] if x["id"] == a["id"])
    assert ag["conversation"]["via"] == "chat" and ag["conversation"]["active"] is False and ag["conversation"]["run_id"] == r2["id"]
    assert [x["run_id"] for x in client.get("/api/office/archive").json()["reports"]] == [r1["id"]]
    assert client.post(f"/api/agents/{a['id']}/run", json={"prompt": "x", "via": "autre"}).status_code == 422
    # arrêt d'urgence visible dans le snapshot
    client.post("/api/control/emergency-stop", json={"reason": "test"})
    c = client.get("/api/office/snapshot").json()["control"]
    assert c["paused"] is True and c["reason"] == "test" and c["since"]
    client.post("/api/control/resume")
