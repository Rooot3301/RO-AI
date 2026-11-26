// Sessions Claude Code en cours (GET /api/office/devteam) : relues toutes les 4 s tant que le bureau est visible,
// jamais quand l'onglet est masqué. Lecture seule ; en cas d'erreur, la dernière liste connue est gardée.
import { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import type { DevSession } from '../../api/types.ts';

export const DEVTEAM_POLL_MS = 4_000;

/** null tant que le premier relevé n'est pas arrivé (les sessions déjà actives sont alors placées directement). */
export function useDevTeam(enabled: boolean): DevSession[] | null {
  const [list, setList] = useState<DevSession[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true, busy = false;
    const run = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const r = await api.officeDevteam();
        if (alive) setList((old) => (old && JSON.stringify(old) === JSON.stringify(r.sessions) ? old : r.sessions));
      } catch { /* la dernière liste reste affichée */ }
      finally { busy = false; }
    };
    void run();
    const t = setInterval(() => void run(), DEVTEAM_POLL_MS);
    const onVis = () => { if (!document.hidden) void run(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [enabled]);
  return list;
}
