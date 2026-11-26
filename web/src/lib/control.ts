// Arrêt d'urgence : état de contrôle, réducteur d'événements et libellés.
import type { Control, RoEvent } from '../api/types';

export const NOT_PAUSED: Control = { paused: false, since: null, reason: null, cancelled: null };
export const STOP_BLOCKED_TEXT = 'Arrêt d’urgence actif : aucun nouveau lancement n’est possible.';
export const STOP_PREFIX = '[ARRÊT] ';

/** Applique un événement SSE à l'état de contrôle (les autres événements le laissent inchangé). */
export function reduceControl(state: Control | null, e: Pick<RoEvent, 'type' | 'ts' | 'payload'>): Control | null {
  if (e.type === 'system.emergency_stop') {
    const p = e.payload ?? {};
    return {
      paused: true, since: e.ts,
      reason: typeof p.reason === 'string' && p.reason.trim() ? p.reason : null,
      cancelled: typeof p.cancelled === 'number' && Number.isFinite(p.cancelled) ? p.cancelled : null,
    };
  }
  if (e.type === 'system.resumed') return { ...NOT_PAUSED };
  return state;
}

/** Préfixe le titre d'onglet pendant l'arrêt (idempotent). */
export function withStopPrefix(title: string, paused: boolean): string {
  const bare = title.startsWith(STOP_PREFIX) ? title.slice(STOP_PREFIX.length) : title;
  return paused ? STOP_PREFIX + bare : bare;
}

export function describeCancelled(n: number | null): string {
  if (n == null) return 'nombre d’exécutions annulées inconnu';
  if (n === 0) return 'aucune exécution annulée';
  return n === 1 ? '1 exécution annulée' : `${n} exécutions annulées`;
}

/** Un 409 de lancement dû à l'arrêt d'urgence (message du serveur ou repli clair). */
export function launchErrorMessage(status: number | undefined, detail: string): string {
  if (status === 409 && /arr[êe]t d.urgence/i.test(detail)) return STOP_BLOCKED_TEXT;
  return detail;
}
