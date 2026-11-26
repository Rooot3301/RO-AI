"""Adaptateur Claude Code : `claude -p --output-format stream-json` (binaire officiel, abonnement)."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from ..redact import redact_text
from .base import clean_model, Adapter, Command, Event, Outcome, RunContext, base_env, classify_error, summarize_tool, tool_kind

DEFAULT_TOOLS = ["Read", "Grep", "Glob"]


MEMORY_MAX = 16 * 1024
MEMORY_OPEN, MEMORY_CLOSE = "<<<MEMOIRE", "MEMOIRE>>>"
_MEMNAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


def memory_text(cwd: Path, name: Any) -> str | None:
    """Contenu du fichier mémoire de l'agent (dans son dossier, 16 Kio au plus), sinon None."""
    if not isinstance(name, str) or not _MEMNAME.match(name) or ".." in name:
        return None
    p = cwd / name
    try:
        if not p.is_file() or p.resolve().parent != cwd.resolve():
            return None
        data = p.read_bytes()[:MEMORY_MAX]
    except OSError:
        return None
    return data.decode("utf-8", "replace")


def apply_memory_update(cwd: Path, cfg: dict, text: str | None) -> tuple[str | None, int | None]:
    """Mode léger avec fichier mémoire : enregistre le bloc <<<MEMOIRE … MEMOIRE>>> de la réponse (16 Kio au plus) et le
    retire du texte. Retourne (texte nettoyé, octets écrits ou None)."""
    if not text or not cfg.get("lean") or MEMORY_OPEN not in text:
        return text, None
    name = cfg.get("memory_file")
    m = re.search(re.escape(MEMORY_OPEN) + r"\s*\n(.*?)\n?\s*" + re.escape(MEMORY_CLOSE), text, re.S)
    if not m or not isinstance(name, str) or not _MEMNAME.match(name):
        return text, None
    body = m.group(1).strip() + "\n"
    clean = (text[: m.start()] + text[m.end():]).strip()
    data = redact_text(body, MEMORY_MAX).encode("utf-8")[:MEMORY_MAX]
    p = cwd / name
    try:
        if p.exists() and p.resolve().parent != cwd.resolve():
            return clean, None
        p.write_bytes(data)
        p.chmod(0o600)
    except OSError:
        return clean, None
    return clean, len(data)


