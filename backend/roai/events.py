"""Journal d'événements : écriture masquée, lecture par seq, diffusion SSE."""
from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator

from .db import Database, now_iso
from .redact import redact


class EventJournal:
    def __init__(self, db: Database, domain: str):
        self.db = db
        self.domain = domain
        self._subs: set[asyncio.Queue] = set()

    # --- écriture -------------------------------------------------------------
    def emit(self, type: str, *, agent_id: str | None = None, run_id: str | None = None, payload: dict[str, Any] | None = None) -> dict:
        clean = redact(payload or {})
        ts = now_iso()
        domain = self._agent_domain(agent_id) if agent_id else self.domain
        cur = self.db.execute(
            "INSERT INTO events(ts,schema,domain,type,agent_id,run_id,payload) VALUES(?,?,?,?,?,?,?)",
            (ts, 1, domain, type, agent_id, run_id, json.dumps(clean, ensure_ascii=False)),
        )
        ev = {"seq": cur.lastrowid, "ts": ts, "schema": 1, "domain": domain, "type": type,
              "agent_id": agent_id, "run_id": run_id, "payload": clean}
        for q in list(self._subs):
            try:
                q.put_nowait(ev)
            except asyncio.QueueFull:  # abonné trop lent : on le coupe, il se resynchronisera
                self._subs.discard(q)
        return ev

    def _agent_domain(self, agent_id: str) -> str:
        r = self.db.one("SELECT domain FROM agents WHERE id=?", (agent_id,))
        return r["domain"] if r else self.domain

    # --- lecture --------------------------------------------------------------
    @staticmethod
    def _row(r) -> dict:
        return {"seq": r["seq"], "ts": r["ts"], "schema": r["schema"], "domain": r["domain"], "type": r["type"],
                "agent_id": r["agent_id"], "run_id": r["run_id"], "payload": json.loads(r["payload"])}

    def since(self, seq: int = 0, limit: int = 200, agent_id: str | None = None, run_id: str | None = None,
              type_prefix: str | None = None) -> list[dict]:
        sql, args = "SELECT * FROM events WHERE seq>?", [seq]
        if agent_id:
            sql += " AND agent_id=?"; args.append(agent_id)
        if run_id:
            sql += " AND run_id=?"; args.append(run_id)
        if type_prefix:
            sql += " AND type LIKE ? ESCAPE '\\'"; args.append(type_prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
        sql += " ORDER BY seq ASC LIMIT ?"; args.append(max(1, min(limit, 1000)))
        return [self._row(r) for r in self.db.all(sql, args)]

    def last_seq(self) -> int:
        r = self.db.one("SELECT COALESCE(MAX(seq),0) AS m FROM events")
        return int(r["m"])

    def min_seq(self) -> int:
        r = self.db.one("SELECT COALESCE(MIN(seq),0) AS m FROM events")
        return int(r["m"])

    def prune(self, days: int) -> int:
        cur = self.db.execute("DELETE FROM events WHERE ts < datetime('now', ?)", (f"-{int(days)} days",))
        return cur.rowcount

    # --- diffusion ------------------------------------------------------------
    async def stream(self, since: int = 0, heartbeat_s: float = 15.0) -> AsyncIterator[dict | None]:
        """Rejoue le journal après `since` puis diffuse en direct. Produit None pour un battement de cœur."""
        q: asyncio.Queue = asyncio.Queue(maxsize=2000)
        self._subs.add(q)  # abonnement AVANT la relecture : aucun événement perdu
        try:
            last = since
            first = self.min_seq()
            if since and first and since < first - 1:
                last_seq = self.last_seq()
                yield {"seq": last_seq, "ts": now_iso(), "schema": 1, "domain": self.domain, "type": "system.resync",
                       "agent_id": None, "run_id": None, "payload": {}}
                last = last_seq
            while True:
                batch = self.since(last, limit=500)
                if not batch:
                    break
                for ev in batch:
                    last = ev["seq"]
                    yield ev
            while True:
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=heartbeat_s)
                except asyncio.TimeoutError:
                    yield None
                    continue
                if ev["seq"] > last:
                    last = ev["seq"]
                    yield ev
                if q not in self._subs:  # coupé pour lenteur
                    yield {"seq": last, "ts": now_iso(), "schema": 1, "domain": self.domain, "type": "system.resync",
                           "agent_id": None, "run_id": None, "payload": {}}
                    return
        finally:
            self._subs.discard(q)
