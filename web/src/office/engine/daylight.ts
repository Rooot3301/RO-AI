// Lumière du jour à l'heure réelle de Paris (Europe/Paris), sans réseau : lever / coucher approchés selon la saison.
// Fonctions pures (testables) ; le rendu ne les appelle qu'une fois par minute.

export interface ParisTime { hour: number; minute: number; weekday: number; month: number; dayOfYear: number; offsetH: number }

let fmt: Intl.DateTimeFormat | null = null;
/** Heure locale de Paris pour un instant donné (repli sur l'heure du navigateur si Intl est incomplet). */
export function parisTime(ms: number): ParisTime {
  const d = new Date(ms);
  try {
    fmt ??= new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' });
    const parts = fmt.formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const hour = Number(get('hour')) % 24, minute = Number(get('minute')), month = Number(get('month')) - 1, day = Number(get('day')), year = Number(get('year'));
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    const local = Date.UTC(year, month, day, hour, minute);
    const offsetH = Math.round((local - Math.floor(ms / 60000) * 60000) / 3600000);
    const dayOfYear = Math.floor((Date.UTC(year, month, day) - Date.UTC(year, 0, 1)) / 86400000);
    if ([hour, minute, month, day, year].every(Number.isFinite) && wd >= 0) return { hour, minute, weekday: wd, month, dayOfYear, offsetH };
  } catch { /* repli ci-dessous */ }
  return { hour: d.getHours(), minute: d.getMinutes(), weekday: d.getDay(), month: d.getMonth(), dayOfYear: Math.floor((ms - Date.UTC(d.getFullYear(), 0, 1)) / 86400000), offsetH: -d.getTimezoneOffset() / 60 };
}

/** Lever et coucher (heures locales décimales) approchés pour Paris (≈ 48,9° N). */
export function sunTimes(dayOfYear: number, offsetH: number): { rise: number; set: number } {
  const len = 12.2 + 4.0 * Math.sin((2 * Math.PI * (dayOfYear - 80)) / 365); // 8 h l'hiver, 16 h l'été
  const noon = 12.6 + (offsetH - 1); // midi solaire ≈ 12 h 36 (heure d'hiver) / 13 h 36 (heure d'été)
  return { rise: noon - len / 2, set: noon + len / 2 };
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Luminosité du jour 0 (nuit) … 1 (plein jour), avec crépuscule d'environ une heure. */
export function daylightAt(t: ParisTime): number {
  const h = t.hour + t.minute / 60, { rise, set } = sunTimes(t.dayOfYear, t.offsetH);
  return Math.min(smooth(rise - 0.6, rise + 0.6, h), 1 - smooth(set - 0.6, set + 0.6, h));
}
