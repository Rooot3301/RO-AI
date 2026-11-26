// Synchronisation : snapshot au chargement, flux SSE en temps réel, resynchronisation sur
// `system.resync`, après reconnexion, ou quand un événement impose de relire l'état (agent créé/modifié).
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import type { RoEvent } from '../../api/types.ts';
import { initialModel, reduceOffice } from './model.ts';
import type { OfficeModel } from './model.ts';

export type Connection = 'connecting' | 'live' | 'reconnecting';

export interface OfficeFeed {
  model: OfficeModel;
  connection: Connection;
  /** Message d'erreur du dernier chargement de snapshot (null si OK). */
  error: string | null;
  reload: () => void;
}

const SNAPSHOT_RETRY_MS = 5000;
const SSE_RETRY_MIN_MS = 1000;
const SSE_RETRY_MAX_MS = 15000;

export function useOfficeFeed(): OfficeFeed {
  const [model, dispatch] = useReducer(reduceOffice, initialModel);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const seqRef = useRef(0);
  seqRef.current = model.seq;
  const inFlight = useRef(false);
  const pending = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);

  const loadSnapshot = useCallback(async () => {
    if (inFlight.current) { pending.current = true; return; }
    inFlight.current = true;
    try {
      const snapshot = await api.officeSnapshot();
      if (!alive.current) return;
      dispatch({ type: 'snapshot', snapshot, nowMs: Date.now() });
      seqRef.current = Math.max(seqRef.current, snapshot.seq);
      setError(null); setStarted(true);
      api.providers().then((providers) => { if (alive.current) dispatch({ type: 'providers', providers }); }).catch(() => { /* états des fournisseurs : facultatif */ });
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : 'Chargement impossible');
      clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => { void loadSnapshot(); }, SNAPSHOT_RETRY_MS);
    } finally {
      inFlight.current = false;
      if (pending.current && alive.current) { pending.current = false; void loadSnapshot(); }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void loadSnapshot();
    return () => { alive.current = false; clearTimeout(retryTimer.current); };
  }, [loadSnapshot]);

  // Flux SSE, ouvert une fois le premier snapshot reçu ; reprise depuis le dernier seq connu.
  useEffect(() => {
    if (!started) return;
    let es: EventSource | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = SSE_RETRY_MIN_MS;
    let hadError = false;
    const open = () => {
      es = new EventSource(`/api/events/stream?since=${seqRef.current}`, { withCredentials: true });
      es.onopen = () => {
        delay = SSE_RETRY_MIN_MS; setConnection('live');
        if (hadError) { hadError = false; void loadSnapshot(); } // après reconnexion : relecture de l'état
      };
      es.addEventListener('roai', (m) => {
        try {
          const event = JSON.parse((m as MessageEvent).data) as RoEvent;
          dispatch({ type: 'event', event, nowMs: Date.now() });
        } catch { /* événement illisible : ignoré */ }
      });
      es.onerror = () => {
        es?.close(); hadError = true; setConnection('reconnecting');
        if (!closed) { retry = setTimeout(open, delay); delay = Math.min(SSE_RETRY_MAX_MS, delay * 2); }
      };
    };
    open();
    return () => { closed = true; es?.close(); clearTimeout(retry); };
  }, [started, loadSnapshot]);

  // Un événement (agent.created/updated, system.resync…) demande un nouveau snapshot.
  useEffect(() => {
    if (!model.needsSnapshot) return;
    const id = setTimeout(() => { void loadSnapshot(); }, 250);
    return () => clearTimeout(id);
  }, [model.needsSnapshot, model.seq, loadSnapshot]);

  const reload = useCallback(() => { void loadSnapshot(); }, [loadSnapshot]);
  return { model, connection, error, reload };
}
