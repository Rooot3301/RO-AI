"""Contrat commun des adaptateurs : un adaptateur ne fait que construire la ligne de commande du client officiel
et traduire son flux JSON en événements RO·AI. Il ne lit ni ne manipule jamais de jeton d'abonnement."""
from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..redact import redact_text

# Variables d'environnement qui feraient basculer un client sur une facturation API : toujours retirées.
FORBIDDEN_ENV = {
    "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "OPENAI_API_KEY", "CODEX_API_KEY",
    "OPENAI_BASE_URL", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY",
    "GEMINI_API_KEY", "GOOGLE_API_KEY",
}


@dataclass
class RunContext:
    run_id: str
    agent: dict[str, Any]
    prompt: str
    cwd: Path
    run_dir: Path
    timeout_s: int
    home: Path
    bin_path: str
    resume_session: str | None = None   # reprise d'une session du client officiel (conversation)


@dataclass
class Command:
    argv: list[str]
    env: dict[str, str]
    stdin: str | None = None
    files: dict[Path, str] = field(default_factory=dict)  # fichiers à écrire avant l'exécution (ex. config MCP)
    hide: list[str] = field(default_factory=list)          # chemins rendus inaccessibles à cette exécution


@dataclass
class Outcome:
    status: str  # succeeded | failed | cancelled
    error_class: str | None = None
    error_message: str | None = None
    num_turns: int | None = None
    cost_usd_estimate: float | None = None
    usage: dict[str, int] | None = None
    result_text: str | None = None
    session_id: str | None = None


Event = tuple[str, dict[str, Any]]
MODEL_RE = re.compile(r"^[A-Za-z0-9._:\-\[\]/@]{1,80}$")


def clean_model(v: Any) -> str | None:
    """Nom de modèle tel que rapporté par le client, s'il a une forme plausible."""
    return v if isinstance(v, str) and MODEL_RE.match(v) else None


def base_env(ctx: RunContext) -> dict[str, str]:
    """Environnement minimal et explicite (liste blanche), sans variable de facturation API."""
    path = ":".join([str(ctx.home / ".local/bin"), str(ctx.home / ".npm-global/bin"), "/opt/node/bin", "/usr/local/bin", "/usr/bin", "/bin"])
    env = {"HOME": str(ctx.home), "PATH": path, "LANG": "C.UTF-8", "USER": ctx.home.name, "LOGNAME": ctx.home.name,
           "TERM": "dumb", "NO_COLOR": "1", "DISABLE_AUTOUPDATER": "1", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"}
    return {k: v for k, v in env.items() if k not in FORBIDDEN_ENV}


def tool_kind(name: str) -> str:
    n = name or ""
    if n.startswith("mcp__") or n.startswith("mcp:"):
        return "mcp"
    if n in {"Read", "Glob", "Grep", "LS", "NotebookRead"}:
        return "read"
    if n in {"Write", "Edit", "MultiEdit", "NotebookEdit"}:
        return "write"
    if n in {"Bash", "BashOutput", "KillShell"}:
        return "exec"
    if n in {"WebFetch", "WebSearch"}:
        return "web"
    return "other"


def summarize_tool(name: str, inp: dict[str, Any] | None) -> str:
    inp = inp or {}
    for key in ("file_path", "path", "pattern", "command", "url", "query", "description"):
        v = inp.get(key)
        if isinstance(v, str) and v:
            return redact_text(f"{name} {v}".strip(), 300)
    return redact_text(name or "outil", 300)


_AUTH_RE = re.compile(r"(?i)(not logged in|please run /?login|claude auth login|invalid api key|oauth token has (expired|been revoked)|authentication[_ ]?(failed|error|required)|log ?in again|login expired|unauthorized|401|refresh[_ ]?token|sign in)")
_RATE_RE = re.compile(r"(?i)(usage limit|rate[ _-]?limit|limit reached|too many requests|429|quota|try again (later|at)|resets? (at|in))")
_TRANSIENT_RE = re.compile(r"(?i)(overloaded|529|503|502|504|timed? ?out|econn|socket hang up|network|temporar)")


def classify_error(text: str | None) -> str:
    t = text or ""
    if _AUTH_RE.search(t):
        return "auth_expired"
    if _RATE_RE.search(t):
        return "rate_limited"
    if _TRANSIENT_RE.search(t):
        return "transient"
    return "failed"


class Adapter(ABC):
    name: str

    @abstractmethod
    def build(self, ctx: RunContext) -> Command: ...

    @abstractmethod
    def parse(self, line: str) -> list[Event]:
        """Traduit une ligne de sortie JSON en événements (type, payload). Ignore ce qui n'est pas du JSON."""

    @abstractmethod
    def finish(self, returncode: int, stderr_tail: str, timed_out: bool, cancelled: bool) -> Outcome: ...

    @property
    @abstractmethod
    def session_id(self) -> str | None: ...

    def resolve_model(self, home: Path) -> str | None:
        """Modèle réellement utilisé, quand le client ne l'annonce pas dans sa sortie (voir Codex)."""
        return None

    def resolve_rate_limits(self, home: Path) -> list[dict]:
        """Fenêtres de limite d'usage relevées après l'exécution, quand le client ne les annonce pas dans sa sortie
        (voir Codex). Chaque entrée : {window, status, used_percent, resets_at}."""
        return []
