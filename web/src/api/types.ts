// Types alignés sur docs/API.md (contrat v1). Ne pas diverger sans mettre le contrat à jour.
export type ProviderId = 'claude' | 'codex';
export type Domain = 'perso' | 'pro';
export type AgentState = 'idle' | 'working' | 'waiting' | 'error' | 'disabled';
export type RunStatus = 'queued' | 'awaiting_approval' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type ErrorClass = 'auth_expired' | 'rate_limited' | 'denied' | 'timeout' | 'transient' | 'failed';
export type ToolKind = 'read' | 'write' | 'exec' | 'web' | 'mcp' | 'other';

export interface Provider {
  id: ProviderId; name: string; installed: boolean; version: string | null;
  auth: { state: 'logged_in' | 'logged_out' | 'unknown'; method: string | null; plan: string | null; detail: string; expires_at: string | null };
  limits: { status: 'ok' | 'limited' | 'unknown'; resets_at: string | null; window: string | null; updated_at: string | null } | null;
  checked_at: string;
}
export interface McpServer { name: string; command: string; args?: string[]; env?: Record<string, string> }
export interface AgentConfig {
  allowed_tools?: string[]; permission_mode?: 'dontAsk' | 'acceptEdits' | 'plan';
  sandbox?: 'read-only' | 'workspace-write'; max_runtime_s?: number; require_approval?: boolean; web_search?: boolean; reasoning_effort?: ReasoningEffort; discord_report?: boolean; discord_brief?: boolean; discord_style?: 'embed' | 'text' | 'both'; discord_public?: boolean; network_domains?: string[]; unrestricted?: boolean; autonomous?: boolean; mcp_servers?: McpServer[];
  /** Claude : mode léger et fichier mémoire du dossier de l'agent joint aux consignes. */
  lean?: boolean; memory_file?: string;
}
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
/** Modèle proposé par le client Codex (lu dans son cache local). */
export interface CodexModel { slug: string; name: string; description: string; default_effort: ReasoningEffort | null; efforts: ReasoningEffort[] }
export interface AgentInput {
  name: string; slug?: string; description?: string; provider: ProviderId; model?: string | null;
  mission: string; default_prompt?: string; department: string; domain?: Domain;
  avatar?: { sprite: number }; enabled?: boolean; config?: AgentConfig;
}
export interface Agent extends AgentInput {
  id: string; slug: string; created_at: string; updated_at: string; state: AgentState;
  domain: Domain; avatar: { sprite: number }; enabled: boolean; config: AgentConfig; description: string; default_prompt: string;
  last_run: { id: string; status: RunStatus; finished_at: string | null; error_class: ErrorClass | null } | null;
  discord_webhook_set?: boolean;
  /** Modèle réellement utilisé lors de la dernière exécution (rapporté par le client), utile quand `model` est vide. */
  last_model?: string | null;
}
export interface Run {
  id: string; agent_id: string; agent_name: string; provider: ProviderId; status: RunStatus;
  trigger: 'manual' | 'schedule' | 'api' | 'reply'; prompt: string; session_id: string | null;
  created_at: string; started_at: string | null; finished_at: string | null; duration_ms: number | null;
  error_class: ErrorClass | null; error_message: string | null; num_turns: number | null;
  cost_usd_estimate: number | null; usage: { input_tokens: number; output_tokens: number } | null;
  result_text: string | null; schedule_id: string | null;
  /** Conversations : facultatifs côté types (anciens clients/tests), toujours présents dans les réponses du noyau. */
  parent_run_id?: string | null; conversation_id?: string | null;
  /** Modèle réellement utilisé, rapporté par le client (absent pour les exécutions antérieures). */
  model?: string | null;
}
export interface ScheduleInput { agent_id: string; name: string; cron: string; timezone?: string; prompt?: string; enabled?: boolean }
export interface Schedule extends ScheduleInput {
  id: string; timezone: string; prompt: string; enabled: boolean;
  last_run_at: string | null; next_run_at: string | null; last_run_id: string | null;
}
export interface RoEvent {
  seq: number; ts: string; schema: 1; domain: Domain; type: string;
  agent_id: string | null; run_id: string | null; payload: Record<string, unknown>;
}
export interface SystemInfo {
  cpu_percent: number; load: [number, number, number];
  mem: { total: number; used: number; available: number; percent: number };
  swap: { total: number; used: number; percent: number };
  disk: { total: number; used: number; percent: number };
  uptime_s: number; ai_slice: { mem_current: number; mem_max: number | null } | null;
  agents_running: number; queue_depth: number;
}
export interface OfficeAgent {
  id: string; name: string; department: string; avatar: { sprite: number }; state: AgentState;
  activity: string | null; tool_kind: ToolKind | null; run_id: string | null; error_class: ErrorClass | null; since: string;
  /** Présents dans les réponses du noyau (facultatifs pour les anciens tests). */
  provider?: ProviderId; model?: string | null; enabled?: boolean;
  /** Dernières actions réelles de l'exécution en cours (résumés d'outils), de la plus ancienne à la plus récente. */
  recent_actions?: string[];
  /** Conversation en direct avec l'utilisateur (Chat, /parler) : en cours, ou terminée depuis moins de 5 min. */
  conversation?: OfficeConversation | null;
  /** Livraisons pas encore traitées pour cet agent (colis sur le bureau). */
  inbox_pending?: number;
}
export interface OfficeConversation { via: 'chat' | 'discord'; run_id: string; active: boolean; last_at: string }
export interface OfficeControl { paused: boolean; since: string | null; reason: string | null }
export interface OfficeSnapshot { seq: number; now: string; departments: string[]; agents: OfficeAgent[]; profiles?: Record<string, AgentProfile>; control?: OfficeControl }
/** Bibliothèque du bureau : derniers rapports réels (GET /api/office/archive). */
export interface OfficeReport { run_id: string; agent_id: string; agent_name: string; trigger: string; scheduled: boolean; finished_at: string; chars: number; title: string; preview: string }
/** Session Claude Code qui développe RO·AI sur ce serveur (hook local, données réduites : jamais de contenu). */
export type DevKind = 'read' | 'write' | 'search' | 'exec' | 'test' | 'build' | 'deploy' | 'commit' | 'git' | 'restart' | 'web' | 'delegate' | 'tool';
export interface DevAction { at: string; kind: DevKind; target: string }
export interface DevSession {
  id: string; label: string; project: string; state: 'idle' | 'working' | 'waiting' | 'ended'; present: boolean;
  since: string; last_at: string; turn_at: string | null; actions: DevAction[];
  counts: { tools: number; write: number; test: number; build: number; deploy: number; commit: number };
}

