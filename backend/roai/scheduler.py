"""Planificateur : expressions cron à 5 champs, fuseau horaire, une seule exécution de rattrapage maximum."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from croniter import croniter


def validate_cron(expr: str, tz: str) -> None:
    if len(expr.split()) != 5 or not croniter.is_valid(expr):
        raise ValueError("expression cron invalide (5 champs : minute heure jour mois jour-de-semaine)")
    try:
        ZoneInfo(tz)
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"fuseau horaire inconnu : {tz}") from e


def next_run(expr: str, tz: str, after: datetime | None = None) -> str:
    base = (after or datetime.now(timezone.utc)).astimezone(ZoneInfo(tz))
    nxt = croniter(expr, base).get_next(datetime)
    return nxt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class Scheduler:
    def __init__(self, db, journal, worker, tick_s: float = 15.0):
        self.db, self.journal, self.worker, self.tick_s = db, journal, worker, tick_s

    async def loop(self) -> None:
        while True:
            try:
                self.tick()
            except Exception as e:  # noqa: BLE001
                self.journal.emit("system.notice", payload={"level": "error", "message": f"planificateur : {e}"})
            await asyncio.sleep(self.tick_s)

    def reschedule_all(self) -> None:
        """À la reprise : repart de maintenant, sans déclenchement de rattrapage."""
        now = datetime.now(timezone.utc)
        for s in self.db.all("SELECT id, cron, timezone FROM schedules WHERE enabled=1"):
            self.db.execute("UPDATE schedules SET next_run_at=? WHERE id=?", (next_run(s["cron"], s["timezone"], now), s["id"]))

    def tick(self) -> None:
        now = datetime.now(timezone.utc)
        now_s = now.strftime("%Y-%m-%dT%H:%M:%SZ")
        rows = self.db.all("SELECT s.*, a.enabled AS agent_enabled FROM schedules s JOIN agents a ON a.id=s.agent_id "
                           "WHERE s.enabled=1 AND s.next_run_at IS NOT NULL AND s.next_run_at<=?", (now_s,))
        paused = self.worker.is_paused()
        for s in rows:
            nxt = next_run(s["cron"], s["timezone"], now)  # pas de rattrapage multiple : on repart de maintenant
            if paused or not s["agent_enabled"]:
                self.db.execute("UPDATE schedules SET next_run_at=? WHERE id=?", (nxt, s["id"]))
                continue
            agent = self.db.one("SELECT * FROM agents WHERE id=?", (s["agent_id"],))
            prompt = s["prompt"] or agent["default_prompt"] or "Exécute ta mission."
            run = self.worker.create_run(agent, prompt, "schedule", schedule_id=s["id"])
            self.db.execute("UPDATE schedules SET last_run_at=?, last_run_id=?, next_run_at=? WHERE id=?", (now_s, run["id"], nxt, s["id"]))
            self.journal.emit("schedule.fired", agent_id=s["agent_id"], run_id=run["id"], payload={"schedule_id": s["id"], "name": s["name"]})
