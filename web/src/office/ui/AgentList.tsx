// Liste d'agents accessible au clavier (équivalent du canvas), groupée par département.
import type { OfficeAgentModel } from '../state/model.ts';
import { STATE_LABEL_FR } from '../state/visual.ts';
import { Link } from 'react-router-dom';
import { ORCH_ID } from '../state/orchestrator.ts';

export function AgentList({ agents, departments, selectedId, onSelect }: {
  agents: readonly OfficeAgentModel[]; departments: readonly string[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const groups: { dept: string; items: OfficeAgentModel[] }[] = [];
  const order = [...departments];
  for (const a of agents) if (!order.includes(a.department)) order.push(a.department);
  for (const dept of order) groups.push({ dept, items: agents.filter((a) => a.department === dept) });
  return (
    <nav className="office-list" aria-label="Agents du bureau">
      <section aria-label="Noyau">
        <h3 className="office-list__dept">Noyau</h3>
        <ul><li>
          <button type="button" className={`office-list__item office-list__item--core${selectedId === ORCH_ID ? ' is-selected' : ''}`} aria-pressed={selectedId === ORCH_ID} onClick={() => onSelect(ORCH_ID)}>
            <span className="office-diamond" aria-hidden="true" />
            <span className="office-list__name">Orchestrateur</span>
            <span className="office-list__state">noyau</span>
          </button>
        </li></ul>
      </section>
      {agents.length === 0 && <p className="office-list__empty">Aucun agent.</p>}
      {groups.map((g) => (
        <section key={g.dept} aria-label={`Département ${g.dept}`}>
          <h3 className="office-list__dept">{g.dept}<span>{g.items.length}</span></h3>
          {g.items.length === 0 && <p className="office-list__none">aucun agent</p>}
          <ul>
            {g.items.map((a) => (
              <li key={a.id}>
                <button type="button" className={`office-list__item${a.id === selectedId ? ' is-selected' : ''}`} aria-pressed={a.id === selectedId} onClick={() => onSelect(a.id)}>
                  <span className={`office-dot office-dot--${a.state}`} aria-hidden="true" />
                  <span className="office-list__name">{a.name}</span>
                  <span className="office-list__state">{STATE_LABEL_FR[a.state]}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Link className="office-list__new" to="/agents/new">+ Nouvel agent</Link>
    </nav>
  );
}
