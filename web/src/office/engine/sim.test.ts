import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OfficeWorld, Mode, Dir, WALK_SPEED, PATHS_PER_FRAME } from './sim.ts';
import { planLayout, levelOfY, TILE } from '../layout/plan.ts';
import type { OfficeAgentModel } from '../state/model.ts';

const mk = (id: string, o: Partial<OfficeAgentModel> = {}): OfficeAgentModel => ({
  id, name: id, department: 'Dev', sprite: 0, state: 'idle', waitKind: null, activity: null, toolKind: null, runId: null,
  errorClass: null, since: '', effects: [], origin: { seq: 1, type: 'snapshot', run_id: null, ts: '' }, ...o,
});
const world = (agents: OfficeAgentModel[], social = false) => {
  const layout = planLayout({ departments: [...new Set(agents.map((a) => a.department))], agents: agents.map((a, i) => ({ id: a.id, department: a.department, rank: i })) });
  const w = new OfficeWorld(layout, { social });
  w.setAgents(agents);
  return w;
};
const run = (w: OfficeWorld, seconds: number, each?: () => void) => { for (let t = 0; t < seconds; t += 1 / 30) { w.update(1 / 30, 0); each?.(); } };
const roomOf = (w: OfficeWorld, x: number, y: number) => { const i = Math.floor(y / TILE) * w.layout.cols + Math.floor(x / TILE); const r = w.layout.roomAt[i]; return r >= 0 ? w.layout.rooms[r] : null; };
const crowd = (n: number) => Array.from({ length: n }, (_, i) => mk(`ag_${String(i).padStart(2, '0')}`, { department: ['Dev', 'Veille', 'Infra', 'Docs'][i % 4] }));

test('première charge : un agent au travail apparaît assis à son poste, face à l\'écran', () => {
  const w = world([mk('ag_1', { state: 'working', toolKind: 'exec', runId: 'r' })]);
  w.update(0.016, 0);
  const c = w.chars[0], d = w.layout.deskByAgent.get('ag_1')!;
  assert.equal(c.mode, Mode.SIT);
  assert.equal(c.dir, Dir.UP);
  assert.equal(c.atDesk, true);
  assert.equal(c.anim, 'terminal', 'animation selon l\'activité réelle (exec => terminal)');
  assert.deepEqual([c.x, c.y], [d.seatX, d.seatY]);
});

test('file d\'attente : debout près de son poste ; approbation : salle d\'attente, emplacements distincts', () => {
  const w = world([mk('a', { state: 'waiting', waitKind: 'approval' }), mk('b', { state: 'waiting', waitKind: 'approval' }), mk('c', { state: 'waiting', waitKind: 'queued' })]);
  w.update(0.016, 0);
  const [a, b, c] = ['a', 'b', 'c'].map((id) => w.byId.get(id)!);
  assert.equal(roomOf(w, a.x, a.y)!.kind, 'approval');
  assert.equal(roomOf(w, b.x, b.y)!.kind, 'approval');
  assert.ok(a.x !== b.x || a.y !== b.y, 'emplacements distincts');
  const d = w.layout.deskByAgent.get('c')!;
  assert.deepEqual([c.x, c.y], [d.standX, d.standY]);
  assert.equal(c.anim, 'wait');
});

test('transition approbation -> travail : marche (sans téléportation) jusqu\'au poste puis s\'assoit', () => {
  const w = world([mk('ag_1', { state: 'waiting', waitKind: 'approval' })]);
  w.update(0.016, 0);
  w.setAgents([mk('ag_1', { state: 'working', toolKind: 'read', runId: 'r' })]);
  const c = w.chars[0];
  let px = c.x, py = c.y, maxStep = 0, walked = false;
  let changed = 0;
  // le seul « saut » permis : le changement d'étage, personnage effacé (ascenseur ou escalier)
  run(w, 60, () => { if (levelOfY(w.layout, py) !== levelOfY(w.layout, c.y)) { changed++; assert.ok(c.alpha < 0.05, 'invisible pendant le changement d’étage'); } else maxStep = Math.max(maxStep, Math.hypot(c.x - px, c.y - py)); px = c.x; py = c.y; if (c.mode === Mode.WALK) walked = true; });
  assert.equal(changed, 1, 'monte une fois au 1er (postes à l’étage)');
  const d = w.layout.deskByAgent.get('ag_1')!;
  assert.ok(walked);
  assert.ok(maxStep <= WALK_SPEED * 1.2 / 30 + 0.01, `pas maximal ${maxStep}`);
  assert.equal(c.mode, Mode.SIT);
  assert.equal(c.anim, 'read');
  assert.deepEqual([c.x, c.y], [d.seatX, d.seatY]);
});

