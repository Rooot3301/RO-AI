import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import type { DiscordSettings } from '../api/types';
import { Banner, Button, LoadError, Led, Panel, Skeleton, Tag, type LedTone } from '../components/ui/primitives';
import { Field, Seg, Switch } from '../components/ui/forms';
import { ConfirmDialog } from '../components/ui/Modal';
import { WebhookPanel } from './WebhookPanel';
import { CopyButton } from '../components/ui/domain';
import { Rel } from '../components/ui/Time';
import { useDocumentTitle } from '../hooks/useNow';
import { useToast } from '../store/toast';
import {
  buildDiscordUpdate, COMMAND_ITEMS, discordToForm, DISCORD_STATE_LABEL, isDirty, NOTIFY_ITEMS, statusPollDelay, validateDiscord, type DiscordErrors, type DiscordForm,
} from '../lib/discordForm';
import './Settings.css';

const STATE_LED: Record<keyof typeof DISCORD_STATE_LABEL, { tone: LedTone; busy?: boolean }> = {
  disabled: { tone: 'off' }, incomplete: { tone: 'warn' }, connecting: { tone: 'amber', busy: true }, connected: { tone: 'ok' }, error: { tone: 'err' },
};
type Live = Pick<DiscordSettings, 'status' | 'token_set' | 'invite_url'>;
const safeHttp = (u: string | null): string | null => { try { const x = new URL(u ?? ''); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; } };

