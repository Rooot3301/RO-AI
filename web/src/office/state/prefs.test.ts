import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREFS, parsePrefs } from './prefs.ts';

test('préférences : défauts (éclairage automatique, vie sociale et animations actives)', () => {
  const p = parsePrefs(null, true, false);
  assert.deepEqual(p, { ...DEFAULT_PREFS, listOpen: true });
  assert.equal(p.theme, 'auto');
  assert.equal(p.social, true);
  assert.equal(p.decor, true);
});

test('préférences : mouvement réduit => vie sociale et animations désactivées par défaut, choix enregistré prioritaire', () => {
  assert.equal(parsePrefs(null, true, true).social, false);
  assert.equal(parsePrefs(null, true, true).decor, false);
  assert.equal(parsePrefs(JSON.stringify({ social: true, decor: true }), true, true).social, true);
});

test('préférences : options désactivables et valeurs invalides ramenées au défaut', () => {
  const p = parsePrefs(JSON.stringify({ theme: 'night', social: false, decor: false, zoomDelta: 99, showNames: 'oui' }));
  assert.deepEqual([p.theme, p.social, p.decor, p.zoomDelta, p.showNames], ['night', false, false, 6, false]);
  assert.equal(parsePrefs('{pas du json').theme, 'auto');
  assert.equal(parsePrefs(JSON.stringify({ theme: 'disco' })).theme, 'auto');
});