test('nouvel agent après la première charge : entre par l\'entrée principale (depuis le parvis)', () => {
  const w = world([mk('a')]);
  w.update(0.016, 0);
  const agents = [mk('a'), mk('b', { state: 'working', toolKind: 'web', runId: 'r' })];
  w.setLayout(planLayout({ departments: ['Dev'], agents: agents.map((a, i) => ({ id: a.id, department: a.department, rank: i })) }));
  w.setAgents(agents);
  w.update(0.016, 0);
  const b = w.byId.get('b')!, s = w.layout.spawn;
  assert.ok(Math.abs(b.x - (s.col + 0.5) * TILE) < 1 && Math.abs(b.y - (s.row + 0.5) * TILE) < 1, 'part du parvis');
  assert.ok(b.alpha < 0.2, 'apparition en fondu');
  run(w, 60);
  assert.equal(b.atDesk, true);
});

test('désactivé : absent dès le chargement, poste conservé ; désactivé en cours : sort par l\'entrée ; supprimé : retiré', () => {
  const w = world([mk('a', { state: 'disabled' }), mk('b'), mk('c')]);
  w.update(0.016, 0);
  assert.equal(w.byId.get('a')!.visible, false);
  assert.ok(w.layout.deskByAgent.get('a'), 'le poste reste');
  assert.equal(w.byId.get('b')!.visible, true);
  w.setAgents([mk('a', { state: 'disabled' }), mk('b', { state: 'disabled' }), mk('c')]);
  run(w, 60);
  assert.equal(w.byId.get('b')!.present, false);
  assert.equal(w.byId.get('b')!.visible, false);
  w.setAgents([mk('a', { state: 'disabled' }), mk('b', { state: 'disabled' })]);
  run(w, 90);
  assert.equal(w.byId.has('c'), false);
  assert.equal(w.chars.filter((c) => !c.extra).length, 2);
});

test('vie sociale désactivée : un agent libre reste assis à son poste, immobile, sans bulle', () => {
  const w = world(crowd(6), false);
  w.update(0.016, 0);
  const ags = w.chars.filter((c) => !c.extra);
  const pos = ags.map((c) => [c.x, c.y]);
  run(w, 200);
  ags.forEach((c, i) => { assert.deepEqual([c.x, c.y], pos[i]); assert.equal(c.atDesk, true); });
  assert.equal(w.bubbles().length, 0);
});

test('vie sociale : promenades, café, repos, discussions ; jamais de réunion simulée ni de passage à travers murs et meubles', () => {
  const w = world(crowd(12), true);
  const visited = new Set<string>();
  let maxBubbles = 0, convos = 0, maxStep = 0;
  const prev = new Map<string, [number, number]>();
  const L = w.layout;
  run(w, 400, () => {
    for (const c of w.chars) {
      if (!c.visible) continue;
      const r = roomOf(w, c.x, c.y);
      if (r) visited.add(r.kind);
      if (L.tiles[Math.floor(c.y / TILE) * L.cols + Math.floor(c.x / TILE)] === 6 && c.act === 'outside') visited.add('parvis');
      assert.notEqual(r?.kind, 'meeting', 'personne en salle de réunion');
      if (c.mode === Mode.WALK && c.pIdx < c.pLen) { // en chemin (hors glissement final vers un siège)
        const i = Math.floor(c.y / TILE) * L.cols + Math.floor(c.x / TILE);
        const near = c.tile >= 0 && Math.hypot(c.x - ((c.tile % L.cols) + 0.5) * TILE, c.y - (Math.floor(c.tile / L.cols) + 0.5) * TILE) < 20; // se lève d’un siège (glissement vers sa case d’accès)
        assert.ok(L.walkable[i] === 1 || near, `marche sur une case praticable (${c.id})`);
      }
      const p = prev.get(c.id);
      if (p && levelOfY(L, p[1]) === levelOfY(L, c.y)) maxStep = Math.max(maxStep, Math.hypot(c.x - p[0], c.y - p[1]));
      prev.set(c.id, [c.x, c.y]);
    }
    maxBubbles = Math.max(maxBubbles, w.bubbles().length);
    convos = Math.max(convos, w.convos.length);
  });
  for (const k of ['corridor', 'department']) assert.ok(visited.has(k), `passage par ${k}`);
  assert.ok(visited.has('coffee') || visited.has('break') || visited.has('library') || visited.has('lobby'), 'espaces communs utilisés');
  assert.ok(visited.has('parvis'), 'certains sortent prendre l’air sur le parvis');
  assert.ok(convos >= 1, 'au moins une conversation');
  assert.ok(maxBubbles >= 1, 'bulles fictives affichées');
  assert.ok(maxStep <= WALK_SPEED * 1.2 / 30 + 3, `aucune téléportation (pas max ${maxStep.toFixed(2)})`);
});

