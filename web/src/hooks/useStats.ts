import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { Stats } from '../api/types';
import { useEventListener } from '../store/LiveProvider';

const REFRESH_MS = 60_000;
const EVENT_DEBOUNCE_MS = 1500;

/** Statistiques de consommation : chargement initial avec squelette, puis rafraîchissement discret (60 s, fin d'exécution). */
export function useStats(days: number) {
  const [data, setData] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const token = useRef(0);
  const daysRef = useRef(days);
  daysRef.current = days;

  const fetchNow = useCallback((silent: boolean) => {
    const t = ++token.current; const d = daysRef.current;
    if (!silent) { setLoading(true); setError(null); }
    api.stats(d).then(
      (s) => { if (t === token.current) { setData(s); setError(null); setLoading(false); } },
      (e) => { if (t === token.current) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); } },
    );
  }, []);

  useEffect(() => { setData(null); fetchNow(false); return () => { token.current++; }; }, [days, fetchNow]);
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') fetchNow(true); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchNow]);

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEventListener((e) => {
    if (e.type !== 'run.succeeded' && e.type !== 'run.failed' && e.type !== 'run.cancelled') return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => fetchNow(true), EVENT_DEBOUNCE_MS);
  });
  return { data, error, loading, reload: () => fetchNow(false) };
}
