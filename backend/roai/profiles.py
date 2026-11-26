"""Fiches d'identité des agents (décoratives) pour le Virtual Office.

- Une fiche par défaut est calculée localement, de façon déterministe, à partir du nom, du département et de la mission :
  aucun appel IA, aucune écriture en base tant que l'utilisateur ne l'enregistre pas.
- La génération IA est facultative, déclenchée explicitement, unique (jamais automatique), via le client officiel de
  l'agent, sans outil, avec un budget minimal. Le résultat est validé puis enregistré.
- Ces informations ne sont jamais injectées dans les prompts opérationnels.
"""
from __future__ import annotations

import json
import re
from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError, field_validator

THEMES = ("general", "security", "space", "dev", "research", "sysadmin", "data", "writing", "design", "finance", "support")
DECOR_ITEMS = {
    "general": ("plant_small", "photo_frame", "mug", "desk_lamp"),
    "security": ("multi_monitor", "network_rack", "shield_poster", "status_board"),
    "space": ("ship_model", "space_poster", "planet_globe", "star_map"),
    "dev": ("mech_keyboard", "code_poster", "rubber_duck", "second_monitor"),
    "research": ("book_stack", "documents", "magnifier", "notes_board"),
    "sysadmin": ("multi_monitor", "status_board", "cable_box", "server_mini"),
    "data": ("chart_poster", "second_monitor", "notes_board", "mug"),
    "writing": ("book_stack", "typewriter", "documents", "desk_lamp"),
    "design": ("drawing_tablet", "color_swatches", "art_poster", "plant_small"),
    "finance": ("calculator", "chart_poster", "documents", "photo_frame"),
    "support": ("headset_stand", "notes_board", "mug", "plant_small"),
}
ALL_ITEMS = tuple(sorted({i for v in DECOR_ITEMS.values() for i in v}))
ACCESSORIES = ("none", "glasses", "headset", "cap", "beanie", "earrings")

ItemLit = Literal[ALL_ITEMS]  # type: ignore[valid-type]


def _short_list(v: list[str], n: int, size: int) -> list[str]:
    out: list[str] = []
    for s in v or []:
        s = re.sub(r"\s+", " ", str(s)).strip()[:size]
        if s and s not in out:
            out.append(s)
    return out[:n]


class Personality(BaseModel):
    """Paramètres 0..1 utilisés uniquement par la simulation locale du bureau."""
    sociability: float = Field(0.5, ge=0, le=1)   # discute volontiers
    curiosity: float = Field(0.5, ge=0, le=1)     # bibliothèque, fenêtres, promenades
    energy: float = Field(0.5, ge=0, le=1)        # se déplace souvent
    focus: float = Field(0.5, ge=0, le=1)         # reste à son bureau
    coffee: float = Field(0.5, ge=0, le=1)        # pauses café


class Appearance(BaseModel):
    skin: int = Field(0, ge=0, le=5)
    hair: int = Field(0, ge=0, le=7)          # couleur
    hair_style: int = Field(0, ge=0, le=5)
    outfit: int = Field(0, ge=0, le=7)        # couleur de tenue
    accessory: Literal["none", "glasses", "headset", "cap", "beanie", "earrings"] = "none"


class Decor(BaseModel):
    theme: Literal["general", "security", "space", "dev", "research", "sysadmin", "data", "writing", "design", "finance", "support"] = "general"
    items: list[ItemLit] = Field(default_factory=list, max_length=6)  # type: ignore[valid-type]
    color: int = Field(0, ge=0, le=7)         # couleur d'accent du poste

    @field_validator("items")
    @classmethod
    def _uniq(cls, v):
        out = []
        for i in v:
            if i not in out:
                out.append(i)
        return out


