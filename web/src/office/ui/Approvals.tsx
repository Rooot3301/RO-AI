// Approbations depuis le bureau : mêmes appels, mêmes vérifications serveur et mêmes retours que le Control Center
// (useRunActions → POST /api/runs/{id}/approve|reject, protégé par la session et le jeton CSRF du BFF).
// La demande est un contenu venant d'un utilisateur ou d'une planification : affichée comme texte, jamais interprétée.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Run } from '../../api/types.ts';
import { Button } from '../../components/ui/primitives';
import { Rel } from '../../components/ui/Time';
import { useRunActions } from '../../hooks/useRunActions';
import { useLive } from '../../store/LiveProvider';
import { pendingApprovals } from '../../lib/runs';
import { TRIGGER_LABEL } from '../../lib/labels.ts';

const PREVIEW = 280;

export function ApprovalCard({ run, showAgent = false, onDone }: { run: Run; showAgent?: boolean; onDone?: () => void }) {
  const { busy, approve, reject } = useRunActions(onDone ? () => onDone() : undefined);
  const [more, setMore] = useState(false);
  const b = busy[run.id];
  const long = run.prompt.length > PREVIEW;
  const text = more || !long ? run.prompt.slice(0, 4000) : run.prompt.slice(0, PREVIEW).trimEnd() + '…';
  return (
    <div className="office-appr" role="group" aria-label={`Demande d’approbation${showAgent ? ` de ${run.agent_name}` : ''}`}>
      <div className="office-appr__top">
        {showAgent ? <b>{run.agent_name}</b> : <b>Lancement en attente</b>}
        <span className="office-dim">{TRIGGER_LABEL[run.trigger] ?? run.trigger} · demandé <Rel iso={run.created_at} /></span>
      </div>
      <p className="office-appr__prompt untrusted">{text || '(demande vide : mission permanente de l’agent)'}</p>
      {long && <button type="button" className="office-textbtn" onClick={() => setMore((m) => !m)}>{more ? 'Réduire' : 'Lire toute la demande'}</button>}
      <div className="office-appr__actions">
        <Button variant="ok" size="sm" busy={b === 'approve'} disabled={!!b} onClick={() => void approve(run.id)}>Approuver</Button>
        <Button variant="danger" size="sm" busy={b === 'reject'} disabled={!!b} onClick={() => void reject(run.id)}>Rejeter</Button>
        <Link to={`/runs/${run.id}`} className="office-dim office-appr__more">Voir le détail</Link>
      </div>
    </div>
  );
}

/** Salle d'attente des approbations : toutes les demandes réellement en attente (même source que la vue d'ensemble). */
export function ApprovalRoomPanel({ onClose, onPick }: { onClose: () => void; onPick: (agentId: string) => void }) {
  const runs = useLive((s) => s.runs);
  const pending = runs ? pendingApprovals(runs).slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1)) : null;
  return (
    <aside className="office-inspector" aria-label="Salle d’attente des approbations">
      <header className="office-inspector__head">
        <div className="office-inspector__title">
          <h2>Approbations</h2>
          <p>Les agents réglés sur « approbation avant lancement » attendent ici votre décision. Approuver lance réellement l’exécution (et consomme du quota) ; rejeter l’annule.</p>
          <span className={`office-badge${pending?.length ? ' office-badge--waiting' : ''}`}>{pending ? `${pending.length} en attente` : '…'}</span>
        </div>
        <button type="button" className="office-iconbtn" onClick={onClose} aria-label="Fermer le panneau">×</button>
      </header>
      <div className="office-inspector__body">
        {!pending && <p className="office-dim">Chargement…</p>}
        {pending && pending.length === 0 && <p className="office-dim">Aucune demande en attente. La salle est vide.</p>}
        {pending?.map((r) => (
          <section key={r.id}>
            <ApprovalCard run={r} showAgent />
            <button type="button" className="office-textbtn" onClick={() => onPick(r.agent_id)}>Voir l’agent dans le bureau</button>
          </section>
        ))}
      </div>
    </aside>
  );
}
