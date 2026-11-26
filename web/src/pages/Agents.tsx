import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Agent, AgentState, ProviderId } from '../api/types';
import { api } from '../api/client';
import { Button, Empty, LoadError, Panel, Skeleton, Tag } from '../components/ui/primitives';
import { AgentBadges, AgentStateText, RunStatusTag, Sprite } from '../components/ui/domain';
import { Switch } from '../components/ui/forms';
import { Rel } from '../components/ui/Time';
import { RunDialog } from '../components/RunDialog';
import { IconEdit, IconPlay, IconPlus } from '../components/ui/icons';
import { useLive, useLiveStore } from '../store/LiveProvider';
import { useToast } from '../store/toast';
import { useDocumentTitle } from '../hooks/useNow';
import { usePaused } from '../hooks/useControl';
import { STOP_BLOCKED_TEXT } from '../lib/control';
import { agentToInput } from '../lib/agentForm';
import { AGENT_STATE_LABEL, DOMAIN_LABEL, PROVIDER_LABEL } from '../lib/labels';
import { sortAgents } from './overview/AgentsPanel';
import './Agents.css';

export default function AgentsPage() {
  useDocumentTitle('Agents');
  const store = useLiveStore();
  const toast = useToast();
  const agents = useLive((s) => s.agents);
  const loadError = useLive((s) => s.loadError);
  const [q, setQ] = useState('');
  const [provider, setProvider] = useState<'' | ProviderId>('');
  const [state, setState] = useState<'' | AgentState>('');
  const [dept, setDept] = useState('');
  const [dom, setDom] = useState<'' | 'perso' | 'pro'>('');
  const [runFor, setRunFor] = useState<Agent | null>(null);
  const paused = usePaused();
  const [toggling, setToggling] = useState<Record<string, boolean>>({});

  const depts = useMemo(() => [...new Set((agents ?? []).map((a) => a.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')), [agents]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return sortAgents((agents ?? []).filter((a) =>
      (!provider || a.provider === provider) && (!state || a.state === state) && (!dept || a.department === dept) && (!dom || a.domain === dom)
      && (!s || `${a.name} ${a.slug} ${a.description} ${a.department}`.toLowerCase().includes(s))));
  }, [agents, q, provider, state, dept, dom]);

  const toggle = async (a: Agent, enabled: boolean) => {
    setToggling((t) => ({ ...t, [a.id]: true }));
    try { await api.updateAgent(a.id, agentToInput(a, { enabled })); store.refetchAgents(); toast.push('ok', enabled ? `« ${a.name} » activé.` : `« ${a.name} » désactivé.`); }
    catch (e) { toast.push('err', e instanceof Error ? e.message : 'Modification impossible.'); }
    finally { setToggling((t) => ({ ...t, [a.id]: false })); }
  };

  const filtered = !!(q || provider || state || dept || dom);
  return (
    <div className="page">
      <div className="page__head">
        <div className="page__titles">
          <div className="micro page__crumb">Opérations</div>
          <h1 className="page__title">Agents</h1>
          <p className="page__sub">Chaque agent combine un fournisseur, une mission, des permissions et une limite de durée. Les modifications s’appliquent aux prochaines exécutions.</p>
        </div>
        <div className="page__actions"><Link to="/agents/new"><Button variant="primary"><IconPlus />Nouvel agent</Button></Link></div>
      </div>

      {loadError && !agents && <LoadError message={loadError} onRetry={store.retryLoad} />}
      <Panel flush>
        <div className="toolbar">
          <div className="field toolbar__grow"><label className="field__label" htmlFor="ag-q">Recherche</label><input id="ag-q" className="input" type="search" placeholder="Nom, description, département…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="field"><label className="field__label" htmlFor="ag-p">Fournisseur</label>
            <select id="ag-p" className="select" value={provider} onChange={(e) => setProvider(e.target.value as '' | ProviderId)}><option value="">Tous</option><option value="claude">Claude</option><option value="codex">Codex</option></select></div>
          <div className="field"><label className="field__label" htmlFor="ag-s">État</label>
            <select id="ag-s" className="select" value={state} onChange={(e) => setState(e.target.value as '' | AgentState)}><option value="">Tous</option>{(Object.keys(AGENT_STATE_LABEL) as AgentState[]).map((s) => <option key={s} value={s}>{AGENT_STATE_LABEL[s]}</option>)}</select></div>
          <div className="field"><label className="field__label" htmlFor="ag-dom">Domaine</label>
            <select id="ag-dom" className="select" value={dom} onChange={(e) => setDom(e.target.value as '' | 'perso' | 'pro')}><option value="">Tous</option><option value="perso">Perso</option><option value="pro">Pro</option></select></div>
          <div className="field"><label className="field__label" htmlFor="ag-d">Département</label>
            <select id="ag-d" className="select" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">Tous</option>{depts.map((d) => <option key={d} value={d}>{d}</option>)}</select></div>
        </div>
        {agents == null ? <Skeleton rows={6} />
          : agents.length === 0 ? (
            <Empty title="Aucun agent configuré" actions={<Link to="/agents/new"><Button variant="primary" size="sm"><IconPlus />Créer un agent</Button></Link>}>
              Créez un agent pour lui confier une mission récurrente ou ponctuelle. Vous choisirez son fournisseur, ses outils autorisés et s’il doit attendre votre approbation.
            </Empty>
          ) : rows.length === 0 ? <Empty title="Aucun résultat" actions={filtered ? <Button size="sm" onClick={() => { setQ(''); setProvider(''); setState(''); setDept(''); setDom(''); }}>Effacer les filtres</Button> : undefined}>Aucun agent ne correspond à ces critères.</Empty>
          : (
            <div className="tbl-scroll">
              <table className="tbl agents-tbl">
                <thead><tr><th>État</th><th>Agent</th><th>Moteur</th><th>Département</th><th>Dernière exécution</th><th>Actif</th><th className="col-act"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id}>
                      <td><AgentStateText state={a.state} /></td>
                      <td>
                        <div className="agcell">
                          <Sprite index={a.avatar?.sprite ?? 0} size={28} />
                          <div className="agcell__txt">
                            <Link to={`/agents/${a.id}`} className="rowlink">{a.name}</Link>
                            <span className="mono faint agcell__slug">{a.slug}</span>
                            <AgentBadges config={a.config} />
                          </div>
                        </div>
                      </td>
                      <td><span>{PROVIDER_LABEL[a.provider]}</span>{a.model ? <span className="mono dim"> · {a.model}</span>
                        : a.last_model ? <span className="dim" title="Aucun modèle imposé : modèle par défaut du fournisseur, constaté à la dernière exécution"> · <span className="mono">{a.last_model}</span> <span className="faint">(défaut)</span></span>
                        : <span className="faint"> · modèle par défaut</span>}</td>
                      <td>{a.department} <Tag tone={a.domain === 'perso' ? 'info' : 'neutral'}>{DOMAIN_LABEL[a.domain]}</Tag></td>
                      <td>{a.last_run ? <Link to={`/runs/${a.last_run.id}`} className="lastrun"><RunStatusTag status={a.last_run.status} /><span className="dim"><Rel iso={a.last_run.finished_at} /></span></Link> : <span className="faint">Jamais lancé</span>}</td>
                      <td><Switch checked={a.enabled} disabled={toggling[a.id]} onChange={(v) => void toggle(a, v)} label={`${a.enabled ? 'Désactiver' : 'Activer'} ${a.name}`} /></td>
                      <td className="col-act">
                        <Button size="sm" variant="primary" disabled={!a.enabled || paused} title={paused ? STOP_BLOCKED_TEXT : a.enabled ? 'Lancer une exécution' : 'Agent désactivé'} onClick={() => setRunFor(a)}><IconPlay />Lancer</Button>
                        <Link to={`/agents/${a.id}/chat`}><Button size="sm" aria-label={`Parler avec ${a.name}`}>Parler</Button></Link>
                        <Link to={`/agents/${a.id}`}><Button size="sm" aria-label={`Configurer ${a.name}`}><IconEdit />Configurer</Button></Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Panel>
      {runFor && <RunDialog agent={runFor} onClose={() => setRunFor(null)} />}
    </div>
  );
}