test('priorité de l\'état réel : une exécution qui démarre interrompt conversation et activité, retour immédiat au poste', () => {
  const w = world(crowd(8), true);
  let found: string | null = null;
  for (let t = 0; t < 600 && !found; t += 1 / 30) { w.update(1 / 30, 0); if (w.convos.length) found = w.convos[0].a.id; }
  assert.ok(found, 'une conversation a eu lieu');
  const agents = w.chars.map((c) => (c.id === found ? mk(c.id, { department: c.agent.department, state: 'working', toolKind: 'exec', runId: 'r' }) : c.agent));
  w.setAgents(agents);
  w.update(1 / 30, 0);
  const c = w.byId.get(found!)!;
  assert.equal(c.convo, null, 'conversation interrompue');
  assert.equal(c.bubble, '', 'plus de bulle fictive');
  assert.equal(c.act, null, 'activité sociale abandonnée');
  run(w, 60);
  assert.equal(c.atDesk, true);
  assert.equal(c.anim, 'terminal');
  // et un agent au travail ne bavarde jamais
  run(w, 120, () => assert.equal(c.convo, null));
});

test('quota atteint (rate_limited) : à son poste, posture spécifique', () => {
  const w = world([mk('a', { state: 'error', errorClass: 'rate_limited' }), mk('b', { state: 'error', errorClass: 'timeout' })]);
  w.update(0.016, 0);
  assert.equal(w.byId.get('a')!.anim, 'quota');
  assert.equal(w.byId.get('a')!.vis.quota, true);
  assert.equal(w.byId.get('b')!.anim, 'alarm');
});

test('après une réussite : reste un moment à son poste avant de se lever (départ progressif)', () => {
  const w = world([mk('a', { state: 'working', toolKind: 'exec', runId: 'r' })], true);
  run(w, 2);
  w.setAgents([mk('a')]);
  run(w, 3);
  const c = w.chars[0];
  assert.equal(c.atDesk, true, 'encore assis juste après');
  let left = false;
  run(w, 120, () => { if (!c.atDesk) left = true; });
  assert.ok(left, 'finit par se lever');
});

test('performances : 40 agents, recherches de chemin plafonnées par image, aucun blocage durable', () => {
  const ags = crowd(40);
  const layout = planLayout({ departments: ['Dev', 'Veille', 'Infra', 'Docs'], agents: ags.map((a, i) => ({ id: a.id, department: a.department, rank: i })), wings: 2 });
  const w = new OfficeWorld(layout, { social: true });
  w.setAgents(ags);
  const stuck = new Map<string, number>();
  let worst = 0, maxPerFrame = 0;
  const t0 = performance.now();
  for (let t = 0; t < 300; t += 1 / 30) {
    const before = w.pathSearches;
    w.update(1 / 30, 0);
    maxPerFrame = Math.max(maxPerFrame, w.pathSearches - before);
    for (const c of w.chars) {
      const s = c.mode === Mode.WALK && c.vel < 1 && c.xfer !== 2 ? (stuck.get(c.id) ?? 0) + 1 / 30 : 0; // attendre l’ascenseur n’est pas un blocage
      stuck.set(c.id, s); worst = Math.max(worst, s);
    }
  }
  const ms = performance.now() - t0;
  assert.ok(maxPerFrame <= PATHS_PER_FRAME, `recherches par image : ${maxPerFrame}`);
  assert.ok(worst < 15, `blocage le plus long : ${worst.toFixed(1)} s`);
  assert.ok(ms < 4000, `simulation de 5 min à 30 i/s : ${ms.toFixed(0)} ms`);
});

