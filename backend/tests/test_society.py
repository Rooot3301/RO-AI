"""Fil interne façon réseau social : éditions Haiku plafonnées, posts « fait réel » sans IA, apparition à l'heure."""
import time
from datetime import datetime, timedelta, timezone

from test_core import AGENT, wait_run

from roai.society import DAILY_CAP, PARIS, at_today, build_context, parse_afternoon, parse_society, society_prompt

END_OF_DAY = datetime.now(timezone.utc).astimezone(PARIS).replace(hour=23, minute=59).astimezone(timezone.utc)


def _wait(client, timeout=15):
    t0 = time.time()
    while time.time() - t0 < timeout:
        v = client.get("/api/office/society").json()
        if not v["running"]:
            return v
        time.sleep(0.15)
    raise AssertionError("génération trop longue")


def test_context_uses_real_facts_only(client):
    a = client.post("/api/agents", json=AGENT).json()
    b = client.post("/api/agents", json={**AGENT, "name": "Second"}).json()
    r = client.post(f"/api/agents/{a['id']}/run", json={"prompt": "Veille CVE du jour\nsecond paragraphe"}).json()
    wait_run(client, r["id"])
    ctx = build_context(client.app_state.db)
    byid = {x["id"]: x for x in ctx["agents"]}
    facts = byid[a["id"]]["facts"]
    assert len(facts) == 1 and "mission manuelle" in facts[0] and "Veille CVE du jour" in facts[0] and "second paragraphe" not in facts[0]
    assert "SECRET" not in str(facts) and byid[b["id"]]["facts"] == [] and byid[a["id"]]["handle"].startswith("@")
    client.post(f"/api/agents/{b['id']}/run", json={"prompt": "Mon secret perso du jour", "via": "chat"})
    time.sleep(1.5)
    convo = build_context(client.app_state.db)
    assert [f for x in convo["agents"] if x["id"] == b["id"] for f in x["facts"] if "discussion avec l'utilisateur" in f]
    assert "secret perso" not in str(convo), "contenu des conversations privées jamais transmis"
    p = society_prompt(ctx)
    assert "n'invente aucune mission" in p and "aucune activité" in p and "pensee" in p and "@" in p


def test_parse_morning_times_authors_likes():
    ctx = {"agents": [{"key": "a1", "id": "ag_1"}, {"key": "a2", "id": "ag_2"}]}
    now = datetime(2026, 11, 26, 6, 30, tzinfo=timezone.utc)
    d = parse_society('{"journal": {"a1": "ok", "a9": "x"}, "posts": [{"author": "a1", "kind": "pensee", "time": "09:40", "text": "' + "y" * 400 + '", "likes": ["a2", "a1", "a7"],'
                      ' "replies": [{"author": "a2", "time": "09:30", "text": "toi"}, {"author": "a9", "text": "x"}]}], "dialogues": []}', ctx, now)
    p = d["posts"][0]
    assert d["journal"] == {"ag_1": "ok"} and p["kind"] == "thought" and len(p["text"]) <= 230
    assert p["at"] == "2026-11-26T08:40:00Z" and p["likes"] == ["ag_2"]
    assert [r["author"] for r in p["replies"]] == ["ag_2"] and p["replies"][0]["at"] >= p["at"]  # jamais avant le post
    assert at_today("25:99", now, 8, 19) == "2026-11-26T18:59:00Z" and at_today("n'importe", now, 8, 19) is None
    try:
        parse_society("pas de json", ctx); raise AssertionError
    except ValueError:
        pass
    af = parse_afternoon('{"replies": [{"post": "p1", "author": "a2", "time": "15:10", "text": "vu"}, {"post": "p9", "author": "a2", "text": "x"}], "likes": [{"post": "p1", "author": "a1"}], "posts": []}',
                         ctx, ["p42"], datetime(2026, 11, 26, 13, 30, tzinfo=timezone.utc))
    assert af["replies"][0]["post"] == "p42" and len(af["replies"]) == 1 and af["replies"][0]["at"] >= "2026-11-26T14:00:00Z"


