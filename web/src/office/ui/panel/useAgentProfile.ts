// Fiche d'identité d'un agent : chargement, suivi des événements `agent.profile`, génération (jamais automatique).
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../../api/client';
import type { AgentProfile, ProviderId, RoEvent } from '../../../api/types';
import { useEventListener } from '../../../store/LiveProvider';
import { generationErrorMessage } from './profileForm.ts';

export interface GenerationStatus {
  phase: 'idle' | 'running' | 'done' | 'failed';
  provider: ProviderId | null; model: string | null; inputTokens: number | null; outputTokens: number | null; error: string | null;
}
const IDLE: GenerationStatus = { phase: 'idle', provider: null, model: null, inputTokens: null, outputTokens: null, error: null };

export interface ProfileController {
  profile: AgentProfile | null; loadError: string | null; reload: () => Promise<AgentProfile | null>;
  /** À appeler après un enregistrement (met à jour l'état local et prévient le bureau). */
  apply: (p: AgentProfile) => void;
  gen: GenerationStatus; generate: (force: boolean) => Promise<boolean>; requestError: string | null; clearGen: () => void;
}

const strOrNull = (v: unknown) => (typeof v === 'string' && v ? v : null);
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** `given` : fiche déjà connue (snapshot du bureau) ; sinon elle est chargée. `onChange` est appelé à chaque nouvelle version. */
export function useAgentProfile(agentId: string, given?: AgentProfile | null, onChange?: (p: AgentProfile) => void, provider?: ProviderId | null): ProfileController {
  const [profile, setProfile] = useState<AgentProfile | null>(given ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gen, setGen] = useState<GenerationStatus>(IDLE);
  const [requestError, setRequestError] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const apply = useCallback((p: AgentProfile) => { setProfile(p); onChangeRef.current?.(p); }, []);
  const reload = useCallback(async () => {
    try {
      const p = await api.agentProfile(agentId);
      if (!alive.current) return null;
      setLoadError(null); apply(p);
      return p;
    } catch (e) {
      if (alive.current) setLoadError(e instanceof Error ? e.message : 'Chargement impossible.');
      return null;
    }
  }, [agentId, apply]);

  // Fiche fournie par le bureau : on la suit ; sinon chargement.
  // (une version plus ancienne que celle déjà connue, ex. snapshot périmé, est ignorée)
  useEffect(() => {
    if (!given) return;
    setProfile((cur) => (!cur || cur.agent_id !== given.agent_id || (given.updated_at ?? '') >= (cur.updated_at ?? '') ? given : cur));
  }, [given]);
  useEffect(() => { if (!given) void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [agentId]);
  // Génération déjà en cours à l'ouverture.
  useEffect(() => {
    if (profile?.generating) setGen((g) => (g.phase === 'running' ? g : { ...IDLE, phase: 'running', provider: provider ?? null }));
  }, [profile?.generating, provider]);

  useEventListener((e: RoEvent) => {
    if (e.type !== 'agent.profile' || e.agent_id !== agentId) return;
    const p = e.payload ?? {};
    const prov = (strOrNull(p.provider) as ProviderId | null) ?? provider ?? null;
    switch (p.action) {
      case 'generating': setGen({ ...IDLE, phase: 'running', provider: prov }); break;
      case 'generated':
        setGen({ phase: 'done', provider: prov, model: strOrNull(p.model), inputTokens: numOrNull(p.input_tokens), outputTokens: numOrNull(p.output_tokens), error: null });
        void reload(); break;
      case 'generation_failed':
        setGen({ phase: 'failed', provider: prov, model: strOrNull(p.model), inputTokens: numOrNull(p.input_tokens), outputTokens: numOrNull(p.output_tokens), error: strOrNull(p.error) ?? 'Erreur inconnue.' });
        void reload(); break;
      case 'updated': case 'reset': void reload(); break;
      default: break;
    }
  });

  // Filet de sécurité si le flux SSE est coupé pendant une génération : relecture périodique.
  useEffect(() => {
    if (gen.phase !== 'running') return;
    const id = setInterval(() => {
      void api.agentProfile(agentId).then((p) => {
        if (!alive.current || p.generating) return;
        apply(p);
        setGen((g) => (g.phase !== 'running' ? g : p.source === 'generated' && p.generation
          ? { phase: 'done', provider: p.generation.provider, model: p.generation.model, inputTokens: p.generation.input_tokens, outputTokens: p.generation.output_tokens, error: null }
          : { ...g, phase: 'failed', error: 'La génération s’est terminée sans résultat (détail dans le journal).' }));
      }).catch(() => undefined);
    }, 6000);
    return () => clearInterval(id);
  }, [gen.phase, agentId, apply]);

  const generate = useCallback(async (force: boolean) => {
    setRequestError(null);
    try {
      await api.generateAgentProfile(agentId, force);
      if (!alive.current) return true;
      setGen((g) => (g.phase === 'running' ? g : { ...IDLE, phase: 'running', provider: provider ?? null }));
      setProfile((p) => (p ? { ...p, generating: true } : p));
      return true;
    } catch (e) {
      if (alive.current) setRequestError(generationErrorMessage(e instanceof ApiError ? e.status : undefined, e instanceof Error ? e.message : ''));
      return false;
    }
  }, [agentId, provider]);

  return { profile, loadError, reload, apply, gen, generate, requestError, clearGen: () => { setGen(IDLE); setRequestError(null); } };
}