test('charAt / deskAt : clic sur un personnage ou sur son bureau', () => {
  const w = world([mk('a', { state: 'working', toolKind: 'read', runId: 'r' })]);
  w.update(0.016, 0);
  const c = w.chars[0], d = w.layout.deskByAgent.get('a')!;
  assert.equal(w.charAt(c.x, c.y - 5), c);
  assert.equal(w.charAt(c.x + 100, c.y), null);
  assert.equal(w.deskAt(d.col * TILE + 30, d.row * TILE - 10), 'a');
  assert.equal(w.deskAt(0, 0), null);
});

test('cadence : 0 si tout est figé (sans animations), 30 au travail, 60 en marche', () => {
  const still = world([mk('a')], false);
  still.setOptions({ decor: false });
  still.update(0.016, 0);
  assert.equal(still.motionFps(0), 0);
  const work = world([mk('a', { state: 'working', toolKind: 'read', runId: 'r' })]);
  work.update(0.016, 0);
  assert.equal(work.motionFps(0), 30);
  work.setAgents([mk('a', { state: 'waiting', waitKind: 'approval' })]);
  run(work, 0.3);
  assert.equal(work.motionFps(0), 60);
});

test('conversation réelle : assis en salle de réunion (chaises distinctes) ; rapport réel : se rend à la bibliothèque', () => {
  const conv = (id: string) => ({ via: 'chat' as const, runId: `r_${id}`, active: true, lastAt: '', until: Infinity });
  const w = world([
    mk('a', { state: 'working', toolKind: 'read', runId: 'r_a', conv: conv('a') }),
    mk('b', { state: 'waiting', waitKind: 'queued', runId: 'r_b', conv: conv('b') }),
    mk('c', { state: 'idle', filedUntil: 1e15 }),
    mk('d', { state: 'working', toolKind: 'read', runId: 'autre', conv: conv('d') }),
  ]);
  w.update(0.016, 0);
  run(w, 40);
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => w.byId.get(id)!);
  assert.equal(roomOf(w, a.x, a.y)?.kind, 'meeting'); assert.equal(a.mode, Mode.SIT); assert.equal(a.anim, 'type');
  assert.equal(roomOf(w, b.x, b.y)?.kind, 'meeting'); assert.equal(b.mode, Mode.SIT);
  assert.ok(a.x !== b.x || a.y !== b.y, 'chaises distinctes');
  assert.equal(roomOf(w, c.x, c.y)?.kind, 'library'); assert.equal(c.anim, 'browse');
  assert.equal(d.atDesk, true, 'mission ordinaire : à son poste, même pendant une conversation récente');
  // la vie sociale ne s'installe jamais en salle de réunion
  const s = world(crowd(12), true);
  let inMeeting = 0;
  run(s, 120, () => { for (const ch of s.chars) if (roomOf(s, ch.x, ch.y)?.kind === 'meeting' && ch.mode === Mode.SIT) inMeeting++; });
  assert.equal(inMeeting, 0);
});

