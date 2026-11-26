"""Bot Discord privé : notifications et commandes réservées au propriétaire.
- Aucun message n'est lu : seuls les événements du noyau (sortie) et les interactions explicites (commandes slash, boutons) sont traités.
- Toute interaction d'un autre utilisateur que le propriétaire est refusée.
- Le jeton ne quitte jamais ce module (jamais renvoyé, jamais journalisé)."""
from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Any

from .config import Settings
from .db import Database, now_iso
from .discord_notify import Dedupe, Notification, PROVIDER_NAME, LOGIN_CMD, _embed, batch, build, public_title, report_embeds, report_texts, summary_embed
from .discord_settings import AgentWebhooks, DiscordSettings, DiscordSettingsIn, DiscordStore, invite_url
from .events import EventJournal
from .redact import redact_text
from .worker import PausedError

import httpx

try:  # la bibliothèque est un paquet Debian ; son absence ne doit pas empêcher le noyau de démarrer
    import discord
    from discord import app_commands
except Exception:  # noqa: BLE001
    discord = None  # type: ignore[assignment]
    app_commands = None  # type: ignore[assignment]

STATE_LABEL = {"idle": "Au repos", "working": "Au travail", "waiting": "En attente", "error": "En erreur", "disabled": "Désactivé"}
STATUS_LABEL = {"queued": "en file", "awaiting_approval": "attend une approbation", "running": "en cours", "succeeded": "réussie",
                "failed": "échec", "cancelled": "annulée"}


def to_embed(d: dict[str, Any]):
    e = discord.Embed(title=d["title"], description=d.get("description") or None, color=d["color"], url=d.get("url") or None)
    for name, value, inline in d.get("fields", []):
        e.add_field(name=name, value=value, inline=inline)
    if d.get("timestamp"):
        try:
            e.timestamp = datetime.fromisoformat(d["timestamp"].replace("Z", "+00:00"))
        except ValueError:
            pass
    e.set_footer(text=d.get("footer") or "RO·AI")
    return e