// --- Fiches d'identité (décoratives, Virtual Office) — voir docs/API.md « Fiches d'identité » ---
export type DecorTheme = 'general' | 'security' | 'space' | 'dev' | 'research' | 'sysadmin' | 'data' | 'writing' | 'design' | 'finance' | 'support';
export type DecorItem =
  | 'plant_small' | 'photo_frame' | 'mug' | 'desk_lamp' | 'multi_monitor' | 'network_rack' | 'shield_poster' | 'status_board'
  | 'ship_model' | 'space_poster' | 'planet_globe' | 'star_map' | 'mech_keyboard' | 'code_poster' | 'rubber_duck' | 'second_monitor'
  | 'book_stack' | 'documents' | 'magnifier' | 'notes_board' | 'cable_box' | 'server_mini' | 'chart_poster' | 'typewriter'
  | 'drawing_tablet' | 'color_swatches' | 'art_poster' | 'calculator' | 'headset_stand';
export type Accessory = 'none' | 'glasses' | 'headset' | 'cap' | 'beanie' | 'earrings';
/** Paramètres 0..1, utilisés uniquement par la simulation locale. */
export interface Personality { sociability: number; curiosity: number; energy: number; focus: number; coffee: number }
export interface Appearance { skin: number /*0..5*/; hair: number /*0..7*/; hair_style: number /*0..5*/; outfit: number /*0..7*/; accessory: Accessory }
export interface Decor { theme: DecorTheme; items: DecorItem[] /*≤6*/; color: number /*0..7*/ }
export interface AgentProfileInput {
  display_name: string; employee_id: string; title: string; hired_at: string; office: string; bio: string;
  traits: string[]; interests: string[]; habits: string[]; skills: string[];
  personality: Personality; appearance: Appearance; decor: Decor;
}
export interface AgentProfile extends AgentProfileInput {
  agent_id: string; department: string;
  /** default = calculée localement (jamais enregistrée) ; manual = enregistrée à la main ; generated = générée une fois par IA. */
  source: 'default' | 'manual' | 'generated';
  generated_at: string | null; updated_at: string | null; generating: boolean;
  generation: { provider: ProviderId; model: string | null; input_tokens: number | null; output_tokens: number | null } | null;
}
/** Agencement personnalisé du bureau (éditeur) : document libre versionné, ≤ 64 Kio. */
export interface OfficeLayoutDoc { version: number; [k: string]: unknown }

/** Planning du jour (heure de Paris) : occurrences réelles des planifications actives et sort des exécutions lancées. */
export type PlanningStatus = 'upcoming' | 'missed' | RunStatus;
export interface PlanningItem {
  schedule_id: string; name: string; agent_id: string; agent_name: string; agent_enabled: boolean;
  at: string; status: PlanningStatus; run_id: string | null; off_schedule?: boolean;
}
export interface OfficePlanning {
  date: string; timezone: string; paused: boolean; items: PlanningItem[]; truncated: boolean;
  next_after: { schedule_id: string; name: string; agent_id: string; agent_name: string; agent_enabled: boolean; at: string } | null;
}
/** Fenêtre de limite d'usage relevée par le client officiel (Claude : statut ; Codex : pourcentage utilisé). */
export interface LimitWindow { window: string; level: 'ok' | 'warning' | 'limited'; used_percent: number | null; resets_at: string | null; updated_at: string | null }
export interface OfficeBoards { now: string; planning: OfficePlanning; limits: Record<'claude' | 'codex', LimitWindow[]> }

