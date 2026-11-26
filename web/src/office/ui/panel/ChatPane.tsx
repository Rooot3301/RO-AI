// Onglet « Discuter » du panneau personnage : la même conversation que la page Chat (mêmes appels, mêmes protections),
// dans le panneau latéral, avec le choix de la conversation. L'agent rejoint la salle de réunion pendant l'échange.
import { useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Banner, Button } from '../../../components/ui/primitives';
import { ChatThread } from '../../../components/chat/ChatThread';
import { useAgentChat } from '../../../hooks/useAgentChat';
import { canSubmitText, contextHint, retryTarget, type Conv } from '../../../lib/chat';
import { isRunActive } from '../../../lib/labels';
import { truncate } from '../../../lib/format';
import { formatAgo } from '../format.ts';

/** Libellé d'une conversation dans la liste déroulante (texte brut). */
export function convOption(c: Conv, now: number): string {
  const when = formatAgo(Math.max(0, now - Date.parse(c.updatedAt)));
  return `${isRunActive(c.last.status) ? '● ' : ''}${truncate(c.title, 46)} · ${when} · ${c.exchanges} échange${c.exchanges > 1 ? 's' : ''}`;
}

export function ChatPane({ agentId, convKey, onConvKey, now }: { agentId: string; convKey: string | null; onConvKey: (k: string | null) => void; now: number }) {
  const [draft, setDraft] = useState('');
  const ch = useAgentChat(agentId, convKey, onConvKey);
  const { convs, selected, thread } = ch;
  const value = selected?.id ?? convKey ?? '';
  const known = !value || convs.some((c) => c.id === value);
  const hint = contextHint(thread.length);
  const submit = async () => { if (await ch.submit(draft)) setDraft(''); };
  const pick = (v: string) => { if (v) onConvKey(v); else ch.newConversation(); };

  return (
    <div className="cp-chat">
      <div className="cp-chat__bar">
        <label className="cp-chat__pick">
          <span className="sr-only">Conversation</span>
          <select className="select" value={value} onChange={(e) => pick(e.target.value)} aria-label="Conversation">
            <option value="">+ Nouvelle conversation</option>
            {!known && <option value={value}>Conversation en cours</option>}
            {convs.map((c) => <option key={c.id} value={c.id}>{convOption(c, now)}</option>)}
          </select>
        </label>
        <Link className="cp-small cp-chat__full" to={`/agents/${agentId}/chat${value ? `?c=${encodeURIComponent(value)}` : ''}`} title="Ouvrir cette conversation dans la page Chat">Agrandir</Link>
      </div>
      {ch.listErr && !ch.list && <p className="is-err cp-small">Conversations indisponibles : {ch.listErr}</p>}
      {hint && <Banner tone="warn">{hint}</Banner>}
      {!value && thread.length === 0 && convs.length > 0 ? (
        // nouvelle conversation : les conversations passées restent visibles et se reprennent d'un clic
        <div className="chat__thread cp-chat__history">
          <p className="cp-small faint">Écris ci-dessous pour commencer une nouvelle conversation, ou reprends-en une :</p>
          <ul>
            {convs.slice(0, 30).map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onConvKey(c.id)}>
                  <span className="cp-chat__htitle untrusted">{c.title}</span>
                  <span className="cp-small faint">{isRunActive(c.last.status) ? '● en cours · ' : ''}{formatAgo(Math.max(0, now - Date.parse(c.updatedAt)))} · {c.exchanges} échange{c.exchanges > 1 ? 's' : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ChatThread compact thread={thread} loading={(ch.threadLoading && thread.length === 0) || (ch.list === null && !!convKey)} agent={ch.agent} live={ch.live} busy={ch.busy}
          onApprove={(rid) => void ch.approve(rid)} onReject={(rid) => void ch.reject(rid)} onCancel={(rid) => void ch.cancel(rid)}
          onRetry={(r) => void ch.send(r.prompt, retryTarget(r))} retryDisabled={!ch.enabled || ch.paused || ch.sending} />
      )}
      <div className="cp-chat__composer">
        {ch.sendErr && <Banner tone="err">{ch.sendErr}</Banner>}
        <textarea className="textarea cp-chat__input" rows={2} value={draft} maxLength={20000} aria-label="Ton message"
          placeholder={selected ? 'Répondre… (Entrée pour envoyer)' : 'Écris à l’agent… (Entrée pour envoyer)'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } }} />
        <div className="cp-chat__row">
          <span className="cp-small faint">{ch.comp.reason && !ch.sending ? ch.comp.reason : 'Maj+Entrée : saut de ligne'}</span>
          <Button size="sm" variant="primary" onClick={() => void submit()} disabled={!ch.comp.canSend || !canSubmitText(draft)} busy={ch.sending}>Envoyer</Button>
        </div>
      </div>
    </div>
  );
}
