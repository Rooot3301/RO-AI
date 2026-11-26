import { useState } from 'react';
import { api } from '../api/client';
import type { Provider } from '../api/types';
import { Banner, Button, Empty, Led, Panel, Skeleton, Tag } from '../components/ui/primitives';
import { CopyButton, providerTone } from '../components/ui/domain';
import { Countdown, Rel } from '../components/ui/Time';
import { IconRefresh } from '../components/ui/icons';
import { useLive, useLiveStore } from '../store/LiveProvider';
import { useToast } from '../store/toast';
import { useDocumentTitle } from '../hooks/useNow';
import { formatDateTime } from '../lib/format';
import { AUTH_STATE_LABEL, LIMIT_STATUS_LABEL, windowLabel } from '../lib/labels';
import './Providers.css';

const LOGIN_CMD: Record<string, { label: string; cmd: string; alt: string }> = {
  claude: { label: 'Claude', cmd: 'roai-login claude', alt: "runuser -l agent -c 'claude auth login'" },
  codex: { label: 'Codex', cmd: 'roai-login codex', alt: "runuser -l agent -c 'codex login --device-auth'" },
};

function ProviderCard({ p }: { p: Provider }) {
  const store = useLiveStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const t = providerTone(p);
  const lim = p.limits;
  const refresh = async () => {
    setBusy(true);
    try { const r = await api.refreshProvider(p.id); store.putProvider(r); toast.push('ok', `État de ${r.name} revérifié.`); }
    catch (e) { toast.push('err', e instanceof Error ? e.message : 'Vérification impossible.'); }
    finally { setBusy(false); }
  };
  return (
    <Panel id={`prov-${p.id}`} title={p.name} tone={p.auth.state === 'logged_out' && p.installed ? 'err' : undefined}
      meta={<><span className="provstate"><Led tone={t.tone} /> {t.text}</span></>}>
      <dl className="kv provkv">
        <dt>Installation</dt><dd>{p.installed ? <>Installé{p.version ? <span className="num dim"> · v{p.version}</span> : null}</> : <span className="err-text">Client non installé sur l’hôte</span>}</dd>
        <dt>Authentification</dt><dd><Tag tone={p.auth.state === 'logged_in' ? 'ok' : p.auth.state === 'logged_out' ? 'err' : 'warn'}>{AUTH_STATE_LABEL[p.auth.state]}</Tag></dd>
        <dt>Détail</dt><dd className="untrusted">{p.auth.detail || <span className="faint">—</span>}</dd>
        <dt>Méthode</dt><dd>{p.auth.method ?? <span className="faint">—</span>}</dd>
        <dt>Abonnement</dt><dd>{p.auth.plan ?? <span className="faint">—</span>}</dd>
        <dt>Expiration</dt><dd className="num">{p.auth.expires_at ? <>{formatDateTime(p.auth.expires_at)} <span className="dim">(<Countdown iso={p.auth.expires_at} />)</span></> : <span className="faint">non communiquée</span>}</dd>
        <dt>Limites</dt>
        <dd>
          {lim == null ? <span className="dim">Aucune information : les limites sont signalées par le client officiel pendant une exécution.</span> : (
            <div className="provlim">
              <Tag tone={lim.status === 'limited' ? 'warn' : lim.status === 'ok' ? 'ok' : 'neutral'}>{LIMIT_STATUS_LABEL[lim.status]}</Tag>
              {lim.window && <span className="dim"> fenêtre de {windowLabel(lim.window)}</span>}
              {lim.resets_at && <div className="num dim" style={{ fontSize: 12 }}>réinitialisation {formatDateTime(lim.resets_at)} · dans <Countdown iso={lim.resets_at} /></div>}
              {lim.updated_at && <div className="faint" style={{ fontSize: 11.5 }}>mis à jour <Rel iso={lim.updated_at} /></div>}
            </div>
          )}
        </dd>
        <dt>Dernière vérif.</dt><dd className="dim"><Rel iso={p.checked_at} /></dd>
      </dl>
      <div className="provactions">
        <Button onClick={() => void refresh()} busy={busy}><IconRefresh />Revérifier</Button>
        <span className="faint" style={{ fontSize: 12 }}>Relance la sonde d’état, sans toucher aux identifiants.</span>
      </div>
    </Panel>
  );
}

export default function ProvidersPage() {
  useDocumentTitle('Fournisseurs');
  const providers = useLive((s) => s.providers);
  const needLogin = (providers ?? []).filter((p) => p.installed && p.auth.state !== 'logged_in');
  return (
    <div className="page">
      <div className="page__head">
        <div className="page__titles">
          <div className="micro page__crumb">Système</div>
          <h1 className="page__title">Fournisseurs</h1>
          <p className="page__sub">Les agents pilotent les clients officiels Claude Code et Codex, connectés par abonnement. Cette page affiche leur état ; elle ne gère aucun identifiant.</p>
        </div>
      </div>

      {needLogin.length > 0 && <div style={{ marginBottom: 16 }}><Banner tone="warn" title="Connexion requise">{needLogin.map((p) => p.name).join(' et ')} {needLogin.length > 1 ? 'ne sont pas connectés' : 'n’est pas connecté'}. Suivez la procédure SSH ci-dessous, puis cliquez sur « Revérifier ».</Banner></div>}

      <div className="provgrid">
        {providers == null ? <Panel><Skeleton rows={6} /></Panel>
          : providers.length === 0 ? <div className="panel"><Empty title="Aucun fournisseur">Le serveur ne déclare aucun fournisseur.</Empty></div>
          : providers.map((p) => <ProviderCard key={p.id} p={p} />)}
      </div>

      <div style={{ marginTop: 16 }}>
        <Panel title="Connexion d’un fournisseur" id="prov-howto" tone="alert">
          <div className="howto">
            <p className="howto__lead"><strong>La connexion se fait uniquement en SSH, sur l’hôte.</strong> Le Control Center ne demande, ne reçoit et ne stocke jamais de jeton, de clé ou de code d’authentification : il n’y a volontairement aucun champ de saisie ici.</p>
            <ol className="howto__steps">
              <li>Ouvrez une session SSH sur le serveur RO·AI avec un compte administrateur.</li>
              <li>Exécutez <code>roai-login</code> pour le fournisseur à connecter (ou l’alternative équivalente). La session est créée sous l’utilisateur <code>agent</code>, dont le répertoire personnel la porte.</li>
              <li>Suivez les instructions affichées dans le terminal (ouverture d’une adresse de confirmation, code d’appareil).</li>
              <li>Revenez ici et cliquez sur « Revérifier » : l’état doit passer à « Connecté ».</li>
            </ol>
            {Object.entries(LOGIN_CMD).map(([id, c]) => (
              <div key={id} className="howto__cmd">
                <div className="micro">{c.label}</div>
                <div className="code"><span className="code__prompt" aria-hidden="true">#</span><pre className="code__text" aria-label={`Commande de connexion ${c.label}`}>{c.cmd}</pre><CopyButton text={c.cmd} /></div>
                <div className="micro faint" style={{ marginTop: 2 }}>Alternative équivalente</div>
                <div className="code"><span className="code__prompt" aria-hidden="true">#</span><pre className="code__text" aria-label={`Commande alternative ${c.label}`}>{c.alt}</pre><CopyButton text={c.alt} /></div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