class DiscordService:
    def __init__(self, s: Settings, db: Database, journal: EventJournal, worker, status, scheduler):
        self.s, self.db, self.journal, self.worker, self.status, self.scheduler = s, db, journal, worker, status, scheduler
        self.store = DiscordStore(s.config_dir)
        self.cfg, self._token = self.store.load()
        self._webhook = self.store.webhook()
        self.agent_hooks = AgentWebhooks(s.config_dir)
        self._wh_error: str | None = None
        self._wh_last_sent: str | None = None
        self._http_factory = lambda: httpx.AsyncClient(timeout=httpx.Timeout(15.0), follow_redirects=False)
        self._client = None
        self._runner: asyncio.Task | None = None
        self._bg: list[asyncio.Task] = []
        self._queue: asyncio.Queue[Notification] = asyncio.Queue(maxsize=200)
        self._ready = asyncio.Event()
        self._error: str | None = None
        self._bot_user: str | None = None
        self._last_sent: str | None = None
        self._dedupe = Dedupe(300.0)
        self._pending_stop: dict[str, str | None] = {}
        self._denied_at = 0.0

    # ------------------------------------------------------------------ état public
    def state(self) -> str:
        if not self.cfg.enabled:
            return "disabled"
        if not (self._token and self.cfg.owner_id):
            return "incomplete"
        if self._ready.is_set():
            return "connected"
        return "error" if self._error else "connecting"

    def public(self) -> dict:
        return {**self.cfg.model_dump(), "token_set": bool(self._token), "webhook_set": bool(self._webhook),
                "status": {"state": self.state(), "bot_user": self._bot_user if self._ready.is_set() else None,
                           "last_sent_at": self._last_sent, "last_error": self._error,
                           "webhook": {"last_sent_at": self._wh_last_sent, "last_error": self._wh_error}},
                "invite_url": invite_url(self.cfg)}

    def is_owner(self, user_id: int) -> bool:
        return bool(self.cfg.owner_id) and str(user_id) == self.cfg.owner_id

    # ------------------------------------------------------------------ cycle de vie
    async def start(self) -> None:
        self._bg = [asyncio.create_task(self._consume_events()), asyncio.create_task(self._sender()), asyncio.create_task(self._expiry_watcher())]
        await self._apply()

    async def stop(self) -> None:
        for t in self._bg:
            t.cancel()
        await self._stop_client()

    async def update(self, patch: DiscordSettingsIn) -> dict:
        self.cfg, self._token = self.store.update(patch)
        self._webhook = self.store.webhook()
        self._wh_error = None
        await self._apply()
        return self.public()

    async def _stop_client(self) -> None:
        self._ready.clear()
        if self._runner:
            self._runner.cancel()
            self._runner = None
        if self._client is not None:
            try:
                await self._client.close()
            except Exception:  # noqa: BLE001
                pass
            self._client = None
        self._bot_user = None

    async def _apply(self) -> None:
        await self._stop_client()
        self._error = None
        if discord is None:
            if self.cfg.enabled:
                self._error = "Bibliothèque Discord absente sur le serveur (paquet python3-discord)."
            return
        if self.cfg.enabled and self._token and self.cfg.owner_id:
            self._runner = asyncio.create_task(self._run_client())

    # ------------------------------------------------------------------ connexion Discord
    def _make_client(self):
        svc = self
        client = discord.Client(intents=discord.Intents.none())

        class OwnerTree(app_commands.CommandTree):
            async def interaction_check(self, interaction) -> bool:  # type: ignore[override]
                if svc.is_owner(interaction.user.id):
                    return True
                svc._note_denied(interaction.user.id)
                try:
                    await interaction.response.send_message("Ce bot est privé.", ephemeral=True)
                except Exception:  # noqa: BLE001
                    pass
                return False

            async def on_error(self, interaction, error) -> None:  # type: ignore[override]
                svc.journal.emit("system.notice", payload={"level": "warn", "message": f"Commande Discord en erreur : {type(error).__name__}"})
                try:
                    if interaction.response.is_done():
                        await interaction.followup.send("Une erreur interne est survenue.", ephemeral=True)
                    else:
                        await interaction.response.send_message("Une erreur interne est survenue.", ephemeral=True)
                except Exception:  # noqa: BLE001
                    pass

        tree = OwnerTree(client)
        self._register_commands(tree)

        @client.event
        async def on_ready() -> None:
            self._bot_user = str(client.user)
            self._error = None
            try:
                await tree.sync()
            except Exception as e:  # noqa: BLE001
                self._error = f"Synchronisation des commandes impossible : {type(e).__name__}"
            self._ready.set()
            self.journal.emit("system.notice", payload={"level": "info", "message": f"Bot Discord connecté en tant que {self._bot_user}."})

        @client.event
        async def on_disconnect() -> None:
            self._ready.clear()

        @client.event
        async def on_interaction(interaction) -> None:
            if interaction.type == discord.InteractionType.component:
                await self._on_component(interaction)

        client.ro_tree = tree  # type: ignore[attr-defined]
        return client

    async def _run_client(self) -> None:
        delay = 20.0
        while True:
            self._client = client = self._make_client()
            try:
                await client.start(self._token, reconnect=True)
                return
            except asyncio.CancelledError:
                raise
            except discord.LoginFailure:
                self._error = "Jeton refusé par Discord : vérifiez-le dans les paramètres."
                self.journal.emit("system.notice", payload={"level": "warn", "message": "Bot Discord : jeton refusé."})
                return
            except Exception as e:  # noqa: BLE001
                self._ready.clear()
                self._error = f"Connexion à Discord impossible ({type(e).__name__}) : nouvelle tentative automatique."
                try:
                    await client.close()
                except Exception:  # noqa: BLE001
                    pass
                await asyncio.sleep(delay)
                delay = min(delay * 2, 300.0)

    def _note_denied(self, user_id: int) -> None:
        if time.monotonic() - self._denied_at > 3600:
            self._denied_at = time.monotonic()
            self.journal.emit("system.notice", payload={"level": "warn", "message": f"Bot Discord : interaction refusée (utilisateur {user_id} n'est pas le propriétaire)."})

    # ------------------------------------------------------------------ notifications sortantes
    def _agent_name(self, aid: str | None) -> str:
        r = self.db.one("SELECT name FROM agents WHERE id=?", (aid,)) if aid else None
        return r["name"] if r else "(agent supprimé)"

    def _run_provider(self, rid: str | None) -> str | None:
        r = self.db.one("SELECT provider FROM runs WHERE id=?", (rid,)) if rid else None
        return r["provider"] if r else None

    async def _consume_events(self) -> None:
        async for ev in self.journal.stream(since=self.journal.last_seq()):
            if ev is None:
                continue
            if ev["type"] == "run.succeeded":
                self._maybe_report(ev)
            elif ev["type"] == "discord.brief":
                self._maybe_brief(ev)
            if not self.cfg.enabled:
                continue
            if ev["type"] in ("run.succeeded", "run.failed"):
                self._maybe_chat(ev)
            try:
                n = build(ev, self.cfg, self._agent_name, self._run_provider)
                if n and self._dedupe.fresh(n.key):
                    self._enqueue(n)
            except Exception:  # noqa: BLE001
                pass

    def _report_notification(self, cfg: dict, title: str, text: str, url: str | None, ts: str | None, key: str, agent_id: str | None,
                             footer_extra: str = "") -> Notification:
        """Rapport selon le format choisi dans la fiche agent : embed (défaut), classique (texte) ou les deux."""
        style, public = cfg.get("discord_style") or "embed", bool(cfg.get("discord_public"))
        if public:  # salon public : titre écrit par l'agent (1re ligne), ni lien interne ni signature RO·AI
            title, text = public_title(text, title)
            url, footer_extra = None, ""
        embeds = report_embeds(title, text, url, ts)
        if footer_extra:
            embeds[-1]["footer"] = (embeds[-1].get("footer") or "RO·AI") + footer_extra
        if public:
            for e in embeds:
                e["footer"] = ""
        texts = report_texts(title, text, url) if style in ("text", "both") else None
        return Notification("reports", embeds[0], key=key, report=embeds, texts=texts, embeds_on_webhook=style != "text",
                            webhook=self.agent_hooks.get(agent_id or ""), public=public)

    def _maybe_report(self, ev: dict) -> None:
        """Rapport complet vers Discord si l'agent l'a demandé (option « Envoyer le rapport sur Discord »)."""
        try:
            row = self.db.one("SELECT name, config_json FROM agents WHERE id=?", (ev.get("agent_id"),))
            cfg = json.loads(row["config_json"] or "{}") if row else {}
            if not row or not cfg.get("discord_report"):
                return
            run = self.db.one("SELECT result_text, trigger, notify_target FROM runs WHERE id=?", (ev.get("run_id"),))
            # conversations avec l'utilisateur (Chat, /parler) : jamais publiées dans le salon des rapports
            if run and (run["trigger"] == "reply" or run["notify_target"] in ("chat", "discord")):
                return
            text = (run["result_text"] if run else None) or (ev.get("payload") or {}).get("result_preview") or ""
            base = self.cfg.dashboard_url
            self._enqueue(self._report_notification(cfg, f"Rapport : {row['name']}", text, f"{base}/runs/{ev['run_id']}" if base else None,
                                                    ev.get("ts"), f"rep:{ev['run_id']}", ev.get("agent_id")))
        except Exception:  # noqa: BLE001
            pass

    def _maybe_brief(self, ev: dict) -> None:
        """Résumé marqué par l'agent (option « Résumé Discord ») : envoyé seul, avec le lien vers le rapport complet."""
        try:
            row = self.db.one("SELECT name, config_json FROM agents WHERE id=?", (ev.get("agent_id"),))
            cfg = json.loads(row["config_json"] or "{}") if row else {}
            if not row or not cfg.get("discord_brief"):
                return
            text = str((ev.get("payload") or {}).get("text") or "").strip()
            if not text:
                return
            base = self.cfg.dashboard_url
            self._enqueue(self._report_notification(cfg, row["name"], text, f"{base}/runs/{ev['run_id']}" if base and ev.get("run_id") else None,
                                                    ev.get("ts"), f"brief:{ev.get('run_id') or ev.get('seq')}", ev.get("agent_id"),
                                                    " · rapport complet dans RO·AI"))
        except Exception:  # noqa: BLE001
            pass

    def _maybe_chat(self, ev: dict) -> None:
        """Réponse d'une conversation lancée depuis Discord (/parler) : renvoyée en privé par le bot."""
        try:
            run = self.db.one("SELECT r.result_text, r.error_class, r.error_message, r.notify_target, a.name FROM runs r "
                              "LEFT JOIN agents a ON a.id=r.agent_id WHERE r.id=?", (ev.get("run_id"),))
            if not run or run["notify_target"] != "discord":
                return
            name = run["name"] or "(agent supprimé)"
            base = self.cfg.dashboard_url
            url = f"{base}/runs/{ev['run_id']}" if base else None
            if ev["type"] == "run.succeeded":
                embeds = report_embeds(f"Réponse de {name}", run["result_text"] or "(réponse vide)", url, ev.get("ts"))
                embeds[-1]["footer"] = (embeds[-1].get("footer") or "RO·AI") + " · /parler pour continuer"
            else:
                from .discord_notify import ERROR_LABEL
                embeds = [_embed(f"{name} n'a pas pu répondre", "err", run["error_message"] or "",
                                 [("Cause", ERROR_LABEL.get(run["error_class"] or "failed", "Échec"), True)], url=url, ts=ev.get("ts"))]
            self._enqueue(Notification("chat", embeds[0], key=f"chat:{ev['run_id']}", report=embeds))
        except Exception:  # noqa: BLE001
            pass

    def _enqueue(self, n: Notification) -> None:
        try:
            self._queue.put_nowait(n)
        except asyncio.QueueFull:
            try:
                self._queue.get_nowait()
                self._queue.put_nowait(n)
            except Exception:  # noqa: BLE001
                pass

    async def _sender(self) -> None:
        while True:
            first = await self._queue.get()
            await asyncio.sleep(2.0)  # fenêtre de regroupement
            items = [first]
            while not self._queue.empty():
                items.append(self._queue.get_nowait())
            for r in [i for i in items if i.report is not None]:  # les rapports partent tels quels, jamais résumés
                await self._deliver_report(r)
            items = [i for i in items if i.report is None]
            if not items:
                continue
            send, extra = batch(items)
            try:
                await asyncio.wait_for(self._ready.wait(), 600)
            except asyncio.TimeoutError:
                continue  # Discord injoignable depuis trop longtemps : on abandonne ce lot
            for n in send:
                await self._deliver(n)
            if extra:
                await self._deliver(Notification("system_errors", summary_embed(extra, self.cfg.dashboard_url)))

    async def _target(self):
        owner = int(self.cfg.owner_id)
        if self.cfg.delivery == "channel" and self.cfg.channel_id:
            return await self._client.fetch_channel(int(self.cfg.channel_id))
        return await self._client.fetch_user(owner)

    def _approval_view(self, run_id: str):
        view = discord.ui.View(timeout=None)

        async def noop(interaction) -> None:  # le traitement réel est dans _on_component
            return None

        for label, style, suffix in (("Approuver", discord.ButtonStyle.success, "ok"), ("Rejeter", discord.ButtonStyle.danger, "no")):
            b = discord.ui.Button(label=label, style=style, custom_id=f"roai:ap:{run_id}:{suffix}")
            b.callback = noop  # type: ignore[assignment]
            view.add_item(b)
        return view

    async def _deliver(self, n: Notification) -> dict:
        try:
            target = await self._target()
            content = f"<@{self.cfg.owner_id}>" if (n.mention and self.cfg.delivery == "channel") else None
            mentions = discord.AllowedMentions(users=[discord.Object(int(self.cfg.owner_id))]) if content else discord.AllowedMentions.none()
            await target.send(content=content, embed=to_embed(n.embed), view=self._approval_view(n.run_id) if n.run_id else discord.utils.MISSING,
                              allowed_mentions=mentions)
            self._last_sent = now_iso()
            return {"ok": True, "error": None}
        except discord.Forbidden:
            msg = ("Discord refuse l'envoi : invitez le bot sur un serveur que vous partagez avec lui et autorisez les messages privés "
                   "des membres de ce serveur (ou utilisez le mode salon).")
        except Exception as e:  # noqa: BLE001
            msg = f"Envoi impossible ({type(e).__name__})."
        self._error = msg
        return {"ok": False, "error": msg}

    @staticmethod
    def _webhook_payload(e: dict[str, Any], public: bool = False) -> dict[str, Any]:
        emb: dict[str, Any] = {"description": e.get("description") or "\u200b", "color": e["color"]}
        if e.get("footer") or not public:
            emb["footer"] = {"text": e.get("footer") or "RO·AI"}
        if e.get("title"):
            emb["title"] = e["title"]
        if e.get("url"):
            emb["url"] = e["url"]
        if e.get("timestamp"):
            emb["timestamp"] = e["timestamp"]
        if e.get("fields"):
            emb["fields"] = [{"name": n, "value": v, "inline": i} for n, v, i in e["fields"]]
        # salon public : le nom et l'avatar du webhook (réglés dans Discord) restent ceux du salon
        return {"embeds": [emb], "allowed_mentions": {"parse": []}} if public else {"username": "RO·AI", "embeds": [emb], "allowed_mentions": {"parse": []}}

    async def _post_webhook(self, embeds: list[dict[str, Any]], url: str | None = None, payloads: list[dict[str, Any]] | None = None,
                            public: bool = False) -> dict:
        """Envoie les embeds un à un (limite Discord : 6 000 caractères par message), avec une reprise en cas de 429 ;
        `payloads` : messages déjà formés (texte classique) envoyés à la place des embeds."""
        target = url or self._webhook
        if not target:
            return {"ok": False, "error": "Aucun webhook enregistré."}
        try:
            async with self._http_factory() as http:
                for body in (payloads if payloads is not None else [self._webhook_payload(e, public) for e in embeds]):
                    for attempt in range(2):
                        r = await http.post(target, json=body)
                        if r.status_code == 429 and attempt == 0:
                            try:
                                wait = float(r.json().get("retry_after", 2))
                            except Exception:  # noqa: BLE001
                                wait = 2.0
                            await asyncio.sleep(min(wait, 10.0))
                            continue
                        break
                    if r.status_code not in (200, 204):
                        msg = ("Webhook invalide ou supprimé : générez-en un nouveau dans Discord (Intégrations > Webhooks)." if r.status_code in (401, 403, 404)
                               else f"Discord a répondu {r.status_code} : le message n'a pas été envoyé.")
                        if not url:
                            self._wh_error = msg
                        return {"ok": False, "error": msg}
                    await asyncio.sleep(0.6)
            if url:
                return {"ok": True, "error": None}
            self._wh_last_sent, self._wh_error = now_iso(), None
            return {"ok": True, "error": None}
        except Exception as e:  # noqa: BLE001
            msg = f"Envoi par webhook impossible ({type(e).__name__})."
            self._wh_error = msg
            return {"ok": False, "error": msg}

    async def _deliver_report(self, n: Notification) -> None:
        """Webhook en priorité (aucun bot requis) ; à défaut, le bot si connecté."""
        embeds = n.report or [n.embed]
        if n.category == "chat":  # conversation privée : uniquement par le bot, jamais par le webhook d'un salon
            try:
                await asyncio.wait_for(self._ready.wait(), 600)
            except asyncio.TimeoutError:
                return
            for e in embeds:
                await self._deliver(Notification("chat", e))
            return
        if n.webhook or self._webhook:
            r = {"ok": True, "error": None}
            if n.embeds_on_webhook:
                r = await self._post_webhook(embeds, n.webhook, public=n.public)
            if r["ok"] and n.texts:
                who = {} if n.public else {"username": "RO·AI"}
                r = await self._post_webhook([], n.webhook, payloads=[{**who, "content": t, "allowed_mentions": {"parse": []}} for t in n.texts])
            if not r["ok"]:
                self.journal.emit("system.notice", payload={"level": "warn", "message": f"Rapport Discord non envoyé ({'webhook de l’agent' if n.webhook else 'webhook global'}) : {r['error']}"})
        elif self.state() == "connected":
            for e in embeds:
                await self._deliver(Notification("reports", e))
        else:
            self._wh_error = "Rapport non envoyé : configurez un webhook ou activez le bot dans Paramètres > Discord."

    async def test_agent_webhook(self, agent_id: str, name: str) -> dict:
        url = self.agent_hooks.get(agent_id)
        if not url:
            return {"ok": False, "error": "Aucun webhook enregistré pour cet agent."}
        return await self._post_webhook([_embed(f"Test RO·AI : {name}", "info", "Ce webhook recevra les rapports de cet agent.", url=self.cfg.dashboard_url or None)], url)

    async def send_test(self, target: str = "bot") -> dict:
        if target == "webhook":
            return await self._post_webhook([_embed("Test RO·AI", "info", "Le webhook est bien relié à RO·AI : les rapports d'agents arriveront ici.", url=self.cfg.dashboard_url or None)])
        if self.state() != "connected":
            return {"ok": False, "error": "Le bot n'est pas connecté : enregistrez les paramètres, activez-le et attendez l'état « connecté »."}
        r = await self._deliver(Notification("test", _embed("Test RO·AI", "info", "Le bot est bien relié à RO·AI. Vous recevrez ici les notifications que vous avez choisies.",
                                                              url=self.cfg.dashboard_url or None)))
        if r["ok"]:
            self._error = None
        return r

    async def _expiry_watcher(self) -> None:
        await asyncio.sleep(90)
        while True:
            try:
                if self.cfg.enabled and self.cfg.notify.auth:
                    for p in await self.status.all(max_age_s=3600):
                        exp = (p.get("auth") or {}).get("expires_at")
                        if p["auth"]["state"] != "logged_in" or not exp:
                            continue
                        left = datetime.fromisoformat(exp.replace("Z", "+00:00")) - datetime.now(timezone.utc)
                        days = left.days
                        if days <= 7:
                            name = PROVIDER_NAME.get(p["id"], p["id"])
                            key = f"exp:{p['id']}:{datetime.now().date().isoformat()}"
                            if self._dedupe.fresh(key):
                                when = "demain" if days <= 1 else f"dans {days} jours"
                                self._enqueue(Notification("auth", _embed(f"La connexion {name} expire {when}", "warn",
                                                                          f"Renouvelez-la sur le serveur : `{LOGIN_CMD.get(p['id'], 'roai-login')}`", url=self.cfg.dashboard_url or None),
                                                           key=key, mention=True))
            except Exception:  # noqa: BLE001
                pass
            await asyncio.sleep(3600)

    # ------------------------------------------------------------------ commandes
    def _allowed(self, group: str) -> bool:
        return bool(getattr(self.cfg.commands, group))

    async def _deny_disabled(self, interaction) -> None:
        await interaction.response.send_message("Cette commande est désactivée dans les paramètres de RO·AI.", ephemeral=True)

    def _register_commands(self, tree) -> None:
        from .core_api import agent_out  # import tardif : évite une dépendance circulaire

        svc = self

        @tree.command(name="statut", description="État de RO·AI : arrêt d'urgence, file, fournisseurs, prochaine planification")
        async def statut(interaction) -> None:
            if not svc._allowed("read"):
                return await svc._deny_disabled(interaction)
            await interaction.response.defer(ephemeral=True)
            await interaction.followup.send(embed=to_embed(await svc.embed_status()), ephemeral=True)

        @tree.command(name="agents", description="Liste des agents et de leur état")
        async def agents(interaction) -> None:
            if not svc._allowed("read"):
                return await svc._deny_disabled(interaction)
            rows = [agent_out(r) for r in svc.db.all("SELECT * FROM agents ORDER BY department, name")]
            lines = [f"**{a['name']}** ({a['department']}, {a['domain']}) : {STATE_LABEL.get(a['state'], a['state'])}" for a in rows[:30]]
            await interaction.response.send_message(embed=to_embed(_embed(f"Agents ({len(rows)})", "info", "\n".join(lines) or "Aucun agent.")), ephemeral=True)

        @tree.command(name="executions", description="Dernières exécutions")
        @app_commands.describe(nombre="Combien (1 à 10, 5 par défaut)")
        async def executions(interaction, nombre: app_commands.Range[int, 1, 10] = 5) -> None:
            if not svc._allowed("read"):
                return await svc._deny_disabled(interaction)
            await interaction.response.send_message(embed=to_embed(svc.embed_runs(nombre)), ephemeral=True)

        @tree.command(name="approbations", description="Exécutions en attente de votre approbation")
        async def approbations(interaction) -> None:
            if not svc._allowed("read"):
                return await svc._deny_disabled(interaction)
            rows = svc.db.all("SELECT r.id, r.prompt, a.name FROM runs r LEFT JOIN agents a ON a.id=r.agent_id WHERE r.status='awaiting_approval' ORDER BY r.created_at LIMIT 5")
            if not rows:
                return await interaction.response.send_message("Aucune approbation en attente.", ephemeral=True)
            for i, r in enumerate(rows):
                kw = dict(embed=to_embed(_embed(f"Approbation : {r['name'] or '(agent supprimé)'}", "warn", redact_text(r["prompt"], 400))), ephemeral=True)
                if svc._allowed("approve"):
                    kw["view"] = svc._approval_view(r["id"])
                if i == 0:
                    await interaction.response.send_message(**kw)
                else:
                    await interaction.followup.send(**kw)

        @tree.command(name="stop", description="ARRÊT D'URGENCE : annule tout et bloque les lancements (confirmation demandée)")
        @app_commands.describe(motif="Motif (facultatif)")
        async def stop(interaction, motif: str | None = None) -> None:
            if not svc._allowed("control"):
                return await svc._deny_disabled(interaction)
            nonce = f"{int(time.time() * 1000):x}"
            svc._pending_stop[nonce] = (motif or "")[:200] or None
            view = discord.ui.View(timeout=300)

            async def noop(i) -> None:
                return None

            for label, style, cid in (("Confirmer l'arrêt d'urgence", discord.ButtonStyle.danger, f"roai:stop:{nonce}"), ("Annuler", discord.ButtonStyle.secondary, "roai:cancel")):
                b = discord.ui.Button(label=label, style=style, custom_id=cid)
                b.callback = noop  # type: ignore[assignment]
                view.add_item(b)
            await interaction.response.send_message(embed=to_embed(_embed("Confirmer l'arrêt d'urgence ?", "err",
                                                    "Annule les exécutions en cours, en file et en attente d'approbation, suspend les planifications et bloque les lancements jusqu'à la reprise.")),
                                                    view=view, ephemeral=True)

        @tree.command(name="reprise", description="Lève l'arrêt d'urgence")
        async def reprise(interaction) -> None:
            if not svc._allowed("control"):
                return await svc._deny_disabled(interaction)
            was = svc.worker.is_paused()
            svc.worker.resume()
            if was:
                svc.scheduler.reschedule_all()
            await interaction.response.send_message("Reprise effectuée." if was else "Aucun arrêt d'urgence n'était actif.", ephemeral=True)

        @tree.command(name="lancer", description="Lance un agent (désactivé par défaut dans les paramètres)")
        @app_commands.describe(agent="Agent à lancer", prompt="Consigne (sinon le prompt par défaut de l'agent)")
        async def lancer(interaction, agent: str, prompt: str | None = None) -> None:
            if not svc._allowed("run"):
                return await svc._deny_disabled(interaction)
            row = svc.db.one("SELECT * FROM agents WHERE id=?", (agent,))
            if not row:
                return await interaction.response.send_message("Agent introuvable : choisissez-le dans la liste proposée.", ephemeral=True)
            if not row["enabled"]:
                return await interaction.response.send_message("Cet agent est désactivé.", ephemeral=True)
            text = (prompt or row["default_prompt"] or "").strip()
            if not text:
                return await interaction.response.send_message("Aucune consigne fournie et l'agent n'a pas de prompt par défaut.", ephemeral=True)
            try:
                run = svc.worker.create_run(row, text[:1000], "api")
            except PausedError as e:
                return await interaction.response.send_message(str(e), ephemeral=True)
            note = "Elle attend votre approbation." if run["status"] == "awaiting_approval" else "Elle est en file."
            await interaction.response.send_message(embed=to_embed(_embed(f"Lancement : {row['name']}", "info", f"Exécution `{run['id']}` créée. {note}",
                                                                          url=f"{svc.cfg.dashboard_url}/runs/{run['id']}" if svc.cfg.dashboard_url else None)), ephemeral=True)

        @tree.command(name="parler", description="Parle à un agent : il garde le contexte de la conversation")
        @app_commands.describe(agent="Agent", message="Votre message", nouvelle="Démarrer une nouvelle conversation au lieu de continuer la dernière")
        async def parler(interaction, agent: str, message: str, nouvelle: bool = False) -> None:
            if not svc._allowed("chat"):
                return await svc._deny_disabled(interaction)
            row = svc.db.one("SELECT * FROM agents WHERE id=?", (agent,))
            if not row:
                return await interaction.response.send_message("Agent introuvable : choisissez-le dans la liste proposée.", ephemeral=True)
            if not row["enabled"]:
                return await interaction.response.send_message("Cet agent est désactivé.", ephemeral=True)
            last = None if nouvelle else svc.db.one("SELECT * FROM runs WHERE agent_id=? AND session_id IS NOT NULL ORDER BY created_at DESC, rowid DESC LIMIT 1", (agent,))
            try:
                if last:
                    conv = last["conversation_id"] or last["id"]
                    if svc.db.one("SELECT 1 FROM runs WHERE (conversation_id=? OR id=?) AND status IN ('queued','awaiting_approval','running') LIMIT 1", (conv, conv)):
                        return await interaction.response.send_message("La réponse précédente n'est pas encore terminée.", ephemeral=True)
                    svc.db.execute("UPDATE runs SET conversation_id=? WHERE id=? AND conversation_id IS NULL", (conv, last["id"]))
                    svc.worker.create_run(row, message[:4000], "reply", parent_run_id=last["id"], conversation_id=conv, notify_target="discord")
                    how = "suite de la dernière conversation"
                else:
                    svc.worker.create_run(row, message[:4000], "api", notify_target="discord")
                    how = "nouvelle conversation"
            except PausedError as e:
                return await interaction.response.send_message(str(e), ephemeral=True)
            await interaction.response.send_message(f"Message transmis à **{row['name']}** ({how}). La réponse arrivera ici dès qu'elle sera prête.", ephemeral=True)

        @parler.autocomplete("agent")
        async def parler_ac(interaction, current: str):
            rows = svc.db.all("SELECT id, name FROM agents WHERE enabled=1 AND name LIKE ? ORDER BY name LIMIT 25", (f"%{current}%",))
            return [app_commands.Choice(name=r["name"][:100], value=r["id"]) for r in rows]

        @lancer.autocomplete("agent")
        async def lancer_ac(interaction, current: str):
            rows = svc.db.all("SELECT id, name FROM agents WHERE enabled=1 AND name LIKE ? ORDER BY name LIMIT 25", (f"%{current}%",))
            return [app_commands.Choice(name=r["name"][:100], value=r["id"]) for r in rows]

    # ------------------------------------------------------------------ boutons
    async def _on_component(self, interaction) -> None:
        cid = (interaction.data or {}).get("custom_id", "")
        if not cid.startswith("roai:"):
            return
        try:
            if not self.is_owner(interaction.user.id):
                self._note_denied(interaction.user.id)
                return await interaction.response.send_message("Ce bot est privé.", ephemeral=True)
            parts = cid.split(":")
            if parts[1] == "ap" and len(parts) == 4:
                if not self._allowed("approve"):
                    return await self._deny_disabled(interaction)
                run_id, verdict = parts[2], parts[3]
                try:
                    done = self.worker.approve(run_id) if verdict == "ok" else self.worker.reject(run_id)
                except PausedError as e:
                    return await interaction.response.send_message(str(e), ephemeral=True)
                text = ("Exécution approuvée." if verdict == "ok" else "Exécution rejetée.") if done else "Cette exécution n'attend plus d'approbation."
                return await interaction.response.edit_message(content=text, embed=None, view=None)
            if parts[1] == "stop" and len(parts) == 3:
                if not self._allowed("control"):
                    return await self._deny_disabled(interaction)
                reason = self._pending_stop.pop(parts[2], None)
                await interaction.response.edit_message(content="Arrêt d'urgence en cours…", embed=None, view=None)
                c = await self.worker.emergency_stop(reason or "demandé depuis Discord")
                return await interaction.followup.send(f"Arrêt d'urgence actif : {c['cancelled']} exécution(s) annulée(s). `/reprise` pour reprendre.", ephemeral=True)
            if parts[1] == "cancel":
                return await interaction.response.edit_message(content="Annulé.", embed=None, view=None)
        except Exception as e:  # noqa: BLE001
            self.journal.emit("system.notice", payload={"level": "warn", "message": f"Bouton Discord en erreur : {type(e).__name__}"})

    # ------------------------------------------------------------------ contenus des commandes
    async def embed_status(self) -> dict:
        c = self.worker.control()
        fields: list[tuple[str, str, bool]] = [
            ("Fonctionnement", "ARRÊT D'URGENCE ACTIF" + (f" ({c['reason']})" if c.get("reason") else "") if c["paused"] else "Normal", False),
            ("En cours", str(self.worker.running_count), True), ("En file", str(self.worker.queue_depth()), True)]
        lines = []
        for p in await self.status.all():
            a, lim = p["auth"], (p.get("limits") or {})
            txt = f"**{p['name']}** : {'connecté' if a['state'] == 'logged_in' else 'non connecté'}"
            if a.get("plan"):
                txt += f" ({a['plan']})"
            if lim.get("status") == "limited":
                txt += " — limite atteinte"
            lines.append(txt)
        fields.append(("Fournisseurs", "\n".join(lines), False))
        nxt = self.db.one("SELECT s.name, s.next_run_at, a.name an FROM schedules s JOIN agents a ON a.id=s.agent_id WHERE s.enabled=1 AND s.next_run_at IS NOT NULL ORDER BY s.next_run_at LIMIT 1")
        if nxt:
            fields.append(("Prochaine planification", f"{nxt['name']} ({nxt['an']}) : {nxt['next_run_at'].replace('T', ' ').replace('Z', ' UTC')}", False))
        last = self.db.one("SELECT r.id, r.status, a.name FROM runs r LEFT JOIN agents a ON a.id=r.agent_id ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1")
        if last:
            fields.append(("Dernière exécution", f"{last['name'] or '(supprimé)'} : {STATUS_LABEL.get(last['status'], last['status'])}", False))
        return _embed("État de RO·AI", "err" if c["paused"] else "ok", fields=fields, url=self.cfg.dashboard_url or None)

    def embed_runs(self, n: int) -> dict:
        rows = self.db.all("SELECT r.id, r.status, r.duration_ms, r.created_at, a.name FROM runs r LEFT JOIN agents a ON a.id=r.agent_id ORDER BY r.created_at DESC, r.rowid DESC LIMIT ?", (n,))
        lines = []
        for r in rows:
            dur = f" ({r['duration_ms'] / 1000:.1f} s)" if r["duration_ms"] else ""
            lines.append(f"`{r['id']}` **{r['name'] or '(supprimé)'}** : {STATUS_LABEL.get(r['status'], r['status'])}{dur}")
        return _embed(f"{len(rows)} dernière(s) exécution(s)", "info", "\n".join(lines) or "Aucune exécution.", url=f"{self.cfg.dashboard_url}/runs" if self.cfg.dashboard_url else None)