class ProfileIn(BaseModel):
    display_name: str = Field(min_length=1, max_length=60)
    employee_id: str = Field(default="", max_length=20)
    title: str = Field(default="", max_length=80)
    hired_at: str = Field(default="", max_length=10)          # AAAA-MM-JJ
    office: str = Field(default="", max_length=12)
    bio: str = Field(default="", max_length=600)
    traits: list[str] = Field(default_factory=list, max_length=6)
    interests: list[str] = Field(default_factory=list, max_length=6)
    habits: list[str] = Field(default_factory=list, max_length=6)
    skills: list[str] = Field(default_factory=list, max_length=8)
    personality: Personality = Field(default_factory=Personality)
    appearance: Appearance = Field(default_factory=Appearance)
    decor: Decor = Field(default_factory=Decor)

    @field_validator("traits", "interests", "habits")
    @classmethod
    def _lists(cls, v):
        return _short_list(v, 6, 60)

    @field_validator("skills")
    @classmethod
    def _skills(cls, v):
        return _short_list(v, 8, 40)

    @field_validator("hired_at")
    @classmethod
    def _date(cls, v):
        v = (v or "").strip()
        if v and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            raise ValueError("date de recrutement invalide (AAAA-MM-JJ)")
        return v

    @field_validator("display_name", "employee_id", "title", "office", "bio")
    @classmethod
    def _txt(cls, v):
        return re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", v or "").strip()


class GenerateIn(BaseModel):
    force: bool = False  # régénérer une fiche déjà générée (toujours à la demande explicite de l'utilisateur)


# --- fiche par défaut (locale, déterministe) -----------------------------------------------------------------
def _h(s: str) -> int:
    h = 2166136261
    for ch in s:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


class _Rng:
    def __init__(self, seed: str):
        self.s = _h(seed) or 1

    def next(self) -> float:
        self.s ^= (self.s << 13) & 0xFFFFFFFF
        self.s ^= self.s >> 17
        self.s ^= (self.s << 5) & 0xFFFFFFFF
        self.s &= 0xFFFFFFFF
        return self.s / 0xFFFFFFFF

    def pick(self, seq):
        return seq[int(self.next() * len(seq)) % len(seq)]

    def sample(self, seq, k: int) -> list:
        pool, out = list(seq), []
        while pool and len(out) < k:
            out.append(pool.pop(int(self.next() * len(pool)) % len(pool)))
        return out


THEME_KEYWORDS = [
    ("space", r"star ?citizen|espace|spatial|vaisseau|astro|nasa|space|rsi\b|cosmo"),
    ("security", r"s[ée]curit|cyber|cve|vuln|soc\b|pentest|menace|threat|intrusion|firewall|pare-feu"),
    ("sysadmin", r"sysadmin|infra|serveur|server|proxmox|monitor|supervision|devops|linux|r[ée]seau|backup|sauvegarde"),
    ("dev", r"d[ée]velopp|code|program|github|git\b|python|javascript|typescript|refactor|test unitaire|pull request"),
    ("data", r"donn[ée]es|data|statisti|analyse|dashboard|sql|kpi|m[ée]trique"),
    ("research", r"veille|recherche|research|r[ée]sum|synth[èe]se|actualit|news|article|biblio|documentation"),
    ("writing", r"r[ée]daction|[ée]crire|blog|newsletter|article|traduction|contenu|copywriting"),
    ("design", r"design|graphi|maquette|ui\b|ux\b|logo|illustration"),
    ("finance", r"financ|compta|budget|factur|banque|bourse|d[ée]pense"),
    ("support", r"support|ticket|client|helpdesk|assistance|faq"),
]

