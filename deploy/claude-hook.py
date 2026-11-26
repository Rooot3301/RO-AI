#!/usr/bin/env python3
"""Hook Claude Code -> RO·AI (bureau virtuel : les sessions qui développent RO·AI travaillent en salle serveur).

Lancé par Claude Code (root) à chaque étape d'une session. Réduit l'événement à son type et à une cible courte :
nom de fichier, nom de commande, nom de domaine. N'envoie JAMAIS le contenu d'un fichier, les messages, une commande
complète, ni rien d'autre. Envoi local uniquement (socket du noyau), délai court ; quoi qu'il arrive : aucune sortie,
code 0, la session n'est jamais bloquée ni ralentie de façon notable.
"""
from __future__ import annotations

import json
import os
import re
import shlex
import socket
import sys
from urllib.parse import urlparse

SOCKET = os.environ.get("ROAI_CORE_SOCKET", "/run/ro-ai/core.sock")
EVENT = {"SessionStart": "session_start", "UserPromptSubmit": "prompt", "PreToolUse": "tool", "Notification": "waiting",
         "Stop": "stop", "SessionEnd": "session_end"}
SKIP_TOOLS = {"ToolSearch", "TodoWrite", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet"}
SAFE_WORD = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+-]{0,30}$")


def base(p: object) -> str:
    return os.path.basename(str(p or "").rstrip("/"))[:60] if isinstance(p, str) else ""


def classify_command(cmd: str) -> tuple[str, str]:
    """Type d'action et libellé court d'une commande shell, sans aucun argument (pas de secret possible)."""
    try:
        words = shlex.split(cmd, comments=True)
    except ValueError:
        words = cmd.split()
    low = " ".join(words).lower()
    # commande composée : l'étape la plus marquante l'emporte (production > commit > redémarrage > tests > build)
    if "vite build" in low and "--outdir" not in low:
        return "deploy", "mise en production"
    if re.search(r"\bgit commit\b", low):
        return "commit", "git commit"
    if re.search(r"\bsystemctl (restart|reload)\b", low):
        return "restart", "redémarrage d’un service"
    if re.search(r"\b(pytest|npm (run )?test|node --test|vitest)\b", low):
        return "test", "tests"
    if "vite build" in low:
        return "build", "build de test"
    if re.search(r"\b(npx )?tsc\b", low):
        return "build", "vérification des types"
    # premier mot « parlant » (on saute cd, variables, sudo…)
    skip_next = False
    for w in words:
        if skip_next:
            skip_next = False
            continue
        if w in ("-u", "-g", "--user", "--group"):  # valeur d'option de sudo : jamais prise pour la commande
            skip_next = True
            continue
        if w in ("cd", "sudo", "env", "timeout", "&&", ";", "|", "then", "do", "if") or "=" in w or w.startswith("-") or w.isdigit():
            continue
        name = os.path.basename(w)
        if name == "git":
            return "git", "git"
        return "exec", name if SAFE_WORD.match(name) else "commande"
    return "exec", "commande"


def reduce(h: dict) -> dict | None:
    ev = EVENT.get(str(h.get("hook_event_name", "")))
    sid = str(h.get("session_id", ""))
    if not ev or not re.match(r"^[A-Za-z0-9_-]{6,64}$", sid):
        return None
    out: dict = {"event": ev, "session": sid, "project": base(h.get("cwd")) or "serveur"}
    if ev != "tool":
        return out
    name = str(h.get("tool_name", ""))
    ti = h.get("tool_input") if isinstance(h.get("tool_input"), dict) else {}
    if name in SKIP_TOOLS or name.startswith("mcp__ccd_"):
        return None  # outils d'organisation de la session : rien à montrer
    if name in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
        kind, target = "write", base(ti.get("file_path") or ti.get("notebook_path"))
    elif name == "Read":
        kind, target = "read", base(ti.get("file_path"))
    elif name in ("Grep", "Glob", "LS"):
        kind, target = "search", ""
    elif name == "Bash":
        kind, target = classify_command(str(ti.get("command", "")))
    elif name == "WebFetch":
        kind, target = "web", (urlparse(str(ti.get("url", ""))).hostname or "")[:60]
    elif name == "WebSearch":
        kind, target = "web", "recherche"
    elif name in ("Agent", "Task"):
        kind, target = "delegate", "sous-agent"
    else:
        kind, target = "tool", ""
    out.update(kind=kind, target=target)
    return out


def send(payload: dict) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode()
    req = (b"POST /api/devwork/ingest HTTP/1.1\r\nHost: core\r\nContent-Type: application/json\r\nConnection: close\r\n"
           b"Content-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body)
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        s.settimeout(0.4)
        s.connect(SOCKET)
        s.sendall(req)
        try:
            s.recv(64)
        except OSError:
            pass


def main() -> None:
    try:
        h = json.loads(sys.stdin.read() or "{}")
        p = reduce(h) if isinstance(h, dict) else None
        if p:
            send(p)
    except Exception:  # noqa: BLE001 — un hook d'ambiance ne doit jamais gêner la session
        pass


if __name__ == "__main__":
    main()
    sys.exit(0)
