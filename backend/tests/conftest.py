import json, os, stat, sys, textwrap
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

FAKE_CLAUDE = r'''#!/usr/bin/env python3
import json, sys, time, os
a = sys.argv[1:]
if a[:1] == ["--version"]: print("9.9.9 (Fake Claude)"); sys.exit(0)
if a[:2] == ["auth", "status"]:
    if os.environ.get("FAKE_LOGGED_OUT"): print(json.dumps({"loggedIn": False, "authMethod": "none"})); sys.exit(1)
    print(json.dumps({"loggedIn": True, "authMethod": "claude.ai", "apiProvider": "firstParty", "loginExpiresAt": None})); sys.exit(0)
prompt = sys.stdin.read()
mode = "ok"
if "SLOW" in prompt: mode = "slow"
if "FAIL_AUTH" in prompt: mode = "auth"
if "FAIL_RATE" in prompt: mode = "rate"
def out(o): print(json.dumps(o), flush=True)
out({"type": "system", "subtype": "init", "session_id": "sess-1234", "model": "fake", "tools": ["Read"]})
if mode == "slow":
    time.sleep(60)
out({"type": "assistant", "message": {"content": [{"type": "text", "text": "Je lis le fichier. token sk-ant-oat01-SECRETSECRETSECRET"}, {"type": "tool_use", "id": "tu_1", "name": "Read", "input": {"file_path": "/tmp/x.txt"}}]}})
out({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "tu_1", "content": "contenu", "is_error": False}]}})
if mode == "auth":
    out({"type": "result", "subtype": "success", "is_error": True, "result": "Invalid API key · Please run /login", "session_id": "sess-1234", "num_turns": 1}); sys.exit(1)
if mode == "rate":
    out({"type": "rate_limit_event", "rate_limit_info": {"status": "rejected", "resetsAt": 1900000000, "rateLimitType": "five_hour"}})
    out({"type": "result", "subtype": "success", "is_error": True, "result": "5-hour limit reached ∙ resets 3pm", "session_id": "sess-1234", "num_turns": 1}); sys.exit(1)
if "vie intérieure d'une petite société" in prompt or "Suite de la journée sur le fil interne" in prompt:
    if "Suite de la journée" in prompt:
        soc = {"replies": [{"post": "p1", "author": "a2", "time": "15:10", "text": "Bien vu @veilleur !"}, {"post": "p99", "author": "a2", "text": "x"}],
               "likes": [{"post": "p1", "author": "a2"}], "posts": [{"author": "a2", "kind": "pensee", "time": "16:00", "text": "Je repense à ce matin."}]}
    else:
        soc = {"journal": {"a1": "Je relis ma veille de ce matin, café en main.", "zz": "inconnu"},
               "posts": [{"author": "a1", "kind": "post", "time": "09:40", "text": "Veille CVE bouclée ce matin ! sk-ant-oat01-SECRETSECRETSECRET", "likes": ["a2", "a1"],
                          "replies": [{"author": "a2", "time": "09:52", "text": "Bravo !"}, {"author": "zz", "text": "fantôme"}]},
                         {"author": "a2", "kind": "pensee", "time": "25:99", "text": "Parfois je me demande à quoi rêvent les serveurs."}],
               "dialogues": [{"a": "a1", "b": "a2", "lines": ["Salut, bien dormi ?", "Oui, et toi ?", "Parfait."]}, {"a": "a1", "b": "a1", "lines": ["x", "y"]}]}
    out({"type": "result", "subtype": "success", "is_error": False, "duration_ms": 9, "num_turns": 1, "result": json.dumps(soc, ensure_ascii=False),
         "session_id": "sess-1234", "total_cost_usd": 0.001, "usage": {"input_tokens": 900, "output_tokens": 300}}); sys.exit(0)
out({"type": "assistant", "message": {"content": [{"type": "text", "text": "Terminé : " + prompt.strip()[:40]}]}})
out({"type": "result", "subtype": "success", "is_error": False, "duration_ms": 12, "num_turns": 2, "result": "Terminé : " + prompt.strip()[:40],
     "session_id": "sess-1234", "total_cost_usd": 0.0123, "usage": {"input_tokens": 100, "output_tokens": 20},
     "permission_denials": [{"tool_name": "Bash", "tool_input": {"command": "rm -rf /"}, "tool_use_id": "tu_9"}]})
'''

