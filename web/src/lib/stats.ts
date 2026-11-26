// Préparation des données de consommation : formatage, séries complètes (zéros inclus), échelles.
import type { ErrorClass, StatsDay } from '../api/types';
import { ERROR_CLASS_LABEL } from './labels.ts';

export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];
export const DEFAULT_PERIOD: Period = 30;
const KEY = 'roai.stats.period';

interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }
export function parsePeriod(raw: string | null | undefined): Period {
  const n = Number(raw);
  return (PERIODS as readonly number[]).includes(n) ? (n as Period) : DEFAULT_PERIOD;
}
/** Lecture / écriture tolérantes : le stockage peut être absent ou lever une exception. */
export function loadPeriod(storage?: StorageLike): Period {
  try { return parsePeriod((storage ?? localStorage).getItem(KEY)); } catch { return DEFAULT_PERIOD; }
}
export function savePeriod(p: Period, storage?: StorageLike): void {
  try { (storage ?? localStorage).setItem(KEY, String(p)); } catch { /* ignoré */ }
}

export function formatRate(r: number | null | undefined): string {
  if (r == null || !Number.isFinite(r)) return '—';
  const pct = Math.round(r * 1000) / 10;
  return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: pct % 1 ? 1 : 0, maximumFractionDigits: 1 }).format(pct)} %`;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toUtc = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd); };
const fromUtc = (t: number) => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const DAY = 86400000;

export const zeroDay = (date: string): StatsDay => ({ date, runs: 0, succeeded: 0, failed: 0, cancelled: 0, input_tokens: 0, output_tokens: 0, cost_usd_estimate: 0 });

/** Série continue de `days` jours se terminant au dernier jour connu : les jours manquants sont complétés par des zéros. */
export function completeDays(byDay: readonly StatsDay[], days: number): StatsDay[] {
  if (byDay.length === 0) return [];
  const map = new Map(byDay.map((d) => [d.date, d]));
  const last = byDay.reduce((m, d) => (d.date > m ? d.date : m), byDay[0].date);
  const first = byDay.reduce((m, d) => (d.date < m ? d.date : m), byDay[0].date);
  const endT = toUtc(last);
  const spanDays = Math.round((endT - toUtc(first)) / DAY) + 1;
  const n = Math.max(days, spanDays);
  const out: StatsDay[] = [];
  for (let i = n - 1; i >= 0; i--) { const d = fromUtc(endT - i * DAY); out.push(map.get(d) ?? zeroDay(d)); }
  return out;
}

/** Échelle « lisible » : maximum arrondi à 1, 2, 2,5, 5 × 10^k et graduations régulières. */
export function niceScale(max: number, ticks = 4): { max: number; ticks: number[] } {
  if (!Number.isFinite(max) || max <= 0) return { max: ticks, ticks: Array.from({ length: ticks + 1 }, (_, i) => i) };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const top = step * Math.ceil(max / step - 1e-9);
  const n = Math.round(top / step);
  return { max: top, ticks: Array.from({ length: n + 1 }, (_, i) => +(i * step).toFixed(6)) };
}

export function formatDayShort(date: string): string { return `${date.slice(8, 10)}/${date.slice(5, 7)}`; }
const DOW = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export function formatDayLong(date: string): string {
  const dow = new Date(toUtc(date)).getUTCDay();
  const d = Number(date.slice(8, 10));
  return `${DOW[dow]} ${d === 1 ? '1er' : d} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
}

/** Indices des étiquettes d'axe à afficher pour ne pas se chevaucher (`maxLabels` au plus, dernier jour toujours inclus). */
export function labelIndices(n: number, maxLabels: number): number[] {
  if (n <= 0) return [];
  const step = Math.max(1, Math.ceil(n / Math.max(1, maxLabels)));
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i -= step) out.push(i);
  return out.reverse();
}

export interface ErrorRow { error_class: ErrorClass; label: string; count: number; share: number }
export function errorRows(errors: readonly { error_class: ErrorClass; count: number }[]): ErrorRow[] {
  const total = errors.reduce((s, e) => s + e.count, 0);
  return [...errors].sort((a, b) => b.count - a.count)
    .map((e) => ({ ...e, label: ERROR_CLASS_LABEL[e.error_class] ?? e.error_class, share: total ? e.count / total : 0 }));
}

/** Intensité 0..1 par heure (pour la carte de chaleur) ; toujours 24 cases. */
export function hourSeries(byHour: readonly number[]): { hour: number; count: number; level: number }[] {
  const arr = Array.from({ length: 24 }, (_, h) => Math.max(0, Number(byHour?.[h]) || 0));
  const max = Math.max(0, ...arr);
  return arr.map((count, hour) => ({ hour, count, level: max ? count / max : 0 }));
}

/** Coût affichable : Codex ne fournit pas d'estimation (0 → « n/d »). */
export function costOrNd(provider: string, usd: number): number | null {
  return provider === 'codex' && usd === 0 ? null : usd;
}

export const totalTokens = (i: number, o: number) => i + o;
