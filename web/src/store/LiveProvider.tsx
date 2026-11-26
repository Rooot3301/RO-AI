import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import { useEventStream } from '../api/events';
import { LiveStore, type LiveState } from './liveStore';
import { useAuth } from './auth';

const Ctx = createContext<LiveStore | null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const store = useMemo(() => new LiveStore(() => auth.expire()), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void store.start(); return () => store.stop(); }, [store]);
  const ready = useSyncExternalStore(store.subscribe, () => store.getSnapshot().ready);
  const lastSeq = useRef(0);
  lastSeq.current = useSyncExternalStore(store.subscribe, () => store.getSnapshot().lastSeq);
  const seqAtReady = useRef<number | null>(null);
  if (ready && seqAtReady.current == null) seqAtReady.current = lastSeq.current;
  // Si la session expire pendant que le flux est coupé, on le détecte via /auth/me.
  const checking = useRef(false);
  const onStatus = useCallback((s: Parameters<typeof store.setConn>[0]) => {
    store.setConn(s);
    if (s === 'reconnecting' && !checking.current) {
      checking.current = true;
      void api.me().catch((e) => { if (e instanceof ApiError && e.status === 401) auth.expire(); }).finally(() => { checking.current = false; });
    }
  }, [store, auth]);
  useEventStream(store.ingest, seqAtReady.current ?? 0, ready, onStatus);
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useLiveStore(): LiveStore {
  const s = useContext(Ctx);
  if (!s) throw new Error('LiveProvider manquant');
  return s;
}

/** Sélecteur : ne renvoyer que des références stables du magasin (pas de nouveaux objets). */
export function useLive<T>(selector: (s: LiveState) => T): T {
  const store = useLiveStore();
  return useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()));
}

/** Abonnement aux événements bruts, pour un composant (journal d'exécution, listes filtrées…). */
export function useEventListener(fn: (e: import('../api/types').RoEvent) => void) {
  const store = useLiveStore();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => store.onEvent((e) => ref.current(e)), [store]);
}
