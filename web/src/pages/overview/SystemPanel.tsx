import { Panel, Skeleton, Stat, Banner } from '../../components/ui/primitives';
import { useLive } from '../../store/LiveProvider';
import { formatBytes, formatNumber, formatPercent, formatUptime } from '../../lib/format';

/** Ligne de ressource : libellé, valeur, barre continue (rouge au-delà de 85 %). */
function Usage({ label, pct, text, big }: { label: string; pct: number | null; text: string; big?: boolean }) {
  const v = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div className={`usage${big ? ' usage--big' : ''}`}>
      <div className="usage__top">
        <span className="usage__label">{label}</span>
        <span className="num usage__text">{text}</span>
      </div>
      <div className={`usage__bar${v >= 85 ? ' usage__bar--hot' : ''}`} role="img" aria-label={`${label} : ${pct == null ? 'indisponible' : formatPercent(pct)}`}>
        <span style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

export function SystemPanel() {
  const sys = useLive((s) => s.system);
  const err = useLive((s) => s.systemError);
  const ai = sys?.ai_slice ?? null;
  const aiPct = ai && ai.mem_max ? (ai.mem_current / ai.mem_max) * 100 : null;
  return (
    <Panel title="Système" id="ov-system" meta={sys ? <span className="num">actif depuis {formatUptime(sys.uptime_s)}</span> : null}>
      {err && !sys && <Banner tone="err" title="Mesures indisponibles">{err}</Banner>}
      {!sys && !err && <Skeleton rows={6} />}
      {sys && (
        <div className="usages">
          <Usage big label="Processeur" pct={sys.cpu_percent} text={formatPercent(sys.cpu_percent)} />
          <Usage big label="Mémoire" pct={sys.mem.percent} text={`${formatBytes(sys.mem.used)} sur ${formatBytes(sys.mem.total)}`} />
          <Usage label="Mémoire des agents" pct={aiPct} text={ai == null ? 'non configurée' : ai.mem_max ? `${formatBytes(ai.mem_current)} sur ${formatBytes(ai.mem_max)}` : `${formatBytes(ai.mem_current)}, sans plafond`} />
          <Usage label="Disque" pct={sys.disk.percent} text={`${formatBytes(sys.disk.used)} sur ${formatBytes(sys.disk.total)}`} />
          <Usage label="Swap" pct={sys.swap.total > 0 ? sys.swap.percent : null} text={sys.swap.total > 0 ? `${formatBytes(sys.swap.used)} sur ${formatBytes(sys.swap.total)}` : 'aucun'} />
          <div className="usages__foot">
            <Stat label="Agents en cours" value={formatNumber(sys.agents_running)} />
            <Stat label="File d’attente" value={formatNumber(sys.queue_depth)} />
            <Stat label="Charge (1 min)" value={formatNumber(sys.load[0], 2)} />
          </div>
        </div>
      )}
    </Panel>
  );
}
