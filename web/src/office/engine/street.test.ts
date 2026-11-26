import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StreetLife, spotSchedule, wantParked } from './street.ts';

const street = { sidewalk: 40, parking: 41, road: 42, far: 44, cross: { a: 10, b: 16 }, spots: [1, 4, 7, 17, 20, 23, 26, 29, 32, 35, 38, 41], lamps: [] };
const clock = (hour: number, calm = false, minute = 0) => ({ hour, minute, calm, day: 20261125 });

test('stationnement : arrivées le matin, départs le soir, peu de monde le week-end (déterministe)', () => {
  const n = street.spots.length;
  const count = (h: number, calm = false) => Array.from({ length: n }, (_, i) => wantParked(i, clock(h, calm))).filter(Boolean).length;
  assert.ok(count(11) > count(5), 'plus de voitures en journée que la nuit');
  assert.ok(count(11) > count(22));
  assert.ok(count(11, true) < count(11), 'week-end / férié : moins de voitures');
  for (let i = 0; i < n; i++) {
    const s = spotSchedule(i, clock(0));
    if (s && s.leave < 24 * 60) { assert.ok(s.arrive >= 7 * 60 && s.arrive <= 9 * 60 + 30); assert.ok(s.leave >= 16 * 60 + 30 && s.leave <= 19 * 60 + 30); }
  }
  assert.deepEqual(spotSchedule(3, clock(0)), spotSchedule(3, clock(14)), 'même journée : même horaire');
});

test('rue : premier affichage sans animation, puis arrivée animée ; rien ne bouge quand les animations sont coupées', () => {
  const s = new StreetLife(street, 50 * 16);
  s.update(0.1, clock(5), true);
  assert.ok(s.spots.every((p) => p.state === 'parked' || p.state === 'empty'));
  s.update(0.1, clock(10), true);
  assert.ok(s.spots.some((p) => p.state === 'arriving'), 'les voitures arrivent en roulant');
  for (let k = 0; k < 600; k++) s.update(0.05, clock(10), true);
  assert.ok(s.spots.every((p) => p.state !== 'arriving'), 'garées après la manœuvre');
  const off = new StreetLife(street, 50 * 16);
  for (let k = 0; k < 200; k++) off.update(0.1, clock(12), false);
  assert.equal(off.movers.length, 0); assert.equal(off.busy, false);
});
