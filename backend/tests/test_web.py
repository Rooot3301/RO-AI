import json, os, subprocess, sys, time
from pathlib import Path
import pytest
import httpx, socket

ROOT = Path(__file__).resolve().parents[1]
PW = "un-mot-de-passe-solide-123"


def _free_port():
    with socket.socket() as k:
        k.bind(("127.0.0.1", 0)); return k.getsockname()[1]


@pytest.fixture()
def stack(env, tmp_path):
    from dataclasses import replace
    sock = tmp_path / "core.sock"
    static = tmp_path / "dist"; (static / "assets").mkdir(parents=True)
    (static / "index.html").write_text("<!doctype html><title>RO</title><div id=root></div>")
    (static / "assets" / "app.js").write_text("console.log(1)")
    (tmp_path / "secret.txt").write_text("TOP SECRET")
    state = tmp_path / "webstate"
    s = replace(env, core_socket=str(sock), static_dir=static, web_state_dir=state)
    base = {**os.environ, "PYTHONPATH": str(ROOT), "ROAI_DATA_DIR": str(s.data_dir), "ROAI_WORKSPACE_DIR": str(s.workspace_dir),
            "ROAI_LOGS_DIR": str(s.logs_dir), "ROAI_AGENT_HOME": str(s.agent_home), "ROAI_ISOLATE": "none",
            "ROAI_CLAUDE_BIN": s.claude_bin, "ROAI_CODEX_BIN": s.codex_bin, "ROAI_CORE_SOCKET": str(sock),
            "ROAI_STATIC_DIR": str(static), "ROAI_WEB_STATE_DIR": str(state)}
    from roai.web import write_auth
    write_auth(state, "admin", PW)
    port = _free_port()
    core = subprocess.Popen([sys.executable, "-m", "uvicorn", "roai.core_api:create_app", "--factory", "--uds", str(sock), "--log-level", "warning"],
                            env=base, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(100):
        if sock.exists():
            break
        time.sleep(0.1)
    web = subprocess.Popen([sys.executable, "-m", "uvicorn", "roai.web:create_web_app", "--factory", "--host", "127.0.0.1", "--port", str(port),
                            "--log-level", "warning", "--timeout-graceful-shutdown", "2"], env=base, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    c = httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=20)
    for _ in range(100):
        try:
            c.get("/auth/me"); break
        except httpx.TransportError:
            time.sleep(0.1)
    try:
        yield c
    finally:
        c.close()
        for p in (web, core):
            p.terminate()
        for p in (web, core):
            try:
                p.wait(8)
            except subprocess.TimeoutExpired:
                p.kill()


def login(c, pw=PW):
    return c.post("/auth/login", json={"username": "admin", "password": pw})


def auth(c):
    assert login(c).status_code == 200
    return {"X-CSRF-Token": c.cookies.get("roai_csrf")}


def test_unauthenticated_is_rejected(stack):
    assert stack.get("/api/agents").status_code == 401
    assert stack.get("/auth/me").status_code == 401
    assert stack.get("/api/events/stream").status_code == 401


def test_login_cookies_and_csrf(stack):
    assert login(stack, "mauvais").status_code == 401
    r = login(stack)
    assert r.status_code == 200 and r.json() == {"username": "admin"}
    sc = r.headers.get_list("set-cookie")
    sess = next(x for x in sc if x.startswith("roai_session="))
    assert "HttpOnly" in sess and "SameSite=strict" in sess
    assert "httponly" not in next(x for x in sc if x.startswith("roai_csrf=")).lower()
    assert stack.get("/api/health").status_code == 200
    agent = {"name": "Test", "provider": "claude", "default_prompt": "go", "department": "Veille"}
    assert stack.post("/api/agents", json=agent).status_code == 403                                  # sans CSRF
    assert stack.post("/api/agents", json=agent, headers={"X-CSRF-Token": "faux"}).status_code == 403
    assert stack.post("/api/agents", json=agent, headers={"X-CSRF-Token": stack.cookies.get("roai_csrf")}).status_code == 201
    assert stack.post("/api/agents", json=agent, headers={"X-CSRF-Token": stack.cookies.get("roai_csrf"), "Origin": "https://evil.example"}).status_code == 403
    assert stack.post("/auth/logout", headers={"X-CSRF-Token": stack.cookies.get("roai_csrf")}).status_code == 204
    stack.cookies.clear()
    assert stack.get("/api/agents").status_code == 401


def test_login_throttle(stack):
    for _ in range(5):
        assert login(stack, "x").status_code == 401
    assert login(stack).status_code == 429


def test_host_check(stack):
    assert stack.get("/auth/me", headers={"Host": "evil.example"}).status_code == 421


def test_proxy_end_to_end_with_sse(stack):
    h = auth(stack)
    a = stack.post("/api/agents", json={"name": "Flux", "provider": "claude", "default_prompt": "bonjour", "department": "Veille"}, headers=h).json()
    run = stack.post(f"/api/agents/{a['id']}/run", json={}, headers=h)
    assert run.status_code == 202
    rid = run.json()["id"]
    seen = []
    with stack.stream("GET", "/api/events/stream?since=0") as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        cur_id = None
        deadline = time.time() + 20
        for line in r.iter_lines():
            assert time.time() < deadline, f"échéance dépassée, événements vus : {seen}"
            if line.startswith("id:"):
                cur_id = int(line[3:])
            elif line.startswith("data:"):
                ev = json.loads(line[5:])
                assert ev["seq"] == cur_id
                seen.append(ev["type"])
                if ev["type"] in ("run.succeeded", "run.failed", "run.cancelled") and ev["run_id"] == rid:
                    assert ev["type"] == "run.succeeded", ev
                    break
    for t in ("agent.created", "run.queued", "run.started", "tool.call", "run.succeeded"):
        assert t in seen, seen
    snap = stack.get("/api/office/snapshot").json()
    assert snap["agents"][0]["state"] == "idle" and snap["departments"] == ["Veille"]
    assert stack.get("/api/../auth/me%00").status_code in (400, 401, 404)
    assert stack.get("/api/nope").status_code == 404


def test_static_and_spa_fallback(stack):
    r = stack.get("/")
    assert r.status_code == 200 and "RO" in r.text and r.headers["cache-control"] == "no-store"
    assert "default-src 'self'" in r.headers["content-security-policy"] and r.headers["x-frame-options"] == "DENY"
    assert stack.get("/office").text == r.text                       # repli du routeur du SPA
    a = stack.get("/assets/app.js")
    assert a.status_code == 200 and "immutable" in a.headers["cache-control"]
    assert "TOP SECRET" not in stack.get("/%2e%2e/secret.txt").text   # pas d'échappement du dossier statique
    assert "TOP SECRET" not in stack.get("/assets/%2e%2e/%2e%2e/secret.txt").text
