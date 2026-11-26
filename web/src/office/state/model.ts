// Modèle du bureau : état dérivé uniquement du snapshot et des événements de l'API.
// Aucune donnée fabriquée : chaque champ visible provient d'un snapshot ou d'un événement.
import type { AgentProfile, AgentState, ErrorClass, OfficeSnapshot, Provider, RoEvent, ToolKind } from '../../api/types.ts';

/** Événement (ou snapshot) à l'origine d'un état ou d'un effet visible. */
export interface Origin { seq: number; type: string; run_id: string | null; ts: string }

export type EffectKind = 'success' | 'denied' | 'rate_limit' | 'retry';
export interface Effect {
  kind: EffectKind;
  /** Fin de validité, en ms locales (Date.now()). */
  until: number;
  /** Texte court (affiché en infobulle / inspecteur). */
  label: string;
  /** Mention très courte pour la pastille (ex. « 2/5 »), sinon vide. */
  short: string;
  origin: Origin;
}

export type WaitKind = 'queued' | 'approval';

export interface OfficeAgentModel {
  id: string; name: string; department: string; sprite: number;
  /** Rang dans le snapshot (ordre de création) : les nouveaux postes s'ajoutent à la fin de leur département. */
  rank?: number;
  /** Fournisseur et modèle déclarés (snapshot), facultatifs. */
  provider?: string | null; model?: string | null;
  state: AgentState;
  /** Pour `waiting` : exécution en file (queued) ou attente d'approbation. */
  waitKind: WaitKind | null;
  activity: string | null; toolKind: ToolKind | null;
  runId: string | null;
  /** Classe d'erreur de la dernière exécution en échec (conservée jusqu'à une réussite). */
  errorClass: ErrorClass | null;
  since: string;
  effects: Effect[];
  /** Événement à l'origine de l'état visible. */
  origin: Origin;
  /** Dernières actions réelles (résumés d'outils) de l'exécution en cours, la plus récente en dernier (3 au plus). */
  actions?: string[];
  /** Conversation en direct avec l'utilisateur : `until` = fin de présence en salle de réunion (ms locales, Infinity si en cours). */
  conv?: { via: 'chat' | 'discord'; runId: string | null; active: boolean; lastAt: string; until: number } | null;
  /** Rapport réel à ranger en bibliothèque jusqu'à cet instant (ms locales), après une mission réussie avec résultat. */
  filedUntil?: number;
  /** Livraisons reçues pas encore traitées (colis posé sur son bureau). */
  inbox?: number;
}
/** Livraison réelle fraîche (camionnette, livreur, accueil) : animation déclenchée une seule fois. */
export interface DeliveryFx { seq: number; agentId: string | null; source: string }

/** Version allégée d'un événement conservée pour l'inspecteur. */
export interface EventLite { seq: number; ts: string; type: string; run_id: string | null; summary: string }

/** Types d'événements d'orchestration (travail réel du noyau : file, lancements, approbations, planifications). */
export type OrchKind = 'queued' | 'dispatch' | 'approval' | 'approved' | 'rejected' | 'cancelled' | 'failed' | 'schedule' | 'rate_limit' | 'provider' | 'resync';
export interface OrchEvent {
  seq: number; ts: string; type: string; kind: OrchKind; agentId: string | null; runId: string | null;
  /** Heure locale de réception (ms) ; `fresh` = vrai si l'événement est récent (pas un rejeu) et peut donc s'animer. */
  receivedAt: number; fresh: boolean; detail: string;
}
export interface OrchModel { events: OrchEvent[]; /** État d'authentification connu par fournisseur. */ providers: Record<string, string> }
export const ORCH_KIND_BY_TYPE: Readonly<Record<string, OrchKind>> = {
  'run.queued': 'queued', 'run.started': 'dispatch', 'run.awaiting_approval': 'approval', 'run.approved': 'approved', 'run.rejected': 'rejected',
  'run.cancelled': 'cancelled', 'run.failed': 'failed', 'schedule.fired': 'schedule', 'run.rate_limit': 'rate_limit', 'provider.auth': 'provider', 'system.resync': 'resync',
};
const MAX_ORCH = 40;

