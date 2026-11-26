import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialModel, reduceOffice, countByState, MAX_EFFECT_EVENT_AGE_MS } from './model.ts';
import type { OfficeModel } from './model.ts';
import type { OfficeSnapshot, RoEvent } from '../../api/types.ts';

const NOW = Date.parse('2026-11-24T10:00:00Z');
const snap = (over: Partial<OfficeSnapshot> = {}): OfficeSnapshot => ({
  seq: 10, now: '2026-11-24T10:00:00Z', departments: ['Dev', 'Veille'],
  agents: [
    { id: 'ag_b', name: 'Bob', department: 'Dev', avatar: { sprite: 2 }, state: 'idle', activity: null, tool_kind: null, run_id: null, error_class: null, since: '2026-11-24T09:00:00Z' },
    { id: 'ag_a', name: 'Alice', department: 'Veille', avatar: { sprite: 9 }, state: 'working', activity: 'Lit README.md', tool_kind: 'read', run_id: 'run_1', error_class: null, since: '2026-11-24T09:59:00Z' },
  ], ...over,
});
let seq = 100;
const ev = (type: string, agent_id: string | null, run_id: string | null, payload: Record<string, unknown> = {}, ts = '2026-11-24T10:00:01Z'): RoEvent =>
  ({ seq: ++seq, ts, schema: 1, domain: 'perso', type, agent_id, run_id, payload });
const load = (): OfficeModel => reduceOffice(initialModel, { type: 'snapshot', snapshot: snap(), nowMs: NOW });
const apply = (m: OfficeModel, e: RoEvent, nowMs = NOW + 1000) => reduceOffice(m, { type: 'event', event: e, nowMs });
const get = (m: OfficeModel, id: string) => m.agents.find((a) => a.id === id)!;

test('snapshot : agents triés par id, sprite borné, origine = snapshot', () => {
  const m = load();
  assert.deepEqual(m.agents.map((a) => a.id), ['ag_a', 'ag_b']);
  assert.equal(get(m, 'ag_a').sprite, 3);
  assert.equal(get(m, 'ag_a').origin.type, 'snapshot');
  assert.equal(get(m, 'ag_a').origin.run_id, 'run_1');
  assert.equal(m.loaded, true);
  assert.deepEqual(countByState(m.agents), { idle: 1, working: 1, waiting: 0, error: 0, disabled: 0 });
});

test('run.started puis tool.call : working, kind et activité, origine = événement', () => {
  let m = load();
  m = apply(m, ev('run.started', 'ag_b', 'run_9', { provider: 'claude', model: null }));
  assert.equal(get(m, 'ag_b').state, 'working');
  const e = ev('tool.call', 'ag_b', 'run_9', { tool_id: 't1', tool: 'Bash', kind: 'exec', summary: 'npm test' });
  m = apply(m, e);
  const a = get(m, 'ag_b');
  assert.equal(a.toolKind, 'exec');
  assert.equal(a.activity, 'npm test');
  assert.equal(a.origin.seq, e.seq);
  assert.equal(a.origin.run_id, 'run_9');
});

test('queued / awaiting_approval : waiting avec le bon type d\'attente', () => {
  let m = load();
  m = apply(m, ev('run.queued', 'ag_b', 'run_2', { trigger: 'manual', prompt_preview: 'x' }));
  assert.equal(get(m, 'ag_b').waitKind, 'queued');
  m = apply(m, ev('run.awaiting_approval', 'ag_b', 'run_2', { prompt_preview: 'x' }));
  assert.equal(get(m, 'ag_b').state, 'waiting');
  assert.equal(get(m, 'ag_b').waitKind, 'approval');
  m = apply(m, ev('run.approved', 'ag_b', 'run_2'));
  assert.equal(get(m, 'ag_b').waitKind, 'queued');
});

