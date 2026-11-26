import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduceControl, withStopPrefix, describeCancelled, launchErrorMessage, NOT_PAUSED, STOP_BLOCKED_TEXT } from './control.ts';

const ts = '2026-11-24T10:00:00Z';
test('reduceControl : arrêt puis reprise', () => {
  const stopped = reduceControl(NOT_PAUSED, { type: 'system.emergency_stop', ts, payload: { reason: 'test', cancelled: 3 } });
  assert.deepEqual(stopped, { paused: true, since: ts, reason: 'test', cancelled: 3 });
  const resumed = reduceControl(stopped, { type: 'system.resumed', ts, payload: {} });
  assert.deepEqual(resumed, NOT_PAUSED);
});

test('reduceControl : charges inattendues et autres événements', () => {
  const s = reduceControl(null, { type: 'system.emergency_stop', ts, payload: { reason: '  ', cancelled: 'x' as unknown as number } });
  assert.deepEqual(s, { paused: true, since: ts, reason: null, cancelled: null });
  assert.equal(reduceControl(s, { type: 'run.started', ts, payload: {} }), s);
  assert.equal(reduceControl(null, { type: 'run.started', ts, payload: {} }), null);
});

test('withStopPrefix : idempotent', () => {
  assert.equal(withStopPrefix('Agents · RO·AI', true), '[ARRÊT] Agents · RO·AI');
  assert.equal(withStopPrefix('[ARRÊT] Agents · RO·AI', true), '[ARRÊT] Agents · RO·AI');
  assert.equal(withStopPrefix('[ARRÊT] Agents · RO·AI', false), 'Agents · RO·AI');
  assert.equal(withStopPrefix('Agents', false), 'Agents');
});

test('describeCancelled et launchErrorMessage', () => {
  assert.equal(describeCancelled(null), 'nombre d’exécutions annulées inconnu');
  assert.equal(describeCancelled(0), 'aucune exécution annulée');
  assert.equal(describeCancelled(1), '1 exécution annulée');
  assert.equal(describeCancelled(4), '4 exécutions annulées');
  assert.equal(launchErrorMessage(409, "Arrêt d'urgence actif : aucun nouveau lancement n'est possible."), STOP_BLOCKED_TEXT);
  assert.equal(launchErrorMessage(409, 'autre conflit'), 'autre conflit');
  assert.equal(launchErrorMessage(500, "Arrêt d'urgence"), "Arrêt d'urgence");
});
