import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCron, describeCron, nextRuns, isValidTimezone, wallToInstant } from './cron.ts';

function ok(expr: string) {
  const r = parseCron(expr);
  assert.ok(r.ok, `attendu valide : ${expr}`);
  return r.ok ? r.cron : (null as never);
}

test('parseCron : validité', () => {
  assert.ok(parseCron('*/15 * * * *').ok);
  assert.ok(parseCron('0 9 * * 1-5').ok);
  assert.ok(parseCron('0,30 8-18/2 * jan,jul mon-fri').ok);
  assert.ok(parseCron('0 0 * * 7').ok);
});

test('parseCron : erreurs lisibles', () => {
  const a = parseCron('* * * *');
  assert.ok(!a.ok && /5 champs attendus.*4 reçus/.test(a.errors[0]));
  const b = parseCron('61 * * * *');
  assert.ok(!b.ok && /minute.*61.*0–59/.test(b.errors[0]));
  const c = parseCron('0 25 * * *');
  assert.ok(!c.ok && /heure/.test(c.errors[0]));
  const d = parseCron('*/0 * * * *');
  assert.ok(!d.ok);
  const e = parseCron('5-1 * * * *');
  assert.ok(!e.ok && /inversé/.test(e.errors[0]));
  const f = parseCron('a * * * *');
  assert.ok(!f.ok);
  const g = parseCron('1,,2 * * * *');
  assert.ok(!g.ok);
  assert.ok(!parseCron('').ok);
});

test('parseCron : valeurs', () => {
  assert.deepEqual(ok('*/15 * * * *').minute.values, [0, 15, 30, 45]);
  assert.equal(ok('*/15 * * * *').minute.step, 15);
  assert.deepEqual(ok('0 0 * * 7').dow.values, [0]);
  assert.deepEqual(ok('0 8-12/2 * * *').hour.values, [8, 10, 12]);
  assert.deepEqual(ok('0 0 * * sun,sat').dow.values, [0, 6]);
  assert.deepEqual(ok('0 0 * * *').dow.values, [0, 1, 2, 3, 4, 5, 6]);
});

test('describeCron', () => {
  assert.equal(describeCron(ok('* * * * *')), 'Chaque minute');
  assert.equal(describeCron(ok('*/15 * * * *')), 'Toutes les 15 minutes');
  assert.equal(describeCron(ok('0 * * * *')), 'Chaque heure pile');
  assert.equal(describeCron(ok('30 * * * *')), 'Chaque heure, à la minute 30');
  assert.equal(describeCron(ok('0 8 * * *')), 'Tous les jours à 08:00');
  assert.equal(describeCron(ok('0 9 * * 1-5')), 'Du lundi au vendredi à 09:00');
  assert.equal(describeCron(ok('0 8 * * 1')), 'Le lundi à 08:00');
  assert.equal(describeCron(ok('0 7 1 * *')), 'Le 1er du mois à 07:00');
  assert.equal(describeCron(ok('30 8,12,18 * * *')), 'Tous les jours à 08:30, 12:30 et 18:30');
  assert.equal(describeCron(ok('*/10 8-18 * * 1-5')), 'Toutes les 10 minutes, de 8 h à 18 h, du lundi au vendredi');
  assert.equal(describeCron(ok('0 0 * * 0,6')), 'Le week-end à 00:00');
  assert.equal(describeCron(ok('0 6 * 6-8 *')), 'Tous les jours de juin à août à 06:00');
});

const T = (iso: string) => Date.parse(iso);

test('nextRuns : UTC', () => {
  const r = nextRuns(ok('*/15 * * * *'), T('2026-11-24T10:07:00Z'), 'UTC', 3);
  assert.deepEqual(r.map((x) => new Date(x).toISOString()), ['2026-11-24T10:15:00.000Z', '2026-11-24T10:30:00.000Z', '2026-11-24T10:45:00.000Z']);
});

test('nextRuns : strictement après maintenant', () => {
  const r = nextRuns(ok('0 9 * * *'), T('2026-11-24T09:00:00Z'), 'UTC', 2);
  assert.deepEqual(r.map((x) => new Date(x).toISOString()), ['2026-11-25T09:00:00.000Z', '2026-11-26T09:00:00.000Z']);
});

test('nextRuns : fuseau Europe/Paris (hiver et été)', () => {
  const w = nextRuns(ok('0 9 * * *'), T('2026-11-24T10:00:00Z'), 'Europe/Paris', 1);
  assert.equal(new Date(w[0]).toISOString(), '2026-11-25T08:00:00.000Z'); // UTC+1
  const s = nextRuns(ok('0 9 * * *'), T('2026-07-01T10:00:00Z'), 'Europe/Paris', 1);
  assert.equal(new Date(s[0]).toISOString(), '2026-07-02T07:00:00.000Z'); // UTC+2
});

test('nextRuns : jours ouvrés', () => {
  // 2026-11-27 est un vendredi ; la suivante doit être le lundi 30.
  const r = nextRuns(ok('0 9 * * 1-5'), T('2026-11-27T12:00:00Z'), 'UTC', 2);
  assert.deepEqual(r.map((x) => new Date(x).toISOString()), ['2026-11-30T09:00:00.000Z', '2026-12-01T09:00:00.000Z']);
});

test('nextRuns : jour du mois OU jour de semaine quand les deux sont restreints', () => {
  // Le 1er OU les lundis, depuis le mardi 2026-11-24 : lundi 30 nov, puis 1er déc (mardi).
  const r = nextRuns(ok('0 0 1 * 1'), T('2026-11-24T12:00:00Z'), 'UTC', 2);
  assert.deepEqual(r.map((x) => new Date(x).toISOString()), ['2026-11-30T00:00:00.000Z', '2026-12-01T00:00:00.000Z']);
});

test('nextRuns : heure inexistante lors du passage à l\'heure d\'été est ignorée', () => {
  // 2026-03-29 02:30 n'existe pas à Paris.
  assert.equal(wallToInstant('Europe/Paris', { y: 2026, mo: 3, d: 29, h: 2, mi: 30 }), null);
  const r = nextRuns(ok('30 2 * * *'), T('2026-03-28T12:00:00Z'), 'Europe/Paris', 2);
  assert.equal(new Date(r[0]).toISOString(), '2026-03-30T00:30:00.000Z');
});

test('nextRuns : 29 février', () => {
  const r = nextRuns(ok('0 0 29 2 *'), T('2026-03-01T00:00:00Z'), 'UTC', 1);
  assert.equal(new Date(r[0]).toISOString(), '2028-02-29T00:00:00.000Z');
});

test('fuseaux', () => {
  assert.ok(isValidTimezone('Europe/Paris'));
  assert.ok(!isValidTimezone('Mars/Olympus'));
  assert.deepEqual(nextRuns(ok('* * * * *'), 0, 'Mars/Olympus', 1), []);
});
