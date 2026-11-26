import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRunLog, filterLog, logStats } from './runLog.ts';
import { ev } from './testutil.ts';

test('buildRunLog : apparie appels et résultats d\'outils', () => {
  const log = buildRunLog([
    ev('run.queued', { trigger: 'manual', prompt_preview: 'x' }),
    ev('run.started', { provider: 'claude', model: 'sonnet' }),
    ev('tool.call', { tool_id: 't1', tool: 'Read', kind: 'read', summary: 'README.md' }),
    ev('tool.call', { tool_id: 't2', tool: 'Bash', kind: 'exec', summary: 'git status' }),
    ev('tool.result', { tool_id: 't2', ok: false, summary: 'refus' }),
    ev('tool.result', { tool_id: 't1', ok: true, summary: '120 lignes' }),
    ev('run.message', { text: '<script>alert(1)</script>' }),
  ]);
  assert.equal(log.length, 5);
  const t1 = log[2]; const t2 = log[3];
  assert.ok(t1.kind === 'tool' && t1.result?.ok === true && t1.toolKind === 'read');
  assert.ok(t2.kind === 'tool' && t2.result?.ok === false);
  assert.ok(log[4].kind === 'message' && log[4].text === '<script>alert(1)</script>'); // texte brut conservé, jamais interprété
});

test('buildRunLog : incidents et résultat final', () => {
  const log = buildRunLog([
    ev('tool.denied', { tool: 'Bash', reason: 'hors liste' }),
    ev('run.api_retry', { attempt: 1, max_retries: 3, error: '529' }),
    ev('run.rate_limit', { status: 'limited', resets_at: '2026-11-24T15:00:00Z', window: '5h' }),
    ev('run.failed', { error_class: 'rate_limited', error_message: 'limite', duration_ms: 1200 }),
  ]);
  assert.deepEqual(log.map((e) => e.kind), ['denied', 'retry', 'limit', 'final']);
  const last = log[3];
  assert.ok(last.kind === 'final' && last.outcome === 'failed' && last.errorClass === 'rate_limited' && last.durationMs === 1200);
  assert.equal(filterLog(log, 'incidents').length, 4);
  assert.equal(filterLog(log, 'tools').length, 1);
  assert.deepEqual(logStats(log), { tools: 0, denied: 1, retries: 1, messages: 0 });
});

test('buildRunLog : résultat orphelin et type inconnu ne cassent rien', () => {
  const log = buildRunLog([ev('tool.result', { tool_id: 'zz', ok: true, summary: 's' }), ev('foo.bar')]);
  assert.equal(log.length, 2);
  assert.equal(log[1].kind, 'other');
});

test('filterLog : messages inclut cycle de vie et final', () => {
  const log = buildRunLog([ev('run.started', {}), ev('tool.call', { tool_id: 'a', tool: 'Read', kind: 'read', summary: '' }), ev('run.succeeded', { duration_ms: 10, num_turns: 1, cost_usd_estimate: 0.1, result_preview: 'ok' })]);
  assert.deepEqual(filterLog(log, 'messages').map((e) => e.kind), ['lifecycle', 'final']);
});

test('buildRunLog : le modèle utilisé apparaît dans le cycle de vie', () => {
  const log = buildRunLog([ev('run.model', { model: 'gpt-6.2-sol' })]);
  assert.equal(log[0].kind, 'lifecycle');
  assert.ok(log[0].kind === 'lifecycle' && log[0].text === 'Modèle' && log[0].detail === 'gpt-6.2-sol');
});

test('buildRunLog : agent.profile et office.layout ont un libellé français', () => {
  const log = buildRunLog([ev('agent.profile', { action: 'generated', provider: 'claude' }), ev('office.layout', { action: 'saved' })]);
  assert.ok(log[0].kind === 'lifecycle' && log[0].text === 'Fiche d’identité générée' && log[0].detail === 'Claude');
  assert.ok(log[1].kind === 'lifecycle' && log[1].text === 'Agencement du bureau enregistré');
});
