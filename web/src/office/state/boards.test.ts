import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countdown, hhmm, whenLabel, limitAlert, limitViews, planningSummary, windowLabel } from './boards.ts';
import type { OfficeBoards, OfficePlanning, PlanningItem } from '../../api/types.ts';
import { EMPTY_STAFF_INFO, receptionFacts, techAlert, techRemarks } from '../engine/staff.ts';

const NOW = Date.parse('2026-11-25T12:00:00Z'); // 13 h à Paris
const item = (o: Partial<PlanningItem>): PlanningItem => ({ schedule_id: 's', name: 'Veille', agent_id: 'a', agent_name: 'Atlas', agent_enabled: true, at: '2026-11-25T07:00:00Z', status: 'succeeded', run_id: 'r', ...o });
const plan = (items: PlanningItem[], o: Partial<OfficePlanning> = {}): OfficePlanning => ({ date: '2026-11-25', timezone: 'Europe/Paris', paused: false, items, truncated: false, next_after: null, ...o });

test('libellés : heure de Paris, compte à rebours, fenêtres', () => {
  assert.equal(hhmm('2026-11-25T13:30:00Z'), '14:30');
  assert.equal(hhmm('2026-07-01T13:30:00Z'), '15:30'); // heure d'été
  assert.equal(countdown('2026-11-25T12:25:00Z', NOW), '25 min');
  assert.equal(countdown('2026-11-25T14:05:00Z', NOW), '2 h 05');
  assert.equal(countdown('2026-11-25T12:00:10Z', NOW), 'maintenant');
  assert.equal(countdown('2026-11-29T12:00:00Z', NOW), '4 j');
  assert.equal(whenLabel('2026-11-25T17:46:00Z', NOW), '18:46');
  assert.equal(whenLabel('2026-11-26T10:01:00Z', NOW), 'demain 11:01');
  assert.match(whenLabel('2026-11-28T10:01:00Z', NOW), /^sam\.? 28\/11 11:01$/);
  assert.equal(windowLabel('five_hour'), '5 h');
  assert.equal(windowLabel('seven_day'), '7 jours');
  assert.equal(windowLabel('60_min'), '1 h');
  assert.equal(windowLabel('1440_min'), '1 j');
});

test('planning : compte les missions réelles, prochaines dans l’ordre, « ensuite » seulement si plus rien aujourd’hui', () => {
  const s = planningSummary(plan([item({}), item({ status: 'failed', at: '2026-11-25T08:00:00Z' }), item({ status: 'missed', run_id: null, at: '2026-11-25T09:00:00Z' }),
    item({ status: 'running', at: '2026-11-25T11:58:00Z' }), item({ status: 'upcoming', run_id: null, at: '2026-11-25T19:00:00Z' })]))!;
  assert.deepEqual([s.total, s.done, s.failed, s.missed], [5, 1, 1, 1]);
  assert.deepEqual(s.upcoming.map((i) => i.status), ['running', 'upcoming']);
  assert.equal(s.later, null);
  const after = { schedule_id: 's', name: 'Veille', agent_id: 'a', agent_name: 'Atlas', agent_enabled: true, at: '2026-11-26T07:00:00Z' };
  assert.equal(planningSummary(plan([item({})], { next_after: after }))!.later?.at, after.at);
  assert.equal(planningSummary(null), null);
});

const limits = (o: Partial<OfficeBoards['limits']>): OfficeBoards['limits'] => ({ claude: [], codex: [], ...o });

test('limites : une fenêtre dont la remise à zéro est passée n’affiche plus de pourcentage', () => {
  const v = limitViews(limits({ codex: [
    { window: 'five_hour', level: 'limited', used_percent: 100, resets_at: '2026-11-25T11:00:00Z', updated_at: null },
    { window: 'seven_day', level: 'warning', used_percent: 86, resets_at: '2026-11-28T10:00:00Z', updated_at: null },
  ] }), NOW);
  assert.deepEqual(v.codex.map((l) => [l.window, l.level, l.pct, l.reset]), [['five_hour', 'ok', null, true], ['seven_day', 'warning', 86, false]]);
});

