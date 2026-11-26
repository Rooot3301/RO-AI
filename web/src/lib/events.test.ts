import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeEvent, eventCategory, matchesFilter, mergeEvents, loadEventTail, EMPTY_FILTER } from './events.ts';
import { ev } from './testutil.ts';

test('eventCategory', () => {
  assert.equal(eventCategory('run.started'), 'run');
  assert.equal(eventCategory('system'), 'system');
});

test('describeEvent : niveaux et textes', () => {
  assert.equal(describeEvent(ev('run.failed', { error_class: 'timeout', error_message: 'trop long' })).level, 'error');
  assert.match(describeEvent(ev('run.failed', { error_class: 'timeout', error_message: 'trop long' })).title, /Délai dépassé/);
  assert.equal(describeEvent(ev('tool.denied', { tool: 'Bash', reason: 'non autorisé' })).level, 'warn');
  assert.equal(describeEvent(ev('tool.result', { tool_id: 't', ok: false, summary: 'x' })).level, 'warn');
  assert.equal(describeEvent(ev('tool.result', { tool_id: 't', ok: true, summary: 'x' })).level, 'info');
  assert.equal(describeEvent(ev('system.notice', { level: 'error', message: 'boum' })).level, 'error');
  assert.equal(describeEvent(ev('run.api_retry', { attempt: 2, max_retries: 5, error: 'x' })).title, 'Nouvelle tentative 2/5');
  assert.equal(describeEvent(ev('truc.inconnu')).title, 'truc.inconnu');
  // charge utile inattendue : pas d'exception
  assert.equal(describeEvent(ev('run.started', { provider: 42 as unknown as string })).level, 'info');
});

test('matchesFilter', () => {
  const e = ev('run.message', { text: 'Bonjour le monde' }, { agent_id: 'ag_9' });
  assert.ok(matchesFilter(e, EMPTY_FILTER));
  assert.ok(matchesFilter(e, { ...EMPTY_FILTER, agentId: 'ag_9' }));
  assert.ok(!matchesFilter(e, { ...EMPTY_FILTER, agentId: 'ag_1' }));
  assert.ok(matchesFilter(e, { ...EMPTY_FILTER, category: 'run' }));
  assert.ok(!matchesFilter(e, { ...EMPTY_FILTER, category: 'tool' }));
  assert.ok(matchesFilter(e, { ...EMPTY_FILTER, search: 'MONDE' }));
  assert.ok(!matchesFilter(e, { ...EMPTY_FILTER, search: 'absent' }));
  assert.ok(!matchesFilter(e, { ...EMPTY_FILTER, level: 'error' }));
});

test('mergeEvents : tri, dédoublonnage, bornage', () => {
  const a = ev('a'); const b = ev('b'); const c = ev('c'); const d = ev('d');
  assert.deepEqual(mergeEvents([a, b], [c, d]).map((x) => x.type), ['a', 'b', 'c', 'd']);
  assert.deepEqual(mergeEvents([a, c], [b, c]).map((x) => x.type), ['a', 'b', 'c']);
  assert.deepEqual(mergeEvents([a, b, c], [d], 2).map((x) => x.type), ['c', 'd']);
  const buf = [a, b];
  assert.equal(mergeEvents(buf, []), buf);
});

