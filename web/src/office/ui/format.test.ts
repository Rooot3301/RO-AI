import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAgo, formatDuration } from './format.ts';
import { parsePrefs, DEFAULT_PREFS } from '../state/prefs.ts';

test('durées lisibles', () => {
  assert.equal(formatDuration(4200), '4 s');
  assert.equal(formatDuration(125000), '2 min 05 s');
  assert.equal(formatDuration(3_900_000), '1 h 05 min');
  assert.equal(formatDuration(-1), '—');
  assert.equal(formatAgo(1000), 'à l’instant');
  assert.equal(formatAgo(90_000), 'il y a 1 min');
});

test('préférences : JSON invalide ou valeurs hors bornes -> défauts sûrs', () => {
  assert.deepEqual(parsePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs('{pas du json'), DEFAULT_PREFS);
  const p = parsePrefs(JSON.stringify({ theme: 'day', zoomDelta: 99, showNames: 'oui', listOpen: false }));
  assert.equal(p.theme, 'day');
  assert.equal(p.zoomDelta, 6);
  assert.equal(p.showNames, false, 'défaut : noms des agents au repos masqués');
  assert.equal(p.listOpen, false);
  assert.equal(parsePrefs(null, false).listOpen, false, 'liste repliée sous 1600 px');
  assert.equal(parsePrefs(JSON.stringify({ theme: 'day' }), false).listOpen, false);
  assert.equal(parsePrefs(JSON.stringify({ listOpen: true }), false).listOpen, true, 'la préférence enregistrée prime');
  assert.equal(parsePrefs(null, true).listOpen, true);
  assert.equal(parsePrefs(JSON.stringify({ theme: 'neon' })).theme, 'auto', 'défaut : éclairage automatique (heure de Paris)');
});
