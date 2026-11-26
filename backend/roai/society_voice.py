"""Voix des agents sur le fil interne, SANS IA : les faits réels deviennent des publications écrites « à la première personne »,
avec le ton de la fiche (énergie, concentration, sociabilité, curiosité, café), et les collègues réagissent avec des
réponses toutes faites, elles aussi teintées par leur caractère. Déterministe (graine = identifiant de l'exécution) :
aucune donnée inventée, seulement des formulations. Coût : zéro jeton.
"""
from __future__ import annotations

import random
from typing import Any

from .redact import MASK

ERR_FR = {"auth_expired": "connexion expirée", "rate_limited": "limite d'usage", "denied": "action refusée", "timeout": "délai dépassé",
          "transient": "erreur passagère", "failed": "erreur"}
STYLES = ("energy", "focus", "sociability", "curiosity")

OK: dict[str, list[str]] = {
    "energy": ["« {label} » : bouclé ! ✅ Au suivant 💪", "Et hop, « {label} », c'est fait 🚀", "« {label} » plié en {dur} ⚡ Quelle journée !",
               "Encore une : « {label} » ✅ Je suis chaud aujourd'hui 🔥"],
    "focus": ["« {label} » terminé. Tout est en ordre.", "Fini : « {label} ». Rapport rangé à la bibliothèque.",
              "« {label} » : fait, en {dur}. Je retourne à mon calme.", "Mission « {label} » close. Propre."],
    "sociability": ["Petite victoire du jour : « {label} » ✅ 🙂", "Voilà, « {label} » est bouclé ! Le détail est à la bibliothèque si ça vous intéresse 📚",
                    "« {label} », c'est fait ! Qui est partant pour un café ? ☕", "Terminé « {label} » 🎉 Bonne journée à tous !"],
    "curiosity": ["« {label} » terminé. Toujours intéressant, ce genre de mission 🤓", "Fini « {label} » 🔍 J'adore fouiller comme ça.",
                  "« {label} » : fait ! Il y a toujours un détail qui m'intrigue 🧐", "Mission « {label} » bouclée, ma curiosité est rassasiée (pour l'instant) 🤓"],
}
RECOVERED = ["Ouf, ça remarche ! « {label} » est passé cette fois 😮‍💨", "Deuxième essai, et cette fois « {label} » est passé ✅",
             "Retour à la normale : « {label} » terminé 🙌"]
KO: dict[str, list[str]] = {
    "rate_limited": ["Quota atteint en plein « {label} »… pause forcée 😴", "Limite d'usage atteinte pendant « {label} ». On reprendra plus tard ⏳"],
    "auth_expired": ["Mon badge d'accès a expiré, « {label} » attendra 🔑", "Connexion expirée pendant « {label} »… quelqu'un a vu mon badge ? 🔑"],
    "timeout": ["« {label} » a pris trop de temps, coupé au chrono ⏱️", "Délai dépassé sur « {label} ». Trop ambitieux ? ⏱️"],
    "denied": ["On m'a refusé une action pendant « {label} ». Je respecte 🙅", "Action refusée sur « {label} ». Règles = règles."],
    "other": ["Aïe, « {label} » n'est pas passé ({err}). Je regarde ça 🔧", "Raté pour « {label} » ({err}) 😕 On fera mieux.",
              "« {label} » en échec ({err}). Ça arrive 🤷"],
}
INBOX_OK = ["📦 Colis de {src} reçu et traité ({n}).", "Livraison de {src} : traitée ✅ ({n})", "Encore un colis de {src} 📦 C'est réglé ({n})."]
INBOX_KO = ["Le colis de {src} m'a posé problème ({err}) 📦😕", "Traitement de la livraison de {src} raté ({err})."]
WELCOME = ["Bonjour tout le monde ! Premier jour dans l'équipe {dept} 👋", "Nouvelle recrue au rapport 👋 Hâte de découvrir l'équipe {dept} !",
           "Premier jour chez RO·AI. Où est la machine à café ? ☕👋"]
STREAK = {3: " (3e de la journée 🔥)", 5: " (5e aujourd'hui, en forme 💪)", 10: " (10e mission du jour 🏆)"}
COFFEE = [" Pause café méritée ☕", " Je file à la machine à café ☕"]