test('changement d’étage : par l’escalier ou l’ascenseur du palier, effacé pendant le trajet, cabine qui suit', () => {
  const agents = Array.from({ length: 6 }, (_, i) => mk(`ag_${i}`, { state: 'waiting', waitKind: 'approval' }));
  const w = world(agents);
  w.update(0.016, 0);
  for (const c of w.chars.filter((x) => !x.extra)) assert.equal(levelOfY(w.layout, c.y), 0, 'attente des approbations au RDC');
  w.setAgents(agents.map((a) => ({ ...a, state: 'working' as const, waitKind: null, toolKind: 'read' as const, runId: 'r' })));
  const used = new Set<string>(), liftLevels = new Set<number>();
  let opened = false;
  run(w, 90, () => {
    for (const c of w.chars) if (c.xfer === 2 && c.xFrom) {
      used.add(c.xFrom.kind);
      assert.equal(c.xFrom.level, 0); assert.equal(c.xDest!.level, 1);
      const g = w.layout.rooms[w.layout.roomAt[c.xFrom.tile.row * w.layout.cols + c.xFrom.tile.col]];
      assert.equal(g.kind, 'landing', 'départ depuis le palier');
    }
    liftLevels.add(w.lift.level);
    if (w.lift.open.some((t) => t > w.time)) opened = true;
  });
  assert.ok(used.has('lift') && used.has('stairs'), `ascenseur et escalier utilisés (${[...used]})`);
  assert.ok(liftLevels.has(1) && opened, 'la cabine monte et ses portes s’ouvrent');
  for (const c of w.chars.filter((x) => !x.extra)) { assert.equal(c.atDesk, true, `${c.id} à son poste`); assert.equal(c.alpha, 1); assert.equal(c.xfer, 0); }
});

test('changement d’étage : un but qui change pendant le trajet est repris à l’arrivée ; sortie par l’entrée du RDC', () => {
  const w = world([mk('a')]);
  w.update(0.016, 0);
  const c = w.chars.find((x) => x.id === 'a')!;
  assert.equal(levelOfY(w.layout, c.y), 1, 'au poste, au 1er');
  w.setAgents([mk('a', { state: 'waiting', waitKind: 'approval' })]);
  run(w, 200, () => { if (c.xfer === 2 && c.xPh === 1) w.setAgents([mk('a', { state: 'disabled' })]); });
  assert.equal(c.present, false, 'sorti par l’entrée');
  assert.equal(c.xfer, 0);
});

test('session Claude Code : entre par l’accueil, travaille en salle serveur, lève la main quand elle attend, repart à la fin', () => {
  const w = world([mk('ag_1')]);
  const dev = (state: 'working' | 'waiting' | 'idle', present = true) => ({
    id: 'bf3ffcc2', label: 'Claude Code · bf3f', project: 'ro-ai', state, present, since: '', last_at: '', turn_at: '',
    actions: [{ at: '2026-11-26T06:00:00Z', kind: 'test' as const, target: 'tests' }], counts: { tools: 1, write: 0, test: 1, build: 0, deploy: 0, commit: 0 },
  });
  run(w, 1);
  w.setDevTeam([]); run(w, 0.2);                       // premier relevé : personne
  w.setDevTeam([dev('working')]); run(w, 0.1);
  const c = w.byId.get('__dev__:bf3ffcc2')!;
  assert.ok(c && c.extra === 'dev');
  const sp = w.layout.spawn;
  assert.ok(Math.abs(c.y - (sp.row * TILE + TILE / 2)) < TILE * 3, 'arrive par l’entrée (pas de téléportation)');
  run(w, 60);
  assert.equal(roomOf(w, c.x, c.y)!.kind, 'server');
  assert.equal(c.anim, 'use');
  assert.equal(c.agent.state, 'working');
  w.setDevTeam([dev('waiting')]); run(w, 5);
  assert.equal(c.anim, 'hand'); assert.equal(c.dir, Dir.DOWN);
  w.setDevTeam([dev('idle', false)]); run(w, 0.1);
  assert.ok(c.leaving && !w.byId.has(c.id), 'repart par l’entrée');
  run(w, 70);
  assert.ok(!w.chars.includes(c));
});

test('session Claude Code déjà active à l’ouverture du bureau : placée directement en salle serveur', () => {
  const w = world([mk('ag_1')]);
  w.setDevTeam([{ id: 'abcdef12', label: 'Claude Code · abcd', project: 'ro-ai', state: 'working', present: true, since: '', last_at: '', turn_at: '', actions: [], counts: { tools: 0, write: 0, test: 0, build: 0, deploy: 0, commit: 0 } }]);
  w.update(1 / 30, 0); w.update(1 / 30, 0);
  const c = w.byId.get('__dev__:abcdef12')!;
  assert.equal(roomOf(w, c.x, c.y)!.kind, 'server');
});