export interface OfficeModel {
  orch: OrchModel;
  loaded: boolean;
  seq: number;
  departments: string[];
  /** Agents triés par id (ordre stable). */
  agents: OfficeAgentModel[];
  /** Décalage horloge serveur - locale, en ms. */
  clockOffsetMs: number;
  /** Vrai quand un événement impose de relire le snapshot (agent créé/modifié…). */
  needsSnapshot: boolean;
  lastEvent: (EventLite & { agent_id: string | null }) | null;
  recent: Record<string, EventLite[]>;
  /** Fiches d'identité (décoratives) fournies par le snapshot. */
  profiles: Record<string, AgentProfile>;
  /** Arrêt d'urgence (snapshot + événements system.emergency_stop / system.resumed). */
  control: { paused: boolean; since: string | null; reason: string | null };
  /** Dernières livraisons fraîches (10 au plus), pour la camionnette et le livreur. */
  deliveries: DeliveryFx[];
}

export type OfficeAction =
  | { type: 'snapshot'; snapshot: OfficeSnapshot; nowMs: number }
  | { type: 'event'; event: RoEvent; nowMs: number }
  | { type: 'providers'; providers: readonly Provider[] };

export const EFFECT_TTL_MS = { success: 3000, denied: 3500, rate_limit: 8000, retry: 10000 } as const;
/** Présence en salle de réunion après la dernière réponse d'une conversation (la conversation peut reprendre). */
export const CONV_LINGER_MS = 300_000;
/** Durée accordée pour aller ranger un rapport en bibliothèque (trajet compris), après l'effet de réussite. */
export const FILE_REPORT_MS = 40_000;
const MAX_ACTIONS = 3;
/** Au-delà de cet âge, un événement rejoué (reprise SSE) ne déclenche plus d'effet bref. */
export const MAX_EFFECT_EVENT_AGE_MS = 15000;
const MAX_RECENT = 40;
const MAX_EFFECTS = 4;

export const initialModel: OfficeModel = {
  orch: { events: [], providers: {} }, loaded: false, seq: 0, departments: [], agents: [], clockOffsetMs: 0, needsSnapshot: false, lastEvent: null, recent: {}, profiles: {},
  control: { paused: false, since: null, reason: null }, deliveries: [],
};

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const ERROR_CLASSES: readonly string[] = ['auth_expired', 'rate_limited', 'denied', 'timeout', 'transient', 'failed'];
const asErrorClass = (v: unknown): ErrorClass | null => (typeof v === 'string' && ERROR_CLASSES.includes(v) ? (v as ErrorClass) : null);
const TOOL_KINDS: readonly string[] = ['read', 'write', 'exec', 'web', 'mcp', 'other'];
const asToolKind = (v: unknown): ToolKind | null => (typeof v === 'string' && TOOL_KINDS.includes(v) ? (v as ToolKind) : null);

const clampSprite = (n: unknown): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : 0;
  return ((v % 6) + 6) % 6;
};

/** Résumé court et sûr (texte brut) d'un événement. */
export function summarizeEvent(e: RoEvent): string {
  const p = e.payload ?? {};
  switch (e.type) {
    case 'tool.call': return `${str(p.tool) ?? 'outil'} : ${str(p.summary) ?? ''}`.trim();
    case 'tool.result': return `${p.ok === false ? 'échec' : 'ok'} ${str(p.summary) ?? ''}`.trim();
    case 'tool.denied': return `${str(p.tool) ?? 'outil'} refusé (${str(p.reason) ?? '?'})`;
    case 'run.queued': case 'run.awaiting_approval': return str(p.prompt_preview) ?? '';
    case 'run.started': return `${str(p.provider) ?? ''} ${str(p.model) ?? ''}`.trim();
    case 'run.message': return str(p.text) ?? '';
    case 'run.failed': return `${str(p.error_class) ?? 'failed'} : ${str(p.error_message) ?? ''}`.trim();
    case 'run.succeeded': return str(p.result_preview) ?? '';
    case 'run.rate_limit': return `${str(p.status) ?? '?'}${str(p.window) ? ` (${str(p.window)})` : ''}`;
    case 'run.api_retry': return `tentative ${num(p.attempt) ?? '?'}/${num(p.max_retries) ?? '?'}`;
    case 'system.notice': return str(p.message) ?? '';
    default: return str(p.name) ?? '';
  }
}
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function pruneEffects(list: Effect[], nowMs: number): Effect[] {
  const live = list.filter((e) => e.until > nowMs);
  return live.length > MAX_EFFECTS ? live.slice(live.length - MAX_EFFECTS) : live;
}

