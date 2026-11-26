import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Stats, StatsProvider } from '../api/types';
import { Empty, LoadError, Panel, Skeleton } from '../components/ui/primitives';
import { Seg } from '../components/ui/forms';
import { ChartTable, StackedBars, type BarItem, type BarSeries } from '../components/ui/StackedBars';
import { useStats } from '../hooks/useStats';
import { useDocumentTitle } from '../hooks/useNow';
import { formatCost, formatDuration, formatNumber, formatTokens } from '../lib/format';
import { PROVIDER_LABEL } from '../lib/labels';
import { completeDays, costOrNd, errorRows, formatDayLong, formatDayShort, formatRate, hourSeries, loadPeriod, PERIODS, savePeriod, type Period } from '../lib/stats';
import './Stats.css';

const RUN_SERIES: BarSeries[] = [
  { name: 'Réussies', color: 'var(--ok)' }, { name: 'Échecs', color: 'var(--err)' }, { name: 'Annulées', color: 'var(--text-faint)' },
];
const TOKEN_SERIES: BarSeries[] = [{ name: 'Entrée', color: 'var(--info)' }, { name: 'Sortie', color: 'var(--amber)' }];
const HOUR_SERIES: BarSeries[] = [{ name: 'Exécutions démarrées', color: 'var(--amber)' }];
const int = (n: number) => formatNumber(n);
const costText = (provider: string, usd: number) => { const c = costOrNd(provider, usd); return c == null ? 'n/d' : formatCost(c); };

export default function StatsPage() {
  useDocumentTitle('Consommation');
  const [period, setPeriod] = useState<Period>(() => loadPeriod());
  const { data, error, loading, reload } = useStats(period);
  const change = (p: Period) => { setPeriod(p); savePeriod(p); };

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__titles">
          <div className="micro page__crumb">Observation</div>
          <h1 className="page__title">Consommation</h1>
          <p className="page__sub">Activité des agents sur la période : exécutions, durée, tokens et coût estimé. Les chiffres se mettent à jour en direct.</p>
        </div>
        <div className="page__actions">
          <Seg name="period" label="Période" size="sm" value={period} onChange={change} options={PERIODS.map((p) => ({ value: p, label: `${p} jours` }))} />
        </div>
      </div>

      {error && !data ? <LoadError message={error} onRetry={reload} />
        : loading && !data ? <StatsSkeleton />
        : data ? <StatsBody s={data} refreshError={error} /> : null}
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="stats" aria-busy="true">
      <div className="panel"><Skeleton rows={2} widths={['60%', '40%']} /></div>
      <div className="stats__row"><div className="panel"><Skeleton rows={7} /></div><div className="panel"><Skeleton rows={5} /></div></div>
    </div>
  );
}

function StatsBody({ s, refreshError }: { s: Stats; refreshError: string | null }) {
  if (s.totals.runs === 0) {
    return (
      <div className="panel">
        <Empty title={`Aucune exécution sur les ${s.days} derniers jours`} actions={<Link to="/agents" className="btn">Lancer un agent</Link>}>
          Les statistiques apparaîtront dès qu’un agent aura été exécuté. Essayez une période plus longue si l’activité est plus ancienne.
        </Empty>
      </div>
    );
  }
  return <StatsContent s={s} refreshError={refreshError} />;
}