REPLY: dict[str, dict[str, list[str]]] = {
    "ok": {"energy": ["Bravo {h} 👏", "🔥🔥", "Machine ! {h} 💪", "Respect 🙌"],
           "focus": ["Bien joué.", "Propre 👍", "Efficace, {h}.", "Noté 📌"],
           "sociability": ["Bravo {h} ! 🎉", "Top, merci pour le boulot 🙂", "On fête ça au café ? ☕", "Trop bien 😄"],
           "curiosity": ["Je lirai le rapport 📚", "Intéressant ! Tu me racontes ? 🤓", "Ça m'intrigue, {h} 👀", "Joli 🔍"]},
    "ko": {"energy": ["Courage {h} 💪", "Tu vas l'avoir au prochain coup !"], "focus": ["Ça arrive.", "Bon courage."],
           "sociability": ["Dis-moi si je peux aider 🙂", "Courage {h} ❤️", "😬 courage !"], "curiosity": ["Bizarre… tu sais d'où ça vient ? 🧐", "Mystère 🔍"]},
    "quota": {"energy": ["Profite de la pause ⏳"], "focus": ["Repos forcé, c'est sain."], "sociability": ["Viens au café en attendant ☕", "Même les meilleurs ont des quotas 😅"],
              "curiosity": ["On sait quand ça revient ? ⏳"]},
    "recovered": {"energy": ["Yes ! 🙌"], "focus": ["Bien."], "sociability": ["Bon retour parmi nous 😄"], "curiosity": ["C'était quoi finalement ? 🧐"]},
    "inbox": {"energy": ["Ça bouge 📦"], "focus": ["Reçu."], "sociability": ["Merci pour le suivi 🙂"], "curiosity": ["Il y avait quoi dedans ? 👀"]},
    "welcome": {"energy": ["Bienvenue {h} ! 🎉"], "focus": ["Bienvenue."], "sociability": ["Bienvenue {h} ! Le café est au rez-de-chaussée ☕", "Bienvenue parmi nous 😄"],
                "curiosity": ["Bienvenue {h} ! Tu fais quoi exactement ? 🤓"]},
}
THANKS = ["Merci {h} 🙏", "Merci 🙂", "😄", "Merci, ça fait plaisir !"]


def style_of(pers: dict | None) -> str:
    p = pers or {}
    return max(STYLES, key=lambda k: (float(p.get(k) or 0), -STYLES.index(k)))


def demask(text: str) -> str:
    """Une donnée masquée reste masquée, mais sans le marqueur technique « [masqué] » au milieu d'une phrase."""
    return text.replace(MASK, "🔒")


def duration(started: str | None, finished: str | None) -> str:
    from datetime import datetime
    try:
        s = (datetime.fromisoformat(str(finished).replace("Z", "+00:00")) - datetime.fromisoformat(str(started).replace("Z", "+00:00"))).total_seconds()
    except (TypeError, ValueError):
        return "un rien de temps"
    if s < 60:
        return f"{max(1, int(s))} s"
    if s < 3600:
        return f"{int(s // 60)} min"
    return f"{int(s // 3600)} h {int(s % 3600 // 60):02d}"


def mission_post(rnd: random.Random, *, label: str, ok: bool, err: str | None, pers: dict | None, recovered: bool, nth_today: int,
                 dur: str) -> tuple[str, str]:
    """(texte, catégorie de réaction) d'une mission réelle."""
    if ok:
        if recovered:
            text = rnd.choice(RECOVERED).format(label=label)
            return text, "recovered"
        text = rnd.choice(OK[style_of(pers)]).format(label=label, dur=dur)
        text += STREAK.get(nth_today, "")
        if float((pers or {}).get("coffee") or 0) >= 0.7 and rnd.random() < 0.35 and nth_today not in STREAK:
            text += rnd.choice(COFFEE)
        return text, "ok"
    cls = err or "failed"
    pool = KO.get(cls, KO["other"])
    text = rnd.choice(pool).format(label=label, err=ERR_FR.get(cls, "erreur"))
    return text, "quota" if cls == "rate_limited" else "ko"


def inbox_post(rnd: random.Random, *, src: str, n: int, ok: bool, err: str | None) -> tuple[str, str]:
    what = f"{n} livraison{'s' if n > 1 else ''}"
    if ok:
        return rnd.choice(INBOX_OK).format(src=src, n=what), "inbox"
    return rnd.choice(INBOX_KO).format(src=src, err=ERR_FR.get(err or "failed", "erreur")), "ko"


def welcome_post(rnd: random.Random, dept: str) -> str:
    return rnd.choice(WELCOME).format(dept=dept or "RO·AI")


def reply_text(rnd: random.Random, category: str, pers: dict | None, author_handle: str) -> str:
    bank = REPLY.get(category) or REPLY["ok"]
    return rnd.choice(bank[style_of(pers)]).format(h=author_handle)


def reactions(rnd: random.Random, *, author: str, category: str, mates: list[dict[str, Any]], handle: str, at, iso,
              timedelta) -> tuple[list[dict], dict[str, str]]:
    """Réponses de 1 à 3 collègues (les plus sociables d'abord, avec du hasard), likes échelonnés dans le temps, et parfois
    un « merci » de l'auteur sous le premier commentaire. `mates` : [{"id", "pers", "handle"}]."""
    if not mates:
        return [], {}
    weighted = sorted(mates, key=lambda m: -(float((m.get("pers") or {}).get("sociability") or 0.4) + rnd.random()))
    k = min(len(weighted), 1 + (rnd.random() < 0.6) + (rnd.random() < 0.25))
    reps: list[dict] = []
    t = at
    for m in weighted[:k]:
        t = t + timedelta(minutes=rnd.randint(1, 14))
        reps.append({"author": m["id"], "text": reply_text(rnd, category, m.get("pers"), handle), "at": iso(t)})
    if reps and rnd.random() < 0.45:
        first = next((m for m in mates if m["id"] == reps[0]["author"]), None)
        reps.append({"author": author, "text": rnd.choice(THANKS).format(h=(first or {}).get("handle", "")), "at": iso(t + timedelta(minutes=rnd.randint(1, 9)))})
    likers = [m["id"] for m in mates if rnd.random() < 0.25 + 0.5 * float((m.get("pers") or {}).get("sociability") or 0.4)]
    like_at = {lid: iso(at + timedelta(minutes=rnd.randint(1, 45))) for lid in likers}
    return reps, like_at
