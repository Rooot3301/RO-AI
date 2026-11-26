import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_STAFF_INFO, MEM_ALERT, parisHM, receptionFacts, receptionGreeting, techAlert, techRemarks } from './staff.ts';
import type { StaffInfo } from './staff.ts';
import { OfficeWorld, Mode } from './sim.ts';
import { planLayout, TILE } from '../layout/plan.ts';
import type { OfficeAgentModel } from '../state/model.ts';

const clock = { hour: 10, minute: 5, weekday: 2, month: 5, daylight: 1 };
const info = (o: Partial<StaffInfo>): StaffInfo => ({ ...EMPTY_STAFF_INFO, loaded: true, ...o });

test('accueil : sans donnée, uniquement des formules de politesse ; avec données, des faits réels exacts', () => {
  const none = receptionFacts(EMPTY_STAFF_INFO, clock);
  assert.ok(none.length > 0);
  for (const l of none) assert.ok(!/\d/.test(l), `aucun chiffre inventé : ${l}`);
  const f = receptionFacts(info({ working: 3, approvals: 1, errors: 2, queued: 0, next: { agent: 'Atlas', at: '2026-11-25T13:30:00Z' } }), clock, Date.parse('2026-01-01T00:00:00Z'));
  assert.ok(f.includes('3 agents au travail en ce moment.'));
  assert.ok(f.includes('1 demande attend une approbation.'));
  assert.ok(f.includes('2 agents signalent une erreur.'));
  assert.ok(f.includes('Prochaine mission à 14 h 30 : Atlas.'), f.join(' | '));
  assert.ok(f.includes('Il est 10 h 05.'));
  assert.ok(!f.some((l) => /file d/.test(l)), 'pas de file mentionnée quand elle est vide');
  assert.ok(receptionFacts(info({}), clock).includes('Aucun agent au travail pour l’instant.'));
  assert.equal(parisHM('n’importe quoi'), null);
  assert.match(receptionGreeting('Atlas', { ...clock, hour: 20 }, 1), /Bonsoir/);
});

test('technicien : alerte seulement sur une vraie mesure (mémoire, disque, fournisseur, erreur système)', () => {
  assert.equal(techAlert(info({})), null);
  assert.equal(techAlert(info({ memPct: MEM_ALERT - 1, diskPct: 50 })), null);
  assert.equal(techAlert(info({ memPct: 91 }))!.kind, 'mem');
  assert.match(techAlert(info({ memPct: 91 }))!.text, /91 %/);
  assert.equal(techAlert(info({ diskPct: 95 }))!.kind, 'disk');
  assert.equal(techAlert(info({ providerDown: 'claude' }))!.text, 'Claude est déconnecté.');
  assert.equal(techAlert(info({ sysError: 'Radar' }))!.kind, 'system');
  for (const l of techRemarks(EMPTY_STAFF_INFO)) assert.ok(!/\d/.test(l));
  assert.ok(techRemarks(info({ cpuPct: 12.4 })).includes('Processeur à 12 %.'));
});

const mk = (id: string, o: Partial<OfficeAgentModel> = {}): OfficeAgentModel => ({
  id, name: id, department: 'Dev', sprite: 0, state: 'idle', waitKind: null, activity: null, toolKind: null, runId: null,
  errorClass: null, since: '', effects: [], origin: { seq: 1, type: 'snapshot', run_id: null, ts: '' }, ...o,
});
const world = (social = true) => {
  const ags = [0, 1, 2, 3, 4, 5].map((i) => mk(`ag_${i}`));
  const w = new OfficeWorld(planLayout({ departments: ['Dev'], agents: ags.map((a, i) => ({ id: a.id, department: a.department, rank: i })) }), { social });
  w.setAgents(ags);
  return w;
};
const run = (w: OfficeWorld, s: number) => { for (let t = 0; t < s; t += 1 / 30) w.update(1 / 30, 0); };

test('figurants : réceptionniste à son comptoir et technicien à son poste ; jamais partenaires de discussion', () => {
  const w = world();
  w.setClock({ hour: 10 });
  run(w, 200);
  const rec = w.chars.find((c) => c.extra === 'reception')!, tech = w.chars.find((c) => c.extra === 'tech')!;
  const p = w.layout.staff.reception!;
  assert.deepEqual([rec.x, rec.y], [(p.tile.col + 0.5) * TILE, (p.tile.row + 0.5) * TILE]);
  assert.equal(w.layout.rooms[w.layout.roomAt[Math.floor(tech.y / TILE) * w.layout.cols + Math.floor(tech.x / TILE)]].kind, 'server');
  for (const cv of w.convos) { assert.equal(cv.a.extra, null); assert.equal(cv.b.extra, null); }
  assert.equal(w.byId.has('__cleaner__'), false, 'pas d\'entretien en journée');
  const noStaff = new OfficeWorld(w.layout, { social: true, staff: false });
  noStaff.setAgents([mk('ag_0')]);
  assert.equal(noStaff.chars.filter((c) => c.extra).length, 0);
});

test('figurants : le technicien rejoint la baie des jauges quand la mémoire réelle dépasse le seuil, puis revient', () => {
  const w = world(false);
  run(w, 2);
  w.setStaffInfo(info({ memPct: 92 }));
  run(w, 40);
  const tech = w.chars.find((c) => c.extra === 'tech')!, L = w.layout;
  const gauge = L.staff.rackFronts.find((f) => f.furn === L.staff.gaugeRack)!;
  assert.deepEqual([Math.floor(tech.x / TILE), Math.floor(tech.y / TILE)], [gauge.tile.col, gauge.tile.row]);
  w.setStaffInfo(info({ memPct: 40 }));
  run(w, 40);
  const post = L.staff.tech!.tile;
  assert.deepEqual([Math.floor(tech.x / TILE), Math.floor(tech.y / TILE)], [post.col, post.row]);
});

test('figurants : l\'agent d\'entretien arrive le soir (vie sociale active) et repart ensuite', () => {
  const w = world();
  w.setClock({ hour: 20 });
  run(w, 5);
  const cl = w.byId.get('__cleaner__');
  assert.ok(cl, 'présent le soir');
  run(w, 60);
  assert.ok(w.chars.some((c) => c.extra === 'cleaner' && c.mode !== undefined));
  w.setClock({ hour: 23 });
  run(w, 60);
  assert.equal(w.chars.some((c) => c.extra === 'cleaner'), false, 'reparti');
  void Mode;
});
