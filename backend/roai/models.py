"""Modèles d'entrée validés (pydantic). La validation est la première ligne de défense : le web ne fait que relayer."""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,40}$")
TOOL_RE = re.compile(r"^[A-Za-z0-9_:*().\- /,<>=\"'@]{1,200}$")
NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
DOMAIN_RE = re.compile(r"^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}(:\d{1,5})?$")


class McpServerIn(BaseModel):
    name: str
    command: str = Field(min_length=1, max_length=500)
    args: list[str] = Field(default_factory=list, max_length=40)
    env: dict[str, str] = Field(default_factory=dict)
    # Codex : les appels d'outils de ce serveur sont acceptés sans demande (à réserver aux passerelles en lecture seule)
    auto_approve: bool = False

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        if not NAME_RE.match(v):
            raise ValueError("nom de serveur MCP invalide (lettres, chiffres, - et _)")
        return v


class AgentConfigIn(BaseModel):
    allowed_tools: list[str] | None = Field(default=None, max_length=100)
    permission_mode: Literal["dontAsk", "acceptEdits", "plan"] | None = None
    sandbox: Literal["read-only", "workspace-write"] | None = None  # danger-full-access volontairement exclu
    max_runtime_s: int | None = Field(default=None, ge=30, le=7200)
    require_approval: bool | None = None
    network_domains: list[str] | None = Field(default=None, max_length=20)  # domaines joignables (sandbox actif)
    unrestricted: bool | None = None  # mode libre : sans sandbox ; approbation forcée côté serveur…
    autonomous: bool | None = None    # …sauf si le propriétaire choisit explicitement le mode libre autonome (sans approbation)
    discord_report: bool | None = None  # envoyer le résultat complet sur Discord à la fin d'une exécution réussie
    discord_brief: bool | None = None  # envoyer seulement le résumé que l'agent marque (bloc <<<DISCORD … DISCORD>>>)
    discord_public: bool | None = None  # salon public : ni lien interne, ni signature RO·AI ; titre = 1re ligne du rapport
    discord_style: Literal["embed", "text", "both"] | None = None  # format des rapports par webhook : embed (défaut), texte classique, les deux
    reasoning_effort: Literal["low", "medium", "high", "xhigh", "max", "ultra"] | None = None  # Codex : effort de raisonnement
    web_search: bool | None = None  # Codex : recherche web native (hébergée par OpenAI ; le shell reste sans réseau)
    lean: bool | None = None  # Claude : mode léger (outils autorisés seuls, mission à la place des consignes système de Claude Code)
    memory_file: str | None = Field(default=None, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")  # mode léger : fichier du dossier de l'agent joint aux consignes
    mcp_servers: list[McpServerIn] | None = Field(default=None, max_length=10)

    @field_validator("network_domains")
    @classmethod
    def _domains(cls, v):
        out = []
        for d in v or []:
            d = d.strip().lower()
            if not DOMAIN_RE.match(d):
                raise ValueError(f"domaine invalide : {d!r} (ex. discord.com, *.github.com, api.example.com:8443)")
            if d not in out:
                out.append(d)
        return out

    @field_validator("allowed_tools")
    @classmethod
    def _tools(cls, v):
        for t in v or []:
            if not TOOL_RE.match(t):
                raise ValueError(f"outil invalide : {t!r}")
        return v


class Avatar(BaseModel):
    sprite: int = Field(default=0, ge=0, le=5)


class AgentIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    slug: str | None = None
    description: str = Field(default="", max_length=500)
    provider: Literal["claude", "codex"]
    model: str | None = Field(default=None, max_length=80)
    mission: str = Field(default="", max_length=8000)
    default_prompt: str = Field(default="", max_length=8000)
    department: str = Field(default="Général", min_length=1, max_length=40)
    domain: Literal["perso", "pro"] | None = None
    avatar: Avatar = Field(default_factory=Avatar)
    enabled: bool = True
    config: AgentConfigIn = Field(default_factory=AgentConfigIn)

    @field_validator("slug")
    @classmethod
    def _slug(cls, v):
        if v is not None and not SLUG_RE.match(v):
            raise ValueError("slug invalide (a-z, 0-9, -, 2 à 41 caractères)")
        return v

    @field_validator("model")
    @classmethod
    def _model(cls, v):
        if v and not re.match(r"^[A-Za-z0-9_.:\-\[\]]{1,80}$", v):
            raise ValueError("nom de modèle invalide")
        return v


class ControlStopIn(BaseModel):
    reason: str | None = Field(default=None, max_length=300)


class RunIn(BaseModel):
    agent_id: str
    prompt: str = Field(min_length=1, max_length=20000)


class RunReplyIn(BaseModel):
    prompt: str = Field(min_length=1, max_length=20000)


class AgentRunIn(BaseModel):
    prompt: str | None = Field(default=None, max_length=20000)
    # origine : « chat » = premier message d'une conversation ouverte depuis la page Chat (salle de réunion du bureau)
    via: Literal["chat"] | None = None


class ScheduleIn(BaseModel):
    agent_id: str
    name: str = Field(min_length=1, max_length=80)
    cron: str = Field(min_length=9, max_length=100)
    timezone: str = "Europe/Paris"
    prompt: str = Field(default="", max_length=20000)
    enabled: bool = True


class InboxSourceIn(BaseModel):
    """Source de livraisons (outil externe) : agent destinataire, traitement automatique, consignes."""
    name: str = Field(min_length=2, max_length=40)
    agent_id: str | None = None
    auto_run: bool = True
    instructions: str = Field("", max_length=4000)
    enabled: bool = True
