"""Vie intérieure de la société RO·AI (bureau virtuel) : fil interne façon mini-réseau social, journal, dialogues.

- Édition du matin (≈ 7 h, heure de Paris) : UN appel Claude Haiku (mode texte seul : aucun outil, consignes minimales,
  pas de session) écrit le journal de chaque agent, 2 à 3 publications horodatées par agent (dont des « pensées »), des
  commentaires et likes entre collègues, et les dialogues de pause. Les publications apparaissent à leur heure.
- Posts « Fait réel » (sans IA) : une mission réussie ou échouée, une livraison traitée deviennent une publication de
  l'agent, avec quelques réactions toutes faites de collègues.
- Édition de l'après-midi (≈ 14 h) : un second appel, SEULEMENT s'il y a eu de vrais événements depuis le matin, pour
  que les agents les commentent et partagent de nouvelles pensées.
Garde-fous : plafond dur d'appels par jour, aucun appel au-delà de 60 % d'une limite Claude, à l'arrêt d'urgence ou si
Claude n'est pas connecté. Le récit ne doit jamais inventer de mission, de résultat ni de collaboration.
"""
from __future__ import annotations

import asyncio
import json
import random
import re
import secrets
import shutil
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from . import society_voice as voice
from .db import Database, now_iso
from .profiles import default_profile
from .redact import redact_text

PARIS = ZoneInfo("Europe/Paris")
DAILY_CAP = 4                 # appels au plus par jour (éditions automatiques + manuelles)
LIMIT_GUARD_PCT = 60          # au-delà : on n'appelle pas
MORNING_HOUR, AFTERNOON_HOUR, LAST_HOUR = 7, 14, 19
TIMEOUT_S = 180
MEMORY_DAYS = 5
MAX_AGENTS = 12
LINE_MAX = 40                 # répliques de dialogue : tiennent dans une bulle (44 caractères)
FEED_DAYS, FEED_MAX = 3, 300
ERR_FR = voice.ERR_FR


def paris_day(dt: datetime | None = None) -> str:
    return (dt or datetime.now(timezone.utc)).astimezone(PARIS).strftime("%Y-%m-%d")


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _clip(v: Any, n: int) -> str:
    s = " ".join(str(v).split()) if isinstance(v, (str, int, float)) else ""
    s = redact_text(s, 10_000)
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def at_today(hhmm: Any, now: datetime, lo: int, hi: int) -> str | None:
    """« 09:40 » → instant ISO du jour (Paris), borné à [lo h, hi h] ; None si illisible."""
    m = re.match(r"^\s*(\d{1,2})[:h](\d{2})\s*$", str(hhmm or ""))
    if not m:
        return None
    h, mi = min(max(int(m.group(1)), lo), hi), min(int(m.group(2)), 59)
    loc = now.astimezone(PARIS).replace(hour=h, minute=mi, second=0, microsecond=0)
    return _iso(loc)


