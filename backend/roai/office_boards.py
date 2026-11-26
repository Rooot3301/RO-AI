"""Tableaux du Virtual Office : planning du jour (planifications réelles et exécutions qu'elles ont lancées).
Lecture seule, calculé à la demande depuis la base ; aucune exécution, aucun appel aux clients."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from croniter import croniter

DAY_TZ = "Europe/Paris"           # le « jour » du bureau est celui de Paris (horloges, jour/nuit)
MAX_PER_SCHEDULE = 48             # au-delà (cron très fréquent), la liste est tronquée et signalée
MAX_ITEMS = 60
MATCH_BEFORE = timedelta(minutes=1)
MATCH_AFTER = timedelta(minutes=15)   # le planificateur tourne toutes les 15 s : une exécution suit son horaire de près

_F = "%Y-%m-%dT%H:%M:%SZ"


def _iso(d: datetime) -> str:
    return d.astimezone(timezone.utc).strftime(_F)


def _parse(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _occurrences(cron: str, tz: str, start: datetime, end: datetime, limit: int) -> tuple[list[datetime], bool]:
    try:
        it = croniter(cron, (start - timedelta(seconds=1)).astimezone(ZoneInfo(tz)))
    except Exception:  # noqa: BLE001 — cron illisible : rien à afficher
        return [], False
    out: list[datetime] = []
    while True:
        n = it.get_next(datetime).astimezone(timezone.utc)
        if n >= end:
            return out, False
        if len(out) >= limit:
            return out, True
        out.append(n)


def planning(db, now: datetime | None = None, paused: bool = False) -> dict:
    """Occurrences d'aujourd'hui (heure de Paris) des planifications actives, avec le sort réel de celles déjà passées."""
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    local = now.astimezone(ZoneInfo(DAY_TZ))
    day0 = local.replace(hour=0, minute=0, second=0, microsecond=0)
    start, end = day0.astimezone(timezone.utc), (day0 + timedelta(days=1)).astimezone(timezone.utc)
    rows = db.all("SELECT s.id, s.name, s.cron, s.timezone, s.agent_id, s.created_at, a.name AS agent_name, a.enabled AS agent_enabled "
                  "FROM schedules s JOIN agents a ON a.id = s.agent_id WHERE s.enabled = 1 ORDER BY s.created_at")
    runs = db.all("SELECT id, schedule_id, status, created_at FROM runs WHERE schedule_id IS NOT NULL AND created_at >= ? AND created_at < ? "
                  "ORDER BY created_at", (_iso(start - MATCH_AFTER), _iso(end)))
    by_sched: dict[str, list[dict]] = {}
    for r in runs:
        by_sched.setdefault(r["schedule_id"], []).append(dict(r))
    items: list[dict] = []
    truncated = False
    next_after = None
    for s in rows:
        created = _parse(s["created_at"]) or start
        occ, cut = _occurrences(s["cron"], s["timezone"], max(start, created), end, MAX_PER_SCHEDULE)
        truncated |= cut
        pool = by_sched.get(s["id"], [])
        used: set[str] = set()
        base = {"schedule_id": s["id"], "name": s["name"], "agent_id": s["agent_id"], "agent_name": s["agent_name"],
                "agent_enabled": bool(s["agent_enabled"])}
        for t in occ:
            run = next((r for r in pool if r["id"] not in used and t - MATCH_BEFORE <= (_parse(r["created_at"]) or t) < t + MATCH_AFTER), None)
            if run:
                used.add(run["id"])
                status, rid = run["status"], run["id"]
            elif t > now - timedelta(seconds=30):
                status, rid = "upcoming", None
            else:
                status, rid = "missed", None    # horaire passé sans exécution (arrêt d'urgence, agent désactivé, noyau arrêté)
            items.append({**base, "at": _iso(t), "status": status, "run_id": rid})
        for r in pool:                          # exécutions de la planification hors horaire (« Lancer maintenant » ou rattrapage après un arrêt du noyau)
            ts = _parse(r["created_at"])
            if r["id"] not in used and ts and start <= ts < end:
                items.append({**base, "at": r["created_at"], "status": r["status"], "run_id": r["id"], "off_schedule": True})
        nxt, _ = _occurrences(s["cron"], s["timezone"], end, end + timedelta(days=8), 1)
        if nxt and (next_after is None or nxt[0] < _parse(next_after["at"])):
            next_after = {**base, "at": _iso(nxt[0])}
    items.sort(key=lambda x: (x["at"], x["name"]))
    if len(items) > MAX_ITEMS:   # on garde l'essentiel : les dernières passées et toutes les prochaines possibles
        up = [i for i in items if i["status"] in ("upcoming", "queued", "awaiting_approval", "running")]
        past = [i for i in items if i not in up]
        keep = up[:MAX_ITEMS - 10]
        items = sorted(past[-(MAX_ITEMS - len(keep)):] + keep, key=lambda x: (x["at"], x["name"]))
        truncated = True
    return {"date": day0.strftime("%Y-%m-%d"), "timezone": DAY_TZ, "paused": paused, "items": items,
            "truncated": truncated, "next_after": next_after}
