import { test } from 'node:test';
import assert from 'node:assert/strict';
import { easter, frenchHoliday, officeCalendar, seasonOf } from './calendar.ts';

const at = (iso: string) => Date.parse(iso);

test('Pâques et fériés mobiles (calendrier grégorien)', () => {
  assert.deepEqual(easter(2026), { m: 4, d: 5 });
  assert.deepEqual(easter(2027), { m: 3, d: 28 });
  assert.equal(frenchHoliday(2026, 4, 6), 'Lundi de Pâques');
  assert.equal(frenchHoliday(2026, 5, 14), 'Ascension');
  assert.equal(frenchHoliday(2026, 5, 25), 'Lundi de Pentecôte');
  assert.equal(frenchHoliday(2026, 7, 14), 'Fête nationale');
  assert.equal(frenchHoliday(2026, 11, 25), null);
});

test('saisons, fêtes et jours calmes à l’heure de Paris', () => {
  assert.equal(seasonOf(11, 25), 'autumn'); assert.equal(seasonOf(12, 21), 'winter'); assert.equal(seasonOf(3, 20), 'spring'); assert.equal(seasonOf(7, 1), 'summer');
  const wed = officeCalendar(at('2026-11-25T10:00:00Z'));
  assert.deepEqual(wed, { season: 'autumn', festive: null, calm: false, holiday: null });
  const sat = officeCalendar(at('2026-11-28T10:00:00Z'));
  assert.equal(sat.calm, true); assert.equal(sat.holiday, null);
  const xmas = officeCalendar(at('2026-12-25T10:00:00Z'));
  assert.equal(xmas.festive, 'xmas'); assert.equal(xmas.holiday, 'Noël'); assert.equal(xmas.calm, true);
  assert.equal(officeCalendar(at('2027-01-06T10:00:00Z')).festive, 'xmas');
  assert.equal(officeCalendar(at('2027-01-07T10:00:00Z')).festive, null);
  assert.equal(officeCalendar(at('2026-07-14T10:00:00Z')).festive, 'national');
  // 31 décembre 23 h 30 UTC = 1er janvier à Paris : férié
  assert.equal(officeCalendar(at('2026-12-31T23:30:00Z')).holiday, 'Jour de l’an');
});
