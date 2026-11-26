import { useState, type KeyboardEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Banner, Button, Empty, Led, LoadError, Skeleton } from '../components/ui/primitives';
import { AgentBadges } from '../components/ui/domain';
import { Rel } from '../components/ui/Time';
import { ChatThread } from '../components/chat/ChatThread';
import { useDocumentTitle } from '../hooks/useNow';
import { useAgentChat } from '../hooks/useAgentChat';
import { canSubmitText, contextHint, retryTarget, runTokens } from '../lib/chat';
import { formatTokens } from '../lib/format';
import { isRunActive } from '../lib/labels';
import './Chat.css';

export default function ChatPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState('');
  const key = params.get('c');
  const ch = useAgentChat(id, key, (k) => setParams(k ? { c: k } : {}, { replace: true }));
  const { agent, agentErr, liveAgent, list, listErr, convs, selected, thread, last } = ch;
  useDocumentTitle(agent ? `Parler avec ${agent.name}` : 'Conversation');

  const submit = async () => { if (await ch.submit(draft)) setDraft(''); };

  if (agentErr) return <div className="page">{agentErr.status === 404 ? <div className="panel"><Empty title="Agent introuvable" actions={<Link to="/agents" className="btn">Retour aux agents</Link>}>Cet agent n’existe pas ou a été supprimé.</Empty></div> : <LoadError message={agentErr.msg} onRetry={ch.loadAgent} />}</div>;
  const tokens = thread.reduce((s, r) => s + runTokens(r), 0);
  const hint = contextHint(thread.length);

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__titles">
          <div className="micro page__crumb"><Link to="/agents">Agents</Link> / {agent ? <Link to={`/agents/${agent.id}`}>{agent.name}</Link> : '…'} / conversation</div>
          <h1 className="page__title">{agent ? `Parler avec ${agent.name}` : 'Conversation'}{(liveAgent ?? agent) && <AgentBadges config={(liveAgent ?? agent)!.config} />}</h1>
          <p className="page__sub">L’agent garde le contexte d’un message à l’autre grâce à la reprise de session du client officiel.</p>
        </div>
      </div>

      <div className="chat">
        <aside className="chat__list" aria-label="Conversations">
          <div className="chat__listhead"><Button variant="primary" onClick={ch.newConversation} className="chat__new">Nouvelle conversation</Button></div>
          {list === null && !listErr ? <Skeleton rows={4} />
            : listErr && !list ? <div style={{ padding: 12 }}><LoadError message={listErr} onRetry={ch.loadList} /></div>
            : convs.length === 0 ? <p className="chat__none">Aucune conversation pour l’instant. Écrivez un premier message pour commencer.</p>
            : (
              <ul>
                {convs.map((c) => (
                  <li key={c.id}>
                    <Link to={`?c=${encodeURIComponent(c.id)}`} replace className={`convitem${selected?.id === c.id ? ' is-active' : ''}`} aria-current={selected?.id === c.id ? 'true' : undefined}>
                      <span className="convitem__title untrusted">{c.title}</span>
                      <span className="convitem__meta">
                        {isRunActive(c.last.status) && <Led tone={c.last.status === 'running' ? 'amber' : 'warn'} busy={c.last.status === 'running'} label="En cours" />}
                        <Rel iso={c.updatedAt} /> · {c.exchanges} échange{c.exchanges > 1 ? 's' : ''}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
        </aside>

        <section className="chat__main" aria-label="Fil de la conversation">
          <header className="chat__bar">
            {thread.length > 0 ? <span className="num">{thread.length} échange{thread.length > 1 ? 's' : ''} · {formatTokens(tokens)} tokens cumulés</span> : <span className="faint">Nouvelle conversation</span>}
            {selected && last && <Link to={`/runs/${last.id}`} className="chat__rundetail">Détail de l’exécution</Link>}
          </header>
          {hint && <div className="chat__hint"><Banner tone="warn">{hint}</Banner></div>}
          <ChatThread thread={thread} loading={ch.threadLoading && thread.length === 0} agent={agent} live={ch.live} busy={ch.busy} onApprove={(rid) => void ch.approve(rid)} onReject={(rid) => void ch.reject(rid)}
            onCancel={(rid) => void ch.cancel(rid)} onRetry={(r) => void ch.send(r.prompt, retryTarget(r))} retryDisabled={!ch.enabled || ch.paused || ch.sending} />
          <div className="composer">
            {ch.sendErr && <Banner tone="err">{ch.sendErr}</Banner>}
            <div className="composer__row">
              <textarea className="textarea composer__input" rows={2} value={draft} aria-label="Votre message" placeholder="Écrivez à l’agent… (Entrée pour envoyer, Maj+Entrée pour un saut de ligne)" onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } }} />
              <Button variant="primary" onClick={() => void submit()} disabled={!ch.comp.canSend || !canSubmitText(draft)} busy={ch.sending}>Envoyer</Button>
            </div>
            {ch.comp.reason && !ch.sending && <p className="composer__reason" role="status">{ch.comp.reason}</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
