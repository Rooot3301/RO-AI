// Panneau personnage : statistiques sur les exécutions récentes, prochaine mission, cible des instructions (logique pure).
import type { Agent, ProviderId, Run, Schedule } from '../../../api/types';
import { composerState, groupConversations, sendTarget } from '../../../lib/chat.ts';
import { PROVIDER_LABEL } from '../../../lib/labels.ts';

export interface RunStats {
  /** Exécutions prises en compte (les plus récentes, tous statuts). */
  count: number; succeeded: number; failed: number; cancelled: number; active: number;
  /** Réussites / exécutions terminées (réussies + échecs ; les annulations sont exclues). null sans exécution terminée. */
  successRate: number | null;
  avgDurationMs: number | null; inputTokens: number; outputTokens: number;
  /** Série de réussites consécutives en cours (depuis la plus récente terminée). */
  streak: number;
  lastSuccessAt: string | null; lastFailureAt: string | null;
}

const isActive = (s: Run['status']) => s === 'queued' || s === 'awaiting_approval' || s === 'running';

/** Statistiques calculées sur une liste d'exécutions (ordre quelconque). */
export function computeRunStats(runs: readonly Run[]): RunStats {
  const sorted = [...runs].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  let succeeded = 0; let failed = 0; let cancelled = 0; let active = 0; let durSum = 0; let durN = 0; let inTok = 0; let outTok = 0;
  let lastSuccessAt: string | null = null; let lastFailureAt: string | null = null;
  for (const r of sorted) {
    if (r.status === 'succeeded') { succeeded++; lastSuccessAt ??= r.finished_at ?? r.created_at; }
    else if (r.status === 'failed') { failed++; lastFailureAt ??= r.finished_at ?? r.created_at; }
    else if (r.status === 'cancelled') cancelled++;
    else if (isActive(r.status)) active++;
    if (!isActive(r.status) && typeof r.duration_ms === 'number' && Number.isFinite(r.duration_ms) && r.duration_ms >= 0) { durSum += r.duration_ms; durN++; }
    if (r.usage) { inTok += r.usage.input_tokens || 0; outTok += r.usage.output_tokens || 0; }
  }
  let streak = 0;
  for (const r of sorted) {
    if (isActive(r.status) || r.status === 'cancelled') continue;
    if (r.status === 'succeeded') streak++; else break;
  }
  const done = succeeded + failed;
  return {
    count: sorted.length, succeeded, failed, cancelled, active,
    successRate: done ? succeeded / done : null, avgDurationMs: durN ? durSum / durN : null,
    inputTokens: inTok, outputTokens: outTok, streak, lastSuccessAt, lastFailureAt,
  };
}

export interface NextMission { scheduleId: string; name: string; at: string; prompt: string; cron: string; timezone: string }
/** Prochaine planification active de l'agent (next_run_at le plus proche). */
export function nextMission(agentId: string, schedules: readonly Schedule[]): NextMission | null {
  let best: Schedule | null = null;
  for (const s of schedules) {
    if (s.agent_id !== agentId || !s.enabled || !s.next_run_at || Number.isNaN(Date.parse(s.next_run_at))) continue;
    if (!best || Date.parse(s.next_run_at) < Date.parse(best.next_run_at!)) best = s;
  }
  return best ? { scheduleId: best.id, name: best.name, at: best.next_run_at!, prompt: best.prompt, cron: best.cron, timezone: best.timezone } : null;
}
export const activeSchedulesCount = (agentId: string, schedules: readonly Schedule[]) => schedules.filter((s) => s.agent_id === agentId && s.enabled).length;

/** Modèle affiché : modèle imposé, sinon dernier modèle utilisé « (défaut) », sinon « par défaut ». */
export function modelLabel(a: Pick<Agent, 'model' | 'last_model'> | null | undefined): { text: string; isDefault: boolean } {
  const m = a?.model?.trim();
  if (m) return { text: m, isDefault: false };
  const last = a?.last_model?.trim();
  return last ? { text: `${last} (défaut)`, isDefault: true } : { text: 'par défaut du fournisseur', isDefault: true };
}
export const providerLabel = (p: ProviderId | null | undefined) => (p ? PROVIDER_LABEL[p] ?? p : '—');

export type InstructionTarget =
  | { kind: 'reply'; runId: string; conversationId: string; title: string }
  | { kind: 'chat'; conversationId: string | null; reason: string; blocked: boolean };

/** Instructions courtes : poursuivre la dernière conversation (réponse) si elle existe et n'est pas occupée ; sinon ouvrir le chat.
 *  `blocked` = l'envoi est impossible pour une raison globale (arrêt d'urgence, agent désactivé) : le chat ne servirait pas davantage. */
export function instructionTarget(runs: readonly Run[], o: { agentEnabled: boolean; paused: boolean; sending?: boolean }): InstructionTarget {
  const conv = groupConversations(runs)[0] ?? null;
  if (!conv) {
    const st = composerState({ runs: [], agentEnabled: o.agentEnabled, paused: o.paused, sending: o.sending });
    return { kind: 'chat', conversationId: null, reason: st.reason ?? 'Aucune conversation en cours : ouvrez le chat pour en démarrer une.', blocked: !st.canSend };
  }
  const st = composerState({ runs: conv.runs, agentEnabled: o.agentEnabled, paused: o.paused, sending: o.sending });
  const target = sendTarget(conv.runs);
  if (st.canSend && target?.kind === 'reply') return { kind: 'reply', runId: target.runId, conversationId: conv.id, title: conv.title };
  const global = o.paused || !o.agentEnabled;
  return { kind: 'chat', conversationId: conv.id, reason: st.reason ?? 'Cette conversation ne peut pas être reprise : ouvrez le chat.', blocked: global || !!o.sending };
}

export const chatUrl = (agentId: string, conversationId: string | null) => `/agents/${agentId}/chat${conversationId ? `?c=${encodeURIComponent(conversationId)}` : ''}`;

/** Première ligne non vide d'un texte (prompt, résultat), tronquée. */
export function firstLine(s: string | null | undefined, max = 140): string {
  const line = (s ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}
