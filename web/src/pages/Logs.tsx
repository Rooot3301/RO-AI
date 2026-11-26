import { useMemo, useState } from 'react';
import { Button, Empty, Led, Panel, Skeleton, Tag } from '../components/ui/primitives';
import { EventRow } from '../components/EventRow';
import { IconDownload, IconPause, IconPlay } from '../components/ui/icons';
import { useLive } from '../store/LiveProvider';
import { useDebounced, useDocumentTitle } from '../hooks/useNow';
import { useToast } from '../store/toast';
import { describeEvent, EMPTY_FILTER, EVENT_CATEGORIES, matchesFilter, type EventFilter, type Level } from '../lib/events';
import './Logs.css';

const MAX_ROWS = 400;

export default function LogsPage() {
  useDocumentTitle('Journal');
  const toast = useToast();
  const live = useLive((s) => s.events);
  const ready = useLive((s) => s.ready);
  const conn = useLive((s) => s.conn);
  const agents = useLive((s) => s.agents);
  const [paused, setPaused] = useState<typeof live | null>(null);
  const [agentId, setAgentId] = useState('');
  const [category, setCategory] = useState('');
  const [level, setLevel] = useState<'' | Level>('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 180);
  const names = useMemo(() => new Map((agents ?? []).map((a) => [a.id, a.name])), [agents]);

  const source = paused ?? live;
  const filter: EventFilter = useMemo(() => ({ ...EMPTY_FILTER, agentId, category, level, search: q }), [agentId, category, level, q]);
  const filtered = useMemo(() => source.filter((e) => matchesFilter(e, filter)), [source, filter]);
  const rows = useMemo(() => filtered.slice(-MAX_ROWS).reverse(), [filtered]);
  const counts = useMemo(() => { const c = { info: 0, warn: 0, error: 0 }; for (const e of filtered) c[describeEvent(e).level]++; return c; }, [filtered]);
  const pending = paused ? live.filter((e) => e.seq > (paused[paused.length - 1]?.seq ?? 0)).length : 0;
  const isFiltered = !!(agentId || category || level || q);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const d = new Date(); const p = (n: number) => String(n).padStart(2, '0');
    const a = document.createElement('a');
    a.href = url; a.download = `ro-ai-journal-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.push('ok', `${filtered.length} événement(s) exportés.`);
  };

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__titles">
          <div className="micro page__crumb">Observation</div>
          <h1 className="page__title">Journal d’événements</h1>
          <p className="page__sub">Flux temps réel de tout ce qui se passe : exécutions, outils, planifications, fournisseurs. Aucun secret n’y figure ; le contenu des agents est affiché comme texte brut.</p>
        </div>
        <div className="page__actions">
          <span className="logstate micro"><Led tone={paused ? 'warn' : conn === 'open' ? 'ok' : 'err'} busy={!paused && conn !== 'open'} /> {paused ? 'En pause' : conn === 'open' ? 'En direct' : 'Reconnexion…'}</span>
          <Button onClick={() => setPaused(paused ? null : live)} aria-pressed={!!paused} variant={paused ? 'primary' : 'default'}>{paused ? <><IconPlay />Reprendre{pending > 0 ? ` (${pending})` : ''}</> : <><IconPause />Pause</>}</Button>
          <Button onClick={exportJson} disabled={filtered.length === 0}><IconDownload />Exporter JSON</Button>
        </div>
      </div>

      <Panel flush>
        <div className="toolbar">
          <div className="field toolbar__grow"><label className="field__label" htmlFor="lg-q">Recherche</label><input id="lg-q" className="input" type="search" placeholder="Texte, type, charge utile…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <div className="field"><label className="field__label" htmlFor="lg-a">Agent</label>
            <select id="lg-a" className="select" value={agentId} onChange={(e) => setAgentId(e.target.value)}><option value="">Tous</option>{(agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
          <div className="field"><label className="field__label" htmlFor="lg-c">Type</label>
            <select id="lg-c" className="select" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Tous</option>{EVENT_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
          <div className="field"><label className="field__label" htmlFor="lg-l">Niveau</label>
            <select id="lg-l" className="select" value={level} onChange={(e) => setLevel(e.target.value as '' | Level)}><option value="">Tous</option><option value="info">Info</option><option value="warn">Avertissement</option><option value="error">Erreur</option></select></div>
          {isFiltered && <div className="toolbar__end"><Button size="sm" variant="ghost" onClick={() => { setAgentId(''); setCategory(''); setLevel(''); setSearch(''); }}>Effacer</Button></div>}
        </div>
        <div className="logsum">
          <span className="num">{filtered.length} / {source.length} événement(s)</span>
          <Tag tone="neutral">{counts.info} info</Tag><Tag tone="warn">{counts.warn} avert.</Tag><Tag tone="err">{counts.error} erreur(s)</Tag>
          {filtered.length > MAX_ROWS && <span className="faint">affichage limité aux {MAX_ROWS} plus récents (l’export contient la sélection complète)</span>}
        </div>
        {!ready ? <Skeleton rows={10} />
          : rows.length === 0 ? (
            <Empty title={source.length === 0 ? 'Journal vide' : 'Aucun événement pour ces filtres'} actions={isFiltered ? <Button size="sm" onClick={() => { setAgentId(''); setCategory(''); setLevel(''); setSearch(''); }}>Effacer les filtres</Button> : undefined}>
              {source.length === 0 ? 'Aucun événement enregistré pour l’instant. Ils apparaîtront ici dès qu’un agent travaille.' : 'Élargissez la recherche pour voir plus d’événements.'}
            </Empty>
          ) : <ol className="evlist logs-list" aria-label="Événements, du plus récent au plus ancien">{rows.map((e) => <EventRow key={e.seq} e={e} expandable agentName={e.agent_id ? names.get(e.agent_id) : undefined} />)}</ol>}
        <div className="panel__foot">Les 800 derniers événements sont conservés dans le navigateur ; le flux reprend automatiquement après une coupure.</div>
      </Panel>
    </div>
  );
}
