// État RÉEL du serveur RO·AI (GET /api/system) : interrogé toutes les 60 s pour l'ambiance de la salle serveur, toutes les
// 7 s quand son panneau est ouvert, et jamais quand l'onglet est masqué (reprise immédiate au retour).
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import type { SystemInfo } from '../../api/types.ts';

export const SYSTEM_IDLE_MS = 60_000;
export const SYSTEM_OPEN_MS = 7_000;

export function useSystem(enabled: boolean, open: boolean): { info: SystemInfo | null; at: number; error: string | null } {
  const [state, setState] = useState<{ info: SystemInfo | null; at: number; error: string | null }>({ info: null, at: 0, error: null });
  const last = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined, busy = false;
    const period = open ? SYSTEM_OPEN_MS : SYSTEM_IDLE_MS;
    const load = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try { const info = await api.system(); last.current = Date.now(); if (alive) setState({ info, at: last.current, error: null }); }
      catch (e) { if (alive) setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'indisponible' })); }
      finally { busy = false; }
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { void load().then(() => { if (alive) schedule(); }); }, Math.max(0, period - (Date.now() - last.current))); };
    const onVis = () => { if (document.hidden) clearTimeout(timer); else schedule(); };
    document.addEventListener('visibilitychange', onVis);
    if (!document.hidden) schedule();
    return () => { alive = false; clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); };
  }, [enabled, open]);
  return state;
}
