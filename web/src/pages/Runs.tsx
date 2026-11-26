import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Run, RunStatus } from '../api/types';
import { Button, Empty, LoadError, Panel, Skeleton } from '../components/ui/primitives';
import { RunStatusTag } from '../components/ui/domain';
import { Rel } from '../components/ui/Time';
import { useLive } from '../store/LiveProvider';
import { useDocumentTitle } from '../hooks/useNow';
import { overlayRuns } from '../lib/runs';
import { formatCost, formatDuration, formatTokens } from '../lib/format';
import { ERROR_CLASS_LABEL, RUN_STATUS_LABEL, TRIGGER_LABEL } from '../lib/labels';

const PAGE = 50;

export default function RunsPage() {
  useDocumentTitle('Exécutions');
  const [params, setParams] = useSearchParams();
  const agentId = params.get('agent_id') ?? '';
  const status = params.get('status') ?? '';
  const agents = useLive((s) => s.agents);
  const liveRuns = useLive((s) => s.runs);
  const [page, setPage] = useState<Run[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setPage(null); setError(null);
    api.runs({ agent_id: agentId, status, limit: PAGE }).then((r) => { if (alive) { setPage(r); setHasMore(r.length >= PAGE); } }, (e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [agentId, status, reloadKey]);

  const loadMore = useCallback(async () => {
    if (!page || page.length === 0) return;
    setLoadingMore(true);
    try {
      const more = await api.runs({ agent_id: agentId, status, limit: PAGE, before: page[page.length - 1].created_at });
      const ids = new Set(page.map((r) => r.id));
      setPage([...page, ...more.filter((r) => !ids.has(r.id))]);
      setHasMore(more.length >= PAGE);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoadingMore(false); }
  }, [page, agentId, status]);

  const rows = useMemo(() => (page ? overlayRuns(page, liveRuns ?? [], { agent_id: agentId, status }, hasMore) : null), [page, liveRuns, agentId, status, hasMore]);
  const setFilter = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const filtered = !!(agentId || status);

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__titles">
          <div className="micro page__crumb">Opérations</div>
          <h1 className="page__title">Exécutions</h1>
          <p className="page__sub">Historique de toutes les exécutions, de la plus récente à la plus ancienne. Les statuts se mettent à jour en direct.</p>
        </div>
      </div>
      <Panel flush>
        <div className="toolbar">
          <div className="field"><label className="field__label" htmlFor="rn-a">Agent</label>
            <select id="rn-a" className="select" value={agentId} onChange={(e) => setFilter('agent_id', e.target.value)}>
              <option value="">Tous les agents</option>
              {agentId && !agents?.some((a) => a.id === agentId) && <option value={agentId}>{agentId}</option>}
              {(agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></div>
          <div className="field"><label className="field__label" htmlFor="rn-s">Statut</label>
            <select id="rn-s" className="select" value={status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">Tous</option>
              {(Object.keys(RUN_STATUS_LABEL) as RunStatus[]).map((s) => <option key={s} value={s}>{RUN_STATUS_LABEL[s]}</option>)}
            </select></div>
          {filtered && <div className="toolbar__end"><Button size="sm" variant="ghost" onClick={() => setParams({}, { replace: true })}>Effacer les filtres</Button></div>}
        </div>
        {error && !rows ? <div style={{ padding: 12 }}><LoadError message={error} onRetry={() => setReloadKey((k) => k + 1)} /></div>
          : rows == null ? <Skeleton rows={8} />
          : rows.length === 0 ? <Empty title={filtered ? 'Aucune exécution pour ces filtres' : 'Aucune exécution'} actions={filtered ? <Button size="sm" onClick={() => setParams({}, { replace: true })}>Effacer les filtres</Button> : <Link to="/agents"><Button size="sm">Choisir un agent à lancer</Button></Link>}>
              {filtered ? 'Élargissez les critères pour voir plus de résultats.' : 'Lancez un agent depuis la liste des agents ou attendez le déclenchement d’une planification.'}
            </Empty>
          : (
            <>
              <div className="tbl-scroll">
                <table className="tbl">
                  <thead><tr><th>Statut</th><th>Agent</th><th>Déclencheur</th><th>Créée</th><th className="col-num">Durée</th><th className="col-num">Tours</th><th className="col-num">Tokens e/s</th><th className="col-num">Coût estimé</th><th>Détail</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td><RunStatusTag status={r.status} /></td>
                        <td><Link className="rowlink" to={`/agents/${r.agent_id}`}>{r.agent_name}</Link></td>
                        <td className="dim">{TRIGGER_LABEL[r.trigger] ?? r.trigger}</td>
                        <td className="dim"><Rel iso={r.created_at} /></td>
                        <td className="col-num">{r.status === 'running' ? <span className="amber">en cours</span> : formatDuration(r.duration_ms)}</td>
                        <td className="col-num dim">{r.num_turns ?? '—'}</td>
                        <td className="col-num dim">{r.usage ? `${formatTokens(r.usage.input_tokens)} / ${formatTokens(r.usage.output_tokens)}` : '—'}</td>
                        <td className="col-num dim">{formatCost(r.cost_usd_estimate)}</td>
                        <td>
                          <Link to={`/runs/${r.id}`} className="mono" style={{ fontSize: 11.5 }}>{r.id}</Link>
                          {r.error_class && <span className="err-text" style={{ marginLeft: 8, fontSize: 12 }}>{ERROR_CLASS_LABEL[r.error_class]}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="panel__foot" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="num">{rows.length} exécution(s) affichée(s)</span>
                {error && <span className="err-text">{error}</span>}
                {hasMore && <Button size="sm" busy={loadingMore} onClick={() => void loadMore()} style={{ marginLeft: 'auto' }}>Charger les plus anciennes</Button>}
              </div>
            </>
          )}
      </Panel>
    </div>
  );
}