def build_context(db: Database, now: datetime | None = None, since: datetime | None = None) -> dict:
    """Faits réels (24 h par défaut) par agent, fiches (personnalité), mémoire des jours précédents. Clés courtes a1, a2…"""
    now = now or datetime.now(timezone.utc)
    since_s = _iso(since or (now - timedelta(hours=24)))
    rows = db.all("SELECT * FROM agents WHERE enabled=1 ORDER BY created_at, name LIMIT ?", (MAX_AGENTS,))
    memory: dict = db.kv_get("society_memory", {}) or {}
    agents = []
    for i, a in enumerate(rows, start=1):
        prof = db.one("SELECT data_json FROM agent_profiles WHERE agent_id=?", (a["id"],))
        p = json.loads(prof["data_json"]) if prof else {}
        facts = []
        for r in db.all("SELECT trigger, status, created_at, prompt, result_text, error_class, notify_target FROM runs "
                        "WHERE agent_id=? AND created_at>=? ORDER BY created_at LIMIT 12", (a["id"], since_s)):
            when = _parse_iso(r["created_at"]).astimezone(PARIS).strftime("%a %H:%M")
            what = {"schedule": "mission planifiée", "manual": "mission manuelle", "api": "livraison" if r["notify_target"] == "inbox" else "message"}.get(r["trigger"], r["trigger"])
            if r["notify_target"] in ("chat", "discord") or r["trigger"] == "reply":
                what = "discussion avec l'utilisateur"
            res = r["status"] if r["status"] != "failed" else f"échec ({r['error_class'] or 'erreur'})"
            if what == "discussion avec l'utilisateur":  # conversation privée : le fait seulement, jamais son contenu
                facts.append(f"{when} · {what}")
                continue
            line = f"{when} · {what} · {res} · demande : {_clip((r['prompt'] or '').split(chr(10))[0], 80)}"
            if r["result_text"] and r["status"] == "succeeded" and what != "discussion avec l'utilisateur":
                line += f" · résultat : {_clip(r['result_text'].split(chr(10))[0], 100)}"
            facts.append(line)
        n_dlv = db.one("SELECT COUNT(*) n FROM deliveries WHERE agent_id=? AND received_at>=?", (a["id"], since_s))
        if n_dlv and n_dlv["n"]:
            facts.append(f"{n_dlv['n']} livraison(s) reçue(s) d'outils externes")
        agents.append({
            "key": f"a{i}", "id": a["id"], "handle": "@" + re.sub(r"[^a-z0-9_]", "", (a["slug"] or a["id"]).replace("-", "_").lower())[:24],
            "name": _clip(p.get("display_name") or a["name"], 40), "department": _clip(a["department"], 30),
            "title": _clip(p.get("title"), 40), "traits": [_clip(t, 24) for t in (p.get("traits") or [])[:3]],
            "interests": [_clip(t, 24) for t in (p.get("interests") or [])[:3]], "facts": facts,
            "memory": [m.get("text", "") for m in (memory.get(a["id"]) or [])[-3:]],
        })
    return {"day": paris_day(now), "weekday": now.astimezone(PARIS).strftime("%A"), "agents": agents}


def _team(ctx: dict) -> str:
    lines = []
    for a in ctx["agents"]:
        lines.append(f"[{a['key']}] {a['name']} ({a['handle']}) · {a['department']}" + (f" · {a['title']}" if a["title"] else "")
                     + (f" · traits : {', '.join(a['traits'])}" if a["traits"] else "") + (f" · aime : {', '.join(a['interests'])}" if a["interests"] else ""))
        lines.append("  faits réels : " + (" | ".join(a["facts"]) if a["facts"] else "aucune activité"))
        if a["memory"]:
            lines.append("  journal des jours précédents : " + " | ".join(a["memory"]))
    return "\n".join(lines)


RULES = ("RÈGLES STRICTES : 1) Comme travail, ne mentionne QUE les faits réels fournis ; n'invente aucune mission, aucun résultat, "
         "aucune collaboration, aucun chiffre. 2) Le reste : vie de bureau, humeur, ressentis, souvenirs, centres d'intérêt, humour bienveillant. "
         "3) Français naturel et vivant, vrai style réseau social : phrases courtes, @pseudo pour interpeller un collègue, un emoji de temps en temps "
         "(pas à chaque phrase), de l'humour, des private jokes liées à leurs centres d'intérêt ; jamais de langage technique ni de compte rendu. "
         "4) Réponds UNIQUEMENT par un objet JSON valide, sans texte autour.\n")


def society_prompt(ctx: dict) -> str:
    keys = [a["key"] for a in ctx["agents"]]
    n_dlg = min(12, max(0, len(keys) * (len(keys) - 1)))
    return (
        "Tu écris la vie intérieure d'une petite société, RO·AI, dont les employés sont des agents IA qui travaillent sur un serveur. "
        "Ils savent qu'ils forment une équipe, ont une mémoire de leurs journées et partagent leurs pensées sur le fil interne de "
        "l'entreprise, un petit réseau social où l'on publie, commente et aime les messages des autres.\n" + RULES +
        'Format : {"journal": {"a1": "1 à 2 phrases à la 1re personne, 200 caractères max"}, '
        '"posts": [{"author": "a1", "kind": "post" | "pensee" | "photo" | "question", "time": "HH:MM", "text": "220 caractères max", "likes": ["a2"], '
        '"replies": [{"author": "a2", "time": "HH:MM", "text": "140 caractères max"}]}], '
        '"dialogues": [{"a": "a1", "b": "a2", "lines": ["réplique de a", "réplique de b", "réplique de a"]}]}\n'
        f"Un journal par agent ({', '.join(keys)}). 2 à 3 publications par agent réparties entre 08:00 et 19:00, variées : "
        "« pensee » (réflexion intime, ressenti, souvenir), « photo » (il publie une photo de son poste de travail : la légende "
        "parle de son bureau, de sa déco, de son ambiance), « question » (il demande l'avis des collègues sur un sujet léger lié à ses "
        "centres d'intérêt), « post » (humeur, anecdote de bureau). Au moins une pensee par agent. Des fils de 2 à 5 commentaires où "
        "les collègues se répondent ENTRE EUX (l'auteur répond aussi), se taquinent gentiment, rebondissent ; des likes. "
        f"{n_dlg} dialogues de pause de 2 à 4 répliques alternées entre deux agents différents, {LINE_MAX} caractères max par réplique.\n\n"
        f"Jour : {ctx['weekday']} {ctx['day']}\nÉquipe :\n{_team(ctx)}"
    )


