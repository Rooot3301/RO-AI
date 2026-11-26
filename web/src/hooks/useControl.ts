import { useLive } from '../store/LiveProvider';
import { NOT_PAUSED } from '../lib/control';

/** État d'arrêt d'urgence courant (non bloquant tant que /api/control n'a pas répondu). */
export function useControl() {
  return useLive((s) => s.control) ?? NOT_PAUSED;
}
export function usePaused(): boolean { return useControl().paused; }
