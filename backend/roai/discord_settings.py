"""Réglages du bot Discord. Le jeton est un secret : stocké en 0600 par l'utilisateur agent, jamais renvoyé par l'API
(seulement « défini / non défini »), jamais journalisé (masqué par redact)."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, field_validator

ID_RE = re.compile(r"^\d{15,22}$")
TOKEN_RE = re.compile(r"^[A-Za-z0-9_\-.]{50,130}$")
WEBHOOK_RE = re.compile(r"^https://(?:discord|discordapp)\.com/api/webhooks/\d{15,22}/[A-Za-z0-9_\-]{20,120}$")
PERMISSIONS = 19456  # Voir le salon (1024) + Envoyer des messages (2048) + Intégrer des liens (16384) : rien de plus


class DiscordNotify(BaseModel):
    approvals: bool = True       # une exécution attend votre approbation (avec boutons)
    failures: bool = True        # une exécution échoue
    emergency: bool = True       # arrêt d'urgence / reprise
    auth: bool = True            # connexion d'un fournisseur perdue ou bientôt expirée
    limits: bool = True          # limite d'usage atteinte
    system_errors: bool = True   # erreur interne du noyau
    completions: bool = False    # une exécution se termine avec succès (bavard : désactivé par défaut)
    startup: bool = False        # le noyau (re)démarre


class DiscordCommands(BaseModel):
    read: bool = True      # /statut /agents /executions /approbations
    control: bool = True   # /stop /reprise
    approve: bool = True   # boutons Approuver / Rejeter
    run: bool = False      # /lancer (consomme du quota : désactivé par défaut)
    chat: bool = True      # /parler : conversation privée avec un agent


class DiscordSettings(BaseModel):
    enabled: bool = False
    owner_id: str = ""
    application_id: str = ""
    delivery: Literal["dm", "channel"] = "dm"
    channel_id: str = ""
    dashboard_url: str = Field(default_factory=lambda: os.environ.get("ROAI_PUBLIC_URL", "").rstrip("/"))  # adresse du Control Center (liens des messages)
    notify: DiscordNotify = Field(default_factory=DiscordNotify)
    commands: DiscordCommands = Field(default_factory=DiscordCommands)


class DiscordSettingsIn(BaseModel):
    """Mise à jour : les champs absents sont conservés. `token` n'est jamais renvoyé."""
    enabled: bool | None = None
    owner_id: str | None = None
    application_id: str | None = None
    delivery: Literal["dm", "channel"] | None = None
    channel_id: str | None = None
    dashboard_url: str | None = Field(default=None, max_length=200)
    notify: DiscordNotify | None = None
    commands: DiscordCommands | None = None
    token: str | None = Field(default=None, max_length=200)
    clear_token: bool = False
    webhook_url: str | None = Field(default=None, max_length=300)
    clear_webhook: bool = False

    @field_validator("owner_id", "application_id", "channel_id")
    @classmethod
    def _ids(cls, v):
        v = (v or "").strip() if v is not None else v
        if v and not ID_RE.match(v):
            raise ValueError("identifiant Discord invalide (15 à 22 chiffres, copié avec le mode développeur)")
        return v

    @field_validator("dashboard_url")
    @classmethod
    def _url(cls, v):
        if v is None:
            return v
        v = v.strip().rstrip("/")
        if v and not re.match(r"^https?://[A-Za-z0-9.\-]+(:\d{1,5})?$", v):
            raise ValueError("adresse invalide (ex. https://ro-ai.lan)")
        return v

    @field_validator("webhook_url")
    @classmethod
    def _webhook(cls, v):
        if v is None:
            return v
        v = v.strip()
        if v and not WEBHOOK_RE.match(v):
            raise ValueError("adresse de webhook invalide : elle doit commencer par https://discord.com/api/webhooks/")
        return v

    @field_validator("token")
    @classmethod
    def _token(cls, v):
        if v is None:
            return v
        v = v.strip()
        if v and not TOKEN_RE.match(v):
            raise ValueError("jeton de bot invalide : copiez le jeton complet depuis le portail développeur Discord")
        return v


class DiscordTestIn(BaseModel):
    target: Literal["bot", "webhook"] = "bot"


class DiscordStore:
    def __init__(self, config_dir: Path):
        self.path = config_dir / "discord.json"

    def load(self) -> tuple[DiscordSettings, str | None]:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            return DiscordSettings(**raw.get("settings", {})), (raw.get("token") or None)
        except (OSError, ValueError):
            return DiscordSettings(), None

    def webhook(self) -> str | None:
        try:
            return json.loads(self.path.read_text(encoding="utf-8")).get("webhook") or None
        except (OSError, ValueError):
            return None

    def save(self, s: DiscordSettings, token: str | None, webhook: str | None = None) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"settings": s.model_dump(), "token": token, "webhook": webhook}, f)
        os.replace(tmp, self.path)
        self.path.chmod(0o600)

    def update(self, patch: DiscordSettingsIn) -> tuple[DiscordSettings, str | None]:
        cur, token = self.load()
        webhook = self.webhook()
        data = cur.model_dump()
        for k in ("enabled", "owner_id", "application_id", "delivery", "channel_id", "dashboard_url"):
            v = getattr(patch, k)
            if v is not None:
                data[k] = v
        if patch.notify is not None:
            data["notify"] = patch.notify.model_dump()
        if patch.commands is not None:
            data["commands"] = patch.commands.model_dump()
        new = DiscordSettings(**data)
        if patch.clear_token:
            token = None
        elif patch.token:
            token = patch.token
        if patch.clear_webhook:
            webhook = None
        elif patch.webhook_url:
            webhook = patch.webhook_url
        if new.enabled and not (token and new.owner_id):
            raise ValueError("pour activer le bot, renseignez le jeton et votre identifiant utilisateur Discord")
        if new.delivery == "channel" and not new.channel_id:
            raise ValueError("le mode « salon » demande l'identifiant du salon")
        self.save(new, token, webhook)
        return new, token


def invite_url(s: DiscordSettings) -> str | None:
    if not s.application_id:
        return None
    return f"https://discord.com/oauth2/authorize?client_id={s.application_id}&scope=bot+applications.commands&permissions={PERMISSIONS}"


class AgentWebhookIn(BaseModel):
    webhook_url: str = Field(max_length=300)

    @field_validator("webhook_url")
    @classmethod
    def _wh(cls, v):
        v = v.strip()
        if not WEBHOOK_RE.match(v):
            raise ValueError("adresse de webhook invalide : elle doit commencer par https://discord.com/api/webhooks/")
        return v


class AgentWebhooks:
    """Webhooks par agent : secrets en 0600, jamais renvoyés par l'API."""

    def __init__(self, config_dir: Path):
        self.path = config_dir / "agent_webhooks.json"

    def _all(self) -> dict[str, str]:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def _save(self, d: dict[str, str]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(d, f)
        os.replace(tmp, self.path)
        self.path.chmod(0o600)

    def get(self, agent_id: str) -> str | None:
        return self._all().get(agent_id)

    def has(self, agent_id: str) -> bool:
        return bool(self.get(agent_id))

    def set(self, agent_id: str, url: str) -> None:
        d = self._all(); d[agent_id] = url; self._save(d)

    def delete(self, agent_id: str) -> None:
        d = self._all()
        if d.pop(agent_id, None) is not None:
            self._save(d)