function StatsContent({ s, refreshError }: { s: Stats; refreshError: string | null }) {
  const t = s.totals;
  const days = useMemo(() => completeDays(s.by_day, s.days), [s]);
  const runItems = useMemo<BarItem[]>(() => days.map((d) => ({ key: d.date, label: formatDayShort(d.date), long: formatDayLong(d.date), values: [d.succeeded, d.failed, d.cancelled] })), [days]);
  const tokItems = useMemo<BarItem[]>(() => days.map((d) => ({ key: d.date, label: formatDayShort(d.date), long: formatDayLong(d.date), values: [d.input_tokens, d.output_tokens] })), [days]);
  const hours = useMemo(() => hourSeries(s.by_hour), [s]);
  const hourItems = useMemo<BarItem[]>(() => hours.map((h) => ({ key: String(h.hour), label: `${h.hour} h`, long: `${h.hour} h à ${h.hour + 1} h`, values: [h.count] })), [hours]);
  const errs = useMemo(() => errorRows(s.errors), [s]);
  const finished = t.succeeded + t.failed;
  const totalTok = t.input_tokens + t.output_tokens;

  return (
    <div className="stats">
      {refreshError && <div className="banner banner--warn" role="status"><div className="banner__body">Actualisation impossible : {refreshError}. Les chiffres affichés peuvent être périmés.</div></div>}

      <section className="panel kfig" aria-label="Chiffres clés">
        <Fig label="Exécutions" value={int(t.runs)} sub={t.running > 0 ? `${int(t.running)} en cours` : `${s.days} derniers jours`} />
        <Fig label="Taux de réussite" value={formatRate(t.success_rate)} sub={finished ? `${int(t.succeeded)} réussies · ${int(t.failed)} échecs · ${int(t.cancelled)} annulées` : 'aucune exécution terminée'} />
        <Fig label="Durée moyenne" value={formatDuration(t.duration_ms_avg)} sub={`${formatDuration(t.duration_ms_total)} cumulées`} />
        <Fig label="Tokens" value={formatTokens(totalTok)} sub={`${formatTokens(t.input_tokens)} entrée · ${formatTokens(t.output_tokens)} sortie`} />
        <Fig label="Coût estimé" value={formatCost(t.cost_usd_estimate)} sub="estimation du client, pas une facture" />
      </section>
      <p className="stats__note">Coût : estimation fournie par le client Claude Code, jamais une facture. Codex ne fournit pas d’estimation : son coût est affiché « n/d ». Les tokens sont ceux déclarés par les clients.</p>

      <div className="stats__row stats__row--wide">
        <Panel title="Exécutions par jour" id="st-runs" meta={<span className="num">{days.length} jours</span>}>
          <StackedBars items={runItems} series={RUN_SERIES} format={int} ariaLabel="Exécutions par jour, réussies, échecs et annulées" />
          <ChartTable items={runItems} series={RUN_SERIES} format={int} caption="Exécutions par jour" labelHeader="Jour" />
        </Panel>
        <Panel title="Fournisseurs" id="st-prov" flush>
          <ProviderTable rows={s.by_provider} />
        </Panel>
      </div>

      <div className="stats__row stats__row--wide">
        <Panel title="Tokens par jour" id="st-tok" meta={<span className="num">{formatTokens(totalTok)} au total</span>}>
          <StackedBars items={tokItems} series={TOKEN_SERIES} format={formatTokens} ariaLabel="Tokens par jour, entrée et sortie" />
          <ChartTable items={tokItems} series={TOKEN_SERIES} format={int} caption="Tokens par jour" labelHeader="Jour" />
        </Panel>
        <Panel title="Causes d’erreur" id="st-err">
          {errs.length === 0 ? <p className="dim">Aucune erreur typée sur la période.</p> : (
            <ul className="errlist">
              {errs.map((e) => (
                <li key={e.error_class}>
                  <div className="errlist__top"><span>{e.label}</span><span className="num">{int(e.count)} <span className="faint">· {formatRate(e.share)}</span></span></div>
                  <div className="bar" role="presentation"><i style={{ width: `${Math.max(2, e.share * 100)}%`, background: 'var(--err)' }} /></div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Activité par heure de la journée" id="st-hours" meta={<span className="faint">heure locale du serveur</span>}>
        <StackedBars items={hourItems} series={HOUR_SERIES} format={int} ariaLabel="Exécutions démarrées par heure de la journée" height={170} maxLabels={12} />
        <ChartTable items={hourItems} series={HOUR_SERIES} format={int} caption="Exécutions démarrées par heure" labelHeader="Heure" />
      </Panel>

      <Panel title="Par agent" id="st-agents" flush meta={<span className="num">{s.by_agent.length}</span>}>
        {s.by_agent.length === 0 ? <Empty title="Aucun agent" glyph={false}>Aucun agent n’a d’exécution sur la période.</Empty> : (
          <div className="tbl-scroll">
            <table className="tbl">
              <caption className="sr-only">Consommation par agent sur {s.days} jours</caption>
              <thead><tr><th scope="col">Agent</th><th scope="col" className="col-num">Exécutions</th><th scope="col">Taux de réussite</th><th scope="col" className="col-num">Durée moy.</th><th scope="col" className="col-num">Tokens e / s</th><th scope="col" className="col-num">Coût estimé</th></tr></thead>
              <tbody>
                {s.by_agent.map((a) => (
                  <tr key={a.agent_id}>
                    <th scope="row"><Link className="rowlink" to={`/agents/${a.agent_id}`}>{a.name}</Link> <span className="faint">{PROVIDER_LABEL[a.provider] ?? a.provider}</span></th>
                    <td className="col-num">{int(a.runs)}</td>
                    <td><RateBar rate={a.success_rate} /></td>
                    <td className="col-num">{formatDuration(a.duration_ms_avg)}</td>
                    <td className="col-num">{formatTokens(a.input_tokens)} / {formatTokens(a.output_tokens)}</td>
                    <td className="col-num">{costText(a.provider, a.cost_usd_estimate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Fig({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="kfig__item"><span className="kfig__label">{label}</span><span className="kfig__value num">{value}</span><span className="kfig__sub">{sub}</span></div>;
}

function RateBar({ rate }: { rate: number | null }) {
  if (rate == null) return <span className="faint">—</span>;
  return (
    <div className="ratebar" role="img" aria-label={`Taux de réussite ${formatRate(rate)}`}>
      <div className="bar"><i style={{ width: `${rate * 100}%`, background: rate >= 0.9 ? 'var(--ok)' : rate >= 0.6 ? 'var(--warn)' : 'var(--err)' }} /></div>
      <span className="num">{formatRate(rate)}</span>
    </div>
  );
}

function ProviderTable({ rows }: { rows: StatsProvider[] }) {
  const total = rows.reduce((s, r) => s + r.runs, 0);
  if (rows.length === 0) return <Empty title="Aucun fournisseur" glyph={false}>Aucune exécution par fournisseur.</Empty>;
  return (
    <ul className="provlist">
      {rows.map((p) => {
        const done = p.succeeded + p.failed;
        return (
          <li key={p.provider}>
            <div className="provlist__top"><strong>{PROVIDER_LABEL[p.provider] ?? p.provider}</strong><span className="num">{int(p.runs)} exéc. <span className="faint">· {formatRate(total ? p.runs / total : null)}</span></span></div>
            <div className="bar" role="presentation"><i style={{ width: `${total ? (p.runs / total) * 100 : 0}%`, background: 'var(--amber)' }} /></div>
            <dl className="provlist__kv">
              <div><dt>Réussite</dt><dd className="num">{formatRate(done ? p.succeeded / done : null)}</dd></div>
              <div><dt>Limites atteintes</dt><dd className="num">{int(p.rate_limited)}</dd></div>
              <div><dt>Tokens e / s</dt><dd className="num">{formatTokens(p.input_tokens)} / {formatTokens(p.output_tokens)}</dd></div>
              <div><dt>Coût estimé</dt><dd className="num">{costText(p.provider, p.cost_usd_estimate)}</dd></div>
            </dl>
          </li>
        );
      })}
    </ul>
  );
}
