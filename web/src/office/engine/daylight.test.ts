import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daylightAt, parisTime, sunTimes } from './daylight.ts';

test('heure de Paris : heure d\'hiver (UTC+1) et d\'été (UTC+2)', () => {
  const w = parisTime(Date.parse('2026-11-25T11:30:00Z'));
  assert.deepEqual([w.hour, w.minute, w.offsetH, w.weekday], [12, 30, 1, 3]);
  const s = parisTime(Date.parse('2026-07-14T20:05:00Z'));
  assert.deepEqual([s.hour, s.minute, s.offsetH], [22, 5, 2]);
});

test('lumière du jour : nuit, crépuscule, plein jour ; journées plus longues en été', () => {
  assert.equal(daylightAt(parisTime(Date.parse('2026-11-25T12:00:00Z'))), 1);
  assert.equal(daylightAt(parisTime(Date.parse('2026-11-25T22:00:00Z'))), 0);
  const dusk = daylightAt(parisTime(Date.parse('2026-11-25T16:00:00Z')));
  assert.ok(dusk > 0 && dusk < 1, `crépuscule ${dusk}`);
  const win = sunTimes(330, 1), sum = sunTimes(172, 2);
  assert.ok(sum.set - sum.rise > win.set - win.rise + 6);
  assert.ok(win.rise > 7.5 && win.rise < 9 && win.set > 16.3 && win.set < 17.6, 'fin novembre : ≈ 8 h 15 – 17 h');
});
