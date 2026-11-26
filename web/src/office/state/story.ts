// « Histoire » des agents : tout vient des données réelles de l'API (exécutions, statistiques, planifications).
// Règle : pas de donnée, pas d'histoire. Les textes d'agents sont NON FIABLES : texte brut tronqué, jamais interprété.
import type { Run, Schedule, StatsAgent } from '../../api/types.ts';

export const MILESTONES = [1, 10, 50, 100, 250, 500, 1000] as const;
export type Mood = 'serene' | 'neutral' | 'worried';

/** Jalons atteints selon le nombre d'exécutions réussies. */
export const milestonesReached = (succeeded: number): number[] => MILESTONES.filter((m) => succeeded >= m);
/** Paliers de la plante du bureau : 0 aucune, 1 pousse, 2 petite, 3 moyenne, 4 grande et fleurie. */
export function plantStage(succeeded: number): 0 | 1 | 2 | 3 | 4 {
  return succeeded >= 100 ? 4 : succeeded >= 50 ? 3 : succeeded >= 10 ? 2 : succeeded >= 1 ? 1 : 0;
}

type Finished = Pick<Run, 'status' | 'finished_at' | 'created_at'>;
const isFinished = (r: Pick<Run, 'status'>) => r.status === 'succeeded' || r.status === 'failed';

/** Humeur discrète d'après les dernières exécutions terminées (les plus récentes d'abord) : annulées et en cours ignorées. */
export function moodOf(recentFirst: readonly Pick<Run, 'status'>[]): Mood {
  const done = recentFirst.filter(isFinished).slice(0, 5);
  if (!done.length) return 'neutral';
  if (done.slice(0, 2).some((r) => r.status === 'failed')) return 'worried';
  let streak = 0;
  for (const r of done) { if (r.status === 'succeeded') streak++; else break; }
  return streak >= 3 ? 'serene' : 'neutral';
}

/** Plus longue série de réussites consécutives (annulées ignorées) ; `current` = série en cours. */
export function streaks(chronological: readonly Pick<Run, 'status'>[]): { longest: number; current: number } {
  let longest = 0, cur = 0;
  for (const r of chronological) {
    if (r.status === 'succeeded') { cur++; if (cur > longest) longest = cur; }
    else if (r.status === 'failed') cur = 0;
  }
  return { longest, current: cur };
}

export const DAY_MS = 86_400_000;
/** Nombre de réussites terminées dans les 7 derniers jours. */
export function reportsLast7d(runs: readonly Finished[], nowMs: number): number {
  let n = 0;
  for (const r of runs) {
    if (r.status !== 'succeeded') continue;
    const t = Date.parse(r.finished_at ?? r.created_at);
    if (Number.isFinite(t) && nowMs - t <= 7 * DAY_MS && t <= nowMs + 60_000) n++;
  }
  return n;
}

/** Prochaine exécution planifiée d'un agent (planifications actives seulement). */
export function nextSchedule(agentId: string, schedules: readonly Schedule[]): { at: string; name: string } | null {
  let best: Schedule | null = null;
  for (const s of schedules) {
    if (s.agent_id !== agentId || !s.enabled || !s.next_run_at) continue;
    if (!best || Date.parse(s.next_run_at) < Date.parse(best.next_run_at!)) best = s;
  }
  return best ? { at: best.next_run_at!, name: best.name } : null;
}

/** Première ligne utile d'un rapport (texte non fiable : brut, sans balisage Markdown, tronqué). */
export function reportTitle(text: string | null, max = 44): string | null {
  if (!text) return null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^[\s#>*\-•\d.)]+/, '').replace(/[*_`~]+/g, '').replace(/\s+/g, ' ').trim();
    if (line) return line.length > max ? `${line.slice(0, max - 1)}…` : line;
  }
  return null;
}

export interface Report { runId: string; agentId: string; agentName: string; at: string; title: string }
/** Dernier rapport réussi (avec texte) parmi des exécutions ; `runs` du plus récent au plus ancien. */
export function latestReport(runs: readonly Run[], agentIds?: ReadonlySet<string>): Report | null {
  let best: Report | null = null, bestT = -1;
  for (const r of runs) {
    if (r.status !== 'succeeded' || (agentIds && !agentIds.has(r.agent_id))) continue;
    const title = reportTitle(r.result_text);
    if (!title) continue;
    const at = r.finished_at ?? r.created_at, t = Date.parse(at);
    if (t > bestT) { bestT = t; best = { runId: r.id, agentId: r.agent_id, agentName: r.agent_name, at, title }; }
  }
  return best;
}

