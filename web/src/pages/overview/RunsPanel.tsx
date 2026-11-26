import { Link } from 'react-router-dom';
import { Empty, Panel, Skeleton } from '../../components/ui/primitives';
import { RunStatusTag } from '../../components/ui/domain';
import { Rel } from '../../components/ui/Time';
import { useLive } from '../../store/LiveProvider';
import { formatDuration } from '../../lib/format';
import { TRIGGER_LABEL } from '../../lib/labels';

export function RunsPanel() {
  const runs = useLive((s) => s.runs);
  const shown = runs?.slice(0, 8);
  return (
    <Panel title="Exécutions récentes" id="ov-runs" flush meta={<Link to="/runs">Historique</Link>}>
      {runs == null ? <Skeleton rows={5} />
        : runs.length === 0 ? <Empty title="Aucune exécution">Les exécutions apparaîtront ici dès qu’un agent aura été lancé, manuellement ou par planification.</Empty>
        : (
          <div className="tbl-scroll">
            <table className="tbl">
              <thead><tr><th>Statut</th><th>Agent</th><th>Déclencheur</th><th>Début</th><th className="col-num">Durée</th></tr></thead>
              <tbody>
                {shown!.map((r) => (
                  <tr key={r.id}>
                    <td><Link to={`/runs/${r.id}`} aria-label={`Exécution ${r.id}`}><RunStatusTag status={r.status} /></Link></td>
                    <td><Link className="rowlink" to={`/agents/${r.agent_id}`}>{r.agent_name}</Link></td>
                    <td className="dim">{TRIGGER_LABEL[r.trigger] ?? r.trigger}</td>
                    <td className="dim"><Rel iso={r.started_at ?? r.created_at} /></td>
                    <td className="col-num dim">{r.status === 'running' ? 'en cours' : formatDuration(r.duration_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Panel>
  );
}