/** L'agent travaille déjà sur une AUTRE exécution que celle de l'événement. */
function busyElsewhere(a: OfficeAgentModel, runId: string | null | undefined): boolean {
  return a.state === 'working' && !!a.runId && !!runId && a.runId !== runId;
}
function agentBusyElsewhere(m: OfficeModel, id: string | null | undefined, runId: string | null | undefined): boolean {
  const a = id ? m.agents.find((x) => x.id === id) : undefined;
  return !!a && busyElsewhere(a, runId);
}
function withAgent(m: OfficeModel, id: string, fn: (a: OfficeAgentModel) => OfficeAgentModel): OfficeModel {
  const i = m.agents.findIndex((a) => a.id === id);
  if (i < 0) return m;
  const agents = m.agents.slice();
  agents[i] = fn(agents[i]);
  return { ...m, agents };
}

export function reduceOffice(m: OfficeModel, action: OfficeAction): OfficeModel {
  if (action.type === 'providers') {
    const providers: Record<string, string> = { ...m.orch.providers };
    for (const p of action.providers) providers[p.id] = !p.installed ? 'not_installed' : p.auth.state;
    return { ...m, orch: { ...m.orch, providers } };
  }
  return action.type === 'snapshot' ? applySnapshot(m, action.snapshot, action.nowMs) : applyEvent(m, action.event, action.nowMs);
}

function convFromSnapshot(c: OfficeSnapshot['agents'][number]['conversation'], serverNow: string, nowMs: number): OfficeAgentModel['conv'] {
  if (!c || (c.via !== 'chat' && c.via !== 'discord')) return null;
  if (c.active) return { via: c.via, runId: c.run_id, active: true, lastAt: c.last_at, until: Infinity };
  const age = (Date.parse(serverNow) || 0) - (Date.parse(c.last_at) || 0);
  const left = CONV_LINGER_MS - Math.max(0, age);
  return left > 0 ? { via: c.via, runId: c.run_id, active: false, lastAt: c.last_at, until: nowMs + left } : null;
}

function applySnapshot(m: OfficeModel, s: OfficeSnapshot, nowMs: number): OfficeModel {
  const prev = new Map(m.agents.map((a) => [a.id, a]));
  const origin = (runId: string | null): Origin => ({ seq: s.seq, type: 'snapshot', run_id: runId, ts: s.now });
  const agents = s.agents.map((a, rank): OfficeAgentModel => {
    const old = prev.get(a.id);
    const state = a.state;
    // Distinction file d'attente / approbation : le snapshot ne la porte pas ; on garde ce que les événements ont établi.
    const waitKind: WaitKind | null = state === 'waiting' ? (old?.state === 'waiting' && old.runId === a.run_id && old.waitKind ? old.waitKind : (a.activity && /approb/i.test(a.activity) ? 'approval' : 'queued')) : null;
    return {
      id: a.id, name: a.name, department: a.department, sprite: clampSprite(a.avatar?.sprite), rank,
      provider: a.provider ?? null, model: a.model ?? null,
      state, waitKind,
      activity: state === 'working' || state === 'waiting' ? a.activity : null,
      toolKind: state === 'working' ? a.tool_kind : null,
      runId: a.run_id, errorClass: a.error_class,
      since: a.since,
      effects: old ? pruneEffects(old.effects, nowMs) : [],
      origin: old && old.origin.seq > s.seq ? old.origin : origin(a.run_id),
      actions: state === 'working' ? (a.recent_actions ?? []).slice(-MAX_ACTIONS) : [],
      conv: convFromSnapshot(a.conversation, s.now, nowMs),
      filedUntil: old?.filedUntil && old.filedUntil > nowMs && state === 'idle' ? old.filedUntil : 0,
      inbox: Math.max(0, Math.floor(a.inbox_pending ?? 0)),
    };
  }).sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const ids = new Set(agents.map((a) => a.id));
  const recent: Record<string, EventLite[]> = {};
  for (const [k, v] of Object.entries(m.recent)) if (ids.has(k)) recent[k] = v;
  return {
    ...m, loaded: true, seq: Math.max(s.seq, 0), departments: s.departments.slice(), agents,
    clockOffsetMs: Date.parse(s.now) - nowMs || 0, needsSnapshot: false, recent,
    control: s.control ? { paused: !!s.control.paused, since: s.control.since ?? null, reason: s.control.reason ?? null } : m.control,
    profiles: s.profiles ? { ...s.profiles } : m.profiles,
  };
}

