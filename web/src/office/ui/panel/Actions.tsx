// Actions du panneau personnage : instructions courtes (suite de la dernière conversation) et nouvelle mission.
// Les lancements restent dans le bureau (pas de navigation forcée) et respectent l'arrêt d'urgence.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../../api/client';
import type { Agent, Run } from '../../../api/types';
import { Modal } from '../../../components/ui/Modal';
import { Banner, Button } from '../../../components/ui/primitives';
import { Field } from '../../../components/ui/forms';
import { IconPlay } from '../../../components/ui/icons';
import { usePaused } from '../../../hooks/useControl';
import { STOP_BLOCKED_TEXT, launchErrorMessage } from '../../../lib/control';
import { canSubmitText, cleanPrompt } from '../../../lib/chat';
import { useLiveStore } from '../../../store/LiveProvider';
import { useToast } from '../../../store/toast';
import { Overlay } from './Overlay.tsx';
import { chatUrl, instructionTarget } from './inspectorLogic.ts';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? launchErrorMessage(e instanceof ApiError ? e.status : undefined, e.message) : fallback);

/** Composeur d'instructions : répond dans la dernière conversation si possible, sinon renvoie vers le chat. */
export function InstructionComposer({ agentId, agentEnabled, runs, onSent, onOpenChat }: { agentId: string; agentEnabled: boolean; runs: readonly Run[] | null; onSent: (r: Run) => void; /** Ouvre la conversation dans le panneau (sinon lien vers la page Chat). */ onOpenChat?: (conversationId: string | null) => void }) {
  const paused = usePaused();
  const toast = useToast();
  const store = useLiveStore();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Run | null>(null);
  if (!runs) return <p className="faint cp-small">Chargement des conversations…</p>;
  const target = instructionTarget(runs, { agentEnabled, paused });

  const send = async () => {
    if (target.kind !== 'reply' || !canSubmitText(text) || sending) return;
    setSending(true); setError(null);
    try {
      const run = await api.replyRun(target.runId, cleanPrompt(text));
      store.putRun(run);
      setText(''); setSent(run); onSent(run);
      toast.push('ok', run.status === 'awaiting_approval' ? 'Instructions envoyées : approbation requise avant le lancement.' : 'Instructions envoyées.');
    } catch (e) { setError(errText(e, 'Envoi impossible.')); }
    finally { setSending(false); }
  };

  if (target.kind === 'chat') {
    return (
      <div className="cp-compose">
        <p className="cp-small faint">{target.reason}</p>
        {paused && <Banner tone="err">{STOP_BLOCKED_TEXT}</Banner>}
        {onOpenChat ? <button type="button" className="btn btn--sm" onClick={() => onOpenChat(target.conversationId)}>{target.conversationId ? 'Ouvrir la conversation' : 'Discuter'}</button>
          : <Link className="btn btn--sm" to={chatUrl(agentId, target.conversationId)}>{target.conversationId ? 'Ouvrir la conversation' : 'Ouvrir le chat'}</Link>}
      </div>
    );
  }
  return (
    <div className="cp-compose">
      <label className="cp-small faint" htmlFor={`cp-compose-${agentId}`}>Poursuit la conversation « <span className="untrusted">{target.title}</span> »</label>
      <textarea id={`cp-compose-${agentId}`} className="textarea cp-compose__ta" rows={3} value={text} maxLength={20000} placeholder="Consigne courte pour l’agent…"
        onChange={(e) => { setText(e.target.value); setError(null); }}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send(); } }} />
      {error && <Banner tone="err">{error}</Banner>}
      {sent && !error && <p className="cp-small faint">Envoyé · <Link to={`/runs/${sent.id}`}>suivre l’exécution</Link></p>}
      <div className="cp-compose__row">
        {onOpenChat ? <button type="button" className="cp-linkbtn cp-small" onClick={() => onOpenChat(target.conversationId)}>Voir la conversation</button>
          : <Link className="cp-small" to={chatUrl(agentId, target.conversationId)}>Ouvrir le chat</Link>}
        <span className="cp-grow" />
        <span className="cp-small faint">Ctrl+Entrée</span>
        <Button size="sm" variant="primary" busy={sending} disabled={!canSubmitText(text)} onClick={() => void send()}>Envoyer</Button>
      </div>
    </div>
  );
}

/** Nouvelle mission (exécution indépendante) depuis le bureau : reste sur place, lien vers le journal. */
export function MissionDialog({ agent, onClose, onLaunched }: { agent: Agent; onClose: () => void; onLaunched: (r: Run) => void }) {
  const paused = usePaused();
  const toast = useToast();
  const store = useLiveStore();
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noDefault = !agent.default_prompt?.trim();
  const submit = async () => {
    if (busy || paused || (noDefault && !prompt.trim())) return;
    setBusy(true); setError(null);
    try {
      const run = await api.runAgent(agent.id, prompt.trim() ? prompt : undefined);
      store.putRun(run);
      toast.push('ok', run.status === 'awaiting_approval' ? 'Mission créée : approbation requise avant le lancement.' : 'Mission lancée : suivez l’agent dans le bureau.');
      onLaunched(run); onClose();
    } catch (e) { setError(errText(e, 'Lancement impossible.')); }
    finally { setBusy(false); }
  };
  return (
    <Overlay>
      <Modal title={`Nouvelle mission · ${agent.name}`} onClose={onClose} busy={busy} footer={<>
        <Button onClick={onClose} disabled={busy}>Annuler</Button>
        <Button variant="primary" busy={busy} disabled={paused || (noDefault && !prompt.trim())} title={paused ? STOP_BLOCKED_TEXT : undefined} onClick={() => void submit()}><IconPlay />Lancer</Button>
      </>}>
        <div className="cp-col">
          <Field label="Demande" hint={noDefault ? 'Cet agent n’a pas de prompt par défaut : décrivez la mission.' : <>Laissée vide, le prompt par défaut est utilisé :<br /><span className="untrusted mono cp-small">{agent.default_prompt.slice(0, 280)}{agent.default_prompt.length > 280 ? '…' : ''}</span></>}>
            <textarea className="textarea" rows={6} data-autofocus value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Que doit faire l’agent ?"
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit(); }} />
          </Field>
          <p className="cp-small faint">Une mission démarre une nouvelle exécution (sans le contexte des conversations précédentes). Pour poursuivre un échange, utilisez plutôt « Instructions ».</p>
          {agent.config?.require_approval && <Banner tone="info">Cet agent exige une approbation : la mission restera en attente jusqu’à votre validation.</Banner>}
          {!agent.enabled && <Banner tone="warn">Cet agent est désactivé : le serveur peut refuser le lancement.</Banner>}
          {paused && <Banner tone="err">{STOP_BLOCKED_TEXT}</Banner>}
          {error && <Banner tone="err">{error}</Banner>}
        </div>
      </Modal>
    </Overlay>
  );
}
