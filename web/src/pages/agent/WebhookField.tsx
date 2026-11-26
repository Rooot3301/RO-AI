import { useState } from 'react';
import { api } from '../../api/client';
import type { Agent } from '../../api/types';
import { Banner, Button, Tag } from '../../components/ui/primitives';
import { ConfirmDialog } from '../../components/ui/Modal';
import { useToast } from '../../store/toast';
import { isDiscordWebhookUrl } from '../../lib/agentForm';

/** Webhook Discord propre à l'agent : écriture seule (l'adresse n'est jamais renvoyée), actions indépendantes de l'enregistrement de la fiche. */
export function WebhookField({ agent }: { agent: Agent | null }) {
  const toast = useToast();
  const [isSet, setIsSet] = useState(!!agent?.discord_webhook_set);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error: string | null } | null>(null);

  if (!agent) {
    return (
      <div className="field span-2"><span className="field__label">Webhook de cet agent</span>
        <div className="field__hint">Disponible après la création de l’agent. Si vide, le webhook global des Paramètres est utilisé.</div></div>
    );
  }
  const trimmed = url.trim();
  const formatErr = trimmed && !isDiscordWebhookUrl(trimmed) ? 'L’adresse doit être de la forme https://discord.com/api/webhooks/…' : null;

  const save = async () => {
    if (!trimmed || formatErr) return;
    setBusy('save'); setError(null); setResult(null);
    try { await api.setAgentWebhook(agent.id, trimmed); setIsSet(true); setUrl(''); toast.push('ok', 'Webhook de l’agent enregistré.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Enregistrement impossible.'); }
    finally { setBusy(null); }
  };
  const test = async () => {
    setBusy('test'); setResult(null);
    try { setResult(await api.testAgentWebhook(agent.id)); }
    catch (e) { setResult({ ok: false, error: e instanceof Error ? e.message : 'Envoi impossible.' }); }
    finally { setBusy(null); }
  };
  const remove = async () => {
    setBusy('delete');
    try { await api.deleteAgentWebhook(agent.id); setIsSet(false); setResult(null); setConfirm(false); toast.push('ok', 'Webhook de l’agent supprimé.'); }
    catch (e) { toast.push('err', e instanceof Error ? e.message : 'Suppression impossible.'); setConfirm(false); }
    finally { setBusy(null); }
  };

  return (
    <div className="field span-2 webhook">
      <label className="field__label" htmlFor="agent-webhook"><span>Webhook de cet agent</span><span style={{ marginLeft: 'auto' }}>{isSet ? <Tag tone="ok">Webhook enregistré</Tag> : <Tag tone="neutral">Aucun webhook</Tag>}</span></label>
      <div className="webhook__row">
        <input id="agent-webhook" className="input input--mono" type="password" name="agent-discord-webhook" autoComplete="new-password" spellCheck={false} autoCapitalize="none"
          value={url} onChange={(e) => setUrl(e.target.value)} aria-invalid={formatErr ? true : undefined} aria-describedby="agent-webhook-h"
          placeholder={isSet ? 'webhook enregistré, laisser vide pour le conserver' : 'https://discord.com/api/webhooks/…'}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }} />
        <Button onClick={() => void save()} busy={busy === 'save'} disabled={!trimmed || !!formatErr || !!busy}>Enregistrer</Button>
        <Button onClick={() => void test()} busy={busy === 'test'} disabled={!isSet || !!busy}>Tester</Button>
        <Button variant="danger" onClick={() => setConfirm(true)} disabled={!isSet || !!busy}>Supprimer</Button>
      </div>
      <div className="field__hint" id="agent-webhook-h">Si vide, le webhook global des Paramètres est utilisé. Ne collez jamais un webhook dans la mission ou le prompt : il serait envoyé au fournisseur d’IA. L’adresse enregistrée n’est jamais réaffichée.</div>
      {(formatErr || error) && <div className="field__err" role="alert">{formatErr ?? error}</div>}
      {result && <div style={{ marginTop: 6 }}>{result.ok ? <Banner tone="ok">Message de test envoyé sur le webhook de l’agent.</Banner> : <Banner tone="err" title="Échec du test"><span className="untrusted">{result.error ?? 'Erreur inconnue.'}</span></Banner>}</div>}
      {confirm && (
        <ConfirmDialog title="Supprimer le webhook" danger confirmLabel="Supprimer le webhook" busy={busy === 'delete'} onCancel={() => setConfirm(false)} onConfirm={() => void remove()}>
          Le webhook de cet agent sera effacé du serveur. Ses rapports utiliseront ensuite le webhook global des Paramètres, ou le bot.
        </ConfirmDialog>
      )}
    </div>
  );
}
