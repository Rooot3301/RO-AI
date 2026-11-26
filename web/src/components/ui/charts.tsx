import { clamp } from '../../lib/format';

const hot = (pct: number, at = 85) => pct >= at;

/** Cadran semi-circulaire, tracé à la main. `pct` 0..100. */
export function ArcGauge({ pct, label, display, sub }: { pct: number | null; label: string; display?: string; sub?: string }) {
  const p = pct == null ? 0 : clamp(pct, 0, 100);
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const a = Math.PI - (i / 10) * Math.PI;
    const r1 = 51; const r2 = i % 5 === 0 ? 57 : 54;
    return { x1: 60 + r1 * Math.cos(a), y1: 64 - r1 * Math.sin(a), x2: 60 + r2 * Math.cos(a), y2: 64 - r2 * Math.sin(a) };
  });
  return (
    <figure className="gauge" style={{ margin: 0 }} aria-label={`${label} : ${pct == null ? 'indisponible' : `${Math.round(p)} %`}`}>
      <svg className={`arc${pct != null && hot(p) ? ' arc--hot' : ''}`} viewBox="0 0 120 76" role="img" aria-hidden="true">
        {ticks.map((t, i) => <line key={i} className="arc__tick" x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} strokeWidth="1" />)}
        <path className="arc__track" d="M14 64A46 46 0 0 1 106 64" fill="none" strokeWidth="6" />
        <path className="arc__val" d="M14 64A46 46 0 0 1 106 64" fill="none" strokeWidth="6" pathLength={100} strokeDasharray={`${p} 100`} />
        <text className="arc__num" x="60" y="62" textAnchor="middle">{pct == null ? '—' : display ?? Math.round(p)}</text>
      </svg>
      <figcaption style={{ textAlign: 'center', marginTop: -2 }}>
        <div className="micro">{label}</div>
        {sub && <div className="dim num" style={{ fontSize: 11, marginTop: 2 }}>{sub}</div>}
      </figcaption>
    </figure>
  );
}

/** Jauge segmentée horizontale (type vumètre). */
export function SegMeter({ pct, segments = 28, hotAt = 85, label }: { pct: number | null; segments?: number; hotAt?: number; label: string }) {
  const p = pct == null ? 0 : clamp(pct, 0, 100);
  const on = Math.round((p / 100) * segments);
  const w = 4; const gap = 1.5; const total = segments * w + (segments - 1) * gap;
  return (
    <svg className={`meter${pct != null && hot(p, hotAt) ? ' meter--hot' : ''}`} viewBox={`0 0 ${total} 10`} preserveAspectRatio="none" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct == null ? undefined : Math.round(p)}>
      {Array.from({ length: segments }, (_, i) => <rect key={i} className={`meter__seg${i < on ? ' meter__seg--on' : ''}`} x={i * (w + gap)} y="0" width={w} height="10" />)}
    </svg>
  );
}

/** Courbe d'historique d'échantillons réels ; aucune donnée n'est inventée tant qu'il y a moins de deux points. */
export function Sparkline({ values, max = 100, label }: { values: readonly number[]; max?: number; label: string }) {
  const W = 100; const H = 24;
  if (values.length < 2) {
    return <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label} : historique en cours de constitution`}><line className="spark__base" x1="0" y1={H - 1} x2={W} y2={H - 1} /></svg>;
  }
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * W).toFixed(2)},${(H - 1 - (clamp(v, 0, max) / max) * (H - 3)).toFixed(2)}`);
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label} : ${values.length} échantillons, dernier ${Math.round(values[values.length - 1])} %`}>
      <line className="spark__base" x1="0" y1={H - 1} x2={W} y2={H - 1} />
      <polygon className="spark__area" points={`0,${H} ${pts.join(' ')} ${W},${H}`} />
      <polyline className="spark__line" points={pts.join(' ')} />
    </svg>
  );
}
