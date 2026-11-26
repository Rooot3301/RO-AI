import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visualOf } from './visual.ts';
import type { OfficeAgentModel } from './model.ts';

const base: OfficeAgentModel = {
  id: 'a', name: 'A', department: 'Dev', sprite: 0, state: 'idle', waitKind: null, activity: null, toolKind: null, runId: null,
  errorClass: null, since: '', effects: [], origin: { seq: 1, type: 'snapshot', run_id: null, ts: '' },
};
const ag = (o: Partial<OfficeAgentModel>): OfficeAgentModel => ({ ...base, ...o });

test('working : à son bureau, posture et écran selon tool_kind (terminal, lecture, web…)', () => {
  const w = (k: OfficeAgentModel['toolKind']) => visualOf(ag({ state: 'working', toolKind: k }), 0);
  assert.deepEqual([w('read').pose, w('read').screen], ['read', 'read']);
  assert.deepEqual([w('write').pose, w('write').screen], ['type', 'code']);
  assert.deepEqual([w('exec').pose, w('exec').screen], ['terminal', 'terminal']);
  assert.deepEqual([w('web').pose, w('web').screen], ['web', 'web']);
  assert.equal(w('mcp').connector, true);
  assert.equal(w('mcp').screen, 'mcp');
  assert.equal(w(null).screen, 'generic');
  assert.equal(w('read').place, 'desk');
  assert.equal(w('read').ambient, false, 'travail réel : jamais de vie sociale');
});

test('waiting : file => debout près de son poste ; approbation => salle d\'attente, main levée', () => {
  const q = visualOf(ag({ state: 'waiting', waitKind: 'queued' }), 0);
  assert.deepEqual([q.place, q.pose, q.ambient], ['stand', 'wait', false]);
  const v = visualOf(ag({ state: 'waiting', waitKind: 'approval' }), 0);
  assert.deepEqual([v.place, v.pose, v.ambient], ['approval', 'hand', false]);
});

test('error : alarme au bureau, classe conservée (repli failed) ; rate_limited => état « quota atteint » spécifique', () => {
  const v = visualOf(ag({ state: 'error', errorClass: 'auth_expired' }), 0);
  assert.deepEqual([v.place, v.pose, v.alarm, v.screen, v.quota], ['desk', 'alarm', 'auth_expired', 'error', false]);
  assert.equal(visualOf(ag({ state: 'error' }), 0).alarm, 'failed');
  const q = visualOf(ag({ state: 'error', errorClass: 'rate_limited' }), 0);
  assert.deepEqual([q.place, q.pose, q.screen, q.quota], ['desk', 'quota', 'quota', true]);
});

test('idle : libre (la vie sociale peut le déplacer) ; réussite récente : debout près du poste le temps de l\'effet', () => {
  const idle = visualOf(ag({}), 100);
  assert.deepEqual([idle.place, idle.pose, idle.ambient], ['free', 'idle', true]);
  const eff = [{ kind: 'success' as const, until: 1000, label: '', short: '', origin: base.origin }];
  const ok = visualOf(ag({ effects: eff }), 500);
  assert.deepEqual([ok.place, ok.pose, ok.success, ok.ambient], ['stand', 'cheer', true, false]);
  assert.equal(visualOf(ag({ effects: eff }), 1500).place, 'free');
});

test('disabled : absent (aucun personnage), poste marqué', () => {
  const v = visualOf(ag({ state: 'disabled' }), 0);
  assert.deepEqual([v.place, v.disabled, v.ambient], ['none', true, false]);
});

test('working avec erreur antérieure : pastille discrète, pas d\'alarme', () => {
  const v = visualOf(ag({ state: 'working', toolKind: 'exec', errorClass: 'timeout' }), 0);
  assert.equal(v.errorBadge, 'timeout');
  assert.equal(v.alarm, null);
});

test('salle de réunion et bibliothèque : uniquement sur données réelles, l’état réel prioritaire', async () => {
  const { visualOf } = await import('./visual.ts');
  const base = { id: 'a', name: 'A', department: 'D', sprite: 0, state: 'working' as const, waitKind: null, activity: null, toolKind: 'read' as const, runId: 'r1', errorClass: null, since: '', effects: [], origin: { seq: 0, type: 's', run_id: null, ts: '' } };
  const now = 1_000_000;
  const conv = (o: object) => ({ via: 'chat' as const, runId: 'r1', active: true, lastAt: '', until: Infinity, ...o });
  assert.equal(visualOf({ ...base, conv: conv({}) }, now).place, 'meeting');
  assert.equal(visualOf({ ...base, conv: conv({ runId: 'autre' }) }, now).place, 'desk', 'mission ordinaire pendant une conversation : au poste');
  assert.equal(visualOf({ ...base, state: 'idle', runId: null, conv: conv({ active: false, until: now + 1000 }) }, now).place, 'meeting');
  assert.equal(visualOf({ ...base, state: 'idle', runId: null, conv: conv({ active: false, until: now - 1 }) }, now).place, 'free');
  assert.equal(visualOf({ ...base, state: 'waiting', waitKind: 'approval', conv: conv({}) }, now).place, 'approval');
  assert.equal(visualOf({ ...base, state: 'error', errorClass: 'failed', conv: conv({ active: false, until: now + 1000 }) }, now).place, 'desk');
  assert.equal(visualOf({ ...base, state: 'idle', runId: null, filedUntil: now + 5000 }, now).place, 'library');
  assert.equal(visualOf({ ...base, state: 'idle', runId: null, filedUntil: now - 1 }, now).place, 'free');
});
