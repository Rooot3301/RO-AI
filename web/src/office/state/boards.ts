// Mise en forme (pure, testable) des tableaux du bureau : planning du jour et limites d'usage.
// Aucune donnée inventée : une limite dont l'heure de remise à zéro est passée est affichée « remise à zéro », sans
// pourcentage (on ne connaît pas la nouvelle consommation tant qu'aucune exécution ne l'a relevée).
import type { LimitWindow, OfficeBoards, OfficePlanning, PlanningItem, PlanningStatus } from '../../api/types.ts';

export type ProviderKey = 'claude' | 'codex';
export const PROVIDER_FR: Readonly<Record<ProviderKey, string>> = { claude: 'Claude', codex: 'Codex' };
const WINDOW_FR: Readonly<Record<string, string>> = { five_hour: '5 h', seven_day: '7 jours', seven_day_opus: '7 jours · Opus', seven_day_sonnet: '7 jours · Sonnet', inconnue: 'fenêtre inconnue' };

export function windowLabel(w: string): string {
  if (WINDOW_FR[w]) return WINDOW_FR[w];
  const m = /^(\d+)_min$/.exec(w);
  if (m) { const n = Number(m[1]); return n % 1440 === 0 ? `${n / 1440} j` : n % 60 === 0 ? `${n / 60} h` : `${n} min`; }
  return w.replace(/_/g, ' ');
}

export const PLANNING_STATUS_FR: Readonly<Record<PlanningStatus, string>> = {
  upcoming: 'À venir', missed: 'Non lancée', queued: 'En file', awaiting_approval: 'Attend une approbation', running: 'En cours',
  succeeded: 'Terminée', failed: 'Échec', cancelled: 'Annulée',
};
export const isPendingItem = (i: PlanningItem): boolean => i.status === 'upcoming' || i.status === 'queued' || i.status === 'awaiting_approval' || i.status === 'running';

let hmFmt: Intl.DateTimeFormat | null = null;
/** « 14:05 » à l'heure de Paris. */
export function hhmm(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '--:--';
  hmFmt ??= new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false });
  return hmFmt.format(new Date(t));
}

let dayKeyFmt: Intl.DateTimeFormat | null = null, wdFmt: Intl.DateTimeFormat | null = null;
const parisDay = (ms: number) => { dayKeyFmt ??= new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }); return dayKeyFmt.format(new Date(ms)); };
/** Échéance lisible à l'heure de Paris : « 18:46 » aujourd'hui, « demain 11:01 », sinon « jeu. 28/11 11:01 ». */
export function whenLabel(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const d = parisDay(t);
  if (d === parisDay(nowMs)) return hhmm(iso);
  if (d === parisDay(nowMs + 86_400_000)) return `demain ${hhmm(iso)}`;
  wdFmt ??= new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: '2-digit', month: '2-digit' });
  return `${wdFmt.format(new Date(t))} ${hhmm(iso)}`;
}

/** Compte à rebours court : « 45 min », « 2 h 05 », « 3 j ». */
export function countdown(iso: string, nowMs: number): string {
  const ms = Date.parse(iso) - nowMs;
  if (!Number.isFinite(ms)) return '';
  if (ms <= 30_000) return 'maintenant';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 48) return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
  return `${Math.round(h / 24)} j`;
}

export interface PlanningSummary {
  total: number; done: number; failed: number; missed: number;
  /** Prochaines occurrences (à venir ou en cours), dans l'ordre. */
  upcoming: PlanningItem[];
  /** Première occurrence d'un jour suivant, si plus rien n'est prévu aujourd'hui. */
  later: OfficePlanning['next_after'];
  paused: boolean;
}

export function planningSummary(p: OfficePlanning | null | undefined): PlanningSummary | null {
  if (!p) return null;
  const items = p.items ?? [];
  const upcoming = items.filter(isPendingItem);
  return {
    total: items.length, done: items.filter((i) => i.status === 'succeeded').length,
    failed: items.filter((i) => i.status === 'failed').length, missed: items.filter((i) => i.status === 'missed').length,
    upcoming, later: upcoming.length ? null : p.next_after, paused: p.paused,
  };
}

export interface LimitView { provider: ProviderKey; window: string; label: string; level: LimitWindow['level']; pct: number | null; resetsAt: string | null; reset: boolean }

/** Fenêtres affichables : une fenêtre dont la remise à zéro est passée devient « remise à zéro », sans pourcentage. */
export function limitViews(limits: OfficeBoards['limits'] | null | undefined, nowMs: number): Record<ProviderKey, LimitView[]> {
  const out: Record<ProviderKey, LimitView[]> = { claude: [], codex: [] };
  if (!limits) return out;
  for (const p of ['claude', 'codex'] as ProviderKey[]) {
    for (const w of limits[p] ?? []) {
      const r = w.resets_at ? Date.parse(w.resets_at) : NaN;
      const reset = Number.isFinite(r) && r <= nowMs;
      out[p].push({ provider: p, window: w.window, label: windowLabel(w.window), level: reset ? 'ok' : w.level, pct: reset ? null : w.used_percent, resetsAt: reset ? null : w.resets_at, reset });
    }
  }
  return out;
}

const RANK = { ok: 0, warning: 1, limited: 2 } as const;
/** Limite proche (≥ 80 % ou avertissement du client) ou atteinte, la plus grave d'abord ; null si tout va bien. */
export function limitAlert(limits: OfficeBoards['limits'] | null | undefined, nowMs: number): LimitView | null {
  const v = limitViews(limits, nowMs);
  let best: LimitView | null = null;
  for (const l of [...v.claude, ...v.codex]) {
    const level = l.level === 'ok' && l.pct !== null && l.pct >= 80 ? 'warning' : l.level;
    if (level === 'ok') continue;
    const cand = { ...l, level };
    if (!best || RANK[level] > RANK[best.level] || (RANK[level] === RANK[best.level] && (l.pct ?? 0) > (best.pct ?? 0))) best = cand;
  }
  return best;
}