export default function SettingsPage() {
  useDocumentTitle('Paramètres');
  const [server, setServer] = useState<DiscordSettings | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.discord().then((s) => { setServer(s); setLive({ status: s.status, token_set: s.token_set, invite_url: s.invite_url }); },
      (e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Actualisation discrète de l'état de connexion (sans toucher aux champs en cours de saisie).
  const state = live?.status.state;
  useEffect(() => {
    if (!state) return;
    const t = setTimeout(() => {
      if (document.visibilityState !== 'visible') return;
      api.discord().then((s) => setLive({ status: s.status, token_set: s.token_set, invite_url: s.invite_url }), () => undefined);
    }, statusPollDelay(state));
    return () => clearTimeout(t);
  }, [state, live]);

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__titles">
          <div className="micro page__crumb">Système</div>
          <h1 className="page__title">Paramètres</h1>
          <p className="page__sub">Configuration de la plateforme. Les réglages sont enregistrés sur le serveur.</p>
        </div>
      </div>
      {error && !server ? <LoadError message={error} onRetry={load} />
        : !server || !live ? <div className="panel"><Skeleton rows={8} /></div>
        : <DiscordSection server={server} live={live} onSaved={(s) => { setServer(s); setLive({ status: s.status, token_set: s.token_set, invite_url: s.invite_url }); }} />}
    </div>
  );
}

function DiscordSection({ server, live, onSaved }: { server: DiscordSettings; live: Live; onSaved: (s: DiscordSettings) => void }) {
  const toast = useToast();
  const base = useMemo(() => discordToForm(server), [server]);
  const [form, setForm] = useState<DiscordForm>(base);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error: string | null } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const set = <K extends keyof DiscordForm>(k: K, v: DiscordForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = isDirty(base, form);
  const errors: DiscordErrors = validateDiscord(form, live.token_set);
  const shown = (k: keyof DiscordErrors) => { const v = errors[k]; if (!v) return undefined; return submitted || form[k].trim() ? v : undefined; };
  const st = live.status;
  const led = STATE_LED[st.state];

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true); setServerError(null);
    if (Object.keys(errors).length) { requestAnimationFrame(() => (formRef.current?.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus()); return; }
    setSaving(true);
    try {
      const saved = await api.saveDiscord(buildDiscordUpdate(base, form));
      onSaved(saved); setForm(discordToForm(saved)); setSubmitted(false); setTestResult(null);
      toast.push('ok', 'Paramètres Discord enregistrés.');
    } catch (err) { setServerError(err instanceof Error ? err.message : 'Enregistrement impossible.'); }
    finally { setSaving(false); }
  };

  const clearToken = async () => {
    setClearing(true);
    try {
      const saved = await api.saveDiscord({ clear_token: true });
      onSaved(saved); setForm((f) => ({ ...f, token: '' })); setConfirmClear(false);
      toast.push('ok', 'Jeton supprimé du serveur.');
    } catch (err) { toast.push('err', err instanceof Error ? err.message : 'Suppression impossible.'); setConfirmClear(false); }
    finally { setClearing(false); }
  };

  const sendTest = async () => {
    setTesting(true); setTestResult(null);
    try { setTestResult(await api.testDiscord()); }
    catch (err) { setTestResult({ ok: false, error: err instanceof ApiError || err instanceof Error ? err.message : 'Envoi impossible.' }); }
    finally { setTesting(false); }
  };

  const invite = safeHttp(live.invite_url);
  const canTest = st.state === 'connected';

  return (
    <section aria-labelledby="discord-h" className="settings">
      <div className="settings__head">
        <h2 id="discord-h" className="settings__h">Discord</h2>
        <p className="dim">Un bot privé qui vous prévient et ne répond qu’à vous.</p>
      </div>

      <div className="settings__grid">
        <form id="discord-form" ref={formRef} onSubmit={save} noValidate className="settings__main">
          <Panel title="État" id="d-status">
            <div className="dstate">
              <span className="dstate__main"><Led tone={led.tone} busy={led.busy} /><strong>{DISCORD_STATE_LABEL[st.state]}</strong></span>
              <dl className="kv dstate__kv">
                <dt>Bot</dt><dd>{st.bot_user ? <span className="untrusted">{st.bot_user}</span> : <span className="faint">non connecté</span>}</dd>
                <dt>Dernier envoi</dt><dd>{st.last_sent_at ? <Rel iso={st.last_sent_at} /> : <span className="faint">aucun message envoyé</span>}</dd>
              </dl>
            </div>
            {st.last_error && <div style={{ marginTop: 12 }}><Banner tone="err" title="Dernière erreur"><span className="untrusted">{st.last_error}</span></Banner></div>}
            {st.state === 'incomplete' && !st.last_error && <div style={{ marginTop: 12 }}><Banner tone="warn">Configuration incomplète : renseignez le jeton, votre identifiant et l’identifiant de l’application, puis activez le bot. Le guide à droite détaille chaque étape.</Banner></div>}
          </Panel>

          {serverError && <Banner tone="err" title="Le serveur a refusé les paramètres"><span className="untrusted">{serverError}</span></Banner>}
          {submitted && Object.keys(errors).length > 0 && (
            <Banner tone="err" title={`${Object.keys(errors).length} champ(s) à corriger`}><ul className="errsum">{Object.values(errors).map((m) => <li key={m}>{m}</li>)}</ul></Banner>
          )}

          <Panel title="Connexion" id="d-conn">
            <div className="form-grid">
              <div className="field span-2"><Switch checked={form.enabled} onChange={(v) => set('enabled', v)}>Activer le bot</Switch><div className="field__hint">Désactivé, le bot est déconnecté de Discord et n’envoie rien. La configuration est conservée.</div></div>
              <Field className="span-2" label="Jeton du bot" error={shown('token')} hint={live.token_set ? 'Écriture seule : le jeton enregistré n’est jamais affiché. Saisissez-en un nouveau uniquement pour le remplacer.' : 'Collez ici le jeton copié depuis le portail Discord. Il ne sera plus jamais affiché.'}
                right={live.token_set ? <Tag tone="ok">Jeton enregistré</Tag> : <Tag tone="neutral">Aucun jeton</Tag>}>
                <input className="input input--mono" type="password" name="discord-bot-token" autoComplete="new-password" spellCheck={false} autoCapitalize="none"
                  value={form.token} onChange={(e) => set('token', e.target.value)} placeholder={live.token_set ? 'jeton enregistré, laisser vide pour le conserver' : 'Jeton du bot'} />
              </Field>
              {live.token_set && <div className="span-2" style={{ marginTop: -6 }}><Button size="sm" variant="danger" onClick={() => setConfirmClear(true)}>Supprimer le jeton</Button></div>}
              <Field label="Votre identifiant utilisateur Discord" error={shown('owner_id')} hint="Seul cet identifiant peut utiliser les commandes et recevoir les messages.">
                <input className="input input--mono" inputMode="numeric" value={form.owner_id} onChange={(e) => set('owner_id', e.target.value)} placeholder="123456789012345678" autoComplete="off" />
              </Field>
              <Field label="Identifiant de l’application" error={shown('application_id')} hint="Onglet « General Information » du portail développeur.">
                <input className="input input--mono" inputMode="numeric" value={form.application_id} onChange={(e) => set('application_id', e.target.value)} placeholder="123456789012345678" autoComplete="off" />
              </Field>
              <div className="field span-2"><span className="field__label">Livraison des notifications</span>
                <Seg name="delivery" label="Livraison" value={form.delivery} onChange={(v) => set('delivery', v)} options={[{ value: 'dm', label: 'Messages privés' }, { value: 'channel', label: 'Salon' }]} />
                <div className="field__hint">{form.delivery === 'dm' ? 'Le bot vous écrit en message privé (recommandé : rien n’est visible des autres membres du serveur).' : 'Les messages sont publiés dans un salon : ils seront visibles de tous ceux qui y ont accès.'}</div>
              </div>
              {form.delivery === 'channel' && (
                <Field label="Identifiant du salon" required error={shown('channel_id')} hint="Clic droit sur le salon (mode développeur) > Copier l’identifiant du salon.">
                  <input className="input input--mono" inputMode="numeric" value={form.channel_id} onChange={(e) => set('channel_id', e.target.value)} autoComplete="off" />
                </Field>
              )}
              <Field className="span-2" label="Adresse du tableau de bord" error={shown('dashboard_url')} hint="Utilisée pour les liens dans les messages (ex. vers une exécution). Facultatif.">
                <input className="input" type="url" inputMode="url" value={form.dashboard_url} onChange={(e) => set('dashboard_url', e.target.value)} placeholder="https://roai.exemple.fr" autoComplete="off" />
              </Field>
            </div>
          </Panel>

          <Panel title="Notifications" id="d-notify">
            <ul className="checks">
              {NOTIFY_ITEMS.map((it) => (
                <CheckRow key={it.key} id={`n-${it.key}`} checked={form.notify[it.key]} onChange={(v) => set('notify', { ...form.notify, [it.key]: v })} label={it.label} help={it.help} />
              ))}
            </ul>
          </Panel>

          <Panel title="Commandes autorisées" id="d-cmds">
            <ul className="checks">
              {COMMAND_ITEMS.map((it) => (
                <CheckRow key={it.key} id={`c-${it.key}`} checked={form.commands[it.key]} onChange={(v) => set('commands', { ...form.commands, [it.key]: v })} label={it.label} help={it.help} warn={it.warn} />
              ))}
            </ul>
          </Panel>

          <div className="savebar">
            <span className="savebar__hint">{dirty ? 'Modifications non enregistrées.' : 'Aucune modification.'}</span>
            <Button type="submit" variant="primary" busy={saving} disabled={!dirty}>Enregistrer</Button>
          </div>
        </form>

        <aside className="settings__side">
          <WebhookPanel server={server} onSaved={onSaved} />

          <Panel title="Message de test" id="d-test">
            <p className="dim" style={{ fontSize: 13, marginBottom: 12 }}>Envoie un message au propriétaire avec la configuration enregistrée.</p>
            <Button onClick={() => void sendTest()} busy={testing} disabled={!canTest} title={canTest ? undefined : 'Le bot doit être connecté pour envoyer un message de test.'}>Envoyer un message de test</Button>
            {!canTest && <p className="faint" style={{ fontSize: 12.5, marginTop: 8 }}>Disponible lorsque l’état est « Connecté ».</p>}
            {dirty && canTest && <p className="faint" style={{ fontSize: 12.5, marginTop: 8 }}>Enregistrez d’abord vos modifications : le test utilise la configuration enregistrée.</p>}
            {testResult && <div style={{ marginTop: 12 }}>{testResult.ok ? <Banner tone="ok">Message de test envoyé : vérifiez vos messages Discord.</Banner> : <Banner tone="err" title="Échec de l’envoi"><span className="untrusted">{testResult.error ?? 'Erreur inconnue.'}</span></Banner>}</div>}
          </Panel>

          {live.invite_url && (
            <Panel title="Lien d’invitation" id="d-invite">
              <div className="field">
                <label className="field__label" htmlFor="invite-url">Lien à ouvrir pour ajouter le bot à votre serveur</label>
                <input id="invite-url" className="input input--mono" readOnly value={live.invite_url} onFocus={(e) => e.currentTarget.select()} />
              </div>
              <div className="invite__actions"><CopyButton text={live.invite_url} />{invite && <a className="btn btn--sm" href={invite} target="_blank" rel="noopener noreferrer">Ouvrir</a>}</div>
            </Panel>
          )}

          <Panel title="Ce que fait le bot" id="d-about">
            <ul className="about">
              <li>Vous envoie les <strong>notifications</strong> que vous avez cochées, en message privé ou dans le salon choisi.</li>
              <li>Répond aux <strong>commandes slash</strong> autorisées, <strong>réservées à votre identifiant</strong>.</li>
              <li>Ne lit <strong>aucun message</strong> et n’a aucun autre pouvoir.</li>
            </ul>
          </Panel>

          <Guide open={!live.token_set && !server.owner_id} />
        </aside>
      </div>

      {confirmClear && (
        <ConfirmDialog title="Supprimer le jeton" danger confirmLabel="Supprimer le jeton" busy={clearing} onCancel={() => setConfirmClear(false)} onConfirm={() => void clearToken()}>
          Le jeton sera effacé du serveur et le bot se déconnectera de Discord. Pour le réactiver, il faudra générer un nouveau jeton (« Reset Token ») dans le portail développeur.
        </ConfirmDialog>
      )}
    </section>
  );
}