test('livraison réelle : un livreur entre, apporte le colis à l’accueil (annoncé par la réceptionniste) et repart', () => {
  const w = world([mk('ag_1', { name: 'Perforce' })], true);
  run(w, 2);
  w.deliver(501, 'PerforceBot', 'Perforce');
  run(w, 3);
  assert.ok(!w.byId.has('__courier__:501'), 'il attend que la camionnette soit arrêtée');
  run(w, 2);
  const c = w.byId.get('__courier__:501')!;
  assert.ok(c && c.extra === 'courier');
  let announced = '';
  run(w, 40, () => { const r = w.byId.get('__reception__'); if (r?.bubble.startsWith('Colis')) announced = r.bubble; });
  assert.equal(announced, 'Colis de PerforceBot pour Perforce !');
  assert.ok(announced.length <= 44);
  run(w, 40);
  assert.ok(!w.chars.includes(c), 'reparti par l’entrée');
});

test('réceptionniste : petites tâches dans le hall (vie sociale seulement), puis retour à la banque d’accueil', () => {
  const w = world([mk('ag_1')], true);
  run(w, 2);
  const r = w.byId.get('__reception__')!, post = w.layout.staff.reception!.tile;
  const lobby = roomOf(w, r.x, r.y)!;
  let left = false, back = false;
  run(w, 240, () => {
    const away = Math.floor(r.x / TILE) !== post.col || Math.floor(r.y / TILE) !== post.row;
    if (away) { left = true; assert.equal(roomOf(w, r.x, r.y)?.id, lobby.id, 'reste dans le hall'); } else if (left) back = true;
  });
  assert.ok(left && back, 'elle quitte son poste puis y revient');
  const calm = world([mk('ag_1')], false);
  run(calm, 2);
  const r2 = calm.byId.get('__reception__')!;
  run(calm, 240, () => assert.deepEqual([Math.floor(r2.x / TILE), Math.floor(r2.y / TILE)], [post.col, post.row], 'sans vie sociale : immobile'));
});

test('vie intérieure : un dialogue généré sert une fois, au bon duo, chaque réplique au bon interlocuteur', () => {
  const w = world([mk('ag_a'), mk('ag_b'), mk('ag_c')], true);
  w.setGeneratedDialogues([{ a: 'ag_b', b: 'ag_a', lines: ['Salut A !', 'Salut B.', 'Café ?'] }], '2026-11-26');
  const g = (w as unknown as { generated(a: unknown, b: unknown): { lines: { s: number; text: string }[] } | null });
  const [a, b, c] = ['ag_a', 'ag_b', 'ag_c'].map((id) => w.byId.get(id)!);
  assert.equal(g.generated.call(w, a, c), null, 'pas pour un autre duo');
  const d = g.generated.call(w, a, b)!;
  assert.deepEqual(d.lines.map((l) => [l.s, l.text]), [[1, 'Salut A !'], [0, 'Salut B.'], [1, 'Café ?']], 'B parle en premier');
  assert.equal(g.generated.call(w, b, a), null, 'une seule fois');
});

test('orchestrateur : sort de la régie pour une approbation en attente, y reste, puis revient (dessin fixe masqué pendant la sortie)', () => {
  const w = world([mk('a', { department: 'Dev' })]);
  const run2 = (s: number) => run(w, s);
  run2(1);
  assert.equal(w.orchAway(), false, 'à la régie au départ');
  w.setOrchSignals({ alertAgent: null, approvals: 1, quiet: false });
  run2(40);
  const c = w.byId.get('__orchestrator__');
  assert.ok(c && w.orchAway(), 'il a quitté la régie');
  assert.equal(roomOf(w, c!.x, c!.y)!.kind, 'approval', 'il attend en salle d\'approbation');
  w.setOrchSignals({ alertAgent: null, approvals: 0, quiet: false });
  run2(60);
  assert.equal(w.orchAway(), false, 'revenu à la régie');
  assert.equal(w.byId.has('__orchestrator__'), false);
});

test('orchestrateur : va voir l\'agent dont l\'exécution vient de démarrer, puis rentre', () => {
  const w = world([mk('a', { department: 'Dev' })]);
  run(w, 1);
  w.orchVisit('a');
  let away = false;
  run(w, 60, () => { if (w.orchAway()) away = true; });
  assert.ok(away, 'sortie constatée');
  run(w, 40);
  assert.equal(w.orchAway(), false, 'de retour');
});