test('run.failed : error avec classe ; run.succeeded : idle, erreur effacée, effet de réussite', () => {
  let m = load();
  m = apply(m, ev('run.failed', 'ag_a', 'run_1', { error_class: 'rate_limited', error_message: 'm', duration_ms: 5 }));
  assert.equal(get(m, 'ag_a').state, 'error');
  assert.equal(get(m, 'ag_a').errorClass, 'rate_limited');
  m = apply(m, ev('run.started', 'ag_a', 'run_3', {}));
  assert.equal(get(m, 'ag_a').state, 'working');
  assert.equal(get(m, 'ag_a').errorClass, 'rate_limited', 'l\'erreur reste mémorisée jusqu\'à une réussite');
  m = apply(m, ev('run.succeeded', 'ag_a', 'run_3', { duration_ms: 1, num_turns: 1, cost_usd_estimate: 0, result_preview: '' }));
  const a = get(m, 'ag_a');
  assert.equal(a.state, 'idle');
  assert.equal(a.errorClass, null);
  assert.ok(a.effects.some((x) => x.kind === 'success' && x.until > NOW));
});

test('classe d\'erreur inconnue : repli sur failed', () => {
  const m = apply(load(), ev('run.failed', 'ag_a', 'run_1', { error_class: 'weird' }));
  assert.equal(get(m, 'ag_a').errorClass, 'failed');
});

test('effets brefs : tool.denied, run.rate_limit, run.api_retry', () => {
  let m = load();
  m = apply(m, ev('tool.denied', 'ag_a', 'run_1', { tool: 'Bash', reason: 'x' }));
  m = apply(m, ev('run.rate_limit', 'ag_a', 'run_1', { status: 'rejected', resets_at: null, window: '5h' }));
  m = apply(m, ev('run.api_retry', 'ag_a', 'run_1', { attempt: 2, max_retries: 5, error: 'e' }));
  assert.deepEqual(get(m, 'ag_a').effects.map((e) => e.kind).sort(), ['denied', 'rate_limit', 'retry']);
  assert.equal(get(m, 'ag_a').effects.find((e) => e.kind === 'retry')!.label, 'Nouvelle tentative 2/5');
});

test('run.rate_limit "allowed" : information de quota, pas de sablier', () => {
  const m = apply(load(), ev('run.rate_limit', 'ag_a', 'run_1', { status: 'allowed', resets_at: null, window: null }));
  assert.equal(get(m, 'ag_a').effects.length, 0);
});

test('événement rejoué (trop ancien) : état mis à jour mais aucun effet', () => {
  const m = apply(load(), ev('tool.denied', 'ag_a', 'run_1', { tool: 'Bash', reason: 'x' }, '2026-11-24T09:00:00Z'));
  assert.equal(get(m, 'ag_a').effects.length, 0);
  assert.ok(MAX_EFFECT_EVENT_AGE_MS > 0);
});

test('seq déjà vu ignoré (idempotence)', () => {
  const m = load();
  const old = { ...ev('run.started', 'ag_b', 'r', {}), seq: 5 };
  assert.equal(apply(m, old), m);
});

test('agent.created / updated / resync : demandent un nouveau snapshot ; deleted retire l\'agent', () => {
  let m = load();
  assert.equal(apply(m, ev('agent.created', 'ag_z', null, { name: 'Zoe' })).needsSnapshot, true);
  assert.equal(apply(m, ev('agent.updated', 'ag_a', null, { name: 'A' })).needsSnapshot, true);
  assert.equal(apply(m, ev('system.resync', null, null, {})).needsSnapshot, true);
  m = apply(m, ev('agent.deleted', 'ag_b', null, { name: 'Bob' }));
  assert.deepEqual(m.agents.map((a) => a.id), ['ag_a']);
  const again = reduceOffice(m, { type: 'snapshot', snapshot: snap({ seq: 500 }), nowMs: NOW });
  assert.equal(again.needsSnapshot, false);
  assert.equal(again.seq, 500);
});

test('agent.disabled : disabled ; le snapshot de resynchronisation conserve les effets en cours', () => {
  let m = load();
  m = apply(m, ev('tool.denied', 'ag_a', 'run_1', { tool: 'Bash', reason: 'x' }));
  m = apply(m, ev('agent.disabled', 'ag_b', null, { name: 'Bob' }));
  assert.equal(get(m, 'ag_b').state, 'disabled');
  const again = reduceOffice(m, { type: 'snapshot', snapshot: snap({ seq: 900 }), nowMs: NOW + 1500 });
  assert.equal(get(again, 'ag_a').effects.length, 1);
  assert.equal(get(again, 'ag_b').state, 'idle', 'le snapshot fait foi');
});

