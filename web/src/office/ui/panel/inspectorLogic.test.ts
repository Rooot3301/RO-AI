import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Run, Schedule } from '../../../api/types';
import { run } from '../../../lib/testutil.ts';
import { STOP_BLOCKED_TEXT } from '../../../lib/control.ts';
import { chatUrl, computeRunStats, firstLine, instructionTarget, modelLabel, nextMission } from './inspectorLogic.ts';

const r = (id: string, at: string, status: Run['status'], extra: Partial<Run> = {}): Run => ({ ...run(id, at, status), ...extra });

test('computeRunStats : nombre, taux de réussite, durée moyenne, jetons, série', () => {
  const runs = [
    r('a', '2026-11-20T10:00:00Z', 'succeeded', { duration_ms: 1000, usage: { input_tokens: 100, output_tokens: 10 } }),
    r('b', '2026-11-21T10:00:00Z', 'failed', { duration_ms: 3000, finished_at: '2026-11-21T10:00:03Z' }),
    r('c', '2026-11-22T10:00:00Z', 'succeeded', { duration_ms: 2000, usage: { input_tokens: 50, output_tokens: 5 } }),
    r('d', '2026-11-23T10:00:00Z', 'cancelled'),
    r('e', '2026-11-24T10:00:00Z', 'succeeded', { duration_ms: 6000, finished_at: '2026-11-24T10:00:06Z' }),
    r('f', '2026-11-25T10:00:00Z', 'running'),
  ];
  const s = computeRunStats(runs);
  assert.equal(s.count, 6); assert.equal(s.succeeded, 3); assert.equal(s.failed, 1); assert.equal(s.cancelled, 1); assert.equal(s.active, 1);
  assert.equal(s.successRate, 0.75);
  assert.equal(s.avgDurationMs, 3000);
  assert.equal(s.inputTokens, 150); assert.equal(s.outputTokens, 15);
  assert.equal(s.streak, 2); // e et c (annulation et exécution en cours ignorées), arrêt sur l'échec b
  assert.equal(s.lastSuccessAt, '2026-11-24T10:00:06Z'); assert.equal(s.lastFailureAt, '2026-11-21T10:00:03Z');
});

test('computeRunStats : aucune exécution terminée', () => {
  const s = computeRunStats([]);
  assert.equal(s.count, 0); assert.equal(s.successRate, null); assert.equal(s.avgDurationMs, null); assert.equal(s.streak, 0);
  assert.equal(computeRunStats([r('x', '2026-11-25T10:00:00Z', 'queued')]).successRate, null);
});

test('nextMission : planification active la plus proche de l’agent', () => {
  const sch = (id: string, agent_id: string, next: string | null, enabled = true): Schedule => ({
    id, agent_id, name: `P ${id}`, cron: '0 8 * * *', timezone: 'Europe/Paris', prompt: `prompt ${id}`, enabled, last_run_at: null, next_run_at: next, last_run_id: null,
  });
  const list = [sch('1', 'ag_1', '2026-11-27T08:00:00Z'), sch('2', 'ag_1', '2026-11-26T08:00:00Z'), sch('3', 'ag_1', '2026-11-25T12:00:00Z', false), sch('4', 'ag_2', '2026-11-25T09:00:00Z'), sch('5', 'ag_1', null)];
  const n = nextMission('ag_1', list);
  assert.equal(n?.scheduleId, '2'); assert.equal(n?.prompt, 'prompt 2');
  assert.equal(nextMission('ag_3', list), null);
});

test('modelLabel : modèle imposé, sinon dernier modèle « (défaut) »', () => {
  assert.deepEqual(modelLabel({ model: 'opus', last_model: 'claude-opus-x' }), { text: 'opus', isDefault: false });
  assert.deepEqual(modelLabel({ model: null, last_model: 'gpt-5-codex' }), { text: 'gpt-5-codex (défaut)', isDefault: true });
  assert.deepEqual(modelLabel({ model: '', last_model: null }), { text: 'par défaut du fournisseur', isDefault: true });
  assert.equal(modelLabel(null).isDefault, true);
});

test('instructionTarget : répondre à la dernière conversation libre', () => {
  const runs = [
    r('c1', '2026-11-24T10:00:00Z', 'succeeded', { session_id: 's1', prompt: 'Fais la veille' }),
    r('c2', '2026-11-24T10:05:00Z', 'succeeded', { session_id: 's2', conversation_id: 'c1', parent_run_id: 'c1', trigger: 'reply' }),
    r('old', '2026-11-20T10:00:00Z', 'succeeded', { session_id: 's0' }),
  ];
  const t = instructionTarget(runs, { agentEnabled: true, paused: false });
  assert.equal(t.kind, 'reply');
  if (t.kind === 'reply') { assert.equal(t.runId, 'c2'); assert.equal(t.conversationId, 'c1'); assert.equal(t.title, 'Fais la veille'); }
});

test('instructionTarget : conversation occupée -> ouvrir le chat (non bloqué)', () => {
  const runs = [r('c1', '2026-11-24T10:00:00Z', 'succeeded', { session_id: 's1' }), r('c2', '2026-11-24T10:05:00Z', 'running', { conversation_id: 'c1', trigger: 'reply' })];
  const t = instructionTarget(runs, { agentEnabled: true, paused: false });
  assert.equal(t.kind, 'chat');
  if (t.kind === 'chat') { assert.equal(t.conversationId, 'c1'); assert.match(t.reason, /répondre/); assert.equal(t.blocked, false); }
});

test('instructionTarget : sans conversation ou sans session -> chat ; arrêt d’urgence -> bloqué', () => {
  const none = instructionTarget([r('s', '2026-11-24T10:00:00Z', 'succeeded', { trigger: 'schedule', session_id: 'x' })], { agentEnabled: true, paused: false });
  assert.equal(none.kind, 'chat');
  if (none.kind === 'chat') { assert.equal(none.conversationId, null); assert.equal(none.blocked, false); }
  const noSession = instructionTarget([r('a', '2026-11-24T10:00:00Z', 'failed')], { agentEnabled: true, paused: false });
  assert.equal(noSession.kind, 'chat');
  const paused = instructionTarget([r('a', '2026-11-24T10:00:00Z', 'succeeded', { session_id: 's' })], { agentEnabled: true, paused: true });
  assert.equal(paused.kind, 'chat');
  if (paused.kind === 'chat') { assert.equal(paused.reason, STOP_BLOCKED_TEXT); assert.equal(paused.blocked, true); }
  const disabled = instructionTarget([], { agentEnabled: false, paused: false });
  assert.ok(disabled.kind === 'chat' && disabled.blocked);
});

test('chatUrl et firstLine', () => {
  assert.equal(chatUrl('ag_1', null), '/agents/ag_1/chat');
  assert.equal(chatUrl('ag_1', 'run 1'), '/agents/ag_1/chat?c=run%201');
  assert.equal(firstLine('\n  Bonjour\nsuite'), 'Bonjour');
  assert.equal(firstLine('abcdef', 4), 'abc…');
  assert.equal(firstLine(null), '');
});
