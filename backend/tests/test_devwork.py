"""Sessions Claude Code (développement de RO·AI) dans le bureau : hook réducteur, état en mémoire, API, relais web."""
import importlib.util
import json
from pathlib import Path

from roai.devwork import LINGER_S, DevWork

from test_web import auth, stack  # noqa: F401  (fixture stack réutilisée)

_spec = importlib.util.spec_from_file_location("claude_hook", Path(__file__).resolve().parents[2] / "deploy" / "claude-hook.py")
hook = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(hook)
SID = "3e8c8321-ea8e-4104-ad3c-2833b400b4de"


def H(event, **kw):
    return {"hook_event_name": event, "session_id": SID, "cwd": "/opt/ro-ai", "transcript_path": "/root/.claude/x.jsonl", **kw}


def test_hook_never_leaks_content():
    secret = "ANTHROPIC_API_KEY=sk-ant-oat01-SECRETSECRETSECRET"
    cases = [
        (H("PreToolUse", tool_name="Write", tool_input={"file_path": "/opt/ro-ai/web/src/plan.ts", "content": secret}), ("write", "plan.ts")),
        (H("PreToolUse", tool_name="Bash", tool_input={"command": f"cd web && {secret} npm test 2>&1 | tail"}), ("test", "tests")),
        (H("PreToolUse", tool_name="Bash", tool_input={"command": "npx vite build --outDir /var/tmp/x --emptyOutDir"}), ("build", "build de test")),
        (H("PreToolUse", tool_name="Bash", tool_input={"command": "cd /opt/ro-ai/web && npx vite build"}), ("deploy", "mise en production")),
        (H("PreToolUse", tool_name="Bash", tool_input={"command": "npm test && npx vite build && git add x && git commit -m y"}), ("deploy", "mise en production")),
        (H("PreToolUse", tool_name="Bash", tool_input={"command": "python3 -m pytest -q && git commit -m z"}), ("commit", "git commit")),
        (H("PreToolUse", tool_name="Bash", tool_input={"command": "git commit -q -m 'mot de passe: hunter2'"}), ("commit", "git commit")),
        (H("PreToolUse", tool_name="Bash", tool_input={"command": f"TOKEN={secret} curl -H 'Authorization: Bearer abc' https://x.y/z"}), ("exec", "curl")),
        (H("PreToolUse", tool_name="Bash", tool_input={"command": "sudo -u agent /opt/bin/weird$(cat /etc/shadow)"}), ("exec", "commande")),
        (H("PreToolUse", tool_name="WebFetch", tool_input={"url": "https://docs.example.org/a?token=s3cr3t", "prompt": secret}), ("web", "docs.example.org")),
        (H("PreToolUse", tool_name="Grep", tool_input={"pattern": secret}), ("search", "")),
        (H("PreToolUse", tool_name="mcp__x__y", tool_input={"q": secret}), ("tool", "")),
    ]
    for h, (kind, target) in cases:
        p = hook.reduce(h)
        assert (p["kind"], p["target"]) == (kind, target), (h["tool_input"], p)
        dumped = json.dumps(p)
        assert "SECRET" not in dumped and "hunter2" not in dumped and "s3cr3t" not in dumped and "shadow" not in dumped
        assert set(p) == {"event", "session", "project", "kind", "target"}
    # pas de message utilisateur, pas d'outils d'organisation, pas de session invalide
    assert hook.reduce(H("UserPromptSubmit", prompt=secret)) == {"event": "prompt", "session": SID, "project": "ro-ai"}
    assert hook.reduce(H("Notification", message=secret))["event"] == "waiting"
    assert hook.reduce(H("PreToolUse", tool_name="mcp__ccd_turn__update_plan", tool_input={})) is None
    assert hook.reduce({**H("Stop"), "session_id": "../../x"}) is None
    assert hook.reduce(H("PostToolUse", tool_name="Read")) is None


def test_session_lifecycle():
    t = [1000.0]
    d = DevWork(clock=lambda: t[0])
    ev = lambda e, **k: d.ingest({"event": e, "session": SID, "project": "ro-ai", **k})  # noqa: E731
    assert ev("session_start")
    v = d.view()[0]
    assert v["state"] == "idle" and not v["present"] and v["label"] == "Claude Code · 3e8c"
    assert ev("prompt") and d.view()[0]["present"]
    for i in range(7):
        t[0] += 1; ev("tool", kind="write", target=f"f{i}.ts")
    ev("tool", kind="nope", target="x" * 500)
    v = d.view()[0]
    assert len(v["actions"]) == 5 and v["actions"][-1] == {"at": v["actions"][-1]["at"], "kind": "tool", "target": "x" * 60}
    assert v["counts"]["write"] == 7 and v["counts"]["tools"] == 8
    ev("waiting"); assert d.view()[0]["state"] == "waiting"
    ev("tool", kind="read", target="a"); assert d.view()[0]["state"] == "working"
    ev("stop"); v = d.view()[0]
    assert v["state"] == "idle" and v["present"]           # le temps de ranger et de sortir
    t[0] += LINGER_S + 1
    assert not d.view()[0]["present"]
    ev("waiting"); assert d.view()[0]["state"] == "idle"   # rappel d'inactivité après la fin du tour : ignoré
    ev("session_end"); assert d.view()[0]["state"] == "ended" and not d.view()[0]["present"]
    t[0] += 3600
    assert d.view() == []
    assert not d.ingest({"event": "tool", "session": "x"}) and not d.ingest({"event": "boom", "session": SID}) and not d.ingest([])


def test_api_and_proxy_refusal(stack):
    h = auth(stack)
    # depuis le réseau (relais web) : refusé, même authentifié, même déguisé
    for path in ("/api/devwork/ingest", "/api/DevWork/ingest", "/api/devwork%2Fingest"):
        assert stack.post(path, json={"event": "prompt", "session": SID}, headers=h).status_code in (403, 404)
    assert stack.get("/api/office/devteam").json()["sessions"] == []


def test_core_ingest(client):
    assert client.post("/api/devwork/ingest", json={"event": "prompt", "session": SID, "project": "ro-ai"}).status_code == 204
    assert client.post("/api/devwork/ingest", json={"event": "tool", "session": SID, "kind": "deploy", "target": "mise en production"}).status_code == 204
    assert client.post("/api/devwork/ingest", json={"event": "bad", "session": SID}).status_code == 422
    assert client.post("/api/devwork/ingest", content=b"x" * 3000).status_code == 413
    s = client.get("/api/office/devteam").json()["sessions"]
    assert s[0]["present"] and s[0]["counts"]["deploy"] == 1 and s[0]["actions"][0]["kind"] == "deploy"
    # rien dans le journal d'événements de RO·AI
    assert not [e for e in client.get("/api/events?limit=1000").json()["events"] if "dev" in e["type"]]
