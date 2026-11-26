// Fil d'une conversation avec un agent (page Chat et panneau du bureau virtuel). Les textes venant de l'agent sont
// rendus en Markdown sûr ; les messages de l'utilisateur en texte brut.
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { Agent, RoEvent, Run } from '../../api/types';
import { Button, Empty, Skeleton, Tag } from '../ui/primitives';
import { RunStatusTag, Sprite } from '../ui/domain';
import { Rel } from '../ui/Time';
import { Markdown } from '../Markdown';
import { activityLabel } from '../../lib/chat';
import { truncatePreview } from '../../lib/events';
import { formatCost, formatDuration, formatTokens, truncate } from '../../lib/format';
import { ERROR_CLASS_HINT, ERROR_CLASS_LABEL } from '../../lib/labels';
import '../../pages/Chat.css';

export interface ThreadProps {
  thread: Run[]; loading: boolean; agent: Agent | null; live: { runId: string; events: RoEvent[] } | null; busy: Record<string, string | undefined>;
  onApprove: (id: string) => void; onReject: (id: string) => void; onCancel: (id: string) => void; onRetry: (r: Run) => void; retryDisabled: boolean;
  /** Variante compacte (panneau latéral) : avatar plus petit, texte d'accueil plus court. */
  compact?: boolean;
}

export function ChatThread({ thread, loading, agent, live, busy, onApprove, onReject, onCancel, onRetry, retryDisabled, compact }: ThreadProps) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const sig = `${thread.length}:${thread[thread.length - 1]?.status}:${live?.events.length ?? 0}`;
  useEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [sig]);
  const onScroll = () => { const el = box.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; };
  if (loading) return <div className="chat__thread"><Skeleton rows={compact ? 3 : 5} /></div>;
  if (thread.length === 0) {
    return (
      <div className="chat__thread">
        <Empty title={compact ? 'Nouvelle conversation' : 'Commencez la conversation'} glyph={false}>
          {compact ? 'Écris ton premier message : l’agent s’installe dans la salle de réunion le temps de l’échange et garde le contexte d’un message à l’autre.'
            : 'Votre message est envoyé à l’agent comme une nouvelle exécution. Les messages suivants reprennent la même session : l’agent se souvient de ce qui a été dit.'}
        </Empty>
      </div>
    );
  }
  return (
    <div className="chat__thread" ref={box} onScroll={onScroll} role="log" aria-live="polite" aria-label="Messages">
      {thread.map((r, i) => (
        <div className="turn" key={r.id}>
          <div className="bubble bubble--user"><div className="bubble__text untrusted">{r.prompt}</div><div className="bubble__meta"><Rel iso={r.created_at} /></div></div>
          <div className="agentrow">
            {!compact && <Sprite index={agent?.avatar?.sprite ?? 0} size={30} title={agent?.name} />}
            <div className="bubble bubble--agent">
              <AgentReply r={r} live={live?.runId === r.id ? live.events : null} busy={busy[r.id]} onApprove={onApprove} onReject={onReject} onCancel={onCancel} onRetry={onRetry} retryDisabled={retryDisabled} isLast={i === thread.length - 1} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentReply({ r, live, busy, onApprove, onReject, onCancel, onRetry, retryDisabled, isLast }: {
  r: Run; live: RoEvent[] | null; busy: string | undefined; onApprove: (id: string) => void; onReject: (id: string) => void; onCancel: (id: string) => void; onRetry: (r: Run) => void; retryDisabled: boolean; isLast: boolean;
}) {
  if (r.status === 'awaiting_approval') {
    return (
      <div className="reply__state">
        <Tag tone="amber">En attente d’approbation</Tag>
        <p className="dim">Cet agent exige votre accord avant de répondre.</p>
        <div className="reply__actions">
          <Button size="sm" variant="ok" busy={busy === 'approve'} disabled={!!busy} onClick={() => onApprove(r.id)}>Approuver</Button>
          <Button size="sm" variant="danger" busy={busy === 'reject'} disabled={!!busy} onClick={() => onReject(r.id)}>Rejeter</Button>
        </div>
      </div>
    );
  }
  if (r.status === 'queued' || r.status === 'running') return <Working r={r} events={live ?? []} busy={busy} onCancel={onCancel} />;
  if (r.status === 'cancelled') return <div className="reply__state"><Tag tone="warn">Interrompue</Tag><p className="dim">{r.error_message || 'La réponse a été interrompue avant la fin.'}</p><Meta r={r} />{isLast && <Link to={`/runs/${r.id}`} className="reply__link">Voir le journal</Link>}</div>;
  if (r.status === 'failed') {
    const cls = r.error_class;
    return (
      <div className="reply__state">
        <Tag tone="err">{cls ? ERROR_CLASS_LABEL[cls] : 'Échec'}</Tag>
        {cls && <p className="dim">{ERROR_CLASS_HINT[cls]}</p>}
        {r.error_message && <p className="untrusted err-text reply__err">{r.error_message}</p>}
        <div className="reply__actions">
          {isLast && <Button size="sm" onClick={() => onRetry(r)} disabled={retryDisabled}>Réessayer</Button>}
          <Link to={`/runs/${r.id}`} className="reply__link">Voir le journal</Link>
        </div>
      </div>
    );
  }
  return (
    <>
      {r.result_text ? <Markdown text={r.result_text} /> : <p className="faint">(réponse vide)</p>}
      <Meta r={r} />
    </>
  );
}

function Meta({ r }: { r: Run }) {
  const bits = [r.duration_ms != null ? formatDuration(r.duration_ms) : '', r.usage ? `${formatTokens(r.usage.input_tokens)} entrée · ${formatTokens(r.usage.output_tokens)} sortie` : '', r.cost_usd_estimate ? `${formatCost(r.cost_usd_estimate)} (estimation)` : ''].filter(Boolean);
  return <div className="bubble__meta">{bits.join('  ·  ')}{bits.length > 0 && ' '}<Link to={`/runs/${r.id}`} className="reply__link">Détail</Link> <RunStatusTag status={r.status} /></div>;
}

function Working({ r, events, busy, onCancel }: { r: Run; events: RoEvent[]; busy: string | undefined; onCancel: (id: string) => void }) {
  const lastTool = [...events].reverse().find((e) => e.type === 'tool.call');
  const kind = typeof lastTool?.payload.kind === 'string' ? (lastTool.payload.kind as string) : null;
  const summary = typeof lastTool?.payload.summary === 'string' ? lastTool.payload.summary : '';
  const msgs = events.filter((e) => e.type === 'run.message').slice(-2).map((e) => (typeof e.payload.text === 'string' ? e.payload.text : '')).filter(Boolean);
  return (
    <div className="working" role="status">
      <div className="working__head">
        <span className="working__dots" aria-hidden="true"><i /><i /><i /></span>
        <span>{r.status === 'queued' ? 'En file d’attente…' : lastTool ? `L’agent ${activityLabel(kind)}` : 'L’agent réfléchit…'}</span>
        <Button size="sm" variant="danger" busy={busy === 'cancel'} disabled={!!busy} onClick={() => onCancel(r.id)} className="working__stop">Arrêter</Button>
      </div>
      {summary && <div className="working__tool untrusted mono">{truncate(summary, 140)}</div>}
      {msgs.map((m, i) => <div key={i} className="working__msg untrusted">{truncatePreview(m, 220)}</div>)}
    </div>
  );
}
