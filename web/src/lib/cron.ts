// Analyse, description et prévisualisation d'expressions cron à 5 champs (m h dom mon dow).
// Sémantique standard (Vixie) : si jour-du-mois et jour-de-semaine sont tous deux restreints, l'un OU l'autre suffit.

export interface CronField {
  raw: string;
  values: number[];       // valeurs autorisées, triées, sans doublon
  star: boolean;          // le champ commence par « * »
  step: number | null;    // « */n » exactement
}
export interface ParsedCron { minute: CronField; hour: CronField; dom: CronField; month: CronField; dow: CronField }
export type CronResult = { ok: true; cron: ParsedCron } | { ok: false; errors: string[] };

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DOW_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

interface Spec { label: string; min: number; max: number; names?: string[]; nameBase?: number }
const SPECS: Spec[] = [
  { label: 'minute', min: 0, max: 59 },
  { label: 'heure', min: 0, max: 23 },
  { label: 'jour du mois', min: 1, max: 31 },
  { label: 'mois', min: 1, max: 12, names: MONTH_NAMES, nameBase: 1 },
  { label: 'jour de la semaine', min: 0, max: 7, names: DOW_NAMES, nameBase: 0 },
];

function parseValue(tok: string, spec: Spec): number | string {
  if (/^\d+$/.test(tok)) {
    const n = Number(tok);
    if (n < spec.min || n > spec.max) return `valeur ${n} hors limites (${spec.min}–${spec.max})`;
    return n;
  }
  if (spec.names) {
    const i = spec.names.indexOf(tok.toLowerCase());
    if (i >= 0) return i + (spec.nameBase ?? 0);
  }
  return `valeur « ${tok} » invalide`;
}

function parseField(raw: string, spec: Spec): CronField | string {
  const set = new Set<number>();
  let step: number | null = null;
  for (const part of raw.split(',')) {
    if (part === '') return 'élément vide dans la liste';
    const [rangePart, stepPart, extra] = part.split('/');
    if (extra !== undefined) return `pas invalide « ${part} »`;
    let stepN = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart) || Number(stepPart) < 1) return `pas « ${stepPart} » invalide (entier ≥ 1)`;
      stepN = Number(stepPart);
    }
    let lo: number; let hi: number;
    if (rangePart === '*') { lo = spec.min; hi = spec.max; if (spec.label === 'jour de la semaine') hi = 6; if (raw === `*/${stepPart}`) step = stepN; }
    else if (rangePart.includes('-')) {
      const [a, b, more] = rangePart.split('-');
      if (more !== undefined || a === '' || b === undefined || b === '') return `intervalle « ${rangePart} » invalide`;
      const va = parseValue(a, spec); const vb = parseValue(b, spec);
      if (typeof va === 'string') return va;
      if (typeof vb === 'string') return vb;
      if (va > vb) return `intervalle « ${rangePart} » inversé`;
      lo = va; hi = vb;
    } else {
      const v = parseValue(rangePart, spec);
      if (typeof v === 'string') return v;
      lo = v; hi = stepPart !== undefined ? spec.max : v;
    }
    for (let n = lo; n <= hi; n += stepN) set.add(spec.label === 'jour de la semaine' && n === 7 ? 0 : n);
  }
  const values = [...set].sort((x, y) => x - y);
  if (values.length === 0) return 'aucune valeur';
  return { raw, values, star: raw.startsWith('*'), step };
}

export function parseCron(expr: string): CronResult {
  const parts = expr.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 5) {
    return { ok: false, errors: [`5 champs attendus (minute heure jour-du-mois mois jour-de-semaine), ${parts.length} reçu${parts.length > 1 ? 's' : ''}.`] };
  }
  const errors: string[] = [];
  const fields: CronField[] = [];
  parts.forEach((p, i) => {
    const r = parseField(p, SPECS[i]);
    if (typeof r === 'string') errors.push(`Champ « ${SPECS[i].label} » : ${r}.`);
    else fields.push(r);
  });
  if (errors.length) return { ok: false, errors };
  const [minute, hour, dom, month, dow] = fields;
  return { ok: true, cron: { minute, hour, dom, month, dow } };
}

// ---------------------------------------------------------------------------------------------
// Fuseaux horaires

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function wallFormatter(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    dtfCache.set(tz, f);
  }
  return f;
}
export function isValidTimezone(tz: string): boolean {
  try { wallFormatter(tz); return true; } catch { return false; }
}
interface Wall { y: number; mo: number; d: number; h: number; mi: number }
function wallParts(ms: number, tz: string): Wall & { s: number } {
  const p = wallFormatter(tz).formatToParts(new Date(ms));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour') % 24, mi: g('minute'), s: g('second') };
}
function tzOffset(ms: number, tz: string): number {
  const w = wallParts(ms, tz);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000;
}
/** Instant correspondant à une heure murale dans un fuseau, ou null si elle n'existe pas (saut d'heure d'été). */
export function wallToInstant(tz: string, w: Wall): number | null {
  const guess = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
  let off = tzOffset(guess, tz);
  let inst = guess - off;
  const off2 = tzOffset(inst, tz);
  if (off2 !== off) { off = off2; inst = guess - off; }
  const back = wallParts(inst, tz);
  if (back.y !== w.y || back.mo !== w.mo || back.d !== w.d || back.h !== w.h || back.mi !== w.mi) return null;
  return inst;
}

