import json, time

from test_core import AGENT

SPACE = {**AGENT, "name": "Veille Star Citizen", "department": "Veille", "mission": "Veille hebdomadaire Star Citizen : patchs, annonces RSI."}


def test_default_profile_is_deterministic_and_not_stored(client):
    a = client.post("/api/agents", json=SPACE).json()
    p1 = client.get(f"/api/agents/{a['id']}/profile").json()
    p2 = client.get(f"/api/agents/{a['id']}/profile").json()
    assert p1 == p2 and p1["source"] == "default" and p1["decor"]["theme"] == "space"
    assert p1["display_name"] == "Veille Star Citizen" and p1["bio"] and len(p1["skills"]) == 3
    assert all(0 <= v <= 1 for v in p1["personality"].values())
    assert client.app_state.db.one("SELECT COUNT(*) n FROM agent_profiles")["n"] == 0
    snap = client.get("/api/office/snapshot").json()
    assert snap["profiles"][a["id"]]["decor"]["theme"] == "space" and snap["agents"][0]["provider"] == "claude"


def test_manual_edit_validation_and_reset(client):
    a = client.post("/api/agents", json=AGENT).json()
    p = client.get(f"/api/agents/{a['id']}/profile").json()
    body = {k: p[k] for k in ("display_name", "employee_id", "title", "hired_at", "office", "bio", "traits", "interests", "habits", "skills", "personality", "appearance", "decor")}
    body["decor"] = {"theme": "dev", "items": ["rubber_duck", "rubber_duck", "mech_keyboard"], "color": 3}
    body["appearance"]["accessory"] = "glasses"
    up = client.put(f"/api/agents/{a['id']}/profile", json=body).json()
    assert up["source"] == "manual" and up["decor"]["items"] == ["rubber_duck", "mech_keyboard"] and up["appearance"]["accessory"] == "glasses"
    assert client.put(f"/api/agents/{a['id']}/profile", json={**body, "decor": {"theme": "dev", "items": ["bombe"]}}).status_code == 422
    assert client.put(f"/api/agents/{a['id']}/profile", json={**body, "personality": {"sociability": 3}}).status_code == 422
    assert client.delete(f"/api/agents/{a['id']}/profile").status_code == 204
    assert client.get(f"/api/agents/{a['id']}/profile").json()["source"] == "default"
    # suppression de l'agent : fiche supprimée en cascade
    client.put(f"/api/agents/{a['id']}/profile", json=body)
    client.delete(f"/api/agents/{a['id']}")
    assert client.app_state.db.one("SELECT COUNT(*) n FROM agent_profiles")["n"] == 0


def test_generation_once_with_official_client(client, env):
    # faux Claude : sa réponse finale est un JSON de fiche
    fake = env.claude_bin
    reply = json.dumps(json.dumps({"title": "Explorateur de patchs", "bio": "Passionné d'espace.", "traits": ["méticuleux"],
                                   "personality": {"sociability": 0.9, "coffee": 2}}))
    src = open(fake, encoding="utf-8").read().replace('"Terminé : " + prompt.strip()[:40]', reply)
    open(fake, "w", encoding="utf-8").write(src)
    a = client.post("/api/agents", json=SPACE).json()
    assert client.post(f"/api/agents/{a['id']}/profile/generate", json={}).status_code == 202
    for _ in range(100):
        p = client.get(f"/api/agents/{a['id']}/profile").json()
        if not p["generating"]:
            break
        time.sleep(0.1)
    evs = [e["payload"] for e in client.get("/api/events?type_prefix=agent.profile").json()["events"]]
    assert p["source"] == "generated", evs
    assert p["title"] == "Explorateur de patchs" and p["personality"]["sociability"] == 0.9 and p["personality"]["coffee"] == 1.0
    assert p["generation"]["provider"] == "claude" and p["generation"]["input_tokens"] == 100
    assert any(e.get("action") == "generated" for e in evs)
    # jamais régénérée sans demande explicite
    assert client.post(f"/api/agents/{a['id']}/profile/generate", json={}).status_code == 409
    # aucune exécution opérationnelle créée
    assert client.get("/api/runs").json() in ([], {"runs": []}) or not client.get("/api/runs").json().get("runs")


def test_generation_refused_when_paused(client):
    a = client.post("/api/agents", json=AGENT).json()
    client.post("/api/control/emergency-stop", json={})
    r = client.post(f"/api/agents/{a['id']}/profile/generate", json={})
    assert r.status_code == 409


def test_office_layout_persistence(client):
    assert client.get("/api/office/layout").json() == {"layout": None}
    lay = {"version": 1, "moves": [{"id": "plant-1", "col": 3, "row": 4}]}
    assert client.put("/api/office/layout", json={"layout": lay}).json()["layout"] == lay
    assert client.get("/api/office/layout").json()["layout"] == lay
    assert client.put("/api/office/layout", json={"layout": {"x": "a" * 70000}}).status_code == 422
    client.put("/api/office/layout", json={"layout": None})
    assert client.get("/api/office/layout").json() == {"layout": None}


def test_text_only_claude_command_has_no_tools():
    from pathlib import Path
    from roai.providers import ClaudeAdapter, RunContext
    ctx = RunContext("r", {"id": "a", "provider": "claude", "model": "haiku", "mission": "", "config": {"_text_only": True}}, "p",
                     Path("/w"), Path("/r"), 60, Path("/h"), "claude")
    argv = ClaudeAdapter().build(ctx).argv
    assert argv[argv.index("--tools") + 1] == "" and "--allowedTools" not in argv and "--system-prompt" in argv
    assert "--no-session-persistence" in argv and '"enabled": true' in argv[argv.index("--settings") + 1]
