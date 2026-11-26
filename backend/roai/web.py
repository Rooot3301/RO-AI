"""Serveur web (utilisateur ro-ai-web, sans accès aux jetons) : authentification, CSRF, relais contrôlé vers le noyau
par socket Unix, service du frontend statique."""
from __future__ import annotations

import hmac
import json
import secrets
import time
from pathlib import Path

import httpx
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHash, VerificationError, VerifyMismatchError
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response, StreamingResponse

from .config import Settings

CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; "
       "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
UNSAFE = {"POST", "PUT", "DELETE", "PATCH"}
MAX_BODY = 1_000_000
_ph = PasswordHasher()
_DUMMY = _ph.hash("ro-ai-dummy-password")


def load_auth(state_dir: Path) -> dict | None:
    try:
        return json.loads((state_dir / "auth.json").read_text())
    except (OSError, ValueError):
        return None


def write_auth(state_dir: Path, username: str, password: str) -> None:
    state_dir.mkdir(parents=True, exist_ok=True)
    p = state_dir / "auth.json"
    p.write_text(json.dumps({"username": username, "hash": _ph.hash(password)}))
    p.chmod(0o600)


class Throttle:
    """Limitation des échecs de connexion par adresse : 5 échecs / 5 min => blocage 5 min."""

    def __init__(self, max_fail: int = 5, window: int = 300):
        self.max_fail, self.window, self.fails = max_fail, window, {}

    def blocked(self, ip: str) -> bool:
        now = time.time()
        self.fails[ip] = [t for t in self.fails.get(ip, []) if now - t < self.window]
        return len(self.fails[ip]) >= self.max_fail

    def fail(self, ip: str) -> None:
        self.fails.setdefault(ip, []).append(time.time())

    def ok(self, ip: str) -> None:
        self.fails.pop(ip, None)