function CheckRow({ id, checked, onChange, label, help, warn }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; help: string; warn?: string }) {
  return (
    <li className="check">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-describedby={`${id}-h`} />
      <label htmlFor={id}>
        <span className="check__label">{label}</span>
        <span className="check__help" id={`${id}-h`}>{help}{warn && <> <strong className="check__warn">{warn}</strong></>}</span>
      </label>
    </li>
  );
}

function Guide({ open }: { open: boolean }): ReactNode {
  return (
    <div className="panel guide">
      <details open={open}>
        <summary className="guide__sum">Comment créer et inviter le bot</summary>
        <ol className="guide__steps">
          <li>Ouvrez <strong>discord.com/developers/applications</strong> et cliquez sur <em>New Application</em>.</li>
          <li>Onglet <em>Bot</em> : cliquez sur <em>Reset Token</em> et copiez le jeton. Collez-le ici : il ne sera plus jamais affiché. <strong>N’activez pas</strong> les « Privileged Gateway Intents ».</li>
          <li>Onglet <em>General Information</em> : copiez l’<em>Application ID</em>.</li>
          <li>Dans Discord, <em>Paramètres utilisateur</em> &gt; <em>Avancés</em> : activez le mode développeur, puis clic droit sur votre profil &gt; <em>Copier l’identifiant</em>.</li>
          <li>Collez les trois valeurs ci-contre, activez le bot et cliquez sur « Enregistrer ».</li>
          <li>Ouvrez le lien d’invitation, choisissez votre serveur et autorisez le bot.</li>
          <li>Dans les paramètres de confidentialité du serveur, autorisez les messages privés des membres.</li>
          <li>Cliquez sur « Envoyer un message de test ».</li>
        </ol>
        <div className="guide__sec">
          <strong>Sécurité</strong>
          <ul>
            <li>Le jeton est stocké sur le serveur avec une lecture réservée et n’est jamais renvoyé à l’interface.</li>
            <li>Seul votre identifiant Discord peut utiliser les commandes.</li>
            <li>Le bot ne lit aucun message.</li>
          </ul>
        </div>
      </details>
    </div>
  );
}
