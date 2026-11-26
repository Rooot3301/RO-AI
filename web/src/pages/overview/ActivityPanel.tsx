import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Empty, Panel, Skeleton } from '../../components/ui/primitives';
import { EventRow } from '../../components/EventRow';
import { useLive } from '../../store/LiveProvider';

export function ActivityPanel() {
  const events = useLive((s) => s.events);
  const ready = useLive((s) => s.ready);
  const agents = useLive((s) => s.agents);
  const names = useMemo(() => new Map((agents ?? []).map((a) => [a.id, a.name])), [agents]);
  const recent = useMemo(() => events.slice(-40).reverse(), [events]);
  return (
    <Panel title="Activité en direct" id="ov-activity" flush meta={<Link to="/logs">Journal complet</Link>}>
      {!ready ? <Skeleton rows={6} />
        : recent.length === 0 ? <Empty title="Aucun événement">Le journal est vide. L’activité des agents s’affichera ici en temps réel.</Empty>
        : <ol className="evlist activity-list" aria-live="off">{recent.map((e) => <EventRow key={e.seq} e={e} compact agentName={e.agent_id ? names.get(e.agent_id) : undefined} />)}</ol>}
    </Panel>
  );
}