class ClaudeAdapter(Adapter):
    name = "claude"

    def __init__(self) -> None:
        self._session: str | None = None
        self._result: dict[str, Any] | None = None
        self._last_text: str = ""
        self._tools: dict[str, str] = {}
        self._rate_error: str | None = None
        self._api_error: str | None = None

    @property
    def session_id(self) -> str | None:
        return self._session

    def build(self, ctx: RunContext) -> Command:
        cfg = ctx.agent.get("config") or {}
        domains = [d for d in (cfg.get("network_domains") or []) if d]
        argv = [ctx.bin_path, "-p", "--output-format", "stream-json", "--verbose"]
        if cfg.get("unrestricted"):
            # mode libre (choix explicite de l'utilisateur, approbation obligatoire) : ni sandbox ni restriction d'outils
            argv += ["--dangerously-skip-permissions"]
            settings = {"sandbox": {"enabled": False}}
        else:
            mode = cfg.get("permission_mode") or "dontAsk"
            if cfg.get("_text_only"):
                # usage interne (fiches d'identité) : aucun outil, consignes système minimales, pas de session conservée
                argv += ["--permission-mode", "dontAsk", "--tools", "", "--disable-slash-commands", "--no-session-persistence",
                         "--system-prompt", "Tu réponds uniquement par le texte demandé, sans utiliser d'outil."]
            else:
                tools = list(cfg.get("allowed_tools") or DEFAULT_TOOLS)
                if domains and "Bash" not in tools:
                    tools.append("Bash")  # le réseau passe par les commandes shell, toujours dans le sandbox
                argv += ["--permission-mode", mode, "--allowedTools", ",".join(tools)]
                if cfg.get("lean"):
                    # mode léger : seuls les outils autorisés sont chargés et la mission REMPLACE les consignes système
                    # de Claude Code (bien moins de jetons à chaque tour) ; sandbox et permissions inchangés. Le fichier
                    # mémoire éventuel (dossier de l'agent) est joint aux consignes : pas d'aller-retour d'outil pour le lire.
                    system = (ctx.agent.get("mission") or "").strip() or "Tu es un assistant. Réponds en français."
                    mem = memory_text(ctx.cwd, cfg.get("memory_file"))
                    if mem is not None:
                        system += (f"\n\n## Contenu actuel de {cfg['memory_file']} (fourni au lancement)\n\n{mem}\n\n"
                                   f"Pour mettre ce fichier à jour, termine ta réponse par un bloc :\n{MEMORY_OPEN}\n(contenu COMPLET mis à jour)\n{MEMORY_CLOSE}\n"
                                   "RO·AI l'enregistre et le retire de ta réponse. N'utilise pas d'outil pour ce fichier.")
                    lean_tools = cfg.get("allowed_tools") if isinstance(cfg.get("allowed_tools"), list) else tools
                    argv += ["--tools", ",".join(lean_tools), "--disable-slash-commands", "--system-prompt", system]
            sandbox = {"enabled": True, "failIfUnavailable": True, "allowUnsandboxedCommands": False}
            if domains:
                sandbox["network"] = {"allowedDomains": domains, "strictAllowlist": True}
            settings = {"sandbox": sandbox}
        argv += ["--settings", json.dumps(settings)]
        if ctx.agent.get("model"):
            argv += ["--model", ctx.agent["model"]]
        if ctx.resume_session:
            argv += ["--resume", ctx.resume_session]
        mission = (ctx.agent.get("mission") or "").strip()
        if mission and not (cfg.get("lean") and not cfg.get("unrestricted") and not cfg.get("_text_only")):
            argv += ["--append-system-prompt", mission]
        files: dict = {}
        servers = cfg.get("mcp_servers") or []
        if servers:
            conf = {"mcpServers": {s["name"]: {"command": s["command"], "args": s.get("args") or [], "env": s.get("env") or {}} for s in servers}}
            path = ctx.run_dir / "mcp.json"
            files[path] = json.dumps(conf)
            argv += ["--mcp-config", str(path), "--strict-mcp-config"]
        return Command(argv=argv, env=base_env(ctx), stdin=ctx.prompt, files=files, hide=[str(ctx.home / ".codex")])

    def parse(self, line: str) -> list[Event]:
        line = line.strip()
        if not line.startswith("{"):
            return []
        try:
            m = json.loads(line)
        except json.JSONDecodeError:
            return []
        out: list[Event] = []
        t = m.get("type")
        sub = m.get("subtype")
        if m.get("session_id") and not self._session:
            self._session = m["session_id"]
            out.append(("run.session", {"session_id": self._session}))
        if t == "system" and sub == "init" and clean_model(m.get("model")):
            out.append(("run.model", {"model": m["model"]}))
        if t == "assistant":
            for block in (m.get("message") or {}).get("content") or []:
                bt = block.get("type")
                if bt == "text" and block.get("text"):
                    self._last_text = block["text"]
                    out.append(("run.message", {"text": block["text"]}))
                elif bt == "tool_use":
                    name = block.get("name", "")
                    self._tools[block.get("id", "")] = name
                    out.append(("tool.call", {"tool_id": block.get("id"), "tool": name, "kind": tool_kind(name),
                                              "summary": summarize_tool(name, block.get("input"))}))
        elif t == "user":
            content = (m.get("message") or {}).get("content")
            if isinstance(content, list):
                for block in content:
                    if block.get("type") == "tool_result":
                        c = block.get("content")
                        if isinstance(c, list):
                            c = " ".join(x.get("text", "") for x in c if isinstance(x, dict))
                        ok = not block.get("is_error")
                        out.append(("tool.result", {"tool_id": block.get("tool_use_id"), "ok": ok,
                                                    "summary": redact_text(str(c or ""), 300)}))
        elif t == "system" and sub == "api_retry":
            out.append(("run.api_retry", {"attempt": m.get("attempt"), "max_retries": m.get("max_retries"),
                                          "error": str(m.get("error") or m.get("error_status") or "")}))
            self._api_error = str(m.get("error") or "")
        elif t == "rate_limit_event":
            info = m.get("rate_limit_info") or m
            status = info.get("status") or "unknown"
            resets = info.get("resetsAt") or info.get("resets_at")
            ev = {"status": status, "resets_at": _epoch_iso(resets), "window": info.get("rateLimitType") or info.get("window")}
            util = info.get("utilization")
            if isinstance(util, (int, float)) and not isinstance(util, bool) and util >= 0:
                ev["used_percent"] = round(float(util) * 100 if util <= 1 else float(util), 1)
            out.append(("run.rate_limit", ev))
            if status in ("rejected", "limited", "exceeded"):
                self._rate_error = status
        elif t == "result":
            self._result = m
            for d in m.get("permission_denials") or []:
                name = d.get("tool_name", "")
                out.append(("tool.denied", {"tool": name, "reason": "refusé par la politique de permissions : "
                                            + summarize_tool(name, d.get("tool_input"))}))
        return out

    def finish(self, returncode: int, stderr_tail: str, timed_out: bool, cancelled: bool) -> Outcome:
        r = self._result or {}
        usage = r.get("usage") or {}
        common = dict(num_turns=r.get("num_turns"), cost_usd_estimate=r.get("total_cost_usd"),
                      usage={"input_tokens": int(usage.get("input_tokens", 0)) + int(usage.get("cache_read_input_tokens", 0) or 0)
                             + int(usage.get("cache_creation_input_tokens", 0) or 0),
                             "output_tokens": int(usage.get("output_tokens", 0))} if usage else None,
                      session_id=self._session)
        if cancelled:
            return Outcome(status="cancelled", **common)
        if timed_out:
            return Outcome(status="failed", error_class="timeout", error_message="Durée maximale dépassée", **common)
        text = r.get("result") if isinstance(r.get("result"), str) else None
        if r and not r.get("is_error") and r.get("subtype", "success") == "success" and returncode == 0:
            return Outcome(status="succeeded", result_text=text or self._last_text, **common)
        blob = " ".join(x for x in [text, stderr_tail, self._api_error, self._rate_error] if x)
        if self._rate_error and not text:
            cls = "rate_limited"
        else:
            cls = classify_error(blob)
        if r.get("subtype") == "error_max_turns":
            cls = "failed"
        msg = redact_text((text or stderr_tail or f"Le client a quitté avec le code {returncode}").strip(), 600)
        return Outcome(status="failed", error_class=cls, error_message=msg, result_text=text, **common)


def _epoch_iso(v: Any) -> str | None:
    from datetime import datetime, timezone
    try:
        if v is None:
            return None
        n = float(v)
        if n > 1e12:
            n /= 1000.0
        return datetime.fromtimestamp(n, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (TypeError, ValueError):
        return str(v)
