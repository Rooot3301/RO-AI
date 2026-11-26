import { useState } from 'react';
import { api, ApiError } from '../api/client';
import type { DiscordSettings } from '../api/types';
import { Banner, Button, Panel, Tag } from '../components/ui/primitives';
import { Field } from '../components/ui/forms';
import { ConfirmDialog } from '../components/ui/Modal';
import { Rel } from '../components/ui/Time';
import { useToast } from '../store/toast';

export const WEBHOOK_RE = /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d{15,22}\/[A-Za-z0-9_-]{20,120}$/;

/** Webhook Discord pour les rapports d'agents. Secret en écriture seule : jamais renvoyé par le serveur, jamais affiché. */
export function WebhookPanel({ server, onSaved }: { server: DiscordSettings; onSaved: (s: DiscordSettings) => void }) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = !!server.webhook_set;
  const wh = server.status.webhook;
  const trimmed = value.trim();
  const invalid = trimmed && !WEBHOOK_RE.test(trimmed) ? 'Adresse invalide : elle doit commencer par https://discord.com/api/webhooks/' : null;

  const save = async () => {
    if (!trimmed || invalid) return;
    setBusy(true); setErr(null); setResult(null);
    try { const s = await api.saveDiscord({ webhook_url: trimmed }); onSaved(s); setValue(''); toast.push('ok', 'Webhook enregistré.'); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Enregistrement impossible.'); }
    finally { setBusy(false); }
  };
  const clear = async () => {
    setBusy(true);
    try { const s = await api.saveDiscord({ clear_webhook: true }); onSaved(s); setConfirmClear(false); setResult(null); toast.push('ok', 'Webhook supprimé du serveur.'); }
    catch (e) { toast.push('err', e instanceof Error ? e.message : 'Suppression impossible.'); setConfirmClear(false); }
    finally { setBusy(false); }
  };
  const test = async () => {
    setTesting(true); setResult(null);
    try { setResult(await api.testDiscord('webhook')); onSaved(await api.discord()); }
    catch (e) { setResult({ ok: false, error: e instanceof ApiError || e instanceof Error ? e.message : 'Envoi impossible.' }); }
    finally { setTesting(false); }
  };

  return (
    <Panel title="Rapports par webhook" id="d-webhook" meta={set ? <Tag tone="ok">Webhook enregistré</Tag> : <Tag tone="neutral">Aucun webhook</Tag>}>
      <p className="dim" style={{ fontSize: 13, marginBottom: 12 }}>
        Reçoit le rapport complet des agents qui ont l’option « Envoyer le rapport complet sur Discord ». Aucun bot n’est nécessaire.
      </p>
      <Field label="Adresse du webhook" error={invalid ?? err ?? undefined}
        hint={set ? 'Écriture seule : l’adresse enregistrée n’est jamais affichée. Saisissez-en une nouvelle uniquement pour la remplacer.' : 'Discord : modifier le salon, Intégrations, Webhooks, Nouveau webhook, Copier l’URL.'}>
        <input className="input input--mono" type="password" name="discord-webhook" autoComplete="new-password" spellCheck={false} autoCapitalize="none"
          value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={!!invalid} placeholder={set ? 'webhook enregistré, laisser vide pour le conserver' : 'https://discord.com/api/webhooks/…'} />
      </Field>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <Button variant="primary" busy={busy} disabled={!trimmed || !!invalid} onClick={() => void save()}>Enregistrer le webhook</Button>
        {set && <Button onClick={() => void test()} busy={testing} disabled={!!trimmed}>Envoyer un message de test</Button>}
        {set && <Button variant="danger" onClick={() => setConfirmClear(true)}>Supprimer</Button>}
      </div>
      {set && wh?.last_sent_at && <p className="faint" style={{ fontSize: 12.5, marginTop: 10 }}>Dernier envoi <Rel iso={wh.last_sent_at} />.</p>}
      {set && wh?.last_error && <div style={{ marginTop: 10 }}><Banner tone="err" title="Dernier envoi en échec"><span className="untrusted">{wh.last_error}</span></Banner></div>}
      {result && <div style={{ marginTop: 10 }}>{result.ok ? <Banner tone="ok">Message de test envoyé : vérifiez votre salon Discord.</Banner> : <Banner tone="err" title="Échec de l’envoi"><span className="untrusted">{result.error ?? 'Erreur inconnue.'}</span></Banner>}</div>}
      <p className="faint" style={{ fontSize: 12.5, marginTop: 12 }}>
        Sécurité : quiconque possède cette adresse peut publier dans votre salon. Ne la collez jamais dans la mission ou le prompt d’un agent (il serait envoyé au fournisseur d’IA). Si elle a fuité, supprimez le webhook dans Discord et créez-en un nouveau.
      </p>
      {confirmClear && <ConfirmDialog title="Supprimer le webhook ?" confirmLabel="Supprimer" danger busy={busy} onConfirm={() => void clear()} onCancel={() => setConfirmClear(false)}>
        L’adresse sera effacée du serveur. Les agents configurés pour envoyer leur rapport ne pourront plus le faire (sauf via le bot s’il est connecté).
      </ConfirmDialog>}
    </Panel>
  );
}