test('limites : alerte la plus grave, seuil 80 % même si le client ne l’a pas signalée', () => {
  assert.equal(limitAlert(limits({ codex: [{ window: 'five_hour', level: 'ok', used_percent: 40, resets_at: '2026-11-25T15:00:00Z', updated_at: null }] }), NOW), null);
  const a = limitAlert(limits({
    codex: [{ window: 'seven_day', level: 'ok', used_percent: 82, resets_at: '2026-11-28T10:00:00Z', updated_at: null }],
    claude: [{ window: 'five_hour', level: 'limited', used_percent: null, resets_at: '2026-11-25T15:00:00Z', updated_at: null }],
  }), NOW)!;
  assert.equal(a.provider, 'claude'); assert.equal(a.level, 'limited');
  const b = limitAlert(limits({ codex: [{ window: 'seven_day', level: 'ok', used_percent: 82, resets_at: '2026-11-28T10:00:00Z', updated_at: null }] }), NOW)!;
  assert.equal(b.level, 'warning'); assert.equal(b.pct, 82);
  assert.equal(limitAlert(null, NOW), null);
});

test('personnel : planning et limites réels dans ce que disent l’accueil et le technicien', () => {
  const info = { ...EMPTY_STAFF_INFO, loaded: true, today: { total: 4, done: 2, failed: 1, paused: false }, next: { agent: 'Atlas', at: '2026-11-25T12:25:00Z' } };
  const f = receptionFacts(info, { hour: 13, minute: 0, weekday: 3, month: 11, daylight: 1 }, NOW);
  assert.ok(f.includes('Aujourd’hui : 4 missions prévues, 2 faites.'), f.join(' | '));
  assert.ok(f.includes('Prochaine mission à 13 h 25 : Atlas.'), f.join(' | '));
  assert.ok(f.includes('1 mission planifiée en échec.') && f.includes('Départ de la prochaine mission dans 25 min.'), f.join(' | '));
  for (const l of f) assert.ok(l.length <= 44, `bulle trop longue : ${l}`);
  const p = receptionFacts({ ...info, today: { total: 0, done: 0, failed: 0, paused: true }, next: null }, { hour: 13, minute: 0, weekday: 3, month: 11, daylight: 1 }, NOW);
  assert.ok(p.includes('Arrêt d’urgence : planning suspendu.'));
  assert.ok(p.includes('Aucune mission planifiée aujourd’hui.'));
  const t = techAlert({ ...EMPTY_STAFF_INFO, loaded: true, limit: { provider: 'codex', label: '7 jours', level: 'warning', pct: 86, resetsAt: '2026-11-28T10:00:00Z' } });
  assert.deepEqual(t, { kind: 'limit', text: 'Codex 7 jours à 86 %, je surveille.' });
  const z = techAlert({ ...EMPTY_STAFF_INFO, loaded: true, limit: { provider: 'claude', label: '5 h', level: 'limited', pct: null, resetsAt: '2026-11-25T15:00:00Z' } }, NOW);
  assert.equal(z?.text, 'Claude 5 h bloqué, retour à 16 h 00.');
  const z2 = techAlert({ ...EMPTY_STAFF_INFO, loaded: true, limit: { provider: 'claude', label: '7 jours', level: 'limited', pct: null, resetsAt: '2026-11-26T10:01:00Z' } }, NOW);
  assert.equal(z2?.text, 'Claude 7 jours bloqué, retour demain 11 h 01.');
  // la mémoire passe avant la limite d'usage (plus grave pour le serveur)
  assert.equal(techAlert({ ...EMPTY_STAFF_INFO, loaded: true, memPct: 95, limit: { provider: 'codex', label: '5 h', level: 'limited', pct: 100, resetsAt: null } })?.kind, 'mem');
  assert.ok(techRemarks({ ...EMPTY_STAFF_INFO, loaded: true, usage: [{ provider: 'codex', label: '5 h', pct: 3 }] }).includes('Codex : 3 % de la limite 5 h.'));
});