def afternoon_prompt(ctx: dict, posts: list[dict], keymap: dict[str, str]) -> str:
    rev = {v: k for k, v in keymap.items()}
    lines = []
    for i, p in enumerate(posts, start=1):
        who = rev.get(p["author"], "?")
        tag = "fait réel" if p["kind"] == "event" else "pensée" if p["kind"] == "thought" else "post"
        lines.append(f"[p{i}] {who} ({tag}) : {p['text']}")
        for r in p.get("replies", [])[-3:]:
            lines.append(f"    ↳ {rev.get(r['author'], '?')} : {r['text']}")
    return (
        "Suite de la journée sur le fil interne de RO·AI (petit réseau social des agents IA de l'entreprise). De vrais événements ont eu "
        "lieu depuis ce matin : les agents réagissent, commentent, aiment, et partagent quelques nouvelles pensées.\n" + RULES +
        'Format : {"replies": [{"post": "p1", "author": "a2", "time": "HH:MM", "text": "140 caractères max"}], '
        '"likes": [{"post": "p1", "author": "a2"}], '
        '"posts": [{"author": "a1", "kind": "post" | "pensee" | "photo" | "question", "time": "HH:MM", "text": "220 caractères max", "likes": [], "replies": []}]}\n'
        f"Entre 3 et {3 + 2 * len(ctx['agents'])} commentaires (surtout sur les faits réels), quelques likes, 1 nouvelle publication par agent au plus, "
        f"heures entre 14:00 et 19:30. Un agent ne commente pas son propre post sauf pour répondre à quelqu'un.\n\n"
        f"Fil du jour :\n" + "\n".join(lines) + f"\n\nÉquipe :\n{_team(ctx)}"
    )


def _json(text: str) -> dict:
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        raise ValueError("réponse sans JSON")
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError as e:
        raise ValueError("JSON invalide") from e
    if not isinstance(data, dict):
        raise ValueError("JSON inattendu")
    return data


def _posts(raw: Any, ids: dict[str, str], now: datetime, lo: int, hi: int, limit: int) -> list[dict]:
    out = []
    for p in (raw or [])[:limit] if isinstance(raw, list) else []:
        if not isinstance(p, dict) or p.get("author") not in ids or not _clip(p.get("text"), 230):
            continue
        at = at_today(p.get("time"), now, lo, hi) or _iso(now)
        replies = []
        for r in (p.get("replies") or [])[:5]:
            if not isinstance(r, dict) or r.get("author") not in ids or not _clip(r.get("text"), 150):
                continue
            rat = at_today(r.get("time"), now, lo, hi + 1) or at
            replies.append({"author": ids[r["author"]], "text": _clip(r["text"], 150), "at": max(rat, at)})
        likes = sorted({ids[x] for x in (p.get("likes") or []) if isinstance(x, str) and x in ids and x != p["author"]}) if isinstance(p.get("likes"), list) else []
        k = str(p.get("kind", "")).lower()
        kind = "thought" if k.startswith("pens") else "photo" if k.startswith("photo") else "question" if k.startswith("quest") else "post"
        out.append({"author": ids[p["author"]], "kind": kind, "text": _clip(p["text"], 230), "at": at, "likes": likes, "replies": replies})
    return out


