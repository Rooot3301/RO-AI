import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { RoEvent, Run } from '../api/types';
import { Banner, Button, Empty, LoadError, Panel, Skeleton, Stat, Tag } from '../components/ui/primitives';
import { Markdown } from '../components/Markdown';
import { CopyButton, RunStatusTag, ToolKindTag } from '../components/ui/domain';
import { ConfirmDialog } from '../components/ui/Modal';
import { Rel } from '../components/ui/Time';
import { IconPause } from '../components/ui/icons';
import { useEventListener, useLiveStore } from '../store/LiveProvider';
import { useRunActions } from '../hooks/useRunActions';
import { useDocumentTitle, useNow } from '../hooks/useNow';
import { ApiError } from '../api/client';
import { isRunActive } from '../lib/labels';
import { isRunLifecycleEvent } from '../lib/runs';
import { loadRunEvents, mergeEvents } from '../lib/events';
import { buildRunLog, filterLog, logStats, type LogEntry, type LogGroup } from '../lib/runLog';
import { formatCost, formatDateTime, formatDuration, formatTime, formatTokens, parseTime } from '../lib/format';
import { windowLabel, rateStatusLabel, ERROR_CLASS_HINT, ERROR_CLASS_LABEL, PROVIDER_LABEL, TRIGGER_LABEL } from '../lib/labels';
import './RunDetail.css';

