import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { launchErrorMessage } from '../lib/control';
import { useLiveStore } from '../store/LiveProvider';
import { useToast } from '../store/toast';

/** Lance une exécution d'agent et ouvre son journal. Le prompt vide laisse le serveur utiliser le prompt par défaut. */
export function useLaunch() {
  const nav = useNavigate();
  const store = useLiveStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const launch = useCallback(async (agentId: string, prompt: string): Promise<boolean> => {
    setBusy(true); setError(null);
    try {
      const run = await api.runAgent(agentId, prompt.trim() ? prompt : undefined);
      store.putRun(run);
      toast.push('ok', run.status === 'awaiting_approval' ? 'Exécution créée : approbation requise avant le lancement.' : 'Exécution lancée.');
      nav(`/runs/${run.id}`);
      return true;
    } catch (e) {
      setError(e instanceof Error ? launchErrorMessage(e instanceof ApiError ? e.status : undefined, e.message) : 'Lancement impossible.');
      return false;
    } finally { setBusy(false); }
  }, [nav, store, toast]);
  return { launch, busy, error, clearError: () => setError(null) };
}
