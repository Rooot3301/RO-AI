// Conversation avec un agent (reprise de session des clients officiels) : liste des conversations, fil choisi,
// réponses en direct, envoi. Partagé par la page Chat et le panneau du personnage du bureau virtuel.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { Agent, RoEvent, Run } from '../api/types';
import { useEventListener, useLive, useLiveStore } from '../store/LiveProvider';
import { useRunActions } from './useRunActions';
import { usePaused } from './useControl';
import { launchErrorMessage } from '../lib/control';
import { canSubmitText, cleanPrompt, composerState, findConversation, groupConversations, sendTarget, type Conv, type SendTarget } from '../lib/chat';
import { loadRunEvents, mergeEvents } from '../lib/events';
import { isRunActive } from '../lib/labels';
import { upsertRun, isRunLifecycleEvent } from '../lib/runs';

export interface LiveReply { runId: string; events: RoEvent[] }

/** `key` : conversation choisie (null = nouvelle) ; `setKey` : appelé quand l'envoi crée ou change la conversation. */
export function useAgentChat(id: string, key: string | null, setKey: (k: string | null) => void) {
  const store = useLiveStore();
  const paused = usePaused();
  const liveAgent = useLive((s) => s.agents?.find((a) => a.id === id));
  const [agent, setAgent] = useState<Agent | null>(null);
  const [agentErr, setAgentErr] = useState<{ msg: string; status: number } | null>(null);
  const [list, setList] = useState<Run[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [thread, setThread] = useState<Run[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const idRef = useRef(id); idRef.current = id;

  const convs: Conv[] = useMemo(() => groupConversations(list ?? []), [list]);
  const selected: Conv | null = useMemo(() => findConversation(convs, key), [convs, key]);
  const selectedId = selected?.id ?? key;

  const loadAgent = useCallback(() => {
    api.agent(id).then((a) => { if (idRef.current === id) { setAgent(a); setAgentErr(null); } }, (e) => setAgentErr({ msg: e instanceof Error ? e.message : String(e), status: e instanceof ApiError ? e.status : 0 }));
  }, [id]);
  const loadList = useCallback(() => {
    api.runs({ agent_id: id, limit: 100 }).then((r) => { if (idRef.current === id) { setList(r); setListErr(null); } }, (e) => setListErr(e instanceof Error ? e.message : String(e)));
  }, [id]);
  const loadThread = useCallback((cid: string | null, silent = true) => {
    if (!cid) { setThread([]); return Promise.resolve(); }
    if (!silent) setThreadLoading(true);
    return api.conversation(cid).then(
      (c) => { if (idRef.current === id) setThread(c.runs); },
      () => { api.run(cid).then((r) => setThread([r]), () => setThread([])); },
    ).finally(() => setThreadLoading(false));
  }, [id]);

  useEffect(() => { setAgent(null); setList(null); setThread([]); loadAgent(); loadList(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadThread(list === null && key ? null : selectedId, false); }, [selectedId, list === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const last = thread[thread.length - 1];
  const activeRunId = last && isRunActive(last.status) ? last.id : null;
  const [live, setLive] = useState<LiveReply | null>(null);
  const activeRef = useRef<string | null>(null); activeRef.current = activeRunId;
  useEffect(() => {
    if (!activeRunId) { setLive(null); return; }
    setLive({ runId: activeRunId, events: [] });
    let alive = true;
    loadRunEvents((since) => api.runEvents(activeRunId, since)).then((evs) => { if (alive) setLive((l) => (l && l.runId === activeRunId ? { runId: l.runId, events: mergeEvents(l.events, evs) } : l)); }, () => undefined);
    return () => { alive = false; };
  }, [activeRunId]);

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const selRef = useRef<string | null>(null); selRef.current = selectedId;
  useEventListener((e) => {
    if (e.type === 'system.resync') { loadList(); void loadThread(selRef.current); return; }
    if (e.agent_id !== id) return;
    if (e.run_id && e.run_id === activeRef.current) setLive((l) => (l && l.runId === e.run_id ? { runId: l.runId, events: mergeEvents(l.events, [e]) } : l));
    if (!e.type.startsWith('run.') || !isRunLifecycleEvent(e.type)) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { loadList(); void loadThread(selRef.current); }, 250);
  });
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const actions = useRunActions(() => { loadList(); void loadThread(selRef.current); });

  const enabled = liveAgent?.enabled ?? agent?.enabled ?? true;
  const comp = composerState({ runs: thread, agentEnabled: enabled, paused, sending });

  const send = async (text: string, target: SendTarget | null): Promise<boolean> => {
    if (!target || !canSubmitText(text)) return false;
    setSending(true); setSendErr(null);
    try {
      const run = target.kind === 'new' ? await api.runAgent(id, cleanPrompt(text), 'chat') : await api.replyRun(target.runId, cleanPrompt(text));
      store.putRun(run);
      const cid = run.conversation_id ?? (target.kind === 'new' ? run.id : selectedId ?? run.id);
      setThread((t) => upsertRun(t, run).slice().reverse().sort((a, b) => (a.created_at < b.created_at ? -1 : 1)));
      if (cid !== key) setKey(cid);
      loadList(); void loadThread(cid);
      return true;
    } catch (e) {
      setSendErr(e instanceof Error ? launchErrorMessage(e instanceof ApiError ? e.status : undefined, e.message) : 'Envoi impossible.');
      return false;
    } finally { setSending(false); }
  };
  /** Envoie le brouillon dans la conversation choisie (ou en commence une). */
  const submit = (draft: string) => (comp.canSend && canSubmitText(draft) ? send(draft, sendTarget(thread)) : Promise.resolve(false));
  const newConversation = () => { setThread([]); setLive(null); setSendErr(null); setKey(null); };

  return {
    agent, agentErr, liveAgent, loadAgent, list, listErr, loadList, convs, selected, thread, threadLoading, live, last,
    sending, sendErr, enabled, paused, comp, send, submit, newConversation, ...actions,
  };
}