def parse_society(text: str, ctx: dict, now: datetime | None = None) -> dict:
    """Édition du matin : journal, publications horodatées, dialogues ; lève ValueError si inexploitable."""
    now = now or datetime.now(timezone.utc)
    data = _json(text)
    ids = {a["key"]: a["id"] for a in ctx["agents"]}
    journal = {ids[k]: _clip(v, 220) for k, v in (data.get("journal") or {}).items() if k in ids and _clip(v, 220)} if isinstance(data.get("journal"), dict) else {}
    posts = _posts(data.get("posts"), ids, now, 8, LAST_HOUR, 3 * MAX_AGENTS)
    dialogues = []
    for d in (data.get("dialogues") or [])[:16] if isinstance(data.get("dialogues"), list) else []:
        if not isinstance(d, dict) or d.get("a") not in ids or d.get("b") not in ids or d["a"] == d["b"] or not isinstance(d.get("lines"), list):
            continue
        lines = [_clip(x, LINE_MAX + 4) for x in d["lines"][:4] if _clip(x, LINE_MAX + 4)]
        if len(lines) >= 2:
            dialogues.append({"a": ids[d["a"]], "b": ids[d["b"]], "lines": lines})
    if not journal and not posts and not dialogues:
        raise ValueError("réponse vide")
    return {"journal": journal, "posts": posts, "dialogues": dialogues}


def parse_afternoon(text: str, ctx: dict, post_ids: list[str], now: datetime | None = None) -> dict:
    """Édition de l'après-midi : commentaires et likes sur des posts existants (pN), nouvelles publications."""
    now = now or datetime.now(timezone.utc)
    data = _json(text)
    ids = {a["key"]: a["id"] for a in ctx["agents"]}
    pmap = {f"p{i}": pid for i, pid in enumerate(post_ids, start=1)}
    lo = max(AFTERNOON_HOUR, now.astimezone(PARIS).hour)
    replies = [{"post": pmap[r["post"]], "author": ids[r["author"]], "text": _clip(r["text"], 150),
                "at": max(at_today(r.get("time"), now, lo, LAST_HOUR + 1) or _iso(now), _iso(now))}
               for r in (data.get("replies") or [])[:30] if isinstance(r, dict) and r.get("post") in pmap and r.get("author") in ids and _clip(r.get("text"), 150)]
    likes = [{"post": pmap[x["post"]], "author": ids[x["author"]]} for x in (data.get("likes") or [])[:40]
             if isinstance(x, dict) and x.get("post") in pmap and x.get("author") in ids]
    posts = [{**p, "at": max(p["at"], _iso(now))} for p in _posts(data.get("posts"), ids, now, lo, LAST_HOUR, MAX_AGENTS)]
    if not replies and not likes and not posts:
        raise ValueError("réponse vide")
    return {"replies": replies, "likes": likes, "posts": posts}


