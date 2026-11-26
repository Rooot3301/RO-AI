// Conversion et validation du formulaire d'agent (AgentInput).
import type { Agent, AgentInput, CodexModel, Domain, ProviderId, ReasoningEffort } from '../api/types';

export interface McpRow { key: string; name: string; command: string; args: string; env: string }
export interface AgentForm {
  name: string; slug: string; description: string; provider: ProviderId; model: string;
  mission: string; default_prompt: string; department: string; domain: Domain; sprite: number; enabled: boolean;
  allowed_tools: string[]; permission_mode: 'dontAsk' | 'acceptEdits' | 'plan'; sandbox: 'read-only' | 'workspace-write';
  max_runtime_s: string; require_approval: boolean; web_search: boolean; reasoning_effort: ReasoningEffort | ''; discord_report: boolean; discord_brief: boolean; discord_style: 'embed' | 'text' | 'both'; discord_public: boolean; network_domains: string[]; unrestricted: boolean; autonomous: boolean; mcp: McpRow[];
  /** Claude : mode léger (mission à la place des consignes système de Claude Code) et fichier mémoire joint. */
  lean: boolean; memory_file: string;
}
export type FormErrors = Record<string, string>;

let uid = 0;
export const newKey = () => `k${++uid}`;

export const DEFAULT_MAX_RUNTIME_S = 900;
export const MIN_RUNTIME_S = 10;
export const MAX_RUNTIME_S = 86400;
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function emptyForm(): AgentForm {
  return {
    name: '', slug: '', description: '', provider: 'claude', model: '', mission: '', default_prompt: '', department: '',
    domain: 'perso', sprite: 0, enabled: true, allowed_tools: [], permission_mode: 'dontAsk', sandbox: 'read-only', web_search: false, reasoning_effort: '', discord_report: false, discord_brief: false, discord_style: 'embed', discord_public: false, network_domains: [], unrestricted: false, autonomous: false, lean: false, memory_file: '',
    max_runtime_s: '', require_approval: false, mcp: [],
  };
}

export function emptyMcpRow(): McpRow { return { key: newKey(), name: '', command: '', args: '', env: '' }; }

