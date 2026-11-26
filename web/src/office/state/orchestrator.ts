// L'orchestrateur est le noyau de RO·AI (file, planificateur, approbations), pas un agent IA.
// Le personnage ne fait que VISUALISER ce travail réel : tout ce qu'il montre vient d'événements (run.queued, run.started,
// run.awaiting_approval, schedule.fired…). Logique pure, testable ; le dessin est dans engine/.
import type { OfficeAgentModel, OrchEvent } from './model.ts';

export const ORCH_ID = '__orchestrator__';
export const FLIGHT_MS = 950;
export const FLIGHT_SPACING_MS = 300;
/** Une fiche qui devrait partir avec plus de ce retard est sautée (on ne rattrape pas un embouteillage d'animations). */
export const MAX_LAG_MS = 2500;
export const TTL = { bell: 2800, hourglass: 8000, stop: 2500, alert: 3500, resync: 5000, pick: 700, quiet: 20000 } as const;

export interface Flight { seq: number; kind: 'dispatch' | 'reject'; agentId: string | null; runId: string | null; start: number }
export interface FlightState { lastSeq: number; lastStart: number }

/** Transforme les nouveaux événements en vols de fiches espacés de ~300 ms ; les trop tardifs ou rejoués sont ignorés. */
export function planFlights(events: readonly OrchEvent[], st: FlightState): { state: FlightState; added: Flight[] } {
  let lastSeq = st.lastSeq, lastStart = st.lastStart;
  const added: Flight[] = [];
  for (const e of events) {
    if (e.seq <= lastSeq) continue;
    lastSeq = e.seq;
    if (!e.fresh || (e.kind !== 'dispatch' && e.kind !== 'rejected')) continue;
    const start = Math.max(e.receivedAt, lastStart + FLIGHT_SPACING_MS);
    if (start - e.receivedAt > MAX_LAG_MS) continue;
    lastStart = start;
    added.push({ seq: e.seq, kind: e.kind === 'dispatch' ? 'dispatch' : 'reject', agentId: e.agentId, runId: e.runId, start });
  }
  return { state: { lastSeq, lastStart }, added };
}

export type OrchPose = 'watch' | 'pick' | 'point' | 'clipboard' | 'stop' | 'go' | 'look';
export interface OrchVisual {
  pose: OrchPose; lookAgentId: string | null;
  queueDepth: number; approvals: number; running: number;
  hourglass: boolean; bell: boolean; stop: boolean; alert: boolean; resync: boolean;
  providerAlert: Record<string, boolean>;
  /** Vrai quand rien ne se passe : il surveille ses écrans (ambiance, clairement distincte du travail réel). */
  ambient: boolean;
  /** Dernier événement qui explique la pose actuelle. */
  cause: OrchEvent | null;
}

const recent = (e: OrchEvent, now: number, ttl: number) => e.fresh && now - e.receivedAt < ttl;

export function deriveOrchVisual(
  events: readonly OrchEvent[], agents: readonly OfficeAgentModel[], providers: Readonly<Record<string, string>>,
  connection: 'connecting' | 'live' | 'reconnecting', now: number, flying: boolean,
): OrchVisual {
  let queueDepth = 0, approvals = 0, running = 0;
  for (const a of agents) {
    if (a.state === 'waiting') { queueDepth++; if (a.waitKind === 'approval') approvals++; }
    else if (a.state === 'working') running++;
  }
  const v: OrchVisual = {
    pose: 'watch', lookAgentId: null, queueDepth, approvals, running, hourglass: false, bell: false, stop: false, alert: false,
    resync: connection === 'reconnecting', providerAlert: {}, ambient: false, cause: null,
  };
  let lastFresh: OrchEvent | null = null, pickAt: OrchEvent | null = null;
  for (const e of events) {
    if (!e.fresh) continue;
    lastFresh = e;
    if (e.kind === 'schedule' && recent(e, now, TTL.bell)) { v.bell = true; v.cause = e; }
    else if (e.kind === 'rate_limit' && recent(e, now, TTL.hourglass) && !/^(ok|allowed)\b/.test(e.detail)) { v.hourglass = true; }
    else if (e.kind === 'cancelled' && recent(e, now, TTL.stop)) { v.stop = true; v.cause = e; }
    else if (e.kind === 'failed' && recent(e, now, TTL.alert)) { v.alert = true; v.lookAgentId = e.agentId; v.cause = e; }
    else if (e.kind === 'resync' && recent(e, now, TTL.resync)) v.resync = true;
    else if (e.kind === 'queued' && recent(e, now, TTL.pick)) { pickAt = e; }
  }
  for (const [id, state] of Object.entries(providers)) v.providerAlert[id] = state !== 'logged_in' && state !== 'unknown' && state !== 'not_installed';
  if (v.stop) v.pose = 'stop';
  else if (v.bell) v.pose = 'go';
  else if (flying) v.pose = 'point';
  else if (v.alert) v.pose = 'look';
  else if (approvals > 0) v.pose = 'clipboard';
  else if (pickAt) { v.pose = 'pick'; v.cause = pickAt; }
  if (!v.cause) v.cause = lastFresh;
  v.ambient = v.pose === 'watch' && !v.hourglass && !v.resync && !(lastFresh && now - lastFresh.receivedAt < TTL.quiet);
  return v;
}
