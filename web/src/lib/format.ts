// Formatage d'affichage (français). Fonctions pures, sans dépendance au DOM.

const nfCache = new Map<number, Intl.NumberFormat>();
function nf(digits: number): Intl.NumberFormat {
  let f = nfCache.get(digits);
  if (!f) { f = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }); nfCache.set(digits, f); }
  return f;
}
const pad2 = (n: number) => String(n).padStart(2, '0');

export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return nf(digits).format(n);
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const units = ['o', 'Kio', 'Mio', 'Gio', 'Tio'];
  let v = Math.max(0, n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  const digits = i === 0 ? 0 : v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${nf(digits).format(v)} ${units[i]}`;
}

export function formatPercent(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${nf(digits).format(n)} %`;
}

/** Durée lisible à partir de millisecondes : « 420 ms », « 12,3 s », « 3 min 05 s », « 1 h 02 min ». */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 10) return `${nf(1).format(s)} s`;
  if (s < 60) return `${Math.round(s)} s`;
  const total = Math.round(s);
  if (total < 3600) return `${Math.floor(total / 60)} min ${pad2(total % 60)} s`;
  return `${Math.floor(total / 3600)} h ${pad2(Math.floor((total % 3600) / 60))} min`;
}

/** Durée d'activité d'un système : « 3 j 04 h », « 5 h 12 min », « 12 min ». */
export function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} j ${pad2(h)} h`;
  if (h > 0) return `${h} h ${pad2(m)} min`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}

/** Durée en secondes pour les champs de formulaire : 900 -> « 15 min ». */
export function formatSeconds(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return '—';
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) { const m = Math.floor(s / 60); const r = Math.round(s % 60); return r ? `${m} min ${pad2(r)} s` : `${m} min`; }
  const h = Math.floor(s / 3600); const m = Math.round((s % 3600) / 60);
  return m ? `${h} h ${pad2(m)} min` : `${h} h`;
}

export function formatTokens(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${nf(n < 10_000 ? 1 : 0).format(n / 1000)} k`;
  return `${nf(1).format(n / 1_000_000)} M`;
}

/** Coût estimé par le client (pas une facture). */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return '—';
  return `≈ ${nf(usd < 1 ? 4 : 2).format(usd)} $`;
}

export function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Date et heure locales ou dans un fuseau : « 24/11/2026 09:41 ». */
export function formatDateTime(iso: string | null | undefined, timeZone?: string, withSeconds = false): string {
  const t = parseTime(iso);
  if (t == null) return '—';
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('fr-FR', {
      timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      second: withSeconds ? '2-digit' : undefined, hourCycle: 'h23',
    }).formatToParts(new Date(t));
  } catch { return '—'; }
  const g = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}${withSeconds ? ':' + g('second') : ''}`;
}

export function formatTime(iso: string | null | undefined, withSeconds = true): string {
  const t = parseTime(iso);
  if (t == null) return '—';
  const d = new Date(t);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}${withSeconds ? ':' + pad2(d.getSeconds()) : ''}`;
}

export function formatClock(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** Temps relatif : « à l'instant », « il y a 3 min », « dans 2 h ». */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  const t = parseTime(iso);
  if (t == null) return '—';
  const diff = Math.round((now - t) / 1000);
  const abs = Math.abs(diff);
  let txt: string;
  if (abs < 5) return diff < 0 ? 'dans un instant' : "à l'instant";
  if (abs < 60) txt = `${abs} s`;
  else if (abs < 3600) txt = `${Math.floor(abs / 60)} min`;
  else if (abs < 86400) txt = `${Math.floor(abs / 3600)} h`;
  else if (abs < 86400 * 14) txt = `${Math.floor(abs / 86400)} j`;
  else return formatDateTime(iso);
  return diff < 0 ? `dans ${txt}` : `il y a ${txt}`;
}

/** Compte à rebours court : « 12 min », « 2 h 05 », « 3 j ». */
export function formatCountdown(iso: string | null | undefined, now: number = Date.now()): string {
  const t = parseTime(iso);
  if (t == null) return '—';
  const s = Math.round((t - now) / 1000);
  if (s <= 0) return 'maintenant';
  if (s < 90) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${pad2(Math.floor((s % 3600) / 60))}`;
  return `${Math.floor(s / 86400)} j`;
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