export function agentToForm(a: Agent): AgentForm {
  const c = a.config ?? {};
  return {
    name: a.name, slug: a.slug ?? '', description: a.description ?? '', provider: a.provider, model: a.model ?? '',
    mission: a.mission ?? '', default_prompt: a.default_prompt ?? '', department: a.department ?? '', domain: a.domain ?? 'pro',
    sprite: a.avatar?.sprite ?? 0, enabled: a.enabled ?? true,
    allowed_tools: [...(c.allowed_tools ?? [])], permission_mode: c.permission_mode ?? 'dontAsk', sandbox: c.sandbox ?? 'read-only', web_search: !!c.web_search, reasoning_effort: c.reasoning_effort ?? '', discord_report: !!c.discord_report, discord_brief: !!c.discord_brief, discord_style: c.discord_style ?? 'embed', discord_public: !!c.discord_public, network_domains: [...(c.network_domains ?? [])], unrestricted: !!c.unrestricted, autonomous: !!(c.unrestricted && c.autonomous), lean: !!c.lean, memory_file: c.memory_file ?? '',
    max_runtime_s: c.max_runtime_s != null ? String(c.max_runtime_s) : '', require_approval: c.require_approval ?? false,
    mcp: (c.mcp_servers ?? []).map((m) => ({
      key: newKey(), name: m.name, command: m.command, args: (m.args ?? []).join('\n'),
      env: Object.entries(m.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'),
    })),
  };
}

export const splitLines = (s: string): string[] => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

export function parseEnv(text: string): { env: Record<string, string>; errors: string[] } {
  const env: Record<string, string> = {}; const errors: string[] = [];
  for (const line of splitLines(text)) {
    const i = line.indexOf('=');
    if (i <= 0) { errors.push(`« ${line} » : format CLE=valeur attendu`); continue; }
    const k = line.slice(0, i).trim();
    if (!ENV_KEY_RE.test(k)) { errors.push(`« ${k} » : nom de variable invalide`); continue; }
    env[k] = line.slice(i + 1);
  }
  return { env, errors };
}

export function validateForm(f: AgentForm): FormErrors {
  const e: FormErrors = {};
  if (!f.name.trim()) e.name = 'Le nom est obligatoire.';
  else if (f.name.trim().length > 120) e.name = '120 caractères au maximum.';
  if (f.slug.trim() && !SLUG_RE.test(f.slug.trim())) e.slug = 'Minuscules, chiffres et tirets uniquement (ex. veille-techno).';
  if (!f.mission.trim()) e.mission = 'La mission est obligatoire : elle fixe le rôle permanent de l’agent.';
  if (!f.department.trim()) e.department = 'Le département est obligatoire.';
  if (f.max_runtime_s.trim()) {
    const n = Number(f.max_runtime_s);
    if (!Number.isInteger(n)) e.max_runtime_s = 'Entier en secondes attendu.';
    else if (n < MIN_RUNTIME_S || n > MAX_RUNTIME_S) e.max_runtime_s = `Entre ${MIN_RUNTIME_S} et ${MAX_RUNTIME_S} secondes.`;
  }
  if (f.provider === 'claude' && f.allowed_tools.some((t) => !t.trim())) e.allowed_tools = 'Un outil est vide.';
  if (f.network_domains.length > MAX_DOMAINS) e.network_domains = `${MAX_DOMAINS} domaines au maximum.`;
  else { const bad = f.network_domains.find((d) => domainError(d)); if (bad) e.network_domains = `${bad} : ${domainError(bad)}`; }
  const seen = new Set<string>();
  f.mcp.forEach((m, i) => {
    const name = m.name.trim();
    if (!name) e[`mcp.${i}.name`] = 'Nom obligatoire.';
    else if (seen.has(name)) e[`mcp.${i}.name`] = 'Nom déjà utilisé.';
    else if (!/^[A-Za-z0-9_-]+$/.test(name)) e[`mcp.${i}.name`] = 'Lettres, chiffres, _ et - uniquement.';
    seen.add(name);
    if (!m.command.trim()) e[`mcp.${i}.command`] = 'Commande obligatoire.';
    const { errors } = parseEnv(m.env);
    if (errors.length) e[`mcp.${i}.env`] = errors[0];
  });
  if (f.provider === 'claude' && f.lean && f.memory_file.trim() && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(f.memory_file.trim())) e.memory_file = 'Nom de fichier simple attendu (ex. style.md), sans dossier.';
  return e;
}

/** Construit l'AgentInput à partir d'un formulaire valide. Les champs propres à l'autre fournisseur sont omis. */
export function formToInput(f: AgentForm): AgentInput {
  const config: NonNullable<AgentInput['config']> = {};
  if (f.provider === 'claude') {
    config.permission_mode = f.permission_mode;
    config.allowed_tools = f.allowed_tools.map((t) => t.trim()).filter(Boolean);
    if (f.lean) { config.lean = true; if (f.memory_file.trim()) config.memory_file = f.memory_file.trim(); }
  } else {
    config.sandbox = f.sandbox;
    if (f.web_search) config.web_search = true;
    if (f.reasoning_effort) config.reasoning_effort = f.reasoning_effort;
  }
  if (f.max_runtime_s.trim()) config.max_runtime_s = Number(f.max_runtime_s);
  const auto = f.unrestricted && f.autonomous;
  // le mode libre impose l'approbation (règle serveur), sauf mode autonome choisi explicitement
  config.require_approval = f.unrestricted && !auto ? true : f.require_approval;
  if (f.discord_report) config.discord_report = true;
  if (f.discord_brief) config.discord_brief = true;
  if ((f.discord_report || f.discord_brief) && f.discord_style !== 'embed') config.discord_style = f.discord_style;
  if ((f.discord_report || f.discord_brief) && f.discord_public) config.discord_public = true;
  const domains = f.network_domains.map(normalizeDomain).filter(Boolean);
  if (domains.length) config.network_domains = [...new Set(domains)];
  if (f.unrestricted) config.unrestricted = true;
  if (auto) config.autonomous = true;
  config.mcp_servers = f.mcp.map((m) => {
    const args = splitLines(m.args);
    const { env } = parseEnv(m.env);
    return { name: m.name.trim(), command: m.command.trim(), ...(args.length ? { args } : {}), ...(Object.keys(env).length ? { env } : {}) };
  });
  const input: AgentInput = {
    name: f.name.trim(), provider: f.provider, model: f.model.trim() || null, mission: f.mission,
    default_prompt: f.default_prompt, description: f.description.trim(), department: f.department.trim(),
    domain: f.domain, avatar: { sprite: f.sprite }, enabled: f.enabled, config,
  };
  if (f.slug.trim()) input.slug = f.slug.trim();
  return input;
}

/** Entrée à renvoyer pour un PUT qui ne change qu'un attribut (ex. activation) sans perdre le reste. */
export function agentToInput(a: Agent, patch: Partial<AgentInput> = {}): AgentInput {
  return { ...formToInput(agentToForm(a)), ...patch };
}

export function slugify(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

export const CLAUDE_TOOL_SUGGESTIONS = ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'Edit', 'Write', 'Bash(git status *)', 'Bash(git diff *)'];
export const CLAUDE_MODEL_SUGGESTIONS = ['sonnet', 'opus', 'haiku'];

// ───────── Réseau et autonomie ─────────
export const MAX_DOMAINS = 20;
export const DOMAIN_RE = /^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}(:\d{1,5})?$/;
export const UNRESTRICTED_CONFIRM_TEXT = 'MODE LIBRE';

