// Construction du journal d'une exécution à partir de ses événements (messages, appels d'outils appariés, incidents).
import type { ErrorClass, RoEvent, ToolKind } from '../api/types';
import { officeLayoutLabel, profileEventLabel } from './events.ts';

export type LogEntry =
  | { kind: 'lifecycle'; seq: number; ts: string; type: string; text: string; detail: string }
  | { kind: 'message'; seq: number; ts: string; text: string }
  | { kind: 'tool'; seq: number; ts: string; toolId: string; tool: string; toolKind: ToolKind; summary: string; result: { seq: number; ts: string; ok: boolean; summary: string } | null }
  | { kind: 'denied'; seq: number; ts: string; tool: string; reason: string }
  | { kind: 'retry'; seq: number; ts: string; attempt: number | null; max: number | null; error: string }
  | { kind: 'limit'; seq: number; ts: string; status: string; resetsAt: string | null; window: string | null }
  | { kind: 'final'; seq: number; ts: string; outcome: 'succeeded' | 'failed' | 'cancelled'; durationMs: number | null; turns: number | null; cost: number | null; preview: string; errorClass: ErrorClass | null; errorMessage: string }
  | { kind: 'other'; seq: number; ts: string; type: string };

export type LogGroup = 'all' | 'messages' | 'tools' | 'incidents';

const s = (p: Record<string, unknown>, k: string) => (typeof p[k] === 'string' ? (p[k] as string) : p[k] != null && typeof p[k] !== 'object' ? String(p[k]) : '');
const n = (p: Record<string, unknown>, k: string) => (typeof p[k] === 'number' && Number.isFinite(p[k]) ? (p[k] as number) : null);
const TOOL_KINDS = new Set(['read', 'write', 'exec', 'web', 'mcp', 'other']);

export function buildRunLog(events: readonly RoEvent[]): LogEntry[] {
  const entries: LogEntry[] = [];
  const toolIdx = new Map<string, number>();
  for (const e of events) {
    const p = e.payload ?? {};
    const base = { seq: e.seq, ts: e.ts };
    switch (e.type) {
      case 'run.queued': entries.push({ kind: 'lifecycle', ...base, type: e.type, text: 'Mise en file', detail: s(p, 'trigger') }); break;
      case 'run.awaiting_approval': entries.push({ kind: 'lifecycle', ...base, type: e.type, text: 'En attente d’approbation', detail: '' }); break;
      case 'run.approved': entries.push({ kind: 'lifecycle', ...base, type: e.type, text: 'Approuvée', detail: '' }); break;
      case 'run.rejected': entries.push({ kind: 'lifecycle', ...base, type: e.type, text: 'Rejetée', detail: '' }); break;
      case 'run.started': entries.push({ kind: 'lifecycle', ...base, type: e.type, text: 'Démarrage', detail: [s(p, 'provider'), s(p, 'model')].filter(Boolean).join(' · ') }); break;
      case 'run.model': entries.push({ kind: 'lifecycle', ...base, type: e.type, text: 'Modèle', detail: s(p, 'model') }); break;
      case 'run.session': entries.push({ kind: 'lifecycle', ...base, type: e.type, text: 'Session ouverte', detail: s(p, 'session_id') }); break;
      case 'run.message': entries.push({ kind: 'message', ...base, text: s(p, 'text') }); break;
      case 'tool.call': {
        const toolId = s(p, 'tool_id');
        const kind = s(p, 'kind');
        const entry: LogEntry = { kind: 'tool', ...base, toolId, tool: s(p, 'tool') || '?', toolKind: (TOOL_KINDS.has(kind) ? kind : 'other') as ToolKind, summary: s(p, 'summary'), result: null };
        if (toolId) toolIdx.set(toolId, entries.length);
        entries.push(entry);
        break;
      }
      case 'tool.result': {
        const idx = toolIdx.get(s(p, 'tool_id'));
        const res = { seq: e.seq, ts: e.ts, ok: p.ok !== false, summary: s(p, 'summary') };
        const target = idx != null ? entries[idx] : undefined;
        if (target && target.kind === 'tool') target.result = res;
        else entries.push({ kind: 'tool', ...base, toolId: s(p, 'tool_id'), tool: 'résultat sans appel', toolKind: 'other', summary: '', result: res });
        break;
      }
      case 'tool.denied': entries.push({ kind: 'denied', ...base, tool: s(p, 'tool') || '?', reason: s(p, 'reason') }); break;
      case 'run.api_retry': entries.push({ kind: 'retry', ...base, attempt: n(p, 'attempt'), max: n(p, 'max_retries'), error: s(p, 'error') }); break;
      case 'run.rate_limit': entries.push({ kind: 'limit', ...base, status: s(p, 'status'), resetsAt: s(p, 'resets_at') || null, window: s(p, 'window') || null }); break;
      case 'run.succeeded': entries.push({ kind: 'final', ...base, outcome: 'succeeded', durationMs: n(p, 'duration_ms'), turns: n(p, 'num_turns'), cost: n(p, 'cost_usd_estimate'), preview: s(p, 'result_preview'), errorClass: null, errorMessage: '' }); break;
      case 'run.failed': entries.push({ kind: 'final', ...base, outcome: 'failed', durationMs: n(p, 'duration_ms'), turns: null, cost: null, preview: '', errorClass: (s(p, 'error_class') || null) as ErrorClass | null, errorMessage: s(p, 'error_message') }); break;
      case 'run.cancelled': entries.push({ kind: 'final', ...base, outcome: 'cancelled', durationMs: null, turns: null, cost: null, preview: '', errorClass: null, errorMessage: '' }); break;
      case 'agent.profile': { const x = profileEventLabel(p); entries.push({ kind: 'lifecycle', ...base, type: e.type, text: x.title, detail: x.detail }); break; }
      case 'office.layout': entries.push({ kind: 'lifecycle', ...base, type: e.type, text: officeLayoutLabel(p), detail: '' }); break;
      default: entries.push({ kind: 'other', ...base, type: e.type });
    }
  }
  return entries;
}

export function filterLog(entries: readonly LogEntry[], g: LogGroup): LogEntry[] {
  if (g === 'all') return entries as LogEntry[];
  return entries.filter((e) => {
    if (g === 'messages') return e.kind === 'message' || e.kind === 'lifecycle' || e.kind === 'final';
    if (g === 'tools') return e.kind === 'tool' || e.kind === 'denied';
    return e.kind === 'denied' || e.kind === 'retry' || e.kind === 'limit'
      || (e.kind === 'final' && e.outcome !== 'succeeded') || (e.kind === 'tool' && e.result?.ok === false);
  });
}

export function logStats(entries: readonly LogEntry[]) {
  let tools = 0; let denied = 0; let retries = 0; let messages = 0;
  for (const e of entries) {
    if (e.kind === 'tool') tools++;
    else if (e.kind === 'denied') denied++;
    else if (e.kind === 'retry') retries++;
    else if (e.kind === 'message') messages++;
  }
  return { tools, denied, retries, messages };
}