FAKE_CODEX = r'''#!/usr/bin/env python3
import json, sys, os
a = sys.argv[1:]
if a[:1] == ["--version"]: print("codex-cli 9.9.9"); sys.exit(0)
if a[:2] == ["login", "status"]: print("Logged in using ChatGPT"); sys.exit(0)
prompt = sys.stdin.read()
def out(o): print(json.dumps(o), flush=True)
tid = "0199aaaa-bbbb-7ccc-8ddd-eeeeffff0001"
out({"type": "thread.started", "thread_id": tid})
d = os.path.join(os.environ["HOME"], ".codex", "sessions", "2026", "11", "24"); os.makedirs(d, exist_ok=True)
with open(os.path.join(d, "rollout-2026-11-24T10-00-00-" + tid + ".jsonl"), "a") as f:
    f.write(json.dumps({"type": "session_meta", "payload": {"id": tid}}) + "\n")
    f.write(json.dumps({"type": "turn_context", "payload": {"model": "gpt-fake-codex"}}) + "\n")
    f.write(json.dumps({"timestamp": "2026-11-24T10:00:05.000Z", "type": "event_msg", "payload": {"type": "token_count", "rate_limits": {"limit_id": "codex", "primary": {"used_percent": 3.0, "window_minutes": 300, "resets_at": 1795615664}, "secondary": {"used_percent": 86.0, "window_minutes": 10080, "resets_at": 1795687263}}}}) + "\n")
out({"type": "turn.started"})
out({"type": "item.started", "item": {"id": "i1", "type": "command_execution", "command": "ls -la"}})
out({"type": "item.completed", "item": {"id": "i1", "type": "command_execution", "command": "ls -la", "aggregated_output": "ok", "exit_code": 0, "status": "completed"}})
out({"type": "item.completed", "item": {"id": "i2", "type": "agent_message", "text": "Fait : " + prompt.strip()[-30:]}})
out({"type": "turn.completed", "usage": {"input_tokens": 50, "cached_input_tokens": 0, "output_tokens": 7}})
'''


@pytest.fixture()
def env(tmp_path, monkeypatch):
    from roai.config import Settings
    bins = tmp_path / "bin"; bins.mkdir()
    for name, src in (("claude", FAKE_CLAUDE), ("codex", FAKE_CODEX)):
        p = bins / name; p.write_text(src); p.chmod(0o755)
    s = Settings(domain="perso", data_dir=tmp_path / "data", workspace_dir=tmp_path / "ws", logs_dir=tmp_path / "logs", config_dir=tmp_path / "config",
                 web_state_dir=tmp_path / "webstate",
                 agent_home=tmp_path / "home", isolate="none", claude_bin=str(bins / "claude"), codex_bin=str(bins / "codex"),
                 default_timeout_s=30)
    (tmp_path / "home").mkdir()
    return s


@pytest.fixture()
def client(env):
    from fastapi.testclient import TestClient
    from roai.core_api import create_app
    app = create_app(env)
    with TestClient(app) as c:
        c.app_state = app.state
        yield c


@pytest.fixture(autouse=True)
def _never_touch_production(env):
    """Garde-fou : aucun chemin des tests ne doit pointer vers la production."""
    for p in (env.data_dir, env.workspace_dir, env.logs_dir, env.config_dir, env.web_state_dir):
        assert str(p).startswith(("/tmp/", "/var/tmp/")), f"chemin de test hors dossier temporaire : {p}"
    yield
