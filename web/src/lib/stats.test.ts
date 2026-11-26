import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePeriod, loadPeriod, savePeriod, formatRate, completeDays, niceScale, formatDayShort, formatDayLong, labelIndices, errorRows, hourSeries, costOrNd, zeroDay } from './stats.ts';

const norm = (s: string) => s.replace(/[  ]/g, ' ');

test('période : validation et stockage tolérant', () => {
  assert.equal(parsePeriod('7'), 7); assert.equal(parsePeriod('90'), 90);
  assert.equal(parsePeriod('15'), 30); assert.equal(parsePeriod(null), 30); assert.equal(parsePeriod('abc'), 30);
  const mem = new Map<string, string>();
  const ok = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
  savePeriod(90, ok); assert.equal(loadPeriod(ok), 90);
  const broken = { getItem: () => { throw new Error('refusé'); }, setItem: () => { throw new Error('refusé'); } };
  assert.equal(loadPeriod(broken), 30); savePeriod(7, broken);
});

test('formatRate', () => {
  assert.equal(formatRate(null), '—');
  assert.equal(norm(formatRate(1)), '100 %');
  assert.equal(norm(formatRate(0.8333)), '83,3 %');
  assert.equal(norm(formatRate(0)), '0 %');
});

test('completeDays : zéros inclus, ordre croissant, bornes', () => {
  const d = (date: string, runs: number) => ({ ...zeroDay(date), runs });
  const out = completeDays([d('2026-11-22', 2), d('2026-11-24', 5)], 5);
  assert.deepEqual(out.map((x) => x.date), ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24']);
  assert.deepEqual(out.map((x) => x.runs), [0, 0, 2, 0, 5]);
  assert.equal(completeDays([], 7).length, 0);
  // passage de mois et d'année
  assert.deepEqual(completeDays([d('2027-01-02', 1)], 3).map((x) => x.date), ['2026-12-31', '2027-01-01', '2027-01-02']);
  // la plage réelle dépasse la période demandée : on ne tronque pas
  assert.equal(completeDays([d('2026-11-01', 1), d('2026-11-30', 1)], 7).length, 30);
});

test('niceScale', () => {
  assert.deepEqual(niceScale(0), { max: 4, ticks: [0, 1, 2, 3, 4] });
  assert.deepEqual(niceScale(7), { max: 8, ticks: [0, 2, 4, 6, 8] });
  assert.deepEqual(niceScale(10), { max: 10, ticks: [0, 2.5, 5, 7.5, 10] });
  assert.deepEqual(niceScale(93), { max: 100, ticks: [0, 25, 50, 75, 100] });
  assert.deepEqual(niceScale(1), { max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] });
  const s = niceScale(123456);
  assert.ok(s.max >= 123456 && s.ticks[0] === 0 && s.ticks[s.ticks.length - 1] === s.max);
});

test('libellés de jours et axes', () => {
  assert.equal(formatDayShort('2026-11-24'), '24/11');
  assert.equal(formatDayLong('2026-11-24'), 'mardi 24 novembre');
  assert.equal(formatDayLong('2026-12-01'), 'mardi 1er décembre');
  assert.deepEqual(labelIndices(7, 10), [0, 1, 2, 3, 4, 5, 6]);
  const idx = labelIndices(30, 8);
  assert.ok(idx.length <= 8 && idx[idx.length - 1] === 29);
  assert.deepEqual(labelIndices(0, 5), []);
});

test('errorRows, hourSeries, costOrNd', () => {
  const rows = errorRows([{ error_class: 'timeout', count: 1 }, { error_class: 'rate_limited', count: 3 }]);
  assert.equal(rows[0].label, 'Limite atteinte'); assert.equal(rows[0].share, 0.75);
  assert.deepEqual(errorRows([]), []);
  const h = hourSeries([0, 4, 2]);
  assert.equal(h.length, 24); assert.equal(h[1].level, 1); assert.equal(h[2].level, 0.5); assert.equal(h[23].count, 0);
  assert.equal(hourSeries([]).every((x) => x.level === 0), true);
  assert.equal(costOrNd('codex', 0), null); assert.equal(costOrNd('claude', 0), 0); assert.equal(costOrNd('claude', 1.2), 1.2);
});