def test_morning_then_event_posts_then_afternoon(client):
    a = client.post("/api/agents", json=AGENT).json(); client.post("/api/agents", json={**AGENT, "name": "Second"})
    soc = client.app_state.society
    soc.ingest_events()  # initialise le curseur (pas de rattrapage)
    assert client.post("/api/office/society/generate").status_code == 202
    v = _wait(client)
    assert v["last_error"] is None and v["editions"] == ["morning"] and v["usage"]["calls"] == 1 and v["usage"]["input_tokens"] == 900
    full = soc.feed_view(END_OF_DAY)["posts"]
    assert len(full) == 2 and {p["kind"] for p in full} == {"post", "thought"} and "SECRET" not in str(full)
    first = next(p for p in full if p["kind"] == "post")
    assert len(first["likes"]) == 1 and first["replies"][0]["text"] == "Bravo !"
    # fait réel : une mission réussie devient une publication de l'agent, avec réactions des collègues (sans IA)
    r = client.post(f"/api/agents/{a['id']}/run", json={"prompt": "Veille CVE de l'après-midi"}).json()
    wait_run(client, r["id"])
    assert soc.ingest_events() == 1
    ev = [p for p in soc.feed_view(END_OF_DAY)["posts"] if p["kind"] == "event"]
    assert ev and ev[0]["author"] == a["id"] and "« Veille CVE de l'après-midi »" in ev[0]["text"] and ev[0]["ref"] == r["id"]
    assert ev[0]["tag"] == "mission" and ev[0]["attach"]["screen"] and "Terminé" in ev[0]["attach"]["result"]
    assert "SECRET" not in str(soc.feed_view(END_OF_DAY)) and "[masqué]" not in str(soc.feed_view(END_OF_DAY))
    full_ev = next(p for p in soc._feed()["posts"] if p.get("ref") == r["id"])
    assert full_ev["replies"] and set(full_ev.get("like_at") or {}) == set(full_ev["likes"])
    assert soc.ingest_events() == 0  # déjà vu
    # conversation privée : rien sur le fil
    client.post(f"/api/agents/{a['id']}/run", json={"prompt": "coucou", "via": "chat"})
    time.sleep(1.5); soc.ingest_events()
    assert len([p for p in soc.feed_view(END_OF_DAY)["posts"] if p["kind"] == "event"]) == 1
    # édition de l'après-midi : commentaires et likes sur les posts existants
    assert client.post("/api/office/society/generate").status_code == 202
    v = _wait(client)
    assert v["last_error"] is None and "afternoon" in v["editions"] and v["usage"]["calls"] == 2


def test_cap_and_guards(client):
    client.post("/api/agents", json=AGENT); client.post("/api/agents", json={**AGENT, "name": "Second"})
    for _ in range(DAILY_CAP):
        client.post("/api/office/society/generate"); _wait(client)
    r = client.post("/api/office/society/generate")
    assert r.status_code == 409 and "plafond" in r.json()["detail"]


def test_guards_limits_and_pause(client):
    client.post("/api/agents", json=AGENT)
    client.app_state.provider_status.note_rate_limit("claude", "allowed_warning", None, "five_hour", used_percent=72)
    r = client.post("/api/office/society/generate")
    assert r.status_code == 409 and "limite d'usage Claude" in r.json()["detail"]
    client.app_state.provider_status.note_rate_limit("claude", "rejected", "2020-01-01T00:00:00Z", "five_hour", used_percent=100)
    assert "limite" not in (client.get("/api/office/society").json()["blocked"] or ""), "fenêtre déjà remise à zéro : ignorée"
    client.app_state.provider_status.note_rate_limit("claude", "allowed", None, "five_hour", used_percent=10)
    client.post("/api/control/emergency-stop", json={"reason": "t"})
    assert "arrêt d'urgence" in client.post("/api/office/society/generate").json()["detail"]
    assert client.get("/api/office/society").json()["usage"]["calls"] == 0
    assert client.put("/api/office/society/settings", json={"enabled": False}).json()["settings"]["enabled"] is False


def test_voice_is_deterministic_and_personal():
    import random
    from roai import society_voice as v
    calm = {"focus": 0.9, "energy": 0.1, "sociability": 0.1, "curiosity": 0.1}
    t1, c1 = v.mission_post(random.Random("r1"), label="Veille", ok=True, err=None, pers=calm, recovered=False, nth_today=1, dur="2 min")
    t2, _ = v.mission_post(random.Random("r1"), label="Veille", ok=True, err=None, pers=calm, recovered=False, nth_today=1, dur="2 min")
    assert t1 == t2 and c1 == "ok" and "« Veille »" in t1 and t1 in [x.format(label="Veille", dur="2 min") for x in v.OK["focus"]]
    t3, c3 = v.mission_post(random.Random("r2"), label="Veille", ok=True, err=None, pers=calm, recovered=False, nth_today=3, dur="1 s")
    assert t3.endswith(v.STREAK[3])
    t4, c4 = v.mission_post(random.Random("r3"), label="X", ok=False, err="rate_limited", pers=None, recovered=False, nth_today=0, dur="")
    assert c4 == "quota" and "« X »" in t4
    assert v.mission_post(random.Random("r4"), label="X", ok=True, err=None, pers=None, recovered=True, nth_today=1, dur="")[1] == "recovered"
    assert v.demask("clé [masqué] ici") == "clé 🔒 ici"
    from datetime import datetime, timedelta, timezone
    mates = [{"id": f"m{i}", "pers": {"sociability": i / 4}, "handle": f"@m{i}"} for i in range(4)]
    at = datetime(2026, 11, 26, 9, tzinfo=timezone.utc)
    reps, likes = v.reactions(random.Random("z"), author="me", category="ok", mates=mates, handle="@me", at=at, iso=lambda d: d.isoformat(), timedelta=timedelta)
    assert 1 <= len([r for r in reps if r["author"] != "me"]) <= 3 and "me" not in likes
    assert all(r["at"] > at.isoformat() for r in reps) and all(x > at.isoformat() for x in likes.values())


def test_welcome_post_for_new_agent(client):
    client.post("/api/agents", json=AGENT)
    soc = client.app_state.society
    soc.ingest_events()
    b = client.post("/api/agents", json={**AGENT, "name": "Recrue"}).json()
    assert soc.ingest_events() == 1
    p = next(x for x in soc._feed()["posts"] if x.get("tag") == "welcome")
    assert p["author"] == b["id"] and p["tag"] == "welcome" and p["kind"] == "event"
