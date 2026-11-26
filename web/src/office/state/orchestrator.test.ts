import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveOrchVisual, planFlights, FLIGHT_SPACING_MS, MAX_LAG_MS } from './orchestrator.ts';
import { initialModel, reduceOffice } from './model.ts';
import type { OfficeAgentModel, OrchEvent, OfficeModel } from './model.ts';
import type { RoEvent } from '../../api/types.ts';

const NOW = 1_000_000;
const oe = (seq: number, kind: OrchEvent['kind'], o: Partial<OrchEvent> = {}): OrchEvent =>
  ({ seq, ts: '2026-11-24T10:00:00Z', type: 'x', kind, agentId: 'ag_a', runId: 'r', receivedAt: NOW, fresh: true, detail: '', ...o });
const ag = (id: string, o: Partial<OfficeAgentModel> = {}): OfficeAgentModel => ({
  id, name: id, department: 'Dev', sprite: 0, state: 'idle', waitKind: null, activity: null, toolKind: null, runId: null, errorClass: null, since: '', effects: [],
  origin: { seq: 1, type: 'snapshot', run_id: null, ts: '' }, ...o,
});
const visual = (events: OrchEvent[], agents: OfficeAgentModel[] = [], now = NOW + 100, conn: 'live' | 'reconnecting' = 'live', providers = {}, flying = false) =>
  deriveOrchVisual(events, agents, providers, conn, now, flying);

test('lancements simultanés : fiches espacées de 300 ms', () => {
  const evs = [oe(1, 'dispatch'), oe(2, 'dispatch', { agentId: 'b' }), oe(3, 'dispatch', { agentId: 'c' })];
  const { added } = planFlights(evs, { lastSeq: 0, lastStart: 0 });
  assert.deepEqual(added.map((f) => f.start - NOW), [0, FLIGHT_SPACING_MS, FLIGHT_SPACING_MS * 2]);
});

test('animations en retard sautées au-delà du seuil ; rejeux ignorés ; seq déjà traités ignorés', () => {
  const many = Array.from({ length: 20 }, (_, i) => oe(i + 1, 'dispatch', { agentId: `a${i}` }));
  const { added, state } = planFlights(many, { lastSeq: 0, lastStart: 0 });
  assert.ok(added.length > 0 && added.length < 20);
  assert.ok(added.every((f) => f.start - NOW <= MAX_LAG_MS));
  assert.equal(state.lastSeq, 20);
  assert.equal(planFlights(many, state).added.length, 0);
  assert.equal(planFlights([oe(1, 'dispatch', { fresh: false })], { lastSeq: 0, lastStart: 0 }).added.length, 0);
});

test('rejet : fiche froissée ; queued / approval ne génèrent pas de vol', () => {
  const { added } = planFlights([oe(1, 'rejected'), oe(2, 'queued'), oe(3, 'approval')], { lastSeq: 0, lastStart: 0 });
  assert.deepEqual(added.map((f) => f.kind), ['reject']);
});

test('au repos sans événement : surveille ses écrans (ambiance) ; pile et approbations dérivées des agents', () => {
  const v = visual([], [ag('a'), ag('b', { state: 'waiting', waitKind: 'queued' }), ag('c', { state: 'waiting', waitKind: 'approval' }), ag('d', { state: 'working' })]);
  assert.equal(v.pose, 'clipboard');
  assert.deepEqual([v.queueDepth, v.approvals, v.running], [2, 1, 1]);
  const idle = visual([], [ag('a')]);
  assert.deepEqual([idle.pose, idle.ambient], ['watch', true]);
});

test('événement récent : plus d\'ambiance ; run.queued : prend une fiche (brièvement)', () => {
  assert.equal(visual([oe(1, 'queued')]).pose, 'pick');
  assert.equal(visual([oe(1, 'queued')]).ambient, false);
  assert.equal(visual([oe(1, 'queued')], [], NOW + 5000).pose, 'watch');
});