test('loadEventTail : pagine vers l\'avant jusqu\'à la fin du journal', async () => {
  const all = Array.from({ length: 25 }, (_, i) => ({ ...ev('x'), seq: i + 1 }));
  const calls: number[] = [];
  const fetchPage = async (since: number, limit: number) => {
    calls.push(since);
    const events = all.filter((e) => e.seq > since).slice(0, limit);
    return { events, last_seq: events.length ? events[events.length - 1].seq : since };
  };
  const r = await loadEventTail(fetchPage, 10, 10);
  assert.deepEqual(calls, [0, 10, 20]);
  assert.equal(r.lastSeq, 25);
  assert.deepEqual(r.events.map((e) => e.seq), [16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
});

test('loadEventTail : journal vide', async () => {
  const r = await loadEventTail(async () => ({ events: [], last_seq: 0 }), 10, 10);
  assert.equal(r.lastSeq, 0);
  assert.equal(r.events.length, 0);
});

import { currentActivity } from './events.ts';
test('currentActivity : dernier appel d\'outil de l\'agent, nul après la fin de l\'exécution', () => {
  const evs = [
    ev('run.started', {}, { agent_id: 'a' }),
    ev('tool.call', { tool_id: '1', tool: 'Read', summary: 'README.md' }, { agent_id: 'a' }),
    ev('tool.call', { tool_id: '2', tool: 'Grep', summary: 'TODO' }, { agent_id: 'b' }),
  ];
  assert.equal(currentActivity(evs, 'a'), 'Read · README.md');
  assert.equal(currentActivity(evs, 'b'), 'Grep · TODO');
  assert.equal(currentActivity(evs, 'zz'), null);
  assert.equal(currentActivity([...evs, ev('run.succeeded', {}, { agent_id: 'a' })], 'a'), null);
});

import { loadRunEvents } from './events.ts';
test('loadRunEvents : une page ou plusieurs pages', async () => {
  const all = Array.from({ length: 7 }, (_, i) => ({ ...ev('x'), seq: i + 1 }));
  const one = await loadRunEvents(async (since) => ({ events: all.filter((e) => e.seq > since), last_seq: 7 }));
  assert.equal(one.length, 7);
  let calls = 0;
  const paged = await loadRunEvents(async (since) => { calls++; const events = all.filter((e) => e.seq > since).slice(0, 3); return { events, last_seq: 7 }; });
  assert.equal(paged.length, 7);
  assert.equal(calls, 3);
  assert.deepEqual(await loadRunEvents(async () => ({ events: [], last_seq: 0 })), []);
});

test('describeEvent : arrêt d\'urgence et reprise', () => {
  const s = describeEvent(ev('system.emergency_stop', { reason: 'incident', cancelled: 2 }));
  assert.equal(s.level, 'error'); assert.equal(s.tone, 'err');
  assert.match(s.title, /Arrêt d’urgence/); assert.match(s.detail, /2 exécutions annulées/); assert.match(s.detail, /incident/);
  assert.equal(describeEvent(ev('system.emergency_stop', { cancelled: 1 })).detail, '1 exécution annulée');
  const r = describeEvent(ev('system.resumed', {}));
  assert.match(r.title, /Reprise/); assert.equal(r.tone, 'ok');
});

test('agent.profile : libellés français selon l’action', () => {
  const g = describeEvent(ev('agent.profile', { action: 'generating', provider: 'claude' }));
  assert.match(g.title, /génération en cours/); assert.equal(g.detail, 'Claude'); assert.equal(g.tone, 'amber');
  const ok = describeEvent(ev('agent.profile', { action: 'generated', provider: 'codex', model: 'gpt-5', input_tokens: 1200, output_tokens: 340 }));
  assert.equal(ok.title, 'Fiche d’identité générée'); assert.equal(ok.tone, 'ok');
  assert.match(ok.detail, /^Codex · gpt-5 · 1\s540 jetons$/);
  const ko = describeEvent(ev('agent.profile', { action: 'generation_failed', provider: 'claude', error: 'réponse invalide' }));
  assert.equal(ko.level, 'warn'); assert.match(ko.title, /Échec/); assert.match(ko.detail, /réponse invalide/);
  assert.equal(describeEvent(ev('agent.profile', { action: 'updated' })).title, 'Fiche d’identité modifiée');
  assert.equal(describeEvent(ev('agent.profile', { action: 'reset' })).title, 'Fiche d’identité réinitialisée');
  assert.equal(eventCategory('office.layout'), 'office');
});

test('office.layout : enregistré ou réinitialisé', () => {
  assert.equal(describeEvent(ev('office.layout', { action: 'saved' })).title, 'Agencement du bureau enregistré');
  assert.equal(describeEvent(ev('office.layout', { action: 'reset' })).title, 'Agencement du bureau réinitialisé');
});