TITLES = {
    "general": ["Chargé de mission", "Assistant polyvalent", "Coordinateur"],
    "security": ["Analyste cybersécurité", "Veilleur sécurité", "Analyste SOC"],
    "space": ["Analyste veille spatiale", "Chroniqueur de l'espace", "Veilleur Star Citizen"],
    "dev": ["Développeur", "Ingénieur logiciel", "Artisan du code"],
    "research": ["Chargé de veille", "Analyste recherche", "Documentaliste"],
    "sysadmin": ["Administrateur systèmes", "Ingénieur infrastructure", "Gardien des serveurs"],
    "data": ["Analyste de données", "Data analyste", "Statisticien"],
    "writing": ["Rédacteur", "Chargé de contenu", "Plume maison"],
    "design": ["Designer", "Graphiste", "Designer d'interfaces"],
    "finance": ["Analyste financier", "Contrôleur de gestion", "Gestionnaire budgétaire"],
    "support": ["Chargé de support", "Conseiller assistance", "Référent support"],
}
INTERESTS = {
    "general": ["les jeux de société", "la randonnée", "les podcasts", "la cuisine", "la photographie"],
    "security": ["les CTF", "la cryptographie", "les énigmes", "l'histoire des hackers", "les échecs"],
    "space": ["l'exploration spatiale", "les nouvelles technologies", "l'astronomie", "les maquettes de vaisseaux", "la science-fiction"],
    "dev": ["les claviers mécaniques", "l'open source", "les jeux rétro", "les casse-têtes", "la domotique"],
    "research": ["les livres rares", "les archives", "les documentaires", "les mots croisés", "l'histoire des sciences"],
    "sysadmin": ["le homelab", "les vieux serveurs", "l'électronique", "les tableaux de bord", "le café filtre"],
    "data": ["les graphiques bien faits", "les statistiques sportives", "les puzzles", "les cartes", "la musique électro"],
    "writing": ["la poésie", "les carnets", "les romans policiers", "le théâtre", "les langues anciennes"],
    "design": ["la typographie", "les expositions", "le dessin", "l'architecture", "les affiches"],
    "finance": ["les marchés", "les échecs", "le vin", "le golf", "les biographies"],
    "support": ["les jeux coopératifs", "le bénévolat", "la cuisine", "les séries", "le jardinage"],
}
SKILLS = {
    "general": ["Organisation", "Synthèse", "Rigueur"],
    "security": ["Analyse de vulnérabilités", "Veille CVE", "Réponse à incident", "Durcissement"],
    "space": ["Veille communautaire", "Synthèse de patch notes", "Suivi des annonces", "Recherche web"],
    "dev": ["Revue de code", "Tests", "Refactorisation", "Automatisation"],
    "research": ["Recherche documentaire", "Synthèse", "Vérification des sources", "Rédaction"],
    "sysadmin": ["Supervision", "Linux", "Sauvegardes", "Automatisation"],
    "data": ["Analyse", "SQL", "Visualisation", "Statistiques"],
    "writing": ["Rédaction", "Relecture", "Ton éditorial", "Traduction"],
    "design": ["Maquettes", "Identité visuelle", "Ergonomie", "Illustration"],
    "finance": ["Budget", "Reporting", "Rapprochements", "Prévisions"],
    "support": ["Diagnostic", "Pédagogie", "Suivi des tickets", "Documentation"],
}
TRAITS = ["méticuleux", "curieux", "calme", "enjoué", "méthodique", "bavard", "discret", "créatif", "patient", "énergique", "pragmatique", "rêveur"]
HABITS = ["longues pauses café", "arrive toujours le premier", "range son bureau chaque soir", "salue tout le monde",
          "lit près de la fenêtre", "prend ses notes à la main", "fait le tour des couloirs pour réfléchir",
          "garde une plante sur son bureau", "écoute de la musique en travaillant", "partage les nouvelles du jour"]
BIO = [
    "{name} a rejoint l'équipe {dept} avec un goût prononcé pour {i1}. {cap} et {t2}, on le croise souvent {habit_short}.",
    "Passionné par {i1} et {i2}, {name} est {t1} dans son travail. Au bureau, on le reconnaît à ses {habit_short2}.",
    "Chez {dept}, {name} est réputé {t1}. En dehors des missions, il parle volontiers de {i1}.",
]


def detect_theme(*texts: str) -> str:
    blob = " ".join(t or "" for t in texts).lower()
    for theme, pat in THEME_KEYWORDS:
        if re.search(pat, blob):
            return theme
    return "general"