export interface Control { paused: boolean; since: string | null; reason: string | null; cancelled: number | null }
export interface StatsTotals {
  runs: number; succeeded: number; failed: number; cancelled: number; running: number; success_rate: number | null;
  duration_ms_total: number; duration_ms_avg: number | null; input_tokens: number; output_tokens: number; cost_usd_estimate: number;
}
export interface StatsDay { date: string; runs: number; succeeded: number; failed: number; cancelled: number; input_tokens: number; output_tokens: number; cost_usd_estimate: number }
export interface StatsProvider { provider: ProviderId; runs: number; succeeded: number; failed: number; rate_limited: number; input_tokens: number; output_tokens: number; cost_usd_estimate: number }
export interface StatsAgent {
  agent_id: string; name: string; provider: ProviderId; runs: number; succeeded: number; failed: number; success_rate: number | null;
  duration_ms_avg: number | null; input_tokens: number; output_tokens: number; cost_usd_estimate: number;
}
export interface Stats {
  days: number; from: string; to: string; totals: StatsTotals; by_day: StatsDay[]; by_provider: StatsProvider[]; by_agent: StatsAgent[];
  by_hour: number[]; errors: { error_class: ErrorClass; count: number }[];
}

export type DiscordState = 'disabled' | 'incomplete' | 'connecting' | 'connected' | 'error';
export interface DiscordNotify { approvals: boolean; failures: boolean; emergency: boolean; auth: boolean; limits: boolean; system_errors: boolean; completions: boolean; startup: boolean }
export interface DiscordCommands { read: boolean; control: boolean; approve: boolean; run: boolean; chat: boolean }
export interface DiscordSettingsInput {
  enabled: boolean; owner_id: string; application_id: string; delivery: 'dm' | 'channel'; channel_id: string; dashboard_url: string;
  notify: DiscordNotify; commands: DiscordCommands;
}
export interface DiscordSettings extends DiscordSettingsInput {
  token_set: boolean; webhook_set?: boolean;
  status: { state: DiscordState; bot_user: string | null; last_sent_at: string | null; last_error: string | null; webhook?: { last_sent_at: string | null; last_error: string | null } };
  invite_url: string | null;
}
export type DiscordUpdate = Partial<DiscordSettingsInput> & { token?: string; clear_token?: boolean; webhook_url?: string; clear_webhook?: boolean };

export interface Conversation { conversation_id: string; agent_id: string; agent_name: string; runs: Run[] }

// --- Livraisons des outils externes (PerforceBot…) — voir docs/API.md « Livraisons » ---
export interface InboxSource { id: string; name: string; token_hint: string; agent_id: string | null; auto_run: boolean; instructions: string; enabled: boolean; created_at: string; last_at: string | null; received: number }
export interface InboxSourceInput { name: string; agent_id: string | null; auto_run: boolean; instructions: string; enabled: boolean }
export type DeliveryStatus = 'waiting' | 'stored' | 'unrouted' | 'processing' | 'done' | 'failed';
export interface Delivery { id: string; source: string | null; agent_id: string | null; agent_name: string | null; received_at: string; title: string; kind: string; bytes: number; file: string | null; status: DeliveryStatus; run_id: string | null }

// --- Vie intérieure du bureau (journal, fil interne, dialogues ; Claude Haiku, 1 appel par jour) ---
export interface SocietyReply { id: string; author: string; text: string; at: string }
/** Publication du fil interne : `post`, `thought` (pensée) ou `event` (fait réel, sans IA). */
export interface SocietyPost {
  id: string; author: string; kind: 'post' | 'thought' | 'photo' | 'question' | 'event'; text: string; at: string; likes: string[]; replies: SocietyReply[]; ref?: string;
  /** Publications réelles : origine, et pièces jointes réelles (dernières actions de l'exécution, début du résultat). */
  tag?: 'mission' | 'inbox' | 'welcome'; attach?: { screen?: string[]; result?: string };
}
export interface SocietyDialogue { a: string; b: string; lines: string[] }
export interface OfficeSociety {
  settings: { enabled: boolean }; usage: { day: string; calls: number; input_tokens: number; output_tokens: number; cap: number };
  running: boolean; last_error: { at: string; message: string } | null; blocked: string | null;
  day: string | null; generated_at: string | null; model: string | null;
  journal: Record<string, string>; posts: SocietyPost[]; upcoming: number; editions: string[]; dialogues: SocietyDialogue[]; memory: Record<string, { day: string; text: string }[]>;
}
