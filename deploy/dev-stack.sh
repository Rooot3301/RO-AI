#!/bin/bash
# Pile de DÉVELOPPEMENT jetable : vrai noyau + vrai serveur web, mais avec de FAUX clients IA (scripts de test)
# et des données dans /var/tmp/ro-ai-dev. Jamais utilisée en production. Usage : dev-stack.sh start|stop|status
# Serveur web : http://127.0.0.1:18081 ; identifiants aléatoires dans $D/dev-login.txt
set -euo pipefail
umask 077
D=/var/tmp/ro-ai-dev; ROOT=/opt/ro-ai/backend; PORT=18081
export PYTHONPATH=$ROOT ROAI_DATA_DIR=$D/data ROAI_WORKSPACE_DIR=$D/ws ROAI_LOGS_DIR=$D/logs ROAI_AGENT_HOME=$D/home ROAI_ISOLATE=none \
  ROAI_CLAUDE_BIN=$D/bin/claude ROAI_CODEX_BIN=$D/bin/codex ROAI_CORE_SOCKET=$D/core.sock ROAI_STATIC_DIR=${ROAI_STATIC_DIR:-/var/tmp/ro-ai-build-dev} \
  ROAI_WEB_STATE_DIR=$D/webstate ROAI_CONFIG_DIR=$D/config
case "${1:-status}" in
  start)
    "$0" stop >/dev/null 2>&1
    mkdir -p "$D/bin" "$D/home" "$D/webstate"
    chmod 700 "$D"
    python3 - <<PY
import sys; sys.path.insert(0, "$ROOT/tests")
import importlib.util
spec = importlib.util.spec_from_file_location("cf", "$ROOT/tests/conftest.py"); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
for n, src in (("claude", m.FAKE_CLAUDE), ("codex", m.FAKE_CODEX)):
    open("$D/bin/" + n, "w").write(src)
PY
    chmod 755 $D/bin/*
    python3 - <<'PY'
import os
import secrets
from pathlib import Path
from roai.web import write_auth
state = Path(os.environ["ROAI_WEB_STATE_DIR"])
password = secrets.token_urlsafe(24)
write_auth(state, "admin", password)
login = state.parent / "dev-login.txt"
fd = os.open(login, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
with os.fdopen(fd, "w") as f:
    os.fchmod(f.fileno(), 0o600)
    f.write("admin\n" + password + "\n")
PY
    # pas de suppression du socket : asyncio remplace lui-même un socket Unix périmé au démarrage
    nohup python3 -m uvicorn roai.core_api:create_app --factory --uds "$D/core.sock" --log-level warning >"$D/core.log" 2>&1 &
    echo $! > "$D/core.pid"
    for _ in $(seq 50); do curl -sf --unix-socket "$D/core.sock" http://x/api/health >/dev/null 2>&1 && break; sleep 0.2; done
    nohup python3 -m uvicorn roai.web:create_web_app --factory --host 127.0.0.1 --port $PORT --log-level warning >$D/web.log 2>&1 &
    echo $! > $D/web.pid
    sleep 1.5; echo "pile de développement démarrée : http://127.0.0.1:$PORT (identifiants : $D/dev-login.txt)";;
  stop)
    for f in web core; do [ -f "$D/$f.pid" ] && kill "$(cat "$D/$f.pid")" 2>/dev/null; : > "$D/$f.pid"; done; echo "arrêtée";;
  status)
    for f in web core; do if [ -s "$D/$f.pid" ] && kill -0 "$(cat "$D/$f.pid")" 2>/dev/null; then echo "$f : actif"; else echo "$f : arrêté"; fi; done;;
esac
