import { useState } from 'react';
import type { Agent } from '../api/types';
import { Modal } from './ui/Modal';
import { Banner, Button } from './ui/primitives';
import { Field } from './ui/forms';
import { IconPlay } from './ui/icons';
import { useLaunch } from '../hooks/useLaunch';
import { usePaused } from '../hooks/useControl';
import { STOP_BLOCKED_TEXT } from '../lib/control';

export function RunDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const { launch, busy, error } = useLaunch();
  const paused = usePaused();
  const [prompt, setPrompt] = useState('');
  const submit = async () => { await launch(agent.id, prompt); };
  return (
    <Modal title={`Lancer · ${agent.name}`} onClose={onClose} busy={busy} footer={<>
      <Button onClick={onClose} disabled={busy}>Annuler</Button>
      <Button variant="primary" busy={busy} disabled={paused} title={paused ? STOP_BLOCKED_TEXT : undefined} onClick={() => void submit()}><IconPlay />Lancer</Button>
    </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Prompt de cette exécution" hint={agent.default_prompt ? <>Laissé vide, le prompt par défaut de l’agent est utilisé :<br /><span className="untrusted mono" style={{ fontSize: 11.5 }}>{agent.default_prompt.slice(0, 280)}{agent.default_prompt.length > 280 ? '…' : ''}</span></> : 'Cet agent n’a pas de prompt par défaut : saisissez la demande à exécuter.'}>
          <textarea className="textarea" rows={6} data-autofocus value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Que doit faire l’agent ?" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit(); }} />
        </Field>
        {agent.config?.require_approval && <Banner tone="info">Cet agent exige une approbation : l’exécution restera en attente jusqu’à votre validation.</Banner>}
        {!agent.enabled && <Banner tone="warn">Cet agent est désactivé : le serveur peut refuser le lancement.</Banner>}
        {paused && <Banner tone="err">{STOP_BLOCKED_TEXT}</Banner>}
        {error && <Banner tone="err">{error}</Banner>}
      </div>
    </Modal>
  );
}
