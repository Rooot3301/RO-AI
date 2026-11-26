// Logique pure autour des événements du journal : description, niveaux, filtres, tampon circulaire.
import type { RoEvent } from '../api/types';
import { formatCost, formatDuration, formatNumber, truncate } from './format.ts';
import { ERROR_CLASS_LABEL, rateStatusLabel } from './labels.ts';

export type Level = 'info' | 'warn' | 'error';
export type Tone = 'neutral' | 'ok' | 'warn' | 'err' | 'amber' | 'info';

export interface EventView { level: Level; tone: Tone; title: string; detail: string }

const str = (p: Record<string, unknown>, k: string): string => {
  const v = p?.[k];
  return typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
};
const num = (p: Record<string, unknown>, k: string): number | null => {
  const v = p?.[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

export function eventCategory(type: string): string {
  const i = type.indexOf('.');
  return i < 0 ? type : type.slice(0, i);
}

export function describeEvent(e: RoEvent): EventView {
  const p = e.payload ?? {};
  const name = str(p, 'name');
  switch (e.type) {
    case 'agent.created': return v('info', 'neutral', 'Agent créé', name);
    case 'agent.updated': return v('info', 'neutral', 'Agent modifié', name);
    case 'agent.deleted': return v('info', 'neutral', 'Agent supprimé', name);
    case 'agent.enabled': return v('info', 'ok', 'Agent activé', name);
    case 'agent.disabled': return v('info', 'neutral', 'Agent désactivé', name);
    case 'agent.profile': { const x = profileEventLabel(p); return v(x.level, x.tone, x.title, x.detail); }
    case 'office.layout': return v('info', 'neutral', officeLayoutLabel(p), '');
    case 'run.queued': return v('info', 'neutral', 'Exécution en file', [str(p, 'trigger'), str(p, 'prompt_preview')].filter(Boolean).join(' · '));
    case 'run.awaiting_approval': return v('info', 'amber', 'Approbation requise', str(p, 'prompt_preview'));
    case 'run.approved': return v('info', 'ok', 'Exécution approuvée', '');
    case 'run.rejected': return v('info', 'warn', 'Exécution rejetée', '');
    case 'run.started': return v('info', 'amber', 'Exécution démarrée', [str(p, 'provider'), str(p, 'model')].filter(Boolean).join(' · '));
    case 'run.model': return v('info', 'neutral', 'Modèle utilisé', str(p, 'model'));
    case 'run.session': return v('info', 'neutral', 'Session ouverte', str(p, 'session_id'));
    case 'run.message': return v('info', 'neutral', 'Message', str(p, 'text'));
    case 'tool.call': return v('info', 'info', `Outil · ${str(p, 'tool') || '?'}`, str(p, 'summary'));
    case 'tool.result': return p.ok === false
      ? v('warn', 'warn', 'Résultat d’outil : échec', str(p, 'summary'))
      : v('info', 'neutral', 'Résultat d’outil', str(p, 'summary'));
    case 'tool.denied': return v('warn', 'warn', `Outil refusé · ${str(p, 'tool') || '?'}`, str(p, 'reason'));
    case 'run.rate_limit': {
      const st = str(p, 'status');
      const bits = [str(p, 'window'), str(p, 'resets_at') && `reprise ${str(p, 'resets_at')}`].filter(Boolean).join(' · ');
      return st === 'ok' || st === 'allowed' ? v('info', 'neutral', 'Limite : aucune', bits) : v('warn', 'warn', `Limite : ${rateStatusLabel(st).toLowerCase()}`, bits);
    }
    case 'run.api_retry': return v('warn', 'warn', `Nouvelle tentative ${str(p, 'attempt')}/${str(p, 'max_retries')}`, str(p, 'error'));
    case 'run.succeeded': {
      const bits = [formatDuration(num(p, 'duration_ms')), num(p, 'num_turns') != null ? `${num(p, 'num_turns')} tours` : '', num(p, 'cost_usd_estimate') != null ? formatCost(num(p, 'cost_usd_estimate')) : ''].filter((x) => x && x !== '—');
      return v('info', 'ok', 'Exécution réussie', [bits.join(' · '), str(p, 'result_preview')].filter(Boolean).join(' — '));
    }
    case 'run.failed': {
      const cls = str(p, 'error_class') as keyof typeof ERROR_CLASS_LABEL;
      return v('error', 'err', `Exécution en échec${cls ? ` · ${ERROR_CLASS_LABEL[cls] ?? cls}` : ''}`, str(p, 'error_message'));
    }
    case 'run.cancelled': return v('info', 'warn', 'Exécution annulée', '');
    case 'schedule.created': return v('info', 'neutral', 'Planification créée', [name, str(p, 'cron')].filter(Boolean).join(' · '));
    case 'schedule.updated': return v('info', 'neutral', 'Planification modifiée', [name, str(p, 'cron')].filter(Boolean).join(' · '));
    case 'schedule.deleted': return v('info', 'neutral', 'Planification supprimée', [name, str(p, 'cron')].filter(Boolean).join(' · '));
    case 'schedule.fired': return v('info', 'amber', 'Planification déclenchée', name);
    case 'provider.auth': {
      const st = str(p, 'state');
      return v(st === 'logged_in' ? 'info' : 'warn', st === 'logged_in' ? 'ok' : 'warn', `Authentification ${str(p, 'provider')}`, st === 'logged_in' ? 'connecté' : st === 'logged_out' ? 'déconnecté' : st);
    }
    case 'system.notice': {
      const lvl = str(p, 'level');
      return v(lvl === 'error' ? 'error' : lvl === 'warn' ? 'warn' : 'info', lvl === 'error' ? 'err' : lvl === 'warn' ? 'warn' : 'neutral', 'Notification système', str(p, 'message'));
    }
    case 'system.emergency_stop': {
      const n = typeof p.cancelled === 'number' ? p.cancelled : null;
      const bits = [n == null ? '' : n === 0 ? 'aucune exécution annulée' : `${n} exécution${n > 1 ? 's' : ''} annulée${n > 1 ? 's' : ''}`, str(p, 'reason') && `motif : ${str(p, 'reason')}`].filter(Boolean);
      return v('error', 'err', 'Arrêt d’urgence déclenché', bits.join(' · '));
    }
    case 'system.resumed': return v('warn', 'ok', 'Reprise après arrêt d’urgence', 'les lancements et planifications sont de nouveau autorisés');
    case 'system.resync': return v('warn', 'warn', 'Resynchronisation du flux', 'Le journal conservé ne remonte pas jusqu’au dernier événement connu.');
    default: return v('info', 'neutral', e.type, '');
  }
}
function v(level: Level, tone: Tone, title: string, detail: string): EventView { return { level, tone, title, detail }; }

/** Événement `agent.profile` (fiche d'identité décorative du Bureau virtuel), selon `action`. */
export function profileEventLabel(p: Record<string, unknown>): EventView {
  const provider = str(p, 'provider');
  const who = [provider === 'claude' ? 'Claude' : provider === 'codex' ? 'Codex' : provider, str(p, 'model')].filter(Boolean).join(' · ');
  const inTok = num(p, 'input_tokens'); const outTok = num(p, 'output_tokens');
  const tokens = inTok == null && outTok == null ? '' : `${formatNumber((inTok ?? 0) + (outTok ?? 0))} jetons`;
  switch (str(p, 'action')) {
    case 'generating': return v('info', 'amber', 'Fiche d’identité : génération en cours', who);
    case 'generated': return v('info', 'ok', 'Fiche d’identité générée', [who, tokens].filter(Boolean).join(' · '));
    case 'generation_failed': return v('warn', 'warn', 'Échec de la génération de la fiche d’identité', [who, str(p, 'error')].filter(Boolean).join(' — '));
    case 'updated': return v('info', 'neutral', 'Fiche d’identité modifiée', '');
    case 'reset': return v('info', 'neutral', 'Fiche d’identité réinitialisée', 'retour à la fiche par défaut');
    default: return v('info', 'neutral', 'Fiche d’identité', str(p, 'action'));
  }
}
/** Événement `office.layout` (agencement personnalisé du Bureau virtuel). */
export function officeLayoutLabel(p: Record<string, unknown>): string {
  return str(p, 'action') === 'reset' ? 'Agencement du bureau réinitialisé' : 'Agencement du bureau enregistré';
}

export const EVENT_CATEGORIES = [
  { id: 'run', label: 'Exécutions' }, { id: 'tool', label: 'Outils' }, { id: 'agent', label: 'Agents' },
  { id: 'schedule', label: 'Planifications' }, { id: 'provider', label: 'Fournisseurs' }, { id: 'system', label: 'Système' },
  { id: 'office', label: 'Bureau virtuel' },
] as const;

export interface EventFilter { agentId: string; category: string; level: '' | Level; search: string }
export const EMPTY_FILTER: EventFilter = { agentId: '', category: '', level: '', search: '' };

export function eventSearchText(e: RoEvent): string {
  const view = describeEvent(e);
  let raw = '';
  try { raw = JSON.stringify(e.payload ?? {}); } catch { /* ignore */ }
  return `${e.type} ${view.title} ${view.detail} ${raw}`.toLowerCase();
}

export function matchesFilter(e: RoEvent, f: EventFilter): boolean {
  if (f.agentId && e.agent_id !== f.agentId) return false;
  if (f.category && eventCategory(e.type) !== f.category) return false;
  if (f.level && describeEvent(e).level !== f.level) return false;
  const s = f.search.trim().toLowerCase();
  if (s && !eventSearchText(e).includes(s)) return false;
  return true;
}

/** Ajoute des événements à un tampon trié par seq, sans doublon, borné à `max` éléments (les plus récents). */
export function mergeEvents(buf: readonly RoEvent[], incoming: readonly RoEvent[], max = Infinity): RoEvent[] {
  if (incoming.length === 0) return buf as RoEvent[];
  const lastSeq = buf.length ? buf[buf.length - 1].seq : -Infinity;
  let out: RoEvent[];
  const sorted = [...incoming].sort((a, b) => a.seq - b.seq);
  const strictlyNewer = sorted.every((e, i) => e.seq > lastSeq && (i === 0 || e.seq > sorted[i - 1].seq));
  if (strictlyNewer) out = [...buf, ...sorted];
  else {
    const bySeq = new Map<number, RoEvent>();
    for (const e of buf) bySeq.set(e.seq, e);
    for (const e of sorted) bySeq.set(e.seq, e);
    out = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  }
  return out.length > max ? out.slice(out.length - max) : out;
}

/** Charge la fin du journal (`want` derniers événements) en paginant vers l'avant, quel que soit le sens de troncature du serveur. */
export async function loadEventTail(
  fetchPage: (since: number, limit: number) => Promise<{ events: RoEvent[]; last_seq: number }>,
  want = 500, pageSize = 500, maxPages = 20,
): Promise<{ events: RoEvent[]; lastSeq: number }> {
  let since = 0; let all: RoEvent[] = []; let lastSeq = 0;
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage(since, pageSize);
    all = mergeEvents(all, page.events, want);
    const pageMax = page.events.length ? page.events[page.events.length - 1].seq : since;
    lastSeq = Math.max(lastSeq, page.last_seq ?? 0, pageMax);
    if (page.events.length < pageSize || pageMax <= since) break;
    since = pageMax;
  }
  return { events: all, lastSeq };
}

export function truncatePreview(s: string, n = 160): string { return truncate(s.replace(/\s+/g, ' ').trim(), n); }

/** Dernière action d'outil en cours pour un agent, d'après le tampon d'événements (null si l'agent n'a pas d'exécution ouverte). */
export function currentActivity(events: readonly RoEvent[], agentId: string): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.agent_id !== agentId) continue;
    switch (e.type) {
      case 'tool.call': { const p = e.payload ?? {}; const t = typeof p.tool === 'string' ? p.tool : ''; const s = typeof p.summary === 'string' ? p.summary : ''; return truncatePreview([t, s].filter(Boolean).join(' · '), 90) || null; }
      case 'run.succeeded': case 'run.failed': case 'run.cancelled': case 'run.rejected': return null;
      case 'run.started': return null;
      default: break;
    }
  }
  return null;
}

/** Charge tous les événements d'une exécution (le serveur peut paginer : on suit `last_seq`). */
export async function loadRunEvents(
  fetchPage: (since: number) => Promise<{ events: RoEvent[]; last_seq: number }>, maxPages = 40,
): Promise<RoEvent[]> {
  let since = 0; let all: RoEvent[] = [];
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage(since);
    if (page.events.length === 0) break;
    all = mergeEvents(all, page.events);
    const maxSeq = all[all.length - 1].seq;
    if (maxSeq >= page.last_seq || maxSeq <= since) break;
    since = maxSeq;
  }
  return all;
}