function dayMatches(c: ParsedCron, y: number, mo: number, d: number): boolean {
  if (!c.month.values.includes(mo)) return false;
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  const domOk = c.dom.values.includes(d);
  const dowOk = c.dow.values.includes(dow);
  return c.dom.star || c.dow.star ? domOk && dowOk : domOk || dowOk;
}

/** Prochaines occurrences (instants UTC en ms) après `fromMs`, calculées dans le fuseau `tz`. */
export function nextRuns(c: ParsedCron, fromMs: number, tz = 'UTC', count = 3): number[] {
  if (!isValidTimezone(tz)) return [];
  const out: number[] = [];
  const start = wallParts(fromMs, tz);
  const day0 = Date.UTC(start.y, start.mo - 1, start.d);
  for (let i = 0; i < 366 * 8 && out.length < count; i++) {
    const dt = new Date(day0 + i * 86400000);
    const y = dt.getUTCFullYear(); const mo = dt.getUTCMonth() + 1; const d = dt.getUTCDate();
    if (!dayMatches(c, y, mo, d)) continue;
    for (const h of c.hour.values) for (const mi of c.minute.values) {
      const inst = wallToInstant(tz, { y, mo, d, h, mi });
      if (inst != null && inst > fromMs) { out.push(inst); if (out.length >= count) return out; }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Description en français

const DOW_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTH_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const pad2 = (n: number) => String(n).padStart(2, '0');
const isContiguous = (v: number[]) => v.length > 1 && v.every((x, i) => i === 0 || x === v[i - 1] + 1);
const joinFr = (items: string[]) => items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ord = (n: number) => (n === 1 ? '1er' : String(n));

function dayPhrase(c: ParsedCron): string | null {
  const domR = !c.dom.star; const dowR = !c.dow.star;
  const dowText = () => {
    const v = c.dow.values;
    if (v.length === 5 && v.join() === '1,2,3,4,5') return 'du lundi au vendredi';
    if (v.length === 2 && v.join() === '0,6') return 'le week-end';
    if (isContiguous(v) && v[0] !== 0) return `du ${DOW_FR[v[0]]} au ${DOW_FR[v[v.length - 1]]}`;
    return `le ${joinFr(v.map((x) => DOW_FR[x]))}`;
  };
  const domText = () => {
    const v = c.dom.values;
    if (v.length === 1) return `le ${ord(v[0])} du mois`;
    return `les ${joinFr(v.map(ord))} du mois`;
  };
  if (domR && dowR) return `${domText()} ou ${dowText()}`;
  if (dowR) return dowText();
  if (domR) return domText();
  return null;
}
function monthPhrase(c: ParsedCron): string | null {
  const v = c.month.values;
  if (v.length === 12) return null;
  if (isContiguous(v)) return `de ${MONTH_FR[v[0] - 1]} à ${MONTH_FR[v[v.length - 1] - 1]}`;
  return `en ${joinFr(v.map((x) => MONTH_FR[x - 1]))}`;
}

export function describeCron(c: ParsedCron): string {
  const day = dayPhrase(c); const month = monthPhrase(c);
  const m = c.minute; const h = c.hour;
  const mStar = m.raw === '*'; const hStar = h.raw === '*';
  let freq: string | null = null;      // phrase de fréquence (sans heure précise)
  let clock: string | null = null;     // heures précises
  if (mStar && hStar) freq = 'Chaque minute';
  else if (m.step && hStar) freq = `Toutes les ${m.step} minutes`;
  else if (m.step || mStar) {
    const hv = h.values;
    const range = isContiguous(hv) ? `de ${hv[0]} h à ${hv[hv.length - 1]} h` : `aux heures ${hv.join(', ')}`;
    freq = `${mStar ? 'Chaque minute' : `Toutes les ${m.step} minutes`}, ${range}`;
  } else if (m.values.length === 1 && hStar) freq = m.values[0] === 0 ? 'Chaque heure pile' : `Chaque heure, à la minute ${m.values[0]}`;
  else if (m.values.length === 1 && h.step) freq = `Toutes les ${h.step} heures, à la minute ${m.values[0]}`;
  else if (m.values.length * h.values.length <= 4) {
    const times: string[] = [];
    for (const hh of h.values) for (const mm of m.values) times.push(`${pad2(hh)}:${pad2(mm)}`);
    clock = `à ${joinFr(times)}`;
  } else freq = `Aux minutes ${m.values.join(', ')} des heures ${h.values.join(', ')}`;

  if (clock) return `${cap(`${day ?? 'tous les jours'}${month ? ` ${month}` : ''} ${clock}`)}`;
  return `${freq}${day ? `, ${day}` : ''}${month ? `, ${month}` : ''}`;
}

export const CRON_PRESETS: { label: string; cron: string }[] = [
  { label: 'Toutes les 15 minutes', cron: '*/15 * * * *' },
  { label: 'Chaque heure', cron: '0 * * * *' },
  { label: 'Chaque jour à 08:00', cron: '0 8 * * *' },
  { label: 'Jours ouvrés à 09:00', cron: '0 9 * * 1-5' },
  { label: 'Chaque lundi à 08:00', cron: '0 8 * * 1' },
  { label: 'Le 1er du mois à 07:00', cron: '0 7 1 * *' },
];
