import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentHistory, buildStory, deskKit, latestReport, milestonesReached, moodOf, nextSchedule, plantStage, reportTitle, reportsLast7d, streaks, DAY_MS } from './story.ts';
import type { Run, Schedule, StatsAgent } from '../../api/types.ts';

const NOW = Date.parse('2026-11-24T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const run = (id: string, status: Run['status'], agoMs: number, o: Partial<Run> = {}): Run => ({
  id, agent_id: 'ag_a', agent_name: 'Alice', provider: 'claude', status, trigger: 'manual', prompt: '', session_id: null, created_at: iso(NOW - agoMs),
  started_at: iso(NOW - agoMs), finished_at: iso(NOW - agoMs + 1000), duration_ms: 1000, error_class: null, error_message: null, num_turns: 1,
  cost_usd_estimate: 0, usage: null, result_text: null, schedule_id: null, ...o,
});

test('jalons : 1re, 10, 50, 100… selon les réussites', () => {
  assert.deepEqual(milestonesReached(0), []);
  assert.deepEqual(milestonesReached(1), [1]);
  assert.deepEqual(milestonesReached(49), [1, 10]);
  assert.deepEqual(milestonesReached(100), [1, 10, 50, 100]);
});

test('paliers de la plante', () => {
  assert.deepEqual([0, 1, 9, 10, 49, 50, 99, 100, 5000].map(plantStage), [0, 1, 1, 2, 2, 3, 3, 4, 4]);
});

test('humeur : série de réussites = serein ; échec récent = soucieux ; sinon neutre ; annulées ignorées', () => {
  const R = (...s: Run['status'][]) => s.map((x, i) => run(`r${i}`, x, i * 1000));
  assert.equal(moodOf(R('succeeded', 'succeeded', 'succeeded')), 'serene');
  assert.equal(moodOf(R('failed', 'succeeded', 'succeeded', 'succeeded')), 'worried');
  assert.equal(moodOf(R('succeeded', 'failed', 'succeeded', 'succeeded')), 'worried');
  assert.equal(moodOf(R('succeeded', 'succeeded', 'failed')), 'neutral');
  assert.equal(moodOf(R('cancelled', 'succeeded', 'succeeded', 'succeeded')), 'serene');
  assert.equal(moodOf([]), 'neutral');
  assert.equal(moodOf(R('succeeded', 'succeeded', 'succeeded', 'succeeded', 'failed')), 'serene');
});

test('plus longue série et série en cours (chronologique)', () => {
  const c = (...s: Run['status'][]) => s.map((x, i) => run(`r${i}`, x, 0));
  assert.deepEqual(streaks(c('succeeded', 'succeeded', 'failed', 'succeeded', 'succeeded', 'succeeded', 'cancelled', 'succeeded')), { longest: 4, current: 4 });
  assert.deepEqual(streaks(c('succeeded', 'failed')), { longest: 1, current: 0 });
  assert.deepEqual(streaks([]), { longest: 0, current: 0 });
});

test('pile de rapports : réussites des 7 derniers jours uniquement', () => {
  const rs = [run('a', 'succeeded', DAY_MS), run('b', 'succeeded', 6 * DAY_MS), run('c', 'succeeded', 8 * DAY_MS), run('d', 'failed', DAY_MS), run('e', 'succeeded', -DAY_MS)];
  assert.equal(reportsLast7d(rs, NOW), 2);
});

test('prochaine planification : la plus proche, planifications actives seulement', () => {
  const s = (id: string, agent_id: string, next: string | null, enabled = true): Schedule => ({ id, agent_id, name: id, cron: '', timezone: 'UTC', prompt: '', enabled, last_run_at: null, next_run_at: next, last_run_id: null });
  const list = [s('s1', 'ag_a', '2026-11-25T08:00:00Z'), s('s2', 'ag_a', '2026-11-24T18:00:00Z'), s('s3', 'ag_a', '2026-11-24T13:00:00Z', false), s('s4', 'ag_b', '2026-11-24T12:30:00Z')];
  assert.deepEqual(nextSchedule('ag_a', list), { at: '2026-11-24T18:00:00Z', name: 's2' });
  assert.equal(nextSchedule('ag_z', list), null);
});