def default_profile(agent: dict) -> dict:
    """Fiche décorative déterministe : même agent => même fiche. Sans IA, sans écriture."""
    r = _Rng(agent["id"])
    theme = detect_theme(agent.get("name", ""), agent.get("department", ""), agent.get("mission", ""), agent.get("description", ""))
    traits = r.sample(TRAITS, 3)
    interests = r.sample(INTERESTS[theme], 2) + r.sample(INTERESTS["general"], 1)
    habits = r.sample(HABITS, 2)
    created = (agent.get("created_at") or date.today().isoformat())[:10]
    name = agent.get("name") or "Agent"
    habit_short = {"longues pauses café": "près de la machine à café", "lit près de la fenêtre": "près de la fenêtre"}.get(habits[0], "dans les couloirs")
    bio = r.pick(BIO).format(name=name, dept=agent.get("department") or "RO·AI", i1=interests[0], i2=interests[1],
                             t1=traits[0], t2=traits[1], cap=traits[0].capitalize(), habit_short=habit_short,
                             habit_short2=habits[0] if habits[0].startswith("longues") else "habitudes : " + habits[0])
    soc = 0.25 + 0.6 * r.next()
    p = ProfileIn(
        display_name=name[:60], employee_id=f"RO-{_h(agent['id']) % 9000 + 1000}", title=r.pick(TITLES[theme]),
        hired_at=created, office="", bio=bio[:600], traits=traits, interests=interests, habits=habits,
        skills=r.sample(SKILLS[theme], 3),
        personality=Personality(sociability=round(soc, 2), curiosity=round(0.2 + 0.7 * r.next(), 2), energy=round(0.2 + 0.7 * r.next(), 2),
                                focus=round(0.3 + 0.6 * r.next(), 2), coffee=round(0.75 if "café" in " ".join(habits) else 0.2 + 0.6 * r.next(), 2)),
        appearance=Appearance(skin=int(r.next() * 6) % 6, hair=int(r.next() * 8) % 8, hair_style=int(r.next() * 6) % 6,
                              outfit=int(r.next() * 8) % 8, accessory=r.pick(ACCESSORIES)),
        decor=Decor(theme=theme, items=list(DECOR_ITEMS[theme][:3]), color=int(r.next() * 8) % 8),
    )
    return p.model_dump()


# --- génération IA (une seule fois, à la demande) ----------------------------------------------------------
def generation_prompt(agent: dict, theme: str) -> str:
    mission = re.sub(r"https?://\S+", "[lien]", (agent.get("mission") or ""))[:500]
    return (
        "Invente la fiche d'identité FICTIVE et décorative d'un employé de bureau virtuel qui représente un agent logiciel. "
        "Réponds UNIQUEMENT avec un objet JSON valide, en français, sans texte autour, avec exactement ces clés : "
        '{"title": str (fonction, 40 car. max), "bio": str (2 phrases naturelles, 280 car. max, cohérentes avec le rôle), '
        '"traits": [3 adjectifs], "interests": [3 centres d\'intérêt], "habits": [2 habitudes de bureau], "skills": [3 compétences], '
        '"personality": {"sociability": 0..1, "curiosity": 0..1, "energy": 0..1, "focus": 0..1, "coffee": 0..1}}. '
        "N'utilise aucun outil. Ne fais aucune recherche.\n\n"
        f"Nom : {agent.get('name', '')}\nDépartement : {agent.get('department', '')}\nThème : {theme}\nRôle (extrait) : {mission}"
    )


def merge_generated(base: dict, text: str) -> dict:
    """Extrait le premier objet JSON du texte et le fusionne dans la fiche de base. Lève ValueError si inexploitable."""
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        raise ValueError("réponse sans JSON")
    try:
        data: Any = json.loads(m.group(0))
    except json.JSONDecodeError as e:
        raise ValueError("JSON invalide") from e
    if not isinstance(data, dict):
        raise ValueError("JSON inattendu")
    out = dict(base)
    for k in ("title", "bio"):
        if isinstance(data.get(k), str) and data[k].strip():
            out[k] = data[k].strip()[: 80 if k == "title" else 600]
    for k in ("traits", "interests", "habits", "skills"):
        if isinstance(data.get(k), list):
            vals = [str(x) for x in data[k] if isinstance(x, (str, int, float))]
            if vals:
                out[k] = vals
    pers = data.get("personality")
    if isinstance(pers, dict):
        p = dict(out.get("personality") or {})
        for k in ("sociability", "curiosity", "energy", "focus", "coffee"):
            v = pers.get(k)
            if isinstance(v, (int, float)):
                p[k] = round(min(1.0, max(0.0, float(v))), 2)
        out["personality"] = p
    try:
        return ProfileIn(**out).model_dump()
    except ValidationError as e:
        raise ValueError("fiche générée invalide") from e

