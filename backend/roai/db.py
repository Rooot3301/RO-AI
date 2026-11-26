"""SQLite (WAL) : schéma, migrations et accès sérialisé."""
from __future__ import annotations

import json
import secrets
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

SCHEMA_V1 = """
CREATE TABLE agents (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL, model TEXT, mission TEXT NOT NULL DEFAULT '', default_prompt TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT 'Général', domain TEXT NOT NULL DEFAULT 'perso',
  avatar_json TEXT NOT NULL DEFAULT '{"sprite":0}', enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE runs (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE, provider TEXT NOT NULL,
  status TEXT NOT NULL, trigger TEXT NOT NULL, prompt TEXT NOT NULL, session_id TEXT,
  created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, duration_ms INTEGER,
  error_class TEXT, error_message TEXT, num_turns INTEGER, cost_usd_estimate REAL,
  input_tokens INTEGER, output_tokens INTEGER, result_text TEXT, schedule_id TEXT
);
CREATE INDEX runs_agent ON runs(agent_id, created_at DESC);
CREATE INDEX runs_status ON runs(status);
CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, schema INTEGER NOT NULL DEFAULT 1, domain TEXT NOT NULL,
  type TEXT NOT NULL, agent_id TEXT, run_id TEXT, payload TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX events_run ON events(run_id, seq);
CREATE INDEX events_agent ON events(agent_id, seq);
CREATE INDEX events_type ON events(type, seq);
CREATE TABLE schedules (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE, name TEXT NOT NULL,
  cron TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'Europe/Paris', prompt TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1, last_run_at TEXT, next_run_at TEXT, last_run_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

SCHEMA_V2 = """
ALTER TABLE runs ADD COLUMN parent_run_id TEXT;
ALTER TABLE runs ADD COLUMN conversation_id TEXT;
ALTER TABLE runs ADD COLUMN notify_target TEXT;
CREATE INDEX runs_conv ON runs(conversation_id, created_at)
"""

SCHEMA_V3 = """
ALTER TABLE runs ADD COLUMN model TEXT
"""
SCHEMA_V4 = """
CREATE TABLE agent_profiles (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  data_json TEXT NOT NULL, source TEXT NOT NULL, generated_at TEXT, generation_json TEXT, updated_at TEXT NOT NULL
)
"""
SCHEMA_V5 = """  -- livraisons des outils externes (voir inbox.py)
CREATE TABLE inbox_sources (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, token_hash TEXT NOT NULL, token_hint TEXT NOT NULL,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL, auto_run INTEGER NOT NULL DEFAULT 1, instructions TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, last_at TEXT, received INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE deliveries (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL, agent_id TEXT, received_at TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL,
  bytes INTEGER NOT NULL, file TEXT, status TEXT NOT NULL, run_id TEXT
);
CREATE INDEX deliveries_recent ON deliveries(received_at);
CREATE INDEX deliveries_wait ON deliveries(agent_id, status)
"""
MIGRATIONS = [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5]


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(5)}"


class Database:
    """Une connexion partagée, accès sérialisé par verrou. Les requêtes sont courtes (SQLite local, WAL)."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA synchronous=NORMAL")
            self._conn.execute("PRAGMA foreign_keys=ON")
            self._conn.execute("PRAGMA busy_timeout=5000")
        self._migrate()

    def _migrate(self) -> None:
        with self._lock:
            version = self._conn.execute("PRAGMA user_version").fetchone()[0]
            for i, script in enumerate(MIGRATIONS[version:], start=version + 1):
                self._conn.execute("BEGIN")
                try:
                    for stmt in script.split(";\n"):
                        if stmt.strip():
                            self._conn.execute(stmt)
                    self._conn.execute(f"PRAGMA user_version={i}")
                    self._conn.execute("COMMIT")
                except Exception:
                    self._conn.execute("ROLLBACK")
                    raise

    def execute(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
        with self._lock:
            return self._conn.execute(sql, tuple(params))

    def one(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Row | None:
        with self._lock:
            return self._conn.execute(sql, tuple(params)).fetchone()

    def all(self, sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, tuple(params)).fetchall()

    def kv_get(self, key: str, default: Any = None) -> Any:
        row = self.one("SELECT value FROM kv WHERE key=?", (key,))
        return json.loads(row["value"]) if row else default

    def kv_set(self, key: str, value: Any) -> None:
        self.execute("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, json.dumps(value)))

    def close(self) -> None:
        with self._lock:
            self._conn.close()
