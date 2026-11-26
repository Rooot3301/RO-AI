import { Link } from 'react-router-dom';
import { Led, Panel, Skeleton, Empty } from '../../components/ui/primitives';
import { providerTone } from '../../components/ui/domain';
import { Countdown } from '../../components/ui/Time';
import { useLive } from '../../store/LiveProvider';
import { AUTH_STATE_LABEL, LIMIT_STATUS_LABEL, windowLabel } from '../../lib/labels';
import type { Provider } from '../../api/types';

function ProviderTile({ p }: { p: Provider }) {
  const t = providerTone(p);
  const lim = p.limits;
  return (
    <div className="ptile">
      <div className="ptile__head">
        <Led tone={t.tone} label={t.text} />
        <span className="ptile__name">{p.name}</span>
        <span className="ptile__ver num">{p.installed ? (p.version ? `v${p.version}` : 'version ?') : 'non installé'}</span>
      </div>
      <dl className="kv ptile__kv">
        <dt>Auth</dt>
        <dd>{AUTH_STATE_LABEL[p.auth.state]}{p.auth.plan ? <span className="dim"> · {p.auth.plan}</span> : null}{p.auth.method ? <span className="dim"> · {p.auth.method}</span> : null}</dd>
        <dt>Limites</dt>
        <dd>
          {lim == null ? <span className="dim">aucune information (émise lors d’une exécution)</span>
            : lim.status === 'limited' ? <span className="amber">Limité{lim.window ? ` · fenêtre de ${windowLabel(lim.window)}` : ''}{lim.resets_at ? <> · reprise dans <Countdown iso={lim.resets_at} /></> : null}</span>
            : <span className={lim.status === 'ok' ? '' : 'dim'}>{LIMIT_STATUS_LABEL[lim.status]}</span>}
        </dd>
      </dl>
      {p.auth.state !== 'logged_in' && p.installed && <p className="ptile__warn">{p.auth.detail || 'Connexion requise.'} <Link to="/providers">Procédure</Link></p>}
    </div>
  );
}

export function ProvidersPanel() {
  const providers = useLive((s) => s.providers);
  return (
    <Panel title="Fournisseurs" id="ov-providers" meta={<Link to="/providers">Détails</Link>} flush>
      {providers == null ? <Skeleton rows={3} />
        : providers.length === 0 ? <Empty title="Aucun fournisseur déclaré">Le serveur ne renvoie aucun fournisseur.</Empty>
        : <div className="ptiles">{providers.map((p) => <ProviderTile key={p.id} p={p} />)}</div>}
    </Panel>
  );
}