/** Objets de bureau stables tirés de l'identifiant : purement décoratifs. */
export interface DeskKit { mug: number; chair: number; plant: number; frame: number; gesture: number; offset: number }
export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function deskKit(id: string): DeskKit {
  const h = hashId(id);
  return { mug: h % 6, chair: (h >>> 3) % 6, plant: (h >>> 6) % 4, frame: (h >>> 9) % 4, gesture: (h >>> 12) % 3, offset: ((h >>> 15) % 1000) / 1000 };
}

export interface AgentStory {
  provider: string | null;
  total: number; succeeded: number; failed: number; rate: number | null;
  mood: Mood; plant: 0 | 1 | 2 | 3 | 4; milestones: number[]; reports7d: number;
  next: { at: string; name: string } | null;
}
export interface StoryData { agents: Record<string, AgentStory>; boards: Record<string, Report | null> }
export const EMPTY_STORY: StoryData = { agents: {}, boards: {} };

/** Assemble l'histoire de tous les agents à partir des sources de l'API. `recentRuns` : plus récentes d'abord. */
export function buildStory(
  agents: readonly { id: string; department: string }[], stats: readonly StatsAgent[] | null, recentRuns: readonly Run[],
  schedules: readonly Schedule[], nowMs: number,
): StoryData {
  const byStat = new Map((stats ?? []).map((s) => [s.agent_id, s]));
  const out: Record<string, AgentStory> = {};
  for (const a of agents) {
    const st = byStat.get(a.id);
    const mine = recentRuns.filter((r) => r.agent_id === a.id);
    // si les statistiques manquent, on se rabat sur les exécutions récentes (plancher réel)
    const succeeded = st ? st.succeeded : mine.filter((r) => r.status === 'succeeded').length;
    const failed = st ? st.failed : mine.filter((r) => r.status === 'failed').length;
    out[a.id] = {
      provider: st?.provider ?? mine[0]?.provider ?? null,
      total: st ? st.runs : mine.length, succeeded, failed,
      rate: st ? st.success_rate : succeeded + failed ? succeeded / (succeeded + failed) : null,
      mood: moodOf(mine), plant: plantStage(succeeded), milestones: milestonesReached(succeeded),
      reports7d: reportsLast7d(mine, nowMs), next: nextSchedule(a.id, schedules),
    };
  }
  const boards: Record<string, Report | null> = {};
  const depts = new Set(agents.map((a) => a.department));
  for (const d of depts) boards[d] = latestReport(recentRuns, new Set(agents.filter((a) => a.department === d).map((a) => a.id)));
  return { agents: out, boards };
}

export interface AgentHistory {
  createdAt: string | null; firstRunAt: string | null; total: number; rate: number | null;
  longestStreak: number; currentStreak: number; milestones: number[]; lastReport: Report | null; next: { at: string; name: string } | null;
}
/** Section « Histoire » de l'inspecteur. `runsRecentFirst` : toutes les exécutions connues de l'agent (jusqu'à plusieurs pages). */
export function agentHistory(
  agent: { id: string; created_at: string | null }, runsRecentFirst: readonly Run[], stat: StatsAgent | null, schedules: readonly Schedule[],
): AgentHistory {
  const chrono = runsRecentFirst.slice().reverse();
  const s = streaks(chrono);
  const succeeded = stat ? stat.succeeded : runsRecentFirst.filter((r) => r.status === 'succeeded').length;
  return {
    createdAt: agent.created_at,
    firstRunAt: chrono.length ? (chrono[0].started_at ?? chrono[0].created_at) : null,
    total: stat ? stat.runs : runsRecentFirst.length,
    rate: stat ? stat.success_rate : null,
    longestStreak: s.longest, currentStreak: s.current,
    milestones: milestonesReached(succeeded), lastReport: latestReport(runsRecentFirst), next: nextSchedule(agent.id, schedules),
  };
}