function applyEvent(m: OfficeModel, e: RoEvent, nowMs: number): OfficeModel {
  if (e.seq <= m.seq) return m; // déjà vu (reprise SSE, rejeu)
  const p = e.payload ?? {};
  const origin: Origin = { seq: e.seq, type: e.type, run_id: e.run_id, ts: e.ts };
  const lite: EventLite = { seq: e.seq, ts: e.ts, type: e.type, run_id: e.run_id, summary: clip(summarizeEvent(e), 160) };
  let next: OfficeModel = { ...m, seq: e.seq, lastEvent: { ...lite, agent_id: e.agent_id } };

  const kind = ORCH_KIND_BY_TYPE[e.type];
  if (kind) {
    const age = nowMs + m.clockOffsetMs - (Date.parse(e.ts) || nowMs + m.clockOffsetMs);
    const oe: OrchEvent = { seq: e.seq, ts: e.ts, type: e.type, kind, agentId: e.agent_id, runId: e.run_id, receivedAt: nowMs, fresh: age <= MAX_EFFECT_EVENT_AGE_MS, detail: clip(summarizeEvent(e), 120) };
    const evs = next.orch.events.concat(oe);
    const providers = e.type === 'provider.auth' && str(p.provider) && str(p.state) ? { ...next.orch.providers, [str(p.provider)!]: str(p.state)! } : next.orch.providers;
    next = { ...next, orch: { events: evs.length > MAX_ORCH ? evs.slice(evs.length - MAX_ORCH) : evs, providers } };
  }
  if (e.type === 'system.resync') return { ...next, needsSnapshot: true };
  if (e.type === 'system.emergency_stop') return { ...next, control: { paused: true, since: next.control.paused ? next.control.since : e.ts, reason: str(p.reason) || null } };
  if (e.type === 'system.resumed') return { ...next, control: { paused: false, since: null, reason: null } };

  if (e.type === 'inbox.received') { // livraison réelle : camionnette (si l'événement est frais), colis sur le bureau du destinataire
    const ageIn = nowMs + m.clockOffsetMs - (Date.parse(e.ts) || nowMs + m.clockOffsetMs);
    const fx = ageIn <= MAX_EFFECT_EVENT_AGE_MS ? next.deliveries.concat({ seq: e.seq, agentId: e.agent_id, source: clip(str(p.source) ?? 'Livraison', 24) }).slice(-10) : next.deliveries;
    next = { ...next, deliveries: fx };
    if (e.agent_id && p.status === 'waiting') next = withAgent(next, e.agent_id, (a) => ({ ...a, inbox: (a.inbox ?? 0) + 1 }));
  }

  const id = e.agent_id;
  if (!id) return next;
  if (e.type !== 'agent.deleted') {
    const buf = (next.recent[id] ?? []).concat(lite);
    next = { ...next, recent: { ...next.recent, [id]: buf.length > MAX_RECENT ? buf.slice(buf.length - MAX_RECENT) : buf } };
  }

  // Âge de l'événement côté serveur : un événement rejoué ne génère pas d'effet bref.
  const ageMs = nowMs + m.clockOffsetMs - (Date.parse(e.ts) || nowMs + m.clockOffsetMs);
  const fresh = ageMs <= MAX_EFFECT_EVENT_AGE_MS;
  const addEffect = (a: OfficeAgentModel, kind: EffectKind, label: string, short = ''): OfficeAgentModel =>
    fresh ? { ...a, effects: pruneEffects(a.effects, nowMs).filter((x) => x.kind !== kind).concat({ kind, until: nowMs + EFFECT_TTL_MS[kind], label, short, origin }) } : a;
  const clearEffects = (a: OfficeAgentModel, kinds: EffectKind[]): OfficeAgentModel =>
    ({ ...a, effects: a.effects.filter((x) => !kinds.includes(x.kind)) });

  switch (e.type) {
    case 'agent.created': case 'agent.updated': return { ...next, needsSnapshot: true };
    // fiche d'identité modifiée / réinitialisée / générée : on relit le snapshot (qui porte les fiches)
    case 'agent.profile': return { ...next, needsSnapshot: true };
    case 'agent.deleted': {
      const recent = { ...next.recent }; delete recent[id];
      return { ...next, agents: next.agents.filter((a) => a.id !== id), recent };
    }
    case 'agent.disabled':
      return withAgent(next, id, (a) => ({ ...a, state: 'disabled', waitKind: null, activity: null, toolKind: null, since: e.ts, origin }));
    case 'agent.enabled':
      // L'état réel (idle/working/error…) dépend des exécutions : on le relit.
      return { ...withAgent(next, id, (a) => (a.state === 'disabled' ? { ...a, state: 'idle', since: e.ts, origin } : a)), needsSnapshot: true };
    // Une autre demande arrive pendant qu'il travaille : il reste à son poste (côté serveur, « working » l'emporte sur
    // « waiting ») ; la demande sera visible à la fin de l'exécution en cours, quand le snapshot est relu.
    case 'run.queued': {
      const via = str(p.conversation);
      const conv = (a: OfficeAgentModel): OfficeAgentModel['conv'] => (via === 'chat' || via === 'discord' ? { via, runId: e.run_id, active: true, lastAt: e.ts, until: Infinity } : a.conv);
      return withAgent(next, id, (a) => (busyElsewhere(a, e.run_id) ? { ...a, conv: conv(a) }
        : { ...a, state: 'waiting', waitKind: 'queued', runId: e.run_id, activity: null, toolKind: null, since: e.ts, origin, conv: conv(a) }));
    }
    case 'run.awaiting_approval':
      return withAgent(next, id, (a) => (busyElsewhere(a, e.run_id) ? a
        : { ...a, state: 'waiting', waitKind: 'approval', runId: e.run_id, activity: 'Attend une approbation', toolKind: null, since: e.ts, origin }));
    case 'run.approved':
      return withAgent(next, id, (a) => (a.state === 'waiting' ? { ...a, waitKind: 'queued', activity: null, origin } : a));
    case 'run.rejected': case 'run.cancelled':
      if (agentBusyElsewhere(next, id, e.run_id)) return { ...next, needsSnapshot: true };
      // L'état résultant (idle ou error selon l'historique) est celui du serveur.
      return { ...withAgent(next, id, (a) => endConv(a.runId === e.run_id || a.runId === null ? { ...a, state: 'idle', waitKind: null, runId: null, activity: null, toolKind: null, since: e.ts, origin, actions: [] } : a, e.run_id, e.ts, nowMs)), needsSnapshot: true };
    case 'run.started':
      return withAgent(next, id, (a) => ({ ...clearEffects(a, ['success']), state: 'working', waitKind: null, runId: e.run_id, activity: null, toolKind: null, since: e.ts, origin, actions: [], filedUntil: 0 }));
    case 'tool.call': {
      const act = clip(str(p.summary) ?? str(p.tool) ?? '', 80);
      return withAgent(next, id, (a) => ({ ...clearEffects(a, ['retry']), state: 'working', waitKind: null, runId: e.run_id ?? a.runId, toolKind: asToolKind(p.kind) ?? 'other', activity: act || null, origin,
        actions: act ? (a.runId === (e.run_id ?? a.runId) ? (a.actions ?? []) : []).concat(act).slice(-MAX_ACTIONS) : a.actions }));
    }
    case 'tool.denied':
      return withAgent(next, id, (a) => addEffect(a, 'denied', `${str(p.tool) ?? 'outil'} refusé : ${str(p.reason) ?? '?'}`));
    case 'run.rate_limit': {
      const status = str(p.status);
      // `allowed` / `ok` : simple information de quota, pas de limitation effective.
      // `warning` / `allowed_warning` : limite proche, pas encore atteinte (affichée en salle serveur, pas sur l'agent).
      if (status !== 'rejected' && status !== 'limited' && status !== 'exceeded') return next;
      return withAgent(next, id, (a) => addEffect(a, 'rate_limit', `Limite atteinte${str(p.window) ? ` (${str(p.window)})` : ''}`));
    }
    case 'run.api_retry':
      return withAgent(next, id, (a) => addEffect(a, 'retry', `Nouvelle tentative ${num(p.attempt) ?? '?'}/${num(p.max_retries) ?? '?'}`, `${num(p.attempt) ?? '?'}/${num(p.max_retries) ?? '?'}`));
    // Fin d'exécution : affichage immédiat, puis état confirmé par le serveur (l'agent peut avoir d'autres demandes
    // en file ou en attente d'approbation, que le flux d'événements seul ne permet pas de connaître).
    case 'run.succeeded':
      if (agentBusyElsewhere(next, id, e.run_id)) return { ...next, needsSnapshot: true };
      return { ...withAgent(next, id, (a) => {
        const isConv = !!a.conv && a.conv.runId === e.run_id;
        // mission réussie avec un résultat (hors conversation) : l'agent va ranger le rapport en bibliothèque
        const filed = fresh && !isConv && !!str(p.result_preview)?.trim() ? nowMs + EFFECT_TTL_MS.success + FILE_REPORT_MS : 0;
        return endConv(addEffect({ ...clearEffects(a, ['retry', 'rate_limit', 'denied']), state: 'idle', waitKind: null, runId: null, activity: null, toolKind: null, errorClass: null, since: e.ts, origin, actions: [], filedUntil: filed }, 'success', 'Exécution réussie'), e.run_id, e.ts, nowMs);
      }), needsSnapshot: true };
    case 'run.failed':
      if (agentBusyElsewhere(next, id, e.run_id)) return { ...next, needsSnapshot: true };
      return { ...withAgent(next, id, (a) => endConv({ ...clearEffects(a, ['retry']), state: 'error', waitKind: null, runId: e.run_id, activity: null, toolKind: null, errorClass: asErrorClass(p.error_class) ?? 'failed', since: e.ts, origin, actions: [] }, e.run_id, e.ts, nowMs)), needsSnapshot: true };
    default:
      return next;
  }
}

/** Fin d'une exécution de conversation : l'agent reste en salle de réunion CONV_LINGER_MS (la conversation peut reprendre). */
function endConv(a: OfficeAgentModel, runId: string | null, ts: string, nowMs: number): OfficeAgentModel {
  if (!a.conv || !runId || a.conv.runId !== runId) return a;
  return { ...a, conv: { ...a.conv, active: false, lastAt: ts, until: nowMs + CONV_LINGER_MS } };
}

export function countByState(agents: readonly OfficeAgentModel[]): Record<AgentState, number> {
  const c: Record<AgentState, number> = { idle: 0, working: 0, waiting: 0, error: 0, disabled: 0 };
  for (const a of agents) c[a.state]++;
  return c;
}