test('titre de rapport : première ligne utile, texte brut tronqué (jamais interprété)', () => {
  assert.equal(reportTitle('\n## **Bilan** du jour\nsuite'), 'Bilan du jour');
  assert.equal(reportTitle('<img src=x onerror=alert(1)> ok'), '<img src=x onerror=alert(1)> ok');
  assert.equal(reportTitle('a'.repeat(100), 10), 'aaaaaaaaa…');
  assert.equal(reportTitle('   \n  '), null);
  assert.equal(reportTitle(null), null);
});

test('tableau du département : dernier rapport réussi des agents du département', () => {
  const rs = [
    run('r1', 'succeeded', 1000, { agent_id: 'ag_b', agent_name: 'Bob', result_text: '# Plus récent' }),
    run('r2', 'failed', 500, { result_text: 'ignoré' }),
    run('r3', 'succeeded', 9000, { result_text: 'Ancien' }),
  ];
  assert.equal(latestReport(rs, new Set(['ag_a']))!.title, 'Ancien');
  assert.equal(latestReport(rs)!.runId, 'r1');
  assert.equal(latestReport([run('x', 'succeeded', 0, { result_text: null })]), null);
});

test('objets de bureau : choix stable par identifiant, bornes respectées', () => {
  assert.deepEqual(deskKit('ag_x'), deskKit('ag_x'));
  for (const id of ['ag_1', 'ag_2', 'ag_abc', 'zzz']) {
    const k = deskKit(id);
    assert.ok(k.mug >= 0 && k.mug < 6 && k.chair < 6 && k.plant < 4 && k.frame < 4 && k.gesture < 3 && k.offset >= 0 && k.offset < 1);
  }
  const variety = new Set(Array.from({ length: 30 }, (_, i) => deskKit(`ag_${i}`).chair));
  assert.ok(variety.size >= 4);
});

test('histoire assemblée : jalons, humeur, plante, pile, planification, tableaux', () => {
  const stats: StatsAgent[] = [{ agent_id: 'ag_a', name: 'Alice', provider: 'codex', runs: 60, succeeded: 55, failed: 5, success_rate: 55 / 60, duration_ms_avg: 1, input_tokens: 0, output_tokens: 0, cost_usd_estimate: 0 }];
  const runs = [run('r1', 'succeeded', DAY_MS, { result_text: 'Veille du jour' }), run('r2', 'succeeded', 2 * DAY_MS), run('r3', 'succeeded', 3 * DAY_MS)];
  const sch: Schedule[] = [{ id: 's', agent_id: 'ag_a', name: 'Quotidien', cron: '', timezone: 'UTC', prompt: '', enabled: true, last_run_at: null, next_run_at: '2026-11-25T08:00:00Z', last_run_id: null }];
  const st = buildStory([{ id: 'ag_a', department: 'Veille' }, { id: 'ag_b', department: 'Veille' }], stats, runs, sch, NOW);
  assert.deepEqual([st.agents.ag_a.provider, st.agents.ag_a.plant, st.agents.ag_a.milestones, st.agents.ag_a.mood, st.agents.ag_a.reports7d], ['codex', 3, [1, 10, 50], 'serene', 3]);
  assert.equal(st.agents.ag_a.next!.name, 'Quotidien');
  assert.deepEqual([st.agents.ag_b.total, st.agents.ag_b.plant, st.agents.ag_b.mood, st.agents.ag_b.provider], [0, 0, 'neutral', null]);
  assert.equal(st.boards.Veille!.title, 'Veille du jour');
});

test('inspecteur : histoire de l\'agent (première exécution, série, jalons, dernier rapport)', () => {
  const runs = [run('r3', 'succeeded', DAY_MS, { result_text: 'Dernier' }), run('r2', 'failed', 2 * DAY_MS), run('r1', 'succeeded', 3 * DAY_MS)];
  const stat: StatsAgent = { agent_id: 'ag_a', name: 'A', provider: 'claude', runs: 3, succeeded: 2, failed: 1, success_rate: 2 / 3, duration_ms_avg: 1, input_tokens: 0, output_tokens: 0, cost_usd_estimate: 0 };
  const h = agentHistory({ id: 'ag_a', created_at: '2026-01-01T00:00:00Z' }, runs, stat, []);
  assert.deepEqual([h.total, h.longestStreak, h.currentStreak, h.milestones, h.lastReport!.runId, h.next], [3, 1, 1, [1], 'r3', null]);
  assert.equal(h.firstRunAt, runs[2].started_at);
});
