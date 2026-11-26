import { useEffect, useRef } from 'react';
import type { RoEvent } from './types';

export type StreamStatus = 'connecting' | 'open' | 'reconnecting';

/** Ouvre le flux SSE /api/events/stream et appelle `onEvent` pour chaque événement.
 *  `since` : dernier `seq` déjà connu (reprise sans trou). Reconnexion automatique avec reprise et attente croissante.
 *  `onStatus` (optionnel) : état de la connexion, pour l'indicateur de l'interface. */
export function useEventStream(onEvent: (e: RoEvent) => void, since: number = 0, enabled = true, onStatus?: (s: StreamStatus) => void) {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  const st = useRef(onStatus);
  st.current = onStatus;
  const last = useRef(since);
  useEffect(() => { last.current = Math.max(last.current, since); }, [since]);
  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const open = () => {
      st.current?.(failures === 0 ? 'connecting' : 'reconnecting');
      es = new EventSource(`/api/events/stream?since=${last.current}`, { withCredentials: true });
      es.onopen = () => { failures = 0; st.current?.('open'); };
      es.addEventListener('roai', (m) => {
        try { const e = JSON.parse((m as MessageEvent).data) as RoEvent; last.current = Math.max(last.current, e.seq); cb.current(e); } catch { /* ignoré */ }
      });
      es.onerror = () => {
        es?.close();
        if (closed) return;
        failures += 1;
        st.current?.('reconnecting');
        retry = setTimeout(open, Math.min(10_000, 1000 * 2 ** Math.min(failures, 4)));
      };
    };
    open();
    return () => { closed = true; es?.close(); if (retry) clearTimeout(retry); };
  }, [enabled]);
}
