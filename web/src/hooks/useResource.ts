import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';

export interface Resource<T> {
  data: T | null; error: string | null; loading: boolean; status: number | null;
  reload: () => void; setData: (v: T | ((prev: T | null) => T | null) | null) => void;
}

/** Charge une ressource, ignore les réponses périmées, expose rechargement et mise à jour locale. */
export function useResource<T>(fetcher: () => Promise<T>, deps: readonly unknown[]): Resource<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean; status: number | null }>({ data: null, error: null, loading: true, status: null });
  const token = useRef(0);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  const run = useCallback((keepData: boolean) => {
    const t = ++token.current;
    setState((s) => ({ data: keepData ? s.data : null, error: null, loading: true, status: null }));
    fetchRef.current().then(
      (data) => { if (t === token.current) setState({ data, error: null, loading: false, status: 200 }); },
      (e) => { if (t === token.current) setState((s) => ({ data: keepData ? s.data : null, error: e instanceof Error ? e.message : String(e), loading: false, status: e instanceof ApiError ? e.status : 0 })); },
    );
  }, []);

  useEffect(() => { run(false); return () => { token.current++; }; }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(() => run(true), [run]);
  const setData = useCallback((v: T | ((p: T | null) => T | null) | null) => {
    setState((s) => ({ ...s, data: typeof v === 'function' ? (v as (p: T | null) => T | null)(s.data) : v }));
  }, []);
  return { ...state, reload, setData };
}
