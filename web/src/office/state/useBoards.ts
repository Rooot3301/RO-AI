// Tableaux du bureau (planning du jour, limites d'usage) : GET /api/office/boards, lecture seule et sans appel aux
// clients IA. Relu quand un événement réel peut les changer (planification, exécution, limite), au plus toutes les 3 s,
// toutes les 5 min sinon (comptes à rebours, changement de jour), jamais quand l'onglet est masqué.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import type { OfficeBoards } from '../../api/types.ts';

export const BOARDS_IDLE_MS = 300_000;
export const BOARDS_DEBOUNCE_MS = 3_000;
const RELEVANT = /^(schedule\.|run\.(queued|awaiting_approval|approved|rejected|started|succeeded|failed|cancelled|rate_limit)$|agent\.(created|updated|deleted)|system\.(resumed|emergency_stop|resync))/;

/** L'événement justifie-t-il de relire les tableaux ? */
export const boardsRelevant = (type: string | null | undefined): boolean => !!type && RELEVANT.test(type);

export function useBoards(enabled: boolean, lastType: string | null, lastSeq: number): { boards: OfficeBoards | null; at: number; error: string | null } {
  const [state, setState] = useState<{ boards: OfficeBoards | null; at: number; error: string | null }>({ boards: null, at: 0, error: null });
  const load = useRef<() => void>(() => {});
  const stale = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true, busy = false, timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      if (busy) return;
      if (document.hidden) { stale.current = true; return; }
      busy = true; stale.current = false;
      try { const boards = await api.officeBoards(); if (alive) setState({ boards, at: Date.now(), error: null }); }
      catch (e) { if (alive) setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'indisponible' })); }
      finally { busy = false; if (alive) { clearTimeout(timer); timer = setTimeout(() => void run(), BOARDS_IDLE_MS); } }
    };
    load.current = () => { clearTimeout(timer); timer = setTimeout(() => void run(), BOARDS_DEBOUNCE_MS); };
    const onVis = () => { if (!document.hidden && stale.current) void run(); };
    document.addEventListener('visibilitychange', onVis);
    void run();
    return () => { alive = false; clearTimeout(timer); load.current = () => {}; document.removeEventListener('visibilitychange', onVis); };
  }, [enabled]);
  useEffect(() => { if (boardsRelevant(lastType)) load.current(); }, [lastType, lastSeq]);
  return state;
}
