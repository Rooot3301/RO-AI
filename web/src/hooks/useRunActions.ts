import { useCallback, useState } from 'react';
import { api } from '../api/client';
import type { Run } from '../api/types';
import { useLiveStore } from '../store/LiveProvider';
import { useToast } from '../store/toast';

type Action = 'cancel' | 'approve' | 'reject';
const CALLS: Record<Action, (id: string) => Promise<Run>> = { cancel: api.cancelRun, approve: api.approveRun, reject: api.rejectRun };
const OK: Record<Action, string> = { cancel: 'Exécution annulée.', approve: 'Exécution approuvée.', reject: 'Exécution rejetée.' };

/** Actions sur une exécution, avec état « occupé » par identifiant et retour utilisateur réel (succès ou détail d'erreur). */
export function useRunActions(onDone?: (run: Run, action: Action) => void) {
  const store = useLiveStore();
  const toast = useToast();
  const [busy, setBusy] = useState<Record<string, Action | undefined>>({});
  const act = useCallback(async (id: string, action: Action) => {
    setBusy((b) => ({ ...b, [id]: action }));
    try {
      const run = await CALLS[action](id);
      store.putRun(run);
      toast.push('ok', OK[action]);
      onDone?.(run, action);
    } catch (e) {
      toast.push('err', e instanceof Error ? e.message : 'Action impossible.');
      if (e && (e as { status?: number }).status === 409) store.refetchRuns();
    } finally { setBusy((b) => ({ ...b, [id]: undefined })); }
  }, [store, toast, onDone]);
  return { busy, approve: (id: string) => act(id, 'approve'), reject: (id: string) => act(id, 'reject'), cancel: (id: string) => act(id, 'cancel') };
}