def create_web_app(settings: Settings | None = None, allowed_hosts: set[str] | None = None) -> FastAPI:
    s = settings or Settings.from_env()
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    sessions: dict[str, dict] = {}
    throttle = Throttle()
    inbox_throttle = Throttle(max_fail=10)  # clés de livraison invalides : compteur distinct de la connexion
    hosts = allowed_hosts if allowed_hosts is not None else {h.strip().lower() for h in
        (__import__("os").environ.get("ROAI_ALLOWED_HOSTS", "localhost,127.0.0.1")).split(",") if h.strip()}  # adresses du serveur : variable d'environnement
    core = httpx.AsyncClient(transport=httpx.AsyncHTTPTransport(uds=s.core_socket), base_url="http://core", timeout=httpx.Timeout(30.0, read=None))

    def client_ip(req: Request) -> str:
        peer = req.client.host if req.client else "?"
        if peer in ("127.0.0.1", "::1"):  # proxy local (Caddy) : on lit l'adresse transmise
            return req.headers.get("x-forwarded-for", peer).split(",")[0].strip()
        return peer

    def is_https(req: Request) -> bool:
        return req.url.scheme == "https" or req.headers.get("x-forwarded-proto") == "https"

    def session_of(req: Request) -> dict | None:
        sid = req.cookies.get("roai_session")
        sess = sessions.get(sid or "")
        if sess and sess["exp"] > time.time():
            return sess
        if sid:
            sessions.pop(sid, None)
        return None

    @app.middleware("http")
    async def guard(req: Request, call_next):
        host = (req.headers.get("host") or "").split(":")[0].lower().strip("[]")
        if hosts and host not in hosts:
            return PlainTextResponse("hôte non autorisé", status_code=421)
        if req.method in UNSAFE:
            origin = req.headers.get("origin")
            if origin and (origin.split("://", 1)[-1].split("/")[0].lower() != (req.headers.get("host") or "").lower()):
                return JSONResponse({"detail": "origine refusée"}, status_code=403)
        resp = await call_next(req)
        resp.headers["Content-Security-Policy"] = CSP
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        resp.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
        resp.headers["X-Frame-Options"] = "DENY"
        if req.url.path.startswith(("/api", "/auth")):
            resp.headers["Cache-Control"] = "no-store"
        return resp

    def set_cookies(resp: Response, req: Request, sid: str, csrf: str) -> None:
        sec = is_https(req)
        resp.set_cookie("roai_session", sid, max_age=s.session_ttl_s, httponly=True, secure=sec, samesite="strict", path="/")
        resp.set_cookie("roai_csrf", csrf, max_age=s.session_ttl_s, httponly=False, secure=sec, samesite="strict", path="/")

    # --- authentification -----------------------------------------------------
    @app.post("/auth/login")
    async def login(req: Request):
        ip = client_ip(req)
        if throttle.blocked(ip):
            return JSONResponse({"detail": "trop de tentatives, réessayez dans quelques minutes"}, status_code=429)
        try:
            body = await req.json()
            username, password = str(body.get("username", "")), str(body.get("password", ""))
        except Exception:  # noqa: BLE001
            return JSONResponse({"detail": "requête invalide"}, status_code=422)
        auth = load_auth(s.web_state_dir)
        good = False
        try:
            h = auth["hash"] if auth else _DUMMY
            _ph.verify(h, password)
            good = bool(auth) and hmac.compare_digest(username, auth["username"])
        except (VerifyMismatchError, VerificationError, InvalidHash):
            good = False
        if not good:
            throttle.fail(ip)
            return JSONResponse({"detail": "identifiants invalides"}, status_code=401)
        throttle.ok(ip)
        sid, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
        sessions[sid] = {"user": auth["username"], "csrf": csrf, "exp": time.time() + s.session_ttl_s}
        resp = JSONResponse({"username": auth["username"]})
        set_cookies(resp, req, sid, csrf)
        return resp

    @app.post("/auth/logout")
    async def logout(req: Request):
        sess = session_of(req)
        if sess and not hmac.compare_digest(req.headers.get("x-csrf-token", ""), sess["csrf"]):
            return JSONResponse({"detail": "jeton CSRF invalide"}, status_code=403)
        sessions.pop(req.cookies.get("roai_session", ""), None)
        resp = Response(status_code=204)
        resp.delete_cookie("roai_session", path="/")
        resp.delete_cookie("roai_csrf", path="/")
        return resp

    @app.get("/auth/me")
    async def me(req: Request):
        sess = session_of(req)
        if not sess:
            return JSONResponse({"detail": "non authentifié"}, status_code=401)
        resp = JSONResponse({"username": sess["user"]})
        if req.cookies.get("roai_csrf") != sess["csrf"]:
            set_cookies(resp, req, req.cookies["roai_session"], sess["csrf"])
        return resp

    # --- livraisons des outils externes (sans session : clé de source vérifiée par le noyau) ---------------
    @app.post("/inbox/deliver")
    async def inbox_deliver(req: Request):
        ip = client_ip(req)
        if inbox_throttle.blocked(ip):
            return JSONResponse({"detail": "trop de tentatives, réessayez plus tard"}, status_code=429)
        content = await req.body()
        if len(content) > 300_000:
            return JSONResponse({"detail": "livraison trop volumineuse"}, status_code=413)
        try:
            r = await core.request("POST", "/api/inbox/deliver", content=content,
                                   headers={"content-type": "application/json", "authorization": req.headers.get("authorization", "")})
        except httpx.ConnectError:
            return JSONResponse({"detail": "le noyau est injoignable"}, status_code=502)
        if r.status_code == 401:
            inbox_throttle.fail(ip)
        return Response(r.content, status_code=r.status_code, media_type="application/json")

    # --- relais vers le noyau -------------------------------------------------
    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
    async def proxy(path: str, req: Request):
        sess = session_of(req)
        if not sess:
            return JSONResponse({"detail": "non authentifié"}, status_code=401)
        if req.method in UNSAFE and not hmac.compare_digest(req.headers.get("x-csrf-token", ""), sess["csrf"]):
            return JSONResponse({"detail": "jeton CSRF invalide"}, status_code=403)
        if not path or ".." in path or "\x00" in path or "//" in path:
            return JSONResponse({"detail": "chemin invalide"}, status_code=400)
        if "devwork" in path.lower():  # réception des hooks locaux : jamais depuis le réseau
            return JSONResponse({"detail": "réservé au serveur"}, status_code=403)
        url = f"/api/{path}"
        if req.url.query:
            url += f"?{req.url.query}"
        try:
            if req.method == "GET" and path == "events/stream":
                up = await core.send(core.build_request("GET", url, headers={k: v for k, v in req.headers.items() if k.lower() == "last-event-id"}), stream=True)

                async def body():
                    try:
                        async for chunk in up.aiter_raw():
                            yield chunk
                    finally:
                        await up.aclose()

                return StreamingResponse(body(), status_code=up.status_code, media_type="text/event-stream",
                                         headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
            content = await req.body() if req.method in UNSAFE else None
            if content is not None and len(content) > MAX_BODY:
                return JSONResponse({"detail": "corps trop volumineux"}, status_code=413)
            headers = {"content-type": "application/json"} if content else {}
            r = await core.request(req.method, url, content=content, headers=headers)
            return Response(r.content, status_code=r.status_code, media_type=r.headers.get("content-type", "application/json"))
        except httpx.ConnectError:
            return JSONResponse({"detail": "le noyau est injoignable"}, status_code=502)

    # --- frontend statique ----------------------------------------------------
    root = s.static_dir.resolve()

    @app.get("/{path:path}")
    async def spa(path: str):
        if not root.exists() or not (root / "index.html").exists():
            return PlainTextResponse("Interface non construite (web/dist absent).", status_code=503)
        if "\x00" in path or len(path) > 1024:
            return PlainTextResponse("chemin invalide", status_code=400)
        try:
            target = (root / path).resolve()
            is_file = path and target.is_file() and (root == target or root in target.parents)
        except (ValueError, OSError):
            return PlainTextResponse("chemin invalide", status_code=400)
        if is_file:
            immut = "/assets/" in f"/{path}"
            return FileResponse(target, headers={"Cache-Control": "public, max-age=31536000, immutable" if immut else "no-cache"})
        return FileResponse(root / "index.html", headers={"Cache-Control": "no-store"})

    @app.on_event("shutdown")
    async def _close():
        await core.aclose()

    return app
