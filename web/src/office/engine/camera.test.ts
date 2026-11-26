import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitScale, clampCenter, viewFor, stepCamera, zoomFromDelta, deltaFromZoom, toWorldX } from './camera.ts';

test('ajustement fractionnaire : la carte remplit la zone (dimension limitante)', () => {
  const s = fitScale(650, 330, 1000, 800);
  assert.ok(Math.abs(650 * s - 1000 * 0.95) < 1e-6, 'largeur remplie à la marge près');
  assert.ok(330 * s < 800);
  assert.ok(s > 1.4 && !Number.isInteger(s));
});

test('centre : monde plus petit que la zone -> centré ; plus grand -> borné avec marge', () => {
  assert.equal(clampCenter(5, 100, 400, 2), 50);
  assert.equal(clampCenter(-1000, 1000, 400, 1), 200 - 48);
  assert.equal(clampCenter(5000, 1000, 400, 1), 1000 - 200 + 48);
});

test('vue : le centre de la caméra est au centre de la zone', () => {
  const v = viewFor({ zoom: 1, cx: 325, cy: 165 }, 650, 330, 1000, 800, 2);
  assert.ok(Math.abs(v.ox + 325 * v.scale - 500) < 1e-6 && Math.abs(v.oy + 165 * v.scale - 400) < 1e-6);
  assert.equal(v.dpr, 2);
  assert.equal(Math.round(toWorldX(v, v.ox + 100 * v.scale)), 100);
});

test('zoom : pas multiplicatif borné, aller-retour', () => {
  assert.ok(Math.abs(zoomFromDelta(2) - 1.5625) < 1e-9);
  assert.equal(deltaFromZoom(zoomFromDelta(4)), 4);
  assert.equal(zoomFromDelta(99), zoomFromDelta(6));
});

test('lissage : converge vers la cible et s\'arrête', () => {
  const cur = { zoom: 1, cx: 0, cy: 0 }, tgt = { zoom: 2, cx: 100, cy: 50 };
  let n = 0;
  while (stepCamera(cur, tgt, 1 / 60) && n < 600) n++;
  assert.ok(n > 10 && n < 300);
  assert.deepEqual(cur, tgt);
  assert.equal(stepCamera(cur, tgt, 1 / 60), false);
});
