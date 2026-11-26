import type { Run, RoEvent } from '../api/types';
let seq = 0;
export function ev(type: string, payload: Record<string, unknown> = {}, extra: Partial<RoEvent> = {}): RoEvent {
  seq += 1;
  return { seq, ts: `2026-11-24T10:00:${String(seq % 60).padStart(2, '0')}Z`, schema: 1, domain: 'pro', type, agent_id: 'ag_1', run_id: 'run_1', payload, ...extra };
}
export function run(id: string, created_at: string, status: Run['status'] = 'queued'): Run {
  return {
    id, agent_id: 'ag_1', agent_name: 'Veille', provider: 'claude', status, trigger: 'manual', prompt: 'p', session_id: null,
    created_at, started_at: null, finished_at: null, duration_ms: null, error_class: null, error_message: null, num_turns: null,
    cost_usd_estimate: null, usage: null, result_text: null, schedule_id: null, parent_run_id: null, conversation_id: null,
  };
}