export default function RunDetailPage() {
  const { id = '' } = useParams();
  const store = useLiveStore();
  const [run, setRun] = useState<Run | null>(null);
  const [runError, setRunError] = useState<{ msg: string; status: number } | null>(null);
  const [events, setEvents] = useState<RoEvent[]>([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const idRef = useRef(id);
  idRef.current = id;
  useDocumentTitle(run ? `Exécution · ${run.agent_name}` : 'Exécution');

  const fetchRun = useCallback(() => {
    const rid = id;
    return api.run(rid).then((r) => { if (idRef.current === rid) { setRun(r); setRunError(null); store.putRun(r); } }, (e) => { if (idRef.current === rid) setRunError({ msg: e instanceof Error ? e.message : String(e), status: e instanceof ApiError ? e.status : 0 }); });
  }, [id, store]);
  const fetchEvents = useCallback(() => {
    const rid = id;
    setEventsError(null);
    return loadRunEvents((since) => api.runEvents(rid, since)).then(
      (evs) => { if (idRef.current === rid) { setEvents((cur) => mergeEvents(cur, evs)); setEventsLoaded(true); } },
      (e) => { if (idRef.current === rid) { setEventsError(e instanceof Error ? e.message : String(e)); setEventsLoaded(true); } },
    );
  }, [id]);

  // Le listener est actif dès le montage : aucun événement n'est perdu entre le chargement initial et le flux.
  useEffect(() => { setRun(null); setRunError(null); setEvents([]); setEventsLoaded(false); void fetchRun(); void fetchEvents(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);
  useEventListener((e) => {
    if (e.type === 'system.resync') { void fetchRun(); void fetchEvents(); return; }
    if (e.run_id !== id) return;
    setEvents((cur) => mergeEvents(cur, [e]));
    if (isRunLifecycleEvent(e.type)) {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void fetchRun(), 200);
    }
  });

  const { busy, approve, reject, cancel } = useRunActions((r) => setRun(r));

  if (!run && runError) {
    return <div className="page">{runError.status === 404
      ? <div className="panel"><Empty title="Exécution introuvable" actions={<Link to="/runs"><Button size="sm">Retour à l’historique</Button></Link>}>Cette exécution n’existe pas ou a été purgée.</Empty></div>
      : <LoadError message={runError.msg} onRetry={() => void fetchRun()} />}</div>;
  }
  if (!run) return <div className="page"><Panel><Skeleton rows={8} /></Panel></div>;
  const b = busy[run.id];

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__titles">
          <div className="micro page__crumb"><Link to="/runs">Exécutions</Link> / <span className="mono" style={{ textTransform: 'none' }}>{run.id}</span></div>
          <h1 className="page__title">{run.agent_name}<RunStatusTag status={run.status} /></h1>
          <p className="page__sub">
            <Link to={`/agents/${run.agent_id}`}>Voir l’agent</Link> · {PROVIDER_LABEL[run.provider]}{run.model && <> · <span className="mono">{run.model}</span></>} · {TRIGGER_LABEL[run.trigger] ?? run.trigger}
            {run.schedule_id && <> · <Link to="/schedules">planification</Link></>} · créée <Rel iso={run.created_at} />
          </p>
        </div>
        <div className="page__actions">
          {run.status === 'awaiting_approval' && <>
            <Button variant="ok" busy={b === 'approve'} disabled={!!b} onClick={() => void approve(run.id)}>Approuver</Button>
            <Button variant="danger" busy={b === 'reject'} disabled={!!b} onClick={() => void reject(run.id)}>Rejeter</Button>
          </>}
          {run.status === 'succeeded' && <Link to={`/agents/${run.agent_id}/chat?c=${encodeURIComponent(run.conversation_id ?? run.id)}`} className="btn btn--primary">Continuer la conversation</Link>}
          {(run.status === 'queued' || run.status === 'running') && <Button variant="danger" busy={b === 'cancel'} disabled={!!b} onClick={() => setConfirmCancel(true)}>Annuler l’exécution</Button>}
        </div>
      </div>

      {run.status === 'awaiting_approval' && <div style={{ marginBottom: 16 }}><Banner tone="info" title="Approbation requise">Cet agent exige une validation humaine : rien n’est exécuté tant que vous n’avez pas approuvé. Relisez le prompt ci-dessous.</Banner></div>}
      {run.error_class && (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="err" title={ERROR_CLASS_LABEL[run.error_class]}>
            <div>{ERROR_CLASS_HINT[run.error_class]}</div>
            {run.error_message && <div className="untrusted mono" style={{ marginTop: 6, fontSize: 12 }}>{run.error_message}</div>}
          </Banner>
        </div>
      )}

      <Metrics run={run} />

      <div className="rd">
        <div className="rd__main">
          <JournalPanel run={run} events={events} loaded={eventsLoaded} error={eventsError} onRetry={() => void fetchEvents()} />
        </div>
        <div className="rd__side">
          <PromptPanel text={run.prompt} />
          {run.result_text && (
            <Panel title="Résultat final" id="rd-result" meta={<CopyButton text={run.result_text} />}>
              <Markdown className="result" text={run.result_text} />
            </Panel>
          )}
          <Panel title="Références" id="rd-refs">
            <dl className="kv" style={{ fontSize: 12 }}>
              <dt>Identifiant</dt><dd className="mono">{run.id}</dd>
              <dt>Session</dt><dd className="mono">{run.session_id ?? '—'}</dd>
              <dt>Créée</dt><dd className="num">{formatDateTime(run.created_at, undefined, true)}</dd>
              <dt>Démarrée</dt><dd className="num">{formatDateTime(run.started_at, undefined, true)}</dd>
              <dt>Terminée</dt><dd className="num">{formatDateTime(run.finished_at, undefined, true)}</dd>
            </dl>
          </Panel>
        </div>
      </div>

      {confirmCancel && (
        <ConfirmDialog title="Annuler l’exécution" danger confirmLabel="Annuler l’exécution" busy={b === 'cancel'} onCancel={() => setConfirmCancel(false)} onConfirm={() => { void cancel(run.id).then(() => setConfirmCancel(false)); }}>
          L’exécution en cours sera interrompue. Le travail déjà effectué par l’agent n’est pas annulé.
        </ConfirmDialog>
      )}
    </div>
  );
}

function Metrics({ run }: { run: Run }) {
  const now = useNow();
  const active = run.status === 'running';
  const started = parseTime(run.started_at);
  const elapsed = active && started ? now - started : run.duration_ms;
  return (
    <div className="panel rd__metrics" role="group" aria-label="Mesures de l’exécution">
      <Stat label={active ? 'Durée écoulée' : 'Durée'} value={active && started ? <span className="amber">{formatDuration(elapsed)}</span> : formatDuration(run.duration_ms)} />
      <Stat label="Tours" value={run.num_turns ?? '—'} />
      <Stat label="Tokens en entrée" value={formatTokens(run.usage?.input_tokens)} />
      <Stat label="Tokens en sortie" value={formatTokens(run.usage?.output_tokens)} />
      <Stat label="Coût estimé" value={formatCost(run.cost_usd_estimate)} sub="estimation du client, pas une facture" />
    </div>
  );
}

function PromptPanel({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 420 || text.split('\n').length > 8;
  return (
    <Panel title="Prompt" id="rd-prompt" meta={long ? <button type="button" className="evrow__toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? 'Réduire' : 'Tout afficher'}</button> : null}>
      <div className={`promptbox untrusted${long && !open ? ' promptbox--clamp' : ''}`}>{text || <span className="faint">(vide)</span>}</div>
    </Panel>
  );
}

const GROUPS: { id: LogGroup; label: string }[] = [{ id: 'all', label: 'Tout' }, { id: 'messages', label: 'Messages' }, { id: 'tools', label: 'Outils' }, { id: 'incidents', label: 'Incidents' }];

function JournalPanel({ run, events, loaded, error, onRetry }: { run: Run; events: RoEvent[]; loaded: boolean; error: string | null; onRetry: () => void }) {
  const [group, setGroup] = useState<LogGroup>('all');
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const entries = useMemo(() => buildRunLog(events), [events]);
  const stats = useMemo(() => logStats(entries), [entries]);
  const shown = useMemo(() => filterLog(entries, group), [entries, group]);
  const live = isRunActive(run.status);

  useEffect(() => { if (follow && live && box.current) box.current.scrollTop = box.current.scrollHeight; }, [shown.length, follow, live]);
  const onScroll = () => {
    const el = box.current; if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (!atBottom && follow) setFollow(false);
    else if (atBottom && !follow) setFollow(true);
  };

  return (
    <Panel title="Journal d’exécution" id="rd-log" flush meta={<>
      {live ? <span className="rd__live"><span className="led led--amber led--lit led--busy" aria-hidden="true" /> en direct</span> : <span className="faint">terminé</span>}
      <span className="num">{events.length} événement(s)</span>
    </>}>
      <div className="toolbar rd__tools">
        <div className="seg seg--sm" role="radiogroup" aria-label="Filtrer le journal">
          {GROUPS.map((g) => (
            <label key={g.id} className="seg__opt">
              <input type="radio" name="loggroup" checked={group === g.id} onChange={() => setGroup(g.id)} />
              <span>{g.label}{g.id === 'tools' && stats.tools ? ` ${stats.tools}` : ''}{g.id === 'incidents' && (stats.denied + stats.retries) ? ` ${stats.denied + stats.retries}` : ''}</span>
            </label>
          ))}
        </div>
        {live && <div className="toolbar__end"><Button size="sm" variant={follow ? 'primary' : 'default'} onClick={() => { setFollow(true); if (box.current) box.current.scrollTop = box.current.scrollHeight; }} aria-pressed={follow}><IconPause />{follow ? 'Suivi actif' : 'Reprendre le suivi'}</Button></div>}
      </div>
      {error && <div style={{ padding: 12 }}><LoadError message={error} onRetry={onRetry} /></div>}
      {!loaded ? <Skeleton rows={7} />
        : shown.length === 0 ? (
          <Empty title={entries.length === 0 ? 'Aucun événement' : 'Rien dans cette catégorie'} glyph={false}>
            {entries.length === 0 ? (live ? 'L’exécution n’a encore rien émis. Les événements apparaîtront ici dès qu’ils arrivent.' : 'Aucun événement n’a été enregistré pour cette exécution.') : 'Changez de filtre pour voir les autres événements.'}
          </Empty>
        ) : (
          <div className="rlog" ref={box} onScroll={onScroll} tabIndex={0} role="log" aria-live="off" aria-label="Événements de l’exécution">
            {shown.map((e) => <LogLine key={e.seq} e={e} />)}
          </div>
        )}
    </Panel>
  );
}

function LogLine({ e }: { e: LogEntry }) {
  const time = <time className="rl__t num" dateTime={e.ts} title={e.ts}>{formatTime(e.ts)}</time>;
  switch (e.kind) {
    case 'lifecycle': return <div className="rl rl--life">{time}<span className="rl__mark rl__mark--dim" aria-hidden="true" /><div className="rl__body"><span className="micro">{e.text}</span>{e.detail && <span className="dim untrusted mono rl__small"> {e.detail}</span>}</div></div>;
    case 'message': return <div className="rl rl--msg">{time}<span className="rl__mark rl__mark--amber" aria-hidden="true" /><div className="rl__body"><div className="micro">Agent</div><div className="rl__text untrusted">{e.text || <span className="faint">(message vide)</span>}</div></div></div>;
    case 'tool': return (
      <div className={`rl rl--tool${e.result && !e.result.ok ? ' rl--bad' : ''}`}>{time}<span className="rl__mark rl__mark--info" aria-hidden="true" />
        <div className="rl__body">
          <div className="rl__toolhead"><ToolKindTag kind={e.toolKind} /><span className="mono rl__tool untrusted">{e.tool}</span>
            {e.result ? <Tag tone={e.result.ok ? 'ok' : 'err'}>{e.result.ok ? 'OK' : 'Échec'}</Tag> : <span className="micro amber">en cours…</span>}
          </div>
          {e.summary && <div className="rl__sum untrusted mono">{e.summary}</div>}
          {e.result?.summary && <div className={`rl__res untrusted mono${e.result.ok ? '' : ' err-text'}`}>{'-> '}{e.result.summary}</div>}
        </div>
      </div>);
    case 'denied': return <div className="rl rl--bad">{time}<span className="rl__mark rl__mark--err" aria-hidden="true" /><div className="rl__body"><div className="rl__toolhead"><Tag tone="err" solid>Refusé</Tag><span className="mono rl__tool untrusted">{e.tool}</span></div>{e.reason && <div className="rl__sum untrusted err-text">{e.reason}</div>}</div></div>;
    case 'retry': return <div className="rl">{time}<span className="rl__mark rl__mark--warn" aria-hidden="true" /><div className="rl__body"><Tag tone="warn">Nouvelle tentative {e.attempt ?? '?'}/{e.max ?? '?'}</Tag>{e.error && <span className="dim untrusted mono rl__small"> {e.error}</span>}</div></div>;
    case 'limit': return <div className="rl">{time}<span className="rl__mark rl__mark--warn" aria-hidden="true" /><div className="rl__body"><Tag tone="warn">Limite · {rateStatusLabel(e.status)}</Tag><span className="dim rl__small"> {e.window ? `fenêtre de ${windowLabel(e.window)}` : ''}{e.resetsAt ? ` · reprise ${formatDateTime(e.resetsAt)}` : ''}</span></div></div>;
    case 'final': return (
      <div className={`rl rl--final rl--final-${e.outcome}`}>{time}<span className={`rl__mark rl__mark--${e.outcome === 'succeeded' ? 'ok' : e.outcome === 'failed' ? 'err' : 'warn'}`} aria-hidden="true" />
        <div className="rl__body">
          <div className="rl__toolhead"><Tag tone={e.outcome === 'succeeded' ? 'ok' : e.outcome === 'failed' ? 'err' : 'warn'} solid>{e.outcome === 'succeeded' ? 'Terminée' : e.outcome === 'failed' ? 'Échec' : 'Annulée'}</Tag>
            {e.durationMs != null && <span className="num dim">{formatDuration(e.durationMs)}</span>}{e.turns != null && <span className="num dim">{e.turns} tours</span>}{e.cost != null && <span className="num dim">{formatCost(e.cost)}</span>}</div>
          {e.errorClass && <div className="rl__sum err-text">{ERROR_CLASS_LABEL[e.errorClass] ?? e.errorClass}</div>}
          {e.errorMessage && <div className="rl__sum untrusted mono err-text">{e.errorMessage}</div>}
          {e.preview && <div className="rl__sum untrusted">{e.preview}</div>}
        </div>
      </div>);
    default: return <div className="rl rl--life">{time}<span className="rl__mark rl__mark--dim" aria-hidden="true" /><div className="rl__body"><span className="micro faint">{e.type}</span></div></div>;
  }
}
