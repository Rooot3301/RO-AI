"""Configuration du noyau, lue depuis l'environnement (ROAI_*)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    domain: str = "perso"
    data_dir: Path = Path("/srv/ai/data")
    workspace_dir: Path = Path("/srv/ai/workspace")
    logs_dir: Path = Path("/srv/ai/logs")
    config_dir: Path = Path("/srv/ai/config")
    agent_home: Path = Path("/home/agent")
    max_concurrency: int = 2
    provider_limits: dict[str, int] = field(default_factory=lambda: {"claude": 2, "codex": 1})
    isolate: str = "auto"  # auto | systemd | none
    run_mem_max: str = "1536M"
    run_tasks_max: int = 512
    default_timeout_s: int = 900
    claude_bin: str = "/home/agent/.local/bin/claude"
    codex_bin: str = "/home/agent/.npm-global/bin/codex"
    event_retention_days: int = 60
    # serveur web
    core_socket: str = "/run/ro-ai/core.sock"
    web_host: str = "127.0.0.1"
    web_port: int = 8081
    static_dir: Path = Path("/opt/ro-ai/web/dist")
    web_state_dir: Path = Path("/var/lib/ro-ai-web")
    session_ttl_s: int = 12 * 3600

    @property
    def db_path(self) -> Path:
        return self.data_dir / "roai.db"

    @classmethod
    def from_env(cls) -> "Settings":
        e = os.environ
        return cls(
            domain=e.get("ROAI_DOMAIN", "perso"),
            data_dir=Path(e.get("ROAI_DATA_DIR", "/srv/ai/data")),
            workspace_dir=Path(e.get("ROAI_WORKSPACE_DIR", "/srv/ai/workspace")),
            logs_dir=Path(e.get("ROAI_LOGS_DIR", "/srv/ai/logs")),
            config_dir=Path(e.get("ROAI_CONFIG_DIR", "/srv/ai/config")),
            agent_home=Path(e.get("ROAI_AGENT_HOME", "/home/agent")),
            max_concurrency=_int("ROAI_MAX_CONCURRENCY", 2),
            provider_limits={"claude": _int("ROAI_LIMIT_CLAUDE", 2), "codex": _int("ROAI_LIMIT_CODEX", 1)},
            isolate=e.get("ROAI_ISOLATE", "auto"),
            run_mem_max=e.get("ROAI_RUN_MEM_MAX", "1536M"),
            run_tasks_max=_int("ROAI_RUN_TASKS_MAX", 512),
            default_timeout_s=_int("ROAI_DEFAULT_TIMEOUT_S", 900),
            claude_bin=e.get("ROAI_CLAUDE_BIN", "/home/agent/.local/bin/claude"),
            codex_bin=e.get("ROAI_CODEX_BIN", "/home/agent/.npm-global/bin/codex"),
            event_retention_days=_int("ROAI_EVENT_RETENTION_DAYS", 60),
            core_socket=e.get("ROAI_CORE_SOCKET", "/run/ro-ai/core.sock"),
            web_host=e.get("ROAI_WEB_HOST", "127.0.0.1"),
            web_port=_int("ROAI_WEB_PORT", 8081),
            static_dir=Path(e.get("ROAI_STATIC_DIR", "/opt/ro-ai/web/dist")),
            web_state_dir=Path(e.get("ROAI_WEB_STATE_DIR", "/var/lib/ro-ai-web")),
            session_ttl_s=_int("ROAI_SESSION_TTL_S", 12 * 3600),
        )
