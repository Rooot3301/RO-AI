import { Link } from 'react-router-dom';
import { Button, Panel, Skeleton } from '../../components/ui/primitives';
import { Rel } from '../../components/ui/Time';
import { useLive } from '../../store/LiveProvider';
import { useRunActions } from '../../hooks/useRunActions';
import { pendingApprovals } from '../../lib/runs';
import { truncatePreview } from '../../lib/events';

export function ApprovalsPanel() {
  const runs = useLive((s) => s.runs);
  const { busy, approve, reject } = useRunActions();
  const pending = runs ? pendingApprovals(runs) : null;
  const n = pending?.length ?? 0;
  return (
    <Panel title="Approbations en attente" id="ov-approvals" tone={n > 0 ? 'alert' : undefined} flush={n > 0}
      meta={pending ? <span className={`num${n > 0 ? ' amber' : ''}`}>{n}</span> : null}>
      {pending == null ? <Skeleton rows={2} />
        : n === 0 ? <p className="dim" style={{ fontSize: 12.5 }}>Rien à valider. Les agents configurés avec « approbation avant lancement » attendront ici votre décision.</p>
        : (
          <ul className="apprlist">
            {pending.map((r) => {
              const b = busy[r.id];
              return (
                <li key={r.id} className="appr">
                  <div className="appr__top">
                    <Link className="rowlink appr__agent" to={`/agents/${r.agent_id}`}>{r.agent_name}</Link>
                    <span className="micro">demandée <Rel iso={r.created_at} /></span>
                  </div>
                  <p className="appr__prompt untrusted">{truncatePreview(r.prompt, 220)}</p>
                  <div className="appr__actions">
                    <Button variant="ok" size="sm" busy={b === 'approve'} disabled={!!b} onClick={() => void approve(r.id)}>Approuver</Button>
                    <Button variant="danger" size="sm" busy={b === 'reject'} disabled={!!b} onClick={() => void reject(r.id)}>Rejeter</Button>
                    <Link to={`/runs/${r.id}`} className="micro appr__more">Voir le détail</Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
    </Panel>
  );
}
