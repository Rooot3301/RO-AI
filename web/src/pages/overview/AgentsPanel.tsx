import { Link } from 'react-router-dom';
import type { Agent, AgentState } from '../../api/types';
import { Button, Empty, Panel, Skeleton } from '../../components/ui/primitives';
import { AgentLed, Sprite } from '../../components/ui/domain';
import { Rel } from '../../components/ui/Time';
import { useLive } from '../../store/LiveProvider';
import { currentActivity } from '../../lib/events';
import { AGENT_STATE_LABEL, RUN_STATUS_LABEL } from '../../lib/labels';
import { IconPlus } from '../../components/ui/icons';

const ORDER: Record<AgentState, number> = { working: 0, waiting: 1, error: 2, idle: 3, disabled: 4 };
export const sortAgents = (list: readonly Agent[]) => [...list].sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name, 'fr'));

export function AgentsPanel() {
  const agents = useLive((s) => s.agents);
  const events = useLive((s) => s.events);
  const sorted = agents ? sortAgents(agents) : null;
  const shown = sorted?.slice(0, 10);
  return (
    <Panel title="Agents" id="ov-agents" flush meta={agents ? <><span className="num">{agents.filter((a) => a.state === 'working').length} au travail · {agents.length} au total</span><Link to="/agents">Tous</Link></> : null}>
      {agents == null ? <Skeleton rows={4} />
        : agents.length === 0 ? (
          <Empty title="Aucun agent" actions={<Link to="/agents/new"><Button variant="primary" size="sm"><IconPlus />Créer un agent</Button></Link>}>
            Un agent associe un fournisseur (Claude ou Codex), une mission et des permissions. Créez le premier pour lancer des exécutions.
          </Empty>
        ) : (
          <ul className="arows">
            {shown!.map((a) => {
              const act = a.state === 'working' ? currentActivity(events, a.id) : null;
              return (
                <li key={a.id} className="arow">
                  <Sprite index={a.avatar?.sprite ?? 0} size={26} />
                  <div className="arow__id">
                    <Link to={`/agents/${a.id}`} className="arow__name">{a.name}</Link>
                    <span className="micro arow__dept">{a.department} · {a.provider}</span>
                  </div>
                  <div className="arow__act untrusted ellipsis" title={act ?? undefined}>
                    {act ? <span className="amber">{act}</span>
                      : a.last_run ? <Link to={`/runs/${a.last_run.id}`} className="dim">Dernière : {RUN_STATUS_LABEL[a.last_run.status].toLowerCase()} <Rel iso={a.last_run.finished_at} /></Link>
                      : <span className="faint">Jamais lancé</span>}
                  </div>
                  <div className="arow__state"><AgentLed state={a.state} /><span className="micro">{AGENT_STATE_LABEL[a.state]}</span></div>
                </li>
              );
            })}
          </ul>
        )}
      {sorted && sorted.length > 10 && <div className="panel__foot"><Link to="/agents">{sorted.length - 10} autre(s) agent(s)</Link></div>}
    </Panel>
  );
}