test('derniers événements par agent et dernier événement global', () => {
  let m = load();
  const e = ev('run.message', 'ag_a', 'run_1', { text: 'bonjour' });
  m = apply(m, e);
  assert.equal(m.lastEvent?.seq, e.seq);
  assert.equal(m.recent['ag_a'].at(-1)?.summary, 'bonjour');
});

test('fin d’exécution : état affiché tout de suite, puis confirmé par le serveur (autres demandes possibles)', () => {
  let m = load();
  m = apply(m, ev('run.succeeded', 'ag_a', 'run_1', { result_preview: 'ok' }));
  assert.equal(get(m, 'ag_a').state, 'idle');
  assert.equal(m.needsSnapshot, true);
  // le serveur indique qu'une autre demande attend encore une approbation : c'est lui qui fait foi
  m = reduceOffice(m, { type: 'snapshot', snapshot: snap({ seq: m.seq, agents: [
    { id: 'ag_a', name: 'Alice', department: 'Veille', avatar: { sprite: 9 }, state: 'waiting', activity: 'Attend une approbation', tool_kind: null, run_id: 'run_2', error_class: null, since: '2026-11-24T09:00:00Z' },
  ] }), nowMs: NOW + 2000 });
  assert.equal(get(m, 'ag_a').state, 'waiting'); assert.equal(get(m, 'ag_a').waitKind, 'approval');
  assert.ok(get(m, 'ag_a').effects.some((x) => x.kind === 'success'), 'l’effet « réussie » survit à la resynchronisation');
  assert.equal(apply(load(), ev('run.failed', 'ag_a', 'run_1', { error_class: 'timeout' })).needsSnapshot, true);
});

test('limite proche (avertissement) : aucun effet « limite atteinte » sur l’agent', () => {
  for (const status of ['warning', 'allowed_warning', 'ok', 'allowed']) {
    assert.equal(get(apply(load(), ev('run.rate_limit', 'ag_a', 'run_1', { status, window: 'seven_day', used_percent: 86 })), 'ag_a').effects.length, 0, status);
  }
  assert.ok(get(apply(load(), ev('run.rate_limit', 'ag_a', 'run_1', { status: 'limited', window: 'five_hour' })), 'ag_a').effects.some((x) => x.kind === 'rate_limit'));
});

test('actions réelles du poste : 3 dernières, remises à zéro à chaque exécution', () => {
  let m = load();
  assert.deepEqual(get(m, 'ag_a').actions, []);
  m = reduceOffice(initialModel, { type: 'snapshot', snapshot: snap({ agents: [{ ...snap().agents[1], recent_actions: ['a', 'b', 'c', 'd'] }] }), nowMs: NOW });
  assert.deepEqual(get(m, 'ag_a').actions, ['b', 'c', 'd']);
  m = apply(m, ev('tool.call', 'ag_a', 'run_1', { kind: 'read', summary: 'lit e' }));
  assert.deepEqual(get(m, 'ag_a').actions, ['c', 'd', 'lit e']);
  m = apply(m, ev('run.started', 'ag_a', 'run_2'));
  assert.deepEqual(get(m, 'ag_a').actions, []);
});

test('conversation réelle : en salle de réunion pendant l’échange et 5 min après la réponse', () => {
  let m = load();
  m = apply(m, ev('run.queued', 'ag_b', 'run_c', { trigger: 'manual', conversation: 'chat' }));
  assert.equal(get(m, 'ag_b').conv?.active, true);
  m = apply(m, ev('run.started', 'ag_b', 'run_c'));
  m = apply(m, ev('run.succeeded', 'ag_b', 'run_c', { result_preview: 'Bonjour !' }), NOW + 2000);
  const a = get(m, 'ag_b');
  assert.equal(a.conv?.active, false); assert.ok(a.conv!.until > NOW + 2000 + 299_000);
  assert.equal(a.filedUntil, 0, 'une réponse de conversation n’est pas un rapport à archiver');
  // mission ordinaire réussie avec résultat : rapport à ranger
  let n = load();
  n = apply(n, ev('run.succeeded', 'ag_a', 'run_1', { result_preview: 'Rapport : 3 points' }));
  assert.ok((get(n, 'ag_a').filedUntil ?? 0) > NOW);
  n = apply(load(), ev('run.succeeded', 'ag_a', 'run_1', { result_preview: '' }));
  assert.equal(get(n, 'ag_a').filedUntil, 0);
  // snapshot : conversation terminée il y a 2 min → encore 3 min ; il y a 6 min → plus de conversation
  const conv = (min: number) => reduceOffice(initialModel, { type: 'snapshot', nowMs: NOW, snapshot: snap({ agents: [{ ...snap().agents[0], conversation: { via: 'discord', run_id: 'r', active: false, last_at: new Date(NOW - min * 60_000).toISOString() } }] }) });
  const c2 = get(conv(2), 'ag_b').conv!;
  assert.equal(c2.via, 'discord'); assert.ok(Math.abs(c2.until - (NOW + 180_000)) < 1500);
  assert.equal(get(conv(6), 'ag_b').conv, null);
});

