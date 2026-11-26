import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEV_WAIT_BUBBLE, devActionText, devBubble, devCharId, devSessionOf, isDevId } from './devteam.ts';

const A = (kind: Parameters<typeof devActionText>[0]['kind'], target = '') => ({ at: '2026-11-26T06:00:00Z', kind, target });

test('identifiants des techniciens Claude Code', () => {
  assert.equal(devCharId('bf3ffcc2'), '__dev__:bf3ffcc2');
  assert.ok(isDevId('__dev__:x') && !isDevId('__tech__') && !isDevId(null));
  assert.equal(devSessionOf('__dev__:bf3ffcc2'), 'bf3ffcc2');
});

test('actions réelles en phrases courtes, bulles seulement pour ce qui compte (≤ 44 caractères)', () => {
  assert.equal(devActionText(A('write', 'plan.ts')), 'modifie plan.ts');
  assert.equal(devActionText(A('test', 'tests')), 'lance les tests');
  assert.equal(devActionText(A('exec', 'curl')), 'lance curl');
  assert.equal(devActionText(A('build', 'build de test')), 'construit une version de test');
  assert.equal(devBubble(A('read', 'plan.ts')), null);
  assert.equal(devBubble(A('deploy', 'mise en production')), 'Mise en production !');
  for (const b of [devBubble(A('write', 'un-nom-de-fichier-vraiment-tres-long-pour-la-bulle.tsx')), DEV_WAIT_BUBBLE, devBubble(A('commit'))]) assert.ok(b && b.length <= 44, b ?? '');
});