/** Minuscules, sans espace, sans schéma ni chemin collés par erreur (https://Exemple.fr/a -> exemple.fr). */
export function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
}
/** Message d'erreur lisible, ou null si le domaine est valide. */
export function domainError(raw: string): string | null {
  const d = normalizeDomain(raw);
  if (!d) return 'domaine vide';
  if (!DOMAIN_RE.test(d)) return 'format invalide (ex. discord.com, *.github.com, api.exemple.fr:8443)';
  const port = d.match(/:(\d{1,5})$/);
  if (port && (Number(port[1]) < 1 || Number(port[1]) > 65535)) return 'port hors limites (1–65535)';
  return null;
}
/** Ajoute des domaines saisis (séparés par virgule, espace ou retour) : renvoie la nouvelle liste et les entrées refusées. */
export function addDomains(current: readonly string[], raw: string): { list: string[]; rejected: { value: string; error: string }[]; full: boolean } {
  const list = [...current]; const rejected: { value: string; error: string }[] = []; let full = false;
  for (const part of raw.split(/[\s,;]+/).filter(Boolean)) {
    const err = domainError(part);
    if (err) { rejected.push({ value: part, error: err }); continue; }
    const d = normalizeDomain(part);
    if (list.includes(d)) continue;
    if (list.length >= MAX_DOMAINS) { full = true; break; }
    list.push(d);
  }
  return { list, rejected, full };
}
export const confirmsUnrestricted = (typed: string) => typed.trim() === UNRESTRICTED_CONFIRM_TEXT;

// ───────── Webhooks ─────────
/** Un webhook Discord ne doit jamais figurer dans la mission ou le prompt (il serait envoyé au fournisseur d'IA). */
export const hasWebhookInText = (...texts: string[]) => texts.some((t) => /(discord(app)?\.com\/api(\/v\d+)?\/webhooks)/i.test(t));
export const isDiscordWebhookUrl = (u: string) => /^https:\/\/(discord(app)?\.com)\/api\/webhooks\/\d+\/[\w-]+$/i.test(u.trim());

export const EFFORT_LABEL: Record<ReasoningEffort, string> = {
  low: 'Faible', medium: 'Moyen', high: 'Élevé', xhigh: 'Très élevé', max: 'Maximum', ultra: 'Ultra',
};
const ALL_EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

/** Modèle Codex concerné par le formulaire : celui imposé, sinon celui constaté à la dernière exécution (défaut du fournisseur). */
export function codexModelInfo(models: CodexModel[], model: string, lastModel?: string | null): { model: CodexModel | null; isDefault: boolean } {
  const slug = model.trim() || lastModel || '';
  return { model: models.find((m) => m.slug === slug) ?? null, isDefault: !model.trim() };
}

/** Niveaux d'effort proposables pour ce modèle (tous si le modèle est inconnu du catalogue). */
export function effortChoices(m: CodexModel | null): ReasoningEffort[] {
  return m && m.efforts.length ? m.efforts : ALL_EFFORTS;
}