test('arrêt d’urgence : snapshot puis événements', () => {
  let m = reduceOffice(initialModel, { type: 'snapshot', nowMs: NOW, snapshot: snap({ control: { paused: true, since: '2026-11-24T09:00:00Z', reason: 'test' } }) });
  assert.deepEqual(m.control, { paused: true, since: '2026-11-24T09:00:00Z', reason: 'test' });
  m = apply(m, ev('system.resumed', null, null));
  assert.equal(m.control.paused, false);
  m = apply(m, ev('system.emergency_stop', null, null, { reason: 'fuite', cancelled: 2 }, '2026-11-24T10:05:00Z'));
  assert.deepEqual(m.control, { paused: true, since: '2026-11-24T10:05:00Z', reason: 'fuite' });
});

test('livraison réelle : colis pour le destinataire, camionnette seulement si l’événement est frais', () => {
  let m = load();
  m = apply(m, ev('inbox.received', 'ag_b', null, { source: 'PerforceBot', status: 'waiting', title: 'CL 1' }));
  assert.equal(get(m, 'ag_b').inbox, 1);
  assert.deepEqual(m.deliveries.map((d) => [d.agentId, d.source]), [['ag_b', 'PerforceBot']]);
  m = apply(m, ev('inbox.received', null, null, { source: 'PerforceBot', status: 'unrouted' }));
  assert.equal(m.deliveries.length, 2);                                  // sans destinataire : la camionnette passe quand même
  m = apply(m, ev('inbox.received', 'ag_b', null, { source: 'X', status: 'stored' }, '2026-11-24T09:00:00Z'));
  assert.equal(m.deliveries.length, 2, 'événement rejoué ancien : pas de camionnette');
  assert.equal(get(m, 'ag_b').inbox, 1, 'déposée sans traitement : pas de colis en attente');
  m = reduceOffice(m, { type: 'snapshot', snapshot: snap({ agents: [{ ...snap().agents[0], inbox_pending: 0 }, snap().agents[1]] }), nowMs: NOW + 5000 });
  assert.equal(get(m, 'ag_b').inbox, 0, 'traitée : le serveur fait foi');
});

test('au travail : une autre demande (file, approbation) ou la fin d’une autre exécution ne le fait pas quitter son poste', () => {
  let m = load(); // ag_a travaille sur run_1
  m = apply(m, ev('run.queued', 'ag_a', 'run_2'));
  assert.equal(get(m, 'ag_a').state, 'working');
  assert.equal(get(m, 'ag_a').runId, 'run_1');
  m = apply(m, ev('run.awaiting_approval', 'ag_a', 'run_3'));
  assert.equal(get(m, 'ag_a').state, 'working');
  m = apply(m, ev('run.failed', 'ag_a', 'run_9', { error_class: 'timeout' }));
  assert.equal(get(m, 'ag_a').state, 'working');
  assert.equal(m.needsSnapshot, true, 'le serveur fait foi : snapshot relu');
  // fin de SON exécution : comportement habituel
  m = apply(m, ev('run.succeeded', 'ag_a', 'run_1', { result_preview: '' }));
  assert.equal(get(m, 'ag_a').state, 'idle');
  // agent au repos : une demande en file le met bien en attente
  m = apply(m, ev('run.queued', 'ag_b', 'run_4'));
  assert.equal(get(m, 'ag_b').state, 'waiting');
});
