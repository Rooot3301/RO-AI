import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Led } from '../ui/primitives';
import { EmergencyButton } from './Emergency';
import { providerTone } from '../ui/domain';
import { useLive } from '../../store/LiveProvider';
import { formatClock, formatPercent } from '../../lib/format';
import { PROVIDER_LABEL } from '../../lib/labels';
import type { ProviderId } from '../../api/types';

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return <time className="status__clock" dateTime={now.toISOString()} title={tz}>{formatClock(now)}</time>;
}

const CONN = {
  connecting: { tone: 'warn' as const, text: 'Connexion…', busy: true },
  open: { tone: 'ok' as const, text: 'Flux connecté', busy: false },
  reconnecting: { tone: 'err' as const, text: 'Reconnexion…', busy: true },
};

export function StatusBar({ title }: { title: string }) {
  const providers = useLive((s) => s.providers);
  const system = useLive((s) => s.system);
  const conn = useLive((s) => s.conn);
  const c = CONN[conn];
  const memHot = (system?.mem.percent ?? 0) >= 85;
  return (
    <header className="topbar" role="banner">
      <div className="topbar__where micro">
        <span className="faint">RO·AI</span><span className="faint" aria-hidden="true">/</span><span className="topbar__title">{title}</span>
      </div>
      <div className="topbar__strip" role="group" aria-label="État de la plateforme">
        {(['claude', 'codex'] as ProviderId[]).map((id) => {
          const p = providers?.find((x) => x.id === id);
          const t = providerTone(providers ? p : undefined);
          return (
            <Link key={id} to="/providers" className="status__item" title={`${PROVIDER_LABEL[id]} : ${t.text}`}>
              <Led tone={providers ? t.tone : 'off'} label={`${PROVIDER_LABEL[id]} : ${t.text}`} />
              <span className="micro">{PROVIDER_LABEL[id]}</span>
            </Link>
          );
        })}
        <span className="status__sep" aria-hidden="true" />
        <span className="status__item" title="Agents en cours d’exécution">
          <span className="micro">Actifs</span><span className="num status__val">{system ? system.agents_running : '—'}</span>
        </span>
        <span className="status__item" title="Exécutions en file d’attente">
          <span className="micro">File</span><span className="num status__val">{system ? system.queue_depth : '—'}</span>
        </span>
        <span className="status__item" title="Mémoire utilisée">
          <span className="micro">Mém</span><span className={`num status__val${memHot ? ' err-text' : ''}`}>{system ? formatPercent(system.mem.percent) : '—'}</span>
        </span>
      </div>
      <div className="topbar__end">
        <EmergencyButton />
        <span className="status__item" role="status" title={c.text}>
          <Led tone={c.tone} busy={c.busy} />
          <span className="micro">{c.text}</span>
        </span>
        <Clock />
      </div>
    </header>
  );
}
