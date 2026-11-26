import type { Run, RunStatus } from '../api/types';

/** Insère ou remplace une exécution, tri par date de création décroissante, borné. */
export function upsertRun(list: readonly Run[], run: Run, max = 200): Run[] {
  const without = list.filter((r) => r.id !== run.id);
  const out = [...without, run].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1));
  return out.length > max ? out.slice(0, max) : out;
}

export function mergeRuns(a: readonly Run[], b: readonly Run[], max = 200): Run[] {
  let out: Run[] = [...a];
  for (const r of b) out = upsertRun(out, r, Infinity);
  return out.slice(0, max);
}

export const pendingApprovals = (runs: readonly Run[]): Run[] => runs.filter((r) => r.status === 'awaiting_approval');
export const activeRuns = (runs: readonly Run[]): Run[] => runs.filter((r) => r.status === 'running' || r.status === 'queued');

/** Événements `run.*` qui changent l'état d'une exécution et justifient un rafraîchissement ciblé. */
const LIFECYCLE = new Set(['run.queued', 'run.awaiting_approval', 'run.approved', 'run.rejected', 'run.started', 'run.succeeded', 'run.failed', 'run.cancelled']);
export const isRunLifecycleEvent = (type: string) => LIFECYCLE.has(type);

/** Statut attendu après un événement de cycle de vie (pour un affichage immédiat avant rafraîchissement). */
export function statusAfterEvent(type: string): RunStatus | null {
  switch (type) {
    case 'run.queued': return 'queued';
    case 'run.awaiting_approval': return 'awaiting_approval';
    case 'run.started': return 'running';
    case 'run.succeeded': return 'succeeded';
    case 'run.failed': return 'failed';
    case 'run.cancelled': return 'cancelled';
    default: return null;
  }
}

/** Ajoute un échantillon à un historique borné. */
export function pushSample(hist: readonly number[], v: number, max = 60): number[] {
  const out = [...hist, v];
  return out.length > max ? out.slice(out.length - max) : out;
}

export interface RunFilter { agent_id?: string; status?: string }
const matchRun = (r: Run, f: RunFilter) => (!f.agent_id || r.agent_id === f.agent_id) && (!f.status || r.status === f.status);

/** Superpose les exécutions « en direct » (magasin) à la page chargée : statuts à jour, nouvelles exécutions, retrait de celles qui ne correspondent plus au filtre. */
export function overlayRuns(base: readonly Run[], live: readonly Run[], f: RunFilter, hasMore: boolean): Run[] {
  const liveById = new Map(live.map((r) => [r.id, r]));
  const known = new Set(base.map((r) => r.id));
  const oldest = hasMore && base.length ? base[base.length - 1].created_at : null;
  const out: Run[] = base.map((r) => liveById.get(r.id) ?? r);
  for (const r of live) if (!known.has(r.id) && (oldest === null || r.created_at >= oldest)) out.push(r);
  return out.filter((r) => matchRun(r, f)).sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1));
}
