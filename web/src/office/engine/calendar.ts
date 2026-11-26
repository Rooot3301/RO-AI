// Calendrier du bureau (heure de Paris) : saison, jours fériés français, décorations de saison. Fonctions pures.
// Purement décoratif : ne change rien au travail réel des agents (seule la vie sociale simulée devient plus calme).

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export interface OfficeCalendar {
  season: Season;
  /** Décoration du jour : Noël (1er décembre → 6 janvier), fête nationale (13-15 juillet). */
  festive: 'xmas' | 'national' | null;
  /** Week-end ou jour férié : bureau plus calme. */
  calm: boolean;
  /** Nom du jour férié, sinon null. */
  holiday: string | null;
}

/** Date civile à Paris. */
export function parisDate(ms: number): { y: number; m: number; d: number; wd: number } {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' });
  const p = f.formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday'));
  return { y: Number(g('year')), m: Number(g('month')), d: Number(g('day')), wd };
}

/** Dimanche de Pâques (algorithme de Meeus / Jones / Butcher, calendrier grégorien). */
export function easter(y: number): { m: number; d: number } {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return { m: month, d: day };
}

const plusDays = (y: number, m: number, d: number, n: number) => { const t = new Date(Date.UTC(y, m - 1, d + n)); return { m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };

/** Jours fériés légaux en France métropolitaine (hors Alsace-Moselle). */
export function frenchHoliday(y: number, m: number, d: number): string | null {
  const fixed: Record<string, string> = {
    '1-1': 'Jour de l’an', '5-1': 'Fête du Travail', '5-8': 'Victoire 1945', '7-14': 'Fête nationale', '8-15': 'Assomption',
    '11-1': 'Toussaint', '11-11': 'Armistice 1918', '12-25': 'Noël',
  };
  if (fixed[`${m}-${d}`]) return fixed[`${m}-${d}`];
  const e = easter(y);
  const mov: [number, string][] = [[1, 'Lundi de Pâques'], [39, 'Ascension'], [50, 'Lundi de Pentecôte']];
  for (const [n, name] of mov) { const x = plusDays(y, e.m, e.d, n); if (x.m === m && x.d === d) return name; }
  return null;
}

/** Saison astronomique approchée (équinoxes et solstices aux dates usuelles). */
export function seasonOf(m: number, d: number): Season {
  const md = m * 100 + d;
  if (md >= 320 && md < 621) return 'spring';
  if (md >= 621 && md < 922) return 'summer';
  if (md >= 922 && md < 1221) return 'autumn';
  return 'winter';
}

export function officeCalendar(ms: number): OfficeCalendar {
  const { y, m, d, wd } = parisDate(ms);
  const holiday = frenchHoliday(y, m, d);
  const xmas = m === 12 || (m === 1 && d <= 6);
  const national = m === 7 && d >= 13 && d <= 15;
  return { season: seasonOf(m, d), festive: xmas ? 'xmas' : national ? 'national' : null, calm: wd === 0 || wd === 6 || !!holiday, holiday };
}

export const SEASON_FR: Readonly<Record<Season, string>> = { spring: 'printemps', summer: 'été', autumn: 'automne', winter: 'hiver' };
