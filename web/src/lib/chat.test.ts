import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupConversations, findConversation, composerState, sendTarget, retryTarget, replyBase, contextHint, activityLabel, convTitle } from './chat.ts';
import { run } from './testutil.ts';
import type { Run } from '../api/types';

const r = (id: string, at: string, extra: Partial<Run> = {}): Run => ({ ...run(id, at, 'succeeded'), session_id: `s_${id}`, ...extra });

test('groupConversations : regroupe par conversation_id, ordre chronologique, tri récent d\'abord', () => {
  const a1 = r('a1', '2026-11-24T10:00:00Z', { prompt: 'Bonjour agent' });
  const a2 = r('a2', '2026-11-24T10:05:00Z', { conversation_id: 'a1', parent_run_id: 'a1', trigger: 'reply', usage: { input_tokens: 10, output_tokens: 5 } });
  const a3 = r('a3', '2026-11-24T10:06:00Z', { conversation_id: 'a1', parent_run_id: 'a2', trigger: 'reply', usage: { input_tokens: 20, output_tokens: 5 } });
  const b1 = r('b1', '2026-11-24T11:00:00Z', { prompt: '\n  Seconde conversation\nsuite' });
  const c = groupConversations([a3, b1, a1, a2]);
  assert.deepEqual(c.map((x) => x.id), ['b1', 'a1']);
  assert.deepEqual(c[1].runs.map((x) => x.id), ['a1', 'a2', 'a3']);
  assert.equal(c[1].exchanges, 3); assert.equal(c[1].tokens, 40); assert.equal(c[1].title, 'Bonjour agent');
  assert.equal(c[0].title, 'Seconde conversation'); assert.equal(c[0].exchanges, 1);
});

test('groupConversations : exécutions planifiées isolées exclues, mais pas si elles ont des réponses', () => {
  const s1 = r('s1', '2026-11-24T08:00:00Z', { trigger: 'schedule' });
  assert.equal(groupConversations([s1]).length, 0);
  const s2 = r('s2', '2026-11-24T08:05:00Z', { conversation_id: 's1', trigger: 'reply', parent_run_id: 's1' });
  assert.equal(groupConversations([s1, s2]).length, 1);
  assert.deepEqual(groupConversations([]), []);
});

test('findConversation : par identifiant de conversation ou d\'exécution', () => {
  const a1 = r('a1', '2026-11-24T10:00:00Z'); const a2 = r('a2', '2026-11-24T10:05:00Z', { conversation_id: 'a1' });
  const convs = groupConversations([a1, a2]);
  assert.equal(findConversation(convs, 'a1')?.id, 'a1');
  assert.equal(findConversation(convs, 'a2')?.id, 'a1');
  assert.equal(findConversation(convs, 'zz'), null);
  assert.equal(findConversation(convs, null), null);
});

test('sendTarget et replyBase', () => {
  assert.deepEqual(sendTarget([]), { kind: 'new' });
  const a = r('a', '2026-11-24T10:00:00Z'); const b = r('b', '2026-11-24T10:01:00Z', { status: 'failed', session_id: null });
  assert.deepEqual(sendTarget([a, b]), { kind: 'reply', runId: 'a' }); // la dernière avec session
  assert.equal(replyBase([a, b])?.id, 'a');
  assert.equal(sendTarget([b]), null);
});

test('retryTarget', () => {
  assert.deepEqual(retryTarget(r('b', '2026-11-24T10:01:00Z', { parent_run_id: 'a' })), { kind: 'reply', runId: 'a' });
  assert.deepEqual(retryTarget(r('b', '2026-11-24T10:01:00Z')), { kind: 'new' });
});

test('composerState : raisons de blocage', () => {
  const ok = r('a', '2026-11-24T10:00:00Z');
  assert.deepEqual(composerState({ runs: [], agentEnabled: true, paused: false }), { canSend: true, reason: null });
  assert.deepEqual(composerState({ runs: [ok], agentEnabled: true, paused: false }), { canSend: true, reason: null });
  assert.match(composerState({ runs: [ok], agentEnabled: true, paused: true }).reason!, /Arrêt d’urgence/);
  assert.match(composerState({ runs: [ok], agentEnabled: false, paused: false }).reason!, /désactivé/);
  assert.match(composerState({ runs: [{ ...ok, status: 'running' }], agentEnabled: true, paused: false }).reason!, /répondre/);
  assert.match(composerState({ runs: [{ ...ok, status: 'queued' }], agentEnabled: true, paused: false }).reason!, /répondre/);
  assert.match(composerState({ runs: [{ ...ok, status: 'awaiting_approval' }], agentEnabled: true, paused: false }).reason!, /approbation/);
  assert.match(composerState({ runs: [{ ...ok, status: 'failed', session_id: null }], agentEnabled: true, paused: false }).reason!, /session/);
  assert.equal(composerState({ runs: [{ ...ok, status: 'failed' }], agentEnabled: true, paused: false }).canSend, true); // échec avec session : on peut répondre
  assert.equal(composerState({ runs: [], agentEnabled: true, paused: false, sending: true }).canSend, false);
});

test('contextHint, activityLabel, convTitle', () => {
  assert.equal(contextHint(10), null);
  assert.match(contextHint(11)!, /nouvelle conversation/);
  assert.equal(activityLabel('read'), 'lit…'); assert.equal(activityLabel('web'), 'cherche sur le web…');
  assert.equal(activityLabel('exec'), 'exécute…'); assert.equal(activityLabel(null), 'travaille…');
  assert.equal(convTitle(r('x', '2026-11-24T10:00:00Z', { prompt: '' })), 'Conversation sans titre');
  assert.equal(convTitle(r('x', '2026-11-24T10:00:00Z', { prompt: 'a'.repeat(100) })).length, 64);
});
