import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/primitives';
import { confirmsUnrestricted, UNRESTRICTED_CONFIRM_TEXT } from '../../lib/agentForm';

export function UnrestrictedDialog({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const [typed, setTyped] = useState('');
  const ok = confirmsUnrestricted(typed);
  return (
    <Modal wide title="Activer le mode libre" onClose={onCancel} footer={<>
      <Button onClick={onCancel} data-autofocus>Annuler</Button>
      <Button variant="stop" disabled={!ok} onClick={onConfirm}>Activer le mode libre</Button>
    </>}>
      <div className="stopdlg">
        <p><strong>Le mode libre est un dernier recours.</strong> L’agent perd ses garde-fous habituels :</p>
        <ul>
          <li><strong>plus de bac à sable ni de restriction d’outils</strong> : l’agent peut tout faire que l’utilisateur système <code>agent</code> peut faire ;</li>
          <li>il peut <strong>lire et modifier tout ce que cet utilisateur atteint</strong>, y compris les identifiants de son propre client IA ;</li>
          <li><strong>une page web piégée pourrait le manipuler</strong> (injection de prompt) et lui faire exécuter des actions que vous n’avez pas voulues.</li>
        </ul>
        <p>RO·AI conserve malgré tout :</p>
        <ul>
          <li>l’absence de droits root, et des limites de ressources (mémoire, durée) ;</li>
          <li>les secrets de RO·AI (jeton du bot, webhooks, base de données), inaccessibles à l’agent ;</li>
          <li>l’<strong>approbation humaine obligatoire avant chaque lancement</strong> ;</li>
          <li>l’arrêt d’urgence.</li>
        </ul>
        <div className="field">
          <label className="field__label" htmlFor="unr-confirm">Pour confirmer, saisissez <code>{UNRESTRICTED_CONFIRM_TEXT}</code></label>
          <input id="unr-confirm" className="input input--mono" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (ok) onConfirm(); } }} />
        </div>
      </div>
    </Modal>
  );
}