test('schedule.fired : sonnerie et « go » ; cancelled : stop ; failed : regarde l\'agent ; vol en cours : pointe', () => {
  assert.deepEqual([visual([oe(1, 'schedule')]).bell, visual([oe(1, 'schedule')]).pose], [true, 'go']);
  assert.deepEqual([visual([oe(1, 'cancelled')]).stop, visual([oe(1, 'cancelled')]).pose], [true, 'stop']);
  const f = visual([oe(1, 'failed', { agentId: 'ag_x' })]);
  assert.deepEqual([f.pose, f.lookAgentId, f.alert], ['look', 'ag_x', true]);
  assert.equal(visual([], [], NOW, 'live', {}, true).pose, 'point');
  assert.equal(visual([oe(1, 'failed')], [], NOW + 9000).alert, false);
});

test('sablier : limitation réelle seulement ; reconnexion et resync ; fournisseur dégradé', () => {
  assert.equal(visual([oe(1, 'rate_limit', { detail: 'rejected (five_hour)' })]).hourglass, true);
  assert.equal(visual([oe(1, 'rate_limit', { detail: 'allowed' })]).hourglass, false);
  assert.equal(visual([], [], NOW, 'reconnecting').resync, true);
  assert.equal(visual([oe(1, 'resync')]).resync, true);
  const v = visual([], [], NOW, 'live', { claude: 'logged_out', codex: 'logged_in', x: 'unknown' });
  assert.deepEqual(v.providerAlert, { claude: true, codex: false, x: false });
});

test('événements rejoués (non frais) : aucune animation', () => {
  const v = visual([oe(1, 'schedule', { fresh: false }), oe(2, 'cancelled', { fresh: false })]);
  assert.deepEqual([v.bell, v.stop, v.pose], [false, false, 'watch']);
});

const ev = (seq: number, type: string, agent_id: string | null, payload: Record<string, unknown> = {}): RoEvent =>
  ({ seq, ts: '2026-11-24T10:00:01Z', schema: 1, domain: 'perso', type, agent_id, run_id: 'r1', payload });

test('reducer : les événements d\'orchestration sont journalisés (y compris sans agent), bornés, avec fraîcheur', () => {
  const NOWMS = Date.parse('2026-11-24T10:00:01Z');
  let m: OfficeModel = reduceOffice(initialModel, { type: 'snapshot', snapshot: { seq: 1, now: '2026-11-24T10:00:00Z', departments: [], agents: [] }, nowMs: NOWMS - 1000 });
  m = reduceOffice(m, { type: 'event', event: ev(2, 'schedule.fired', null, { schedule_id: 's', name: 'Veille' }), nowMs: NOWMS });
  m = reduceOffice(m, { type: 'event', event: ev(3, 'provider.auth', null, { provider: 'claude', state: 'logged_out' }), nowMs: NOWMS });
  m = reduceOffice(m, { type: 'event', event: ev(4, 'tool.call', 'ag', { kind: 'read' }), nowMs: NOWMS });
  assert.deepEqual(m.orch.events.map((e) => e.kind), ['schedule', 'provider']);
  assert.equal(m.orch.events[0].fresh, true);
  assert.equal(m.orch.providers.claude, 'logged_out');
  const old = reduceOffice(m, { type: 'event', event: { ...ev(5, 'run.queued', 'ag', {}), ts: '2026-11-24T09:00:00Z' }, nowMs: NOWMS });
  assert.equal(old.orch.events.at(-1)!.fresh, false);
  let big = m;
  for (let i = 0; i < 60; i++) big = reduceOffice(big, { type: 'event', event: ev(10 + i, 'run.queued', 'ag', {}), nowMs: NOWMS });
  assert.equal(big.orch.events.length, 40);
});

test('reducer : action providers (état initial depuis /api/providers)', () => {
  const m = reduceOffice(initialModel, { type: 'providers', providers: [
    { id: 'claude', name: 'Claude', installed: true, version: null, auth: { state: 'logged_in', method: null, plan: null, detail: '', expires_at: null }, limits: null, checked_at: '' },
    { id: 'codex', name: 'Codex', installed: false, version: null, auth: { state: 'unknown', method: null, plan: null, detail: '', expires_at: null }, limits: null, checked_at: '' },
  ] });
  assert.deepEqual(m.orch.providers, { claude: 'logged_in', codex: 'not_installed' });
});