class Society:
    def __init__(self, s, db: Database, journal, executor, worker, status, adapters):
        self.s, self.db, self.journal, self.executor, self.worker, self.status, self.adapters = s, db, journal, executor, worker, status, adapters
        self._lock = asyncio.Lock()
        self.running = False

    # --- fil ----------------------------------------------------------------------------------------------------------
    def _feed(self) -> dict:
        f = self.db.kv_get("society_feed", None)
        if not isinstance(f, dict):
            f = {"seq": 0, "posts": []}
            old = self.db.kv_get("society", {}) or {}  # première édition (ancien format, sans heure) : reprise
            for p in old.get("posts", []) or []:
                f["seq"] += 1
                at = old.get("generated_at") or now_iso()
                f["posts"].append({"id": f"p{f['seq']}", "author": p.get("author"), "kind": "post", "text": p.get("text", ""), "at": at, "likes": [],
                                   "replies": [{"id": f"p{f['seq']}r{i}", "author": r.get("author"), "text": r.get("text", ""), "at": at} for i, r in enumerate(p.get("replies") or [])]})
        return f

    def _save_feed(self, f: dict) -> None:
        cutoff = _iso(datetime.now(timezone.utc) - timedelta(days=FEED_DAYS))
        f["posts"] = [p for p in f["posts"] if p["at"] >= cutoff][-FEED_MAX:]
        self.db.kv_set("society_feed", f)

    def _add_posts(self, f: dict, posts: list[dict], edition: str) -> list[str]:
        ids = []
        for p in posts:
            f["seq"] += 1
            pid = f"p{f['seq']}"
            reps = [{"id": f"{pid}r{i}", **r} for i, r in enumerate(p.get("replies") or [])]
            f["posts"].append({"id": pid, "author": p["author"], "kind": p["kind"], "text": p["text"], "at": p["at"], "likes": list(p.get("likes") or []),
                               "replies": reps, "edition": edition, **{k: p[k] for k in ("ref", "like_at", "attach", "tag") if p.get(k)}})
            ids.append(pid)
        f["posts"].sort(key=lambda x: x["at"])
        return ids

    def feed_view(self, now: datetime | None = None) -> dict:
        nowi = _iso(now or datetime.now(timezone.utc))
        f = self._feed()
        vis = []
        upcoming = 0
        for p in f["posts"]:
            if p["at"] > nowi:
                upcoming += 1
                continue
            la = p.get("like_at") or {}
            vis.append({**p, "text": voice.demask(p["text"]), "likes": [x for x in p.get("likes", []) if la.get(x, "") <= nowi],
                        "replies": [{**r, "text": voice.demask(r["text"])} for r in p.get("replies", []) if r["at"] <= nowi]})
        vis.sort(key=lambda p: p["at"], reverse=True)
        return {"posts": vis[:80], "upcoming": upcoming}

    # --- faits réels → publications (sans IA) ----------------------------------------------------------------------------
    def _people(self) -> dict[str, dict]:
        """Agents actifs : personnalité (fiche enregistrée, sinon fiche par défaut), pseudo, département."""
        out = {}
        for a in self.db.all("SELECT * FROM agents WHERE enabled=1"):
            prof = self.db.one("SELECT data_json FROM agent_profiles WHERE agent_id=?", (a["id"],))
            try:
                p = json.loads(prof["data_json"]) if prof else default_profile(dict(a))
            except (ValueError, KeyError):
                p = {}
            handle = "@" + re.sub(r"[^a-z0-9_]", "", (a["slug"] or a["id"]).replace("-", "_").lower())[:24]
            out[a["id"]] = {"id": a["id"], "pers": p.get("personality") or {}, "handle": handle, "department": a["department"] or ""}
        return out

    def _mission_label(self, r) -> str:
        """Nom lisible d'une mission : la planification si elle en vient, sinon la 1re ligne de la demande."""
        if r["schedule_id"]:
            sc = self.db.one("SELECT name FROM schedules WHERE id=?", (r["schedule_id"],))
            if sc and sc["name"]:
                return _clip(sc["name"], 60)
        return _clip((r["prompt"] or "").split("\n")[0], 60) or "ma mission"

    def _screen(self, run_id: str) -> list[str]:
        """Dernières actions réelles de l'exécution (résumés tool.call déjà masqués) : la « capture d'écran » du post."""
        out = []
        for ev in self.db.all("SELECT payload FROM events WHERE run_id=? AND type='tool.call' ORDER BY seq DESC LIMIT 4", (run_id,)):
            try:
                s_ = _clip(json.loads(ev["payload"]).get("summary") or "", 80)
            except ValueError:
                s_ = ""
            if s_:
                out.insert(0, s_)
        return out

    def _event_post(self, e: dict, people: dict[str, dict]) -> dict | None:
        at = _parse_iso(e["ts"])
        if e["type"] == "agent.created" and e.get("agent_id") in people:
            me = people[e["agent_id"]]
            rnd = random.Random(e["agent_id"])
            mates = [m for k, m in people.items() if k != me["id"]]
            reps, like_at = voice.reactions(rnd, author=me["id"], category="welcome", mates=mates, handle=me["handle"], at=at, iso=_iso, timedelta=timedelta)
            return {"author": me["id"], "kind": "event", "text": voice.welcome_post(rnd, me["department"]), "at": e["ts"], "likes": list(like_at),
                    "like_at": like_at, "replies": reps, "tag": "welcome"}
        if e["type"] not in ("run.succeeded", "run.failed") or not e.get("run_id"):
            return None
        r = self.db.one("SELECT r.*, a.enabled FROM runs r JOIN agents a ON a.id=r.agent_id WHERE r.id=?", (e["run_id"],))
        if not r or r["notify_target"] in ("chat", "discord") or r["trigger"] == "reply":
            return None  # conversations privées avec l'utilisateur : rien sur le fil
        ok = r["status"] == "succeeded"
        rnd = random.Random(r["id"])
        me = people.get(r["agent_id"]) or {"id": r["agent_id"], "pers": {}, "handle": "@agent"}
        attach: dict[str, Any] = {}
        if r["notify_target"] == "inbox":
            src = self.db.one("SELECT s.name, COUNT(*) n FROM deliveries d JOIN inbox_sources s ON s.id=d.source_id WHERE d.run_id=? GROUP BY s.name", (r["id"],))
            text, cat = voice.inbox_post(rnd, src=_clip(src["name"], 40) if src else "l'extérieur", n=src["n"] if src else 1, ok=ok, err=r["error_class"])
            tag = "inbox"
        else:
            prev = self.db.one("SELECT status FROM runs WHERE agent_id=? AND created_at<? AND status IN ('succeeded','failed') "
                               "AND (notify_target IS NULL OR notify_target NOT IN ('chat','discord')) AND trigger!='reply' ORDER BY created_at DESC LIMIT 1",
                               (r["agent_id"], r["created_at"]))
            day0 = _iso(at.astimezone(PARIS).replace(hour=0, minute=0, second=0, microsecond=0))
            nth = self.db.one("SELECT COUNT(*) n FROM runs WHERE agent_id=? AND status='succeeded' AND finished_at>=? AND finished_at<=? "
                              "AND (notify_target IS NULL OR notify_target NOT IN ('chat','discord')) AND trigger!='reply'",
                              (r["agent_id"], day0, r["finished_at"] or e["ts"]))["n"] if ok else 0
            text, cat = voice.mission_post(rnd, label=self._mission_label(r), ok=ok, err=r["error_class"], pers=me["pers"],
                                           recovered=bool(prev and prev["status"] == "failed"), nth_today=int(nth or 0),
                                           dur=voice.duration(r["started_at"], r["finished_at"]))
            tag = "mission"
            if ok and r["result_text"]:
                attach["result"] = _clip(r["result_text"], 400)
        screen = self._screen(r["id"])
        if screen:
            attach["screen"] = screen
        mates = [m for k, m in people.items() if k != r["agent_id"]]
        reps, like_at = voice.reactions(rnd, author=r["agent_id"], category=cat, mates=mates, handle=me["handle"], at=at, iso=_iso, timedelta=timedelta)
        return {"author": r["agent_id"], "kind": "event", "text": text, "at": e["ts"], "likes": list(like_at), "like_at": like_at, "replies": reps,
                "ref": r["id"], "tag": tag, **({"attach": attach} if attach else {})}

    def ingest_events(self) -> int:
        last = self.db.kv_get("society_seq", None)
        if last is None:  # premier passage : pas de rattrapage de l'historique
            self.db.kv_set("society_seq", self.journal.last_seq())
            return 0
        evs = self.journal.since(int(last), limit=300)
        if not evs:
            return 0
        f, n, people = self._feed(), 0, None
        for e in evs:
            if e["type"] not in ("run.succeeded", "run.failed", "agent.created"):
                continue
            people = people if people is not None else self._people()
            post = self._event_post(e, people)
            if post:
                self._add_posts(f, [post], "event")
                n += 1
        self.db.kv_set("society_seq", evs[-1]["seq"])
        if n:
            self._save_feed(f)
        return n

    # --- état ---------------------------------------------------------------------------------------------------------
    def settings(self) -> dict:
        return {"enabled": True, **(self.db.kv_get("society_settings", {}) or {})}

    def set_enabled(self, on: bool) -> dict:
        self.db.kv_set("society_settings", {**self.settings(), "enabled": bool(on)})
        return self.view()

    def usage(self) -> dict:
        u = self.db.kv_get("society_usage", {}) or {}
        if u.get("day") != paris_day():
            u = {"day": paris_day(), "calls": 0, "input_tokens": 0, "output_tokens": 0}
        return {**u, "cap": DAILY_CAP}

    def view(self) -> dict:
        cur = self.db.kv_get("society", {}) or {}
        return {"settings": self.settings(), "usage": self.usage(), "running": self.running, "last_error": self.db.kv_get("society_error"),
                "day": cur.get("day"), "generated_at": cur.get("generated_at"), "model": cur.get("model"), "editions": cur.get("editions", []),
                "journal": cur.get("journal", {}) if cur.get("day") == paris_day() else {}, "dialogues": cur.get("dialogues", []) if cur.get("day") == paris_day() else [],
                "memory": self.db.kv_get("society_memory", {}) or {}, **self.feed_view()}

    def blocked_reason(self, manual: bool) -> str | None:
        if not manual and not self.settings()["enabled"]:
            return "vie intérieure désactivée"
        if self.worker.is_paused():
            return "arrêt d'urgence actif"
        if self.usage()["calls"] >= DAILY_CAP:
            return f"plafond du jour atteint ({DAILY_CAP} appels)"
        now = datetime.now(timezone.utc)
        for w in (self.status.limits_view().get("claude") or []):
            pct, reset = w.get("used_percent"), w.get("resets_at")
            try:
                if reset and _parse_iso(str(reset)) <= now:
                    continue  # fenêtre remise à zéro depuis : elle ne compte plus
            except ValueError:
                pass
            if w.get("level") == "limited" or (isinstance(pct, (int, float)) and pct >= LIMIT_GUARD_PCT):
                return f"limite d'usage Claude trop haute ({w.get('window')} : {pct if pct is not None else 'atteinte'} %)"
        if not self.db.one("SELECT 1 FROM agents WHERE enabled=1"):
            return "aucun agent actif"
        return None

    def due(self) -> str | None:
        """Édition automatique à faire maintenant (une tentative de chaque par jour), sinon None."""
        if self.running:
            return None
        now = datetime.now(timezone.utc).astimezone(PARIS)
        cur, today = self.db.kv_get("society", {}) or {}, paris_day()
        if now.hour >= MORNING_HOUR and cur.get("day") != today and self.db.kv_get("society_auto_day") != today:
            return "morning"
        if (AFTERNOON_HOUR <= now.hour < LAST_HOUR and cur.get("day") == today and "afternoon" not in cur.get("editions", [])
                and self.db.kv_get("society_auto_pm") != today
                and any(p["kind"] == "event" and p["at"] > (cur.get("generated_at") or "") for p in self._feed()["posts"])):
            return "afternoon"
        return None

    # --- génération ---------------------------------------------------------------------------------------------------
    async def _call(self, prompt: str) -> tuple[str, dict, str | None]:
        gid = "soc" + secrets.token_hex(5)
        run_dir, cwd = self.s.data_dir / "runs" / gid, self.s.workspace_dir / "_society"
        model: str | None = None
        try:
            cwd.mkdir(parents=True, exist_ok=True); run_dir.mkdir(parents=True, exist_ok=True)
            synth = {"id": "_society", "name": "Vie intérieure", "slug": "_society", "provider": "claude", "mission": "", "model": "haiku",
                     "config": {"_text_only": True, "permission_mode": "dontAsk", "sandbox": "read-only"}}
            from .providers import RunContext
            adapter = self.adapters["claude"]()
            cmd = adapter.build(RunContext(gid, synth, prompt, cwd, run_dir, TIMEOUT_S, self.s.agent_home, self.s.claude_bin))
            texts: list[str] = []

            def on_line(line: str) -> None:
                nonlocal model
                for typ, payload in adapter.parse(line):
                    if typ == "run.message":
                        texts.append(payload.get("text", ""))
                    elif typ == "run.model":
                        model = payload.get("model")
            res = await self.executor.run(cmd, unit=f"roai-run-{gid}", cwd=cwd, timeout_s=TIMEOUT_S, on_line=on_line, cancel=asyncio.Event())
            out = adapter.finish(res.returncode, res.stderr_tail, res.timed_out, res.cancelled)
            self._usage = out.usage or {}
            if out.status != "succeeded":
                raise ValueError(out.error_message or "échec du client")
            return out.result_text or (texts[-1] if texts else ""), self._usage, model
        finally:
            shutil.rmtree(run_dir, ignore_errors=True)

    async def generate(self, manual: bool = False, edition: str | None = None) -> dict:
        why = self.blocked_reason(manual)
        if why:
            raise PermissionError(why)
        async with self._lock:
            info = await self.status.refresh("claude")
            if not info["installed"] or info["auth"]["state"] == "logged_out":
                raise PermissionError("Claude n'est pas connecté")
            cur, today = self.db.kv_get("society", {}) or {}, paris_day()
            edition = edition or ("morning" if cur.get("day") != today else "afternoon")
            self.running = True
            self._usage: dict = {}
            usage, model, err = {}, None, None
            u = self.usage(); u["calls"] += 1; self.db.kv_set("society_usage", u)  # compté avant l'appel : le plafond tient même en cas d'échec
            try:
                self.ingest_events()
                now = datetime.now(timezone.utc)
                if edition == "morning":
                    ctx = build_context(self.db, now)
                    text, usage, model = await self._call(society_prompt(ctx))
                    data = parse_society(text, ctx, now)
                    f = self._feed(); self._add_posts(f, data["posts"], "morning"); self._save_feed(f)
                    self.db.kv_set("society", {"day": today, "generated_at": now_iso(), "model": model, "editions": ["morning"],
                                               "journal": data["journal"], "dialogues": data["dialogues"]})
                    mem: dict = self.db.kv_get("society_memory", {}) or {}
                    for aid, txt in data["journal"].items():
                        mem[aid] = ([m for m in (mem.get(aid) or []) if m.get("day") != today] + [{"day": today, "text": txt}])[-MEMORY_DAYS:]
                    self.db.kv_set("society_memory", mem)
                else:
                    since = _parse_iso(cur["generated_at"]) if cur.get("generated_at") else now - timedelta(hours=12)
                    ctx = build_context(self.db, now, since=since)
                    nowi = _iso(now)
                    f = self._feed()
                    todays = [p for p in f["posts"] if p["at"] <= nowi and paris_day(_parse_iso(p["at"])) == today][-25:]
                    keymap = {a["key"]: a["id"] for a in ctx["agents"]}
                    text, usage, model = await self._call(afternoon_prompt(ctx, todays, keymap))
                    data = parse_afternoon(text, ctx, [p["id"] for p in todays], now)
                    byid = {p["id"]: p for p in f["posts"]}
                    for r in data["replies"]:
                        p = byid[r["post"]]
                        p["replies"].append({"id": f"{p['id']}r{len(p['replies'])}", "author": r["author"], "text": r["text"], "at": r["at"]})
                    for lk in data["likes"]:
                        p = byid[lk["post"]]
                        if lk["author"] != p["author"] and lk["author"] not in p["likes"]:
                            p["likes"].append(lk["author"])
                    self._add_posts(f, data["posts"], "afternoon"); self._save_feed(f)
                    self.db.kv_set("society", {**cur, "editions": sorted(set(cur.get("editions", [])) | {"afternoon"}), "model": model or cur.get("model")})
                self.db.kv_set("society_error", None)
            except Exception as e:  # noqa: BLE001
                err = str(e)[:300]
                usage = getattr(self, "_usage", {}) or usage
                self.db.kv_set("society_error", {"at": now_iso(), "message": err})
            finally:
                self.running = False
                u = self.usage()
                u["input_tokens"] += int((usage or {}).get("input_tokens") or 0); u["output_tokens"] += int((usage or {}).get("output_tokens") or 0)
                self.db.kv_set("society_usage", u)
            self.journal.emit("office.society", payload={"action": "failed" if err else "generated", "edition": edition, "manual": manual, "model": model,
                                                         "input_tokens": (usage or {}).get("input_tokens"), "output_tokens": (usage or {}).get("output_tokens"),
                                                         **({"error": err} if err else {})})
            if err:
                raise ValueError(err)
            return self.view()

    async def loop(self) -> None:
        """Toutes les 30 s : faits réels → publications ; toutes les 5 min : édition du matin ou de l'après-midi si due."""
        n = 0
        while True:
            await asyncio.sleep(30)
            n += 1
            try:
                self.ingest_events()
                if n % 10 == 0:
                    ed = self.due()
                    if ed and not self.blocked_reason(False):
                        self.db.kv_set("society_auto_day" if ed == "morning" else "society_auto_pm", paris_day())
                        await self.generate(False, ed)
            except Exception:  # noqa: BLE001 — erreur enregistrée et visible ; une seule tentative automatique de chaque par jour
                pass
