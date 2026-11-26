import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertRun, mergeRuns, pendingApprovals, pushSample, statusAfterEvent, isRunLifecycleEvent } from './runs.ts';
import { run } from './testutil.ts';

test('upsertRun : remplace, trie par création décroissante, borne', () => {
  const a = run('a', '2026-11-24T10:00:00Z'); const b = run('b', '2026-11-24T10:05:00Z'); const c = run('c', '2026-11-24T10:10:00Z');
  const l1 = upsertRun([a, b], c);
  assert.deepEqual(l1.map((r) => r.id), ['c', 'b', 'a']);
  const l2 = upsertRun(l1, { ...b, status: 'running' });
  assert.equal(l2.length, 3);
  assert.equal(l2.find((r) => r.id === 'b')?.status, 'running');
  assert.deepEqual(upsertRun(l1, run('d', '2026-11-24T11:00:00Z'), 3).map((r) => r.id), ['d', 'c', 'b']);
});

test('mergeRuns et pendingApprovals', () => {
  const a = run('a', '2026-11-24T10:00:00Z', 'awaiting_approval'); const b = run('b', '2026-11-24T10:05:00Z', 'running');
  const merged = mergeRuns([b], [a, b]);
  assert.equal(merged.length, 2);
  assert.deepEqual(pendingApprovals(merged).map((r) => r.id), ['a']);
});

test('pushSample borne l\'historique', () => {
  assert.deepEqual(pushSample([1, 2, 3], 4, 3), [2, 3, 4]);
});

test('événements de cycle de vie', () => {
  assert.ok(isRunLifecycleEvent('run.started'));
  assert.ok(!isRunLifecycleEvent('run.message'));
  assert.equal(statusAfterEvent('run.succeeded'), 'succeeded');
  assert.equal(statusAfterEvent('run.rejected'), null);
});

import { overlayRuns } from './runs.ts';
test('overlayRuns : statut en direct, nouvelle exécution, retrait selon filtre', () => {
  const a = run('a', '2026-11-24T10:00:00Z', 'running'); const b = run('b', '2026-11-24T10:05:00Z', 'running');
  const aDone = { ...a, status: 'succeeded' as const };
  const c = run('c', '2026-11-24T10:10:00Z', 'running');
  const out = overlayRuns([b, a], [aDone, c], { status: 'running' }, false);
  assert.deepEqual(out.map((r) => r.id), ['c', 'b']);
  // sans filtre : a est mis à jour
  assert.equal(overlayRuns([b, a], [aDone], {}, false).find((r) => r.id === 'a')?.status, 'succeeded');
  // page tronquée : une exécution plus ancienne que la page n'est pas injectée
  const old = run('z', '2026-11-24T08:00:00Z');
  assert.equal(overlayRuns([b, a], [old], {}, true).length, 2);
  assert.equal(overlayRuns([b, a], [old], {}, false).length, 3);
  // filtre agent
  assert.equal(overlayRuns([], [{ ...c, agent_id: 'ag_2' }], { agent_id: 'ag_1' }, false).length, 0);
});
