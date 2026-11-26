import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { clamp } from '../../lib/format';
import { labelIndices, niceScale } from '../../lib/stats';

export interface BarItem { key: string; label: string; long: string; values: number[] }
export interface BarSeries { name: string; color: string }

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver((entries) => { const cw = entries[0]?.contentRect.width; if (cw && cw > 0) setW(Math.floor(cw)); });
    ro.observe(el); setW(Math.max(200, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const M = { l: 46, r: 8, t: 10, b: 24 };

/** Barres empilées dessinées à la main (SVG). Survol et clavier (flèches, Début, Fin, Échap) ; lecture vocale de la barre active. */
export function StackedBars({ items, series, format, axisFormat, ariaLabel, height = 210, maxLabels }: {
  items: BarItem[]; series: BarSeries[]; format: (n: number) => string; axisFormat?: (n: number) => string; ariaLabel: string; height?: number; maxLabels?: number;
}) {
  const [wrap, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const n = items.length;
  const totals = items.map((it) => it.values.reduce((s, v) => s + v, 0));
  const scale = niceScale(Math.max(0, ...totals));
  const iw = Math.max(10, width - M.l - M.r); const ih = height - M.t - M.b;
  const slot = iw / Math.max(1, n); const bw = clamp(slot * 0.72, 2, 30);
  const y = (v: number) => M.t + ih - (v / scale.max) * ih;
  const labels = new Set(labelIndices(n, maxLabels ?? Math.max(2, Math.floor(iw / 54))));
  const ax = axisFormat ?? format;

  const idxAt = (clientX: number, el: Element) => clamp(Math.floor((clientX - el.getBoundingClientRect().left - M.l) / slot), 0, n - 1);
  const onMove = (e: PointerEvent<SVGSVGElement>) => { if (n) setActive(idxAt(e.clientX, e.currentTarget)); };
  const onKey = (e: KeyboardEvent) => {
    if (!n) return;
    const cur = active ?? n;
    const next = e.key === 'ArrowLeft' ? Math.max(0, cur - 1) : e.key === 'ArrowRight' ? Math.min(n - 1, active == null ? 0 : cur + 1)
      : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : e.key === 'Escape' ? null : undefined;
    if (next === undefined) return;
    e.preventDefault(); setActive(next);
  };
  const a = active != null ? items[active] : null;
  const ax0 = active != null ? M.l + slot * active + slot / 2 : 0;
  const speech = a ? `${a.long} : ${series.map((s, i) => `${format(a.values[i] ?? 0)} ${s.name.toLowerCase()}`).join(', ')}.` : '';

  return (
    <div className="sbars" ref={wrap}>
      <div className="sbars__legend" aria-hidden="true">
        {series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}
      </div>
      <div className="sbars__plot" tabIndex={0} role="group" aria-label={`${ariaLabel}. Flèches gauche et droite pour lire chaque barre.`}
        onKeyDown={onKey} onFocus={() => setActive((c) => c ?? (n ? n - 1 : null))} onBlur={() => setActive(null)} onPointerLeave={() => setActive(null)}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} onPointerMove={onMove} aria-hidden="true" focusable="false">
          {scale.ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={width - M.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'sbars__axis' : 'sbars__grid'} />
              <text x={M.l - 8} y={y(t) + 4} textAnchor="end" className="sbars__tick">{ax(t)}</text>
            </g>
          ))}
          {active != null && <rect x={M.l + slot * active} y={M.t} width={slot} height={ih} className="sbars__hl" />}
          {items.map((it, i) => {
            let acc = 0; const x = M.l + slot * i + (slot - bw) / 2;
            return (
              <g key={it.key}>
                {it.values.map((v, si) => {
                  if (v <= 0) return null;
                  const y0 = y(acc + v); const h = y(acc) - y0; acc += v;
                  return <rect key={si} x={x} y={y0} width={bw} height={Math.max(1, h)} fill={series[si].color} opacity={active == null || active === i ? 1 : 0.55} />;
                })}
                {labels.has(i) && <text x={x + bw / 2} y={height - 7} textAnchor="middle" className="sbars__tick">{it.label}</text>}
              </g>
            );
          })}
        </svg>
        {a && (
          <div className="sbars__tip" style={{ left: clamp(ax0, 90, Math.max(90, width - 90)) }} aria-hidden="true">
            <div className="sbars__tipt">{a.long}</div>
            {series.map((s, i) => <div key={s.name} className="sbars__tiprow"><i style={{ background: s.color }} /><span>{s.name}</span><b className="num">{format(a.values[i] ?? 0)}</b></div>)}
          </div>
        )}
      </div>
      <div className="sr-only" aria-live="polite">{speech}</div>
    </div>
  );
}

/** Alternative tabulaire repliable d'un graphique. */
export function ChartTable({ items, series, format, caption, labelHeader }: { items: BarItem[]; series: BarSeries[]; format: (n: number) => string; caption: string; labelHeader: string }) {
  return (
    <details className="chartalt">
      <summary>Afficher les données en tableau</summary>
      <div className="tbl-scroll chartalt__scroll">
        <table className="tbl">
          <caption className="sr-only">{caption}</caption>
          <thead><tr><th scope="col">{labelHeader}</th>{series.map((s) => <th key={s.name} scope="col" className="col-num">{s.name}</th>)}{series.length > 1 && <th scope="col" className="col-num">Total</th>}</tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.key}><th scope="row">{it.long}</th>{it.values.map((v, i) => <td key={i} className="col-num">{format(v)}</td>)}{series.length > 1 && <td className="col-num">{format(it.values.reduce((s, v) => s + v, 0))}</td>}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
