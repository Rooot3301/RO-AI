import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planLayout, fitPlan, planKey, orderedDepartments, levelOfRow, levelSeeds, T, TILE } from './plan.ts';
import type { Layout, PlanInput } from './plan.ts';
import { PathFinder, reachable } from './pathfinding.ts';
import { FURNITURE } from './furniture.ts';

const agents = (n: number, dept = 'Dev', prefix = 'ag_', rank0 = 0) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${String(i).padStart(2, '0')}`, department: dept, rank: rank0 + i }));
const big = (): PlanInput => {
  const depts = ['Veille', 'Infrastructure', 'Développement', 'Documentation', 'Sécurité', 'Support', 'Données'];
  return { departments: depts, agents: depts.flatMap((d, i) => agents(3 + (i * 2) % 7, d, `ag_${i}_`, i * 10)) };
};

/** Invariants communs : connexité complète depuis l'entrée (et, à l'étage, depuis le palier), portes dégagées, aucun
 * chevauchement, tout dans sa pièce ; chaque étage a son ascenseur et son escalier, accessibles. */
function checkInvariants(l: Layout) {
  const reach = reachable(l, levelSeeds(l));
  for (let f = 0; f < l.floors; f++) {
    const own = reachable(l, f === 0 ? l.spawn : l.portals.find((q) => q.level === f && q.kind === 'lift')!.tile);
    const mine = l.portals.filter((q) => q.level === f);
    assert.deepEqual(mine.map((q) => q.kind).sort(), ['lift', 'stairs'], `accès de l'étage ${f}`);
    for (const q of mine) { assert.ok(own[q.tile.row * l.cols + q.tile.col], `accès ${q.kind} de l'étage ${f} atteignable`); assert.equal(levelOfRow(l, q.tile.row), f); }
  }
  const at = (c: number, r: number) => r * l.cols + c;
  // chaque pièce est accessible (au moins une case de l'intérieur), chaque porte est libre et franchissable
  for (const room of l.rooms) {
    let ok = false;
    for (let r = room.y; r < room.y + room.h && !ok; r++) for (let c = room.x; c < room.x + room.w && !ok; c++) if (reach[at(c, r)]) ok = true;
    assert.ok(ok, `pièce ${room.key} accessible depuis l'entrée`);
  }
  for (const d of l.doors) for (let i = 0; i < d.w; i++) {
    const c = d.col + i, r = d.row;
    assert.equal(l.walkable[at(c, r)], 1, `porte ${d.id} libre`);
    assert.ok(reach[at(c, r)], `porte ${d.id} atteignable`);
    for (const k of [-1, 1]) { const rr = r + k; if (l.tiles[at(c, rr)] === T.FLOOR || l.tiles[at(c, rr)] === T.OUT) assert.equal(l.walkable[at(c, rr)], 1, `abords de la porte ${d.id} dégagés`); }
  }
  // chaque siège, chaque place debout, chaque emplacement d'usage est accessible
  for (const d of l.desks) { assert.ok(reach[at(d.seat.col, d.seat.row)], `siège de ${d.agentId}`); assert.ok(reach[at(d.stand.col, d.stand.row)], `place debout de ${d.agentId}`); }
  for (const s of l.spots) assert.ok(reach[at(s.approach.col, s.approach.row)], `emplacement ${s.kind} ${s.id}`);
  for (const t of l.queueTiles) assert.ok(reach[at(t.col, t.row)], 'file d\'attente');
  // aucun chevauchement entre meubles bloquants et postes ; tout meuble est dans sa pièce
  const owner = new Map<number, string>();
  const claim = (c: number, r: number, who: string) => { const k = at(c, r); assert.ok(!owner.has(k), `chevauchement ${who} / ${owner.get(k)}`); owner.set(k, who); };
  for (const d of l.desks) for (let i = 0; i < 4; i++) claim(d.col + i, d.row, `poste ${d.agentId}`);
  for (const f of l.furniture) {
    if (!FURNITURE[f.kind].blocks) continue;
    for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) {
      claim(f.col + i, f.row + j, f.key);
      if (f.room >= 0) { const k = at(f.col + i, f.row + j); assert.equal(l.roomAt[k], f.room, `${f.key} dans sa pièce`); assert.equal(l.tiles[k], T.FLOOR); }
    }
  }
}

test('plan vide : toutes les salles du siège existent, aucun poste', () => {
  const l = planLayout({ departments: [], agents: [] });
  assert.equal(l.desks.length, 0);
  const kinds = new Set(l.rooms.map((r) => r.kind));
  for (const k of ['lobby', 'control', 'corridor', 'approval', 'meeting', 'break', 'coffee', 'server', 'library'] as const) assert.ok(kinds.has(k), `salle ${k}`);
  checkInvariants(l);
});

test('déterminisme : mêmes entrées, même plan ; rang de création respecté (nouveau poste en fin de rangée)', () => {
  const a = agents(5).concat(agents(3, 'Veille', 'ag_v', 5));
  const l1 = planLayout({ departments: ['Dev', 'Veille'], agents: a });
  const l2 = planLayout({ departments: ['Dev', 'Veille'], agents: a.slice().reverse() });
  assert.deepEqual(l1.desks, l2.desks);
  assert.deepEqual(l1.furniture, l2.furniture);
  assert.equal(planKey({ departments: ['Dev', 'Veille'], agents: a }), planKey({ departments: ['Dev', 'Veille'], agents: a.slice().reverse() }));
  // un agent plus récent (rang élevé) mais d'identifiant « plus petit » prend le dernier poste de son département
  const l3 = planLayout({ departments: ['Dev'], agents: agents(3).concat({ id: 'aa_new', department: 'Dev', rank: 99 }) });
  assert.equal(l3.desks.filter((d) => l3.rooms[d.room].dept === 'Dev').sort((p, q) => p.index - q.index).at(-1)!.agentId, 'aa_new');
});

test('un poste par agent, dans l\'open space de son département, sans chevauchement, tous accessibles', () => {
  const a = agents(7).concat(agents(2, 'Veille', 'ag_v', 7));
  const l = planLayout({ departments: ['Dev', 'Veille'], agents: a });
  assert.equal(l.desks.length, 9);
  for (const d of l.desks) {
    const room = l.rooms[d.room];
    assert.equal(room.kind, 'department');
    assert.equal(room.dept, a.find((x) => x.id === d.agentId)!.department);
    assert.ok(d.col >= room.x && d.col + 4 <= room.x + room.w && d.row > room.y && d.row + 2 < room.y + room.h);
    assert.equal(d.seatX, (d.seat.col + 0.5) * TILE);
  }
  checkInvariants(l);
});

test('départements extensibles : ceux des agents hors liste sont ajoutés (alphabétique)', () => {
  const input = { departments: ['Dev'], agents: [{ id: 'a', department: 'Zèbre' }, { id: 'b', department: 'Alpha' }, { id: 'c', department: 'Dev' }] };
  assert.deepEqual(orderedDepartments(input), ['Dev', 'Alpha', 'Zèbre']);
  const l = planLayout(input);
  assert.equal(l.rooms.filter((z) => z.kind === 'department').length, 3);
  checkInvariants(l);
});

test('architecture : entrée principale au sud du hall, régie de l\'orchestrateur, couloir principal, salle serveur, réunion vide', () => {
  const l = planLayout({ departments: ['Dev'], agents: agents(4) });
  const lobby = l.rooms.find((r) => r.kind === 'lobby')!;
  assert.equal(l.entrance.room, lobby.id);
  assert.equal(l.entrance.row, lobby.y + lobby.h, 'porte d\'entrée dans le mur sud du hall');
  assert.equal(l.tiles[l.spawn.row * l.cols + l.spawn.col], T.OUT, 'on arrive de l\'extérieur');
  const ctl = l.rooms.find((r) => r.kind === 'control')!;
  assert.ok(l.control.col >= ctl.x && l.control.col + l.control.w <= ctl.x + ctl.w);
  assert.ok(l.rooms.some((r) => r.kind === 'corridor' && r.h === 3), 'couloir principal de 3 cases');
  // la salle de réunion n'offre que des chaises « meet », réservées aux conversations réelles avec l'utilisateur
  // (la vie sociale n'utilise jamais ce type d'emplacement : aucune réunion simulée)
  const meeting = l.rooms.find((r) => r.kind === 'meeting')!;
  const inMeeting = l.spots.filter((s) => s.room === meeting.id);
  assert.ok(inMeeting.length >= 4 && inMeeting.every((s) => s.kind === 'meet'));
  assert.deepEqual([...l.meetSpots].sort(), inMeeting.map((s) => s.id).sort());
  for (const s of inMeeting) assert.ok(l.walkable[s.approach.row * l.cols + s.approach.col], 'chaise accessible par l’arrière');
  assert.ok(l.shelfSpots.length > 0 && l.shelfSpots.every((i) => l.rooms[l.spots[i].room].kind === 'library'));
  // murs extérieurs fermés (hors entrée et fenêtres)
  const B = l.building;
  for (let c = B.x; c < B.x + B.w; c++) for (const r of [B.y, B.y + B.h - 1]) {
    const t = l.tiles[r * l.cols + c];
    assert.ok(t === T.WALL || t === T.WINDOW || (t === T.DOOR && r === l.entrance.row), `mur extérieur en ${c},${r}`);
  }
});

test('beaucoup d\'agents et de départements : plusieurs ailes reliées, tout reste accessible, pièces proportionnées', () => {
  const input = big();
  for (const aspect of [0.8, 1.6, 2.4]) {
    const l = fitPlan(input, aspect);
    checkInvariants(l);
    for (const r of l.rooms) if (r.kind !== 'corridor') assert.ok(r.w <= 44 && r.h <= 10, `pièce ${r.key} proportionnée (${r.w}x${r.h})`);
  }
  const wide = fitPlan(input, 2.6), tall = fitPlan(input, 0.8);
  assert.ok(wide.width / wide.height > tall.width / tall.height, 'la forme suit les proportions de l\'écran');
  for (let W = 1; W <= 3; W++) checkInvariants(planLayout({ ...input, wings: W }));
  assert.ok(planLayout({ ...input, wings: 2 }).rooms.some((r) => r.band === 'V'), 'couloir vertical entre les ailes');
});

test('le bâtiment s\'agrandit quand les départements dépassent l\'emprise du rez-de-chaussée', () => {
  const a = planLayout({ departments: ['Dev'], agents: agents(2) });
  const more = ['Ops', 'Data', 'Sécu', 'Docs'];
  const b = planLayout({ departments: ['Dev', ...more], agents: agents(2).concat(more.flatMap((d, i) => agents(5, d, `ag_${i}_`, 10 + i * 10))) });
  assert.ok(b.building.w * b.building.h > a.building.w * a.building.h);
  assert.equal(b.rooms.filter((r) => r.kind === 'department').length, 5);
  const c = planLayout({ departments: ['Dev'], agents: agents(16) });
  assert.ok(c.deskRows === 3, 'grand département : trois rangées de postes');
  checkInvariants(c);
});

test('pathfinding A* : 8-connexe sans couper les angles, contourne les obstacles, évite une case, inaccessible = null', () => {
  const l = planLayout({ departments: ['Dev'], agents: agents(2) });
  const pf = new PathFinder(l);
  const d = l.desks[0], goal = l.portals.find((q) => q.level === 0 && q.kind === 'stairs')!.tile; // pied de l'escalier (RDC)
  const p = pf.findTiles(l.spawn, goal)!;
  assert.ok(p.length > 0);
  let prev = l.spawn;
  for (const t of p) {
    const dc = t.col - prev.col, dr = t.row - prev.row;
    assert.ok(Math.abs(dc) <= 1 && Math.abs(dr) <= 1 && (dc || dr));
    assert.equal(l.walkable[t.row * l.cols + t.col], 1);
    if (dc && dr) { assert.equal(l.walkable[prev.row * l.cols + t.col], 1); assert.equal(l.walkable[t.row * l.cols + prev.col], 1); }
    prev = t;
  }
  assert.deepEqual(prev, goal);
  assert.equal(pf.findTiles(l.spawn, d.seat), null, 'pas de chemin direct vers l’étage : on passe par l’escalier ou l’ascenseur');
  assert.deepEqual(pf.findTiles(l.spawn, l.spawn), []);
  assert.equal(pf.findTiles(l.spawn, { col: d.col, row: d.row }), null, 'bureau bloqué');
  assert.equal(pf.findTiles(l.spawn, { col: -1, row: 0 }), null);
  // éviter une case du chemin : on passe ailleurs si possible
  const oc = new Int16Array(4096), or = new Int16Array(4096);
  const mid = p[Math.floor(p.length / 2)], avoid = [mid.row * l.cols + mid.col];
  const n = pf.find(l.spawn.col, l.spawn.row, goal.col, goal.row, oc, or, avoid, 1);
  assert.ok(n > 0);
  let crosses = false;
  for (let i = 0; i < n; i++) if (oc[i] === mid.col && or[i] === mid.row) crosses = true;
  assert.equal(crosses, false);
});

test('pathfinding A* : chemin optimal sur une grille ouverte et tampons réutilisés', () => {
  const cols = 30, rows = 20, walkable = new Uint8Array(cols * rows).fill(1);
  for (let r = 2; r < 18; r++) walkable[r * cols + 15] = 0; // mur avec passages en haut et en bas
  const pf = new PathFinder({ cols, rows, walkable });
  const p = pf.findTiles({ col: 2, row: 10 }, { col: 28, row: 10 })!;
  assert.ok(p.length >= 26 && p.length <= 34, `longueur ${p.length}`);
  const p2 = pf.findTiles({ col: 2, row: 10 }, { col: 28, row: 10 })!;
  assert.deepEqual(p, p2, 'déterministe');
});

test('tableaux muraux : planning dans le hall, écran des limites en salle serveur avec une case libre pour le lire', () => {
  for (const n of [0, 1, 3, 8, 20]) {
    const agents = Array.from({ length: n }, (_, i) => ({ id: `a${i}`, department: ['Dev', 'Veille', 'Action'][i % 3] }));
    const l = fitPlan({ departments: ['Dev', 'Veille', 'Action'].slice(0, Math.max(1, Math.min(3, n))), agents }, 1.6);
    const lobby = l.rooms.find((r) => r.kind === 'lobby')!, server = l.rooms.find((r) => r.kind === 'server')!;
    const pl = l.wallDecor.find((w) => w.kind === 'planning'), lim = l.furniture.find((f) => f.kind === 'status_board');
    assert.ok(pl && pl.room === lobby.id && pl.w >= 4, `planning absent (${n} agents)`);
    assert.ok(lim && lim.room === server.id, `écran des limites absent (${n} agents)`);
    for (const w of l.wallDecor) for (const o of l.wallDecor) if (w !== o && w.row === o.row) assert.ok(w.col + w.w <= o.col || o.col + o.w <= w.col, `décors muraux superposés : ${w.kind} / ${o.kind}`);
    const sp = l.staff.limitsSpot!;
    assert.ok(sp && l.walkable[sp.tile.row * l.cols + sp.tile.col] && l.roomAt[sp.tile.row * l.cols + sp.tile.col] === server.id);
  }
});

test('immeuble : rue avec places et lampadaires, boîte aux lettres à l’accueil, palier avec ascenseur et escalier au bout du couloir', () => {
  for (const n of [0, 4, 12, 30]) {
    const agents = Array.from({ length: n }, (_, i) => ({ id: `a${i}`, department: ['Dev', 'Veille', 'Action', 'Support'][i % 4] }));
    const l = fitPlan({ departments: ['Dev', 'Veille', 'Action', 'Support'].slice(0, Math.max(1, Math.min(4, n))), agents }, 1.6);
    const S = l.street, B = l.building;
    assert.equal(S.sidewalk, B.y + B.h + 3); assert.equal(S.far, S.road + 2); assert.ok(S.far < l.rows);
    assert.ok(S.spots.length >= 4 && S.lamps.length >= 2, `rue équipée (${n} agents)`);
    for (const c of S.spots) assert.ok(c + 3 <= S.cross.a || c >= S.cross.b, 'aucune place sur le passage piéton');
    assert.ok(l.walkable[l.spawn.row * l.cols + l.spawn.col] && l.spawn.row < S.sidewalk, 'les agents entrent par le parvis');
    const lobby = l.rooms.find((r) => r.kind === 'lobby')!;
    assert.ok(l.furniture.some((f) => f.kind === 'mailbox' && f.room === lobby.id), 'boîte aux lettres dans le hall');
    // palier au bout est du couloir principal (chaque étage), ascenseur au mur nord, escalier contre le pignon est
    for (let f = 0; f < l.floors; f++) {
      const g = l.rooms.find((r) => r.kind === 'landing' && r.level === f)!;
      assert.ok(g && g.x > B.x + B.w - 1, `palier hors du bloc principal (étage ${f})`);
      const corr = l.rooms.find((r) => r.kind === 'corridor' && r.level === f && r.wing === 0 && r.band === 'C')!;
      assert.equal(g.x, corr.x + corr.w + 1); assert.ok(g.y < corr.y && g.y + g.h > corr.y + corr.h);
      for (let r = corr.y; r < corr.y + corr.h; r++) assert.equal(l.walkable[r * l.cols + corr.x + corr.w], 1, 'couloir ouvert sur le palier');
      assert.ok(l.wallDecor.some((w) => w.kind === 'elevator' && w.room === g.id), 'ascenseur');
      assert.ok(l.furniture.some((x) => x.kind === 'stairs' && x.room === g.id && x.variant === f), 'escalier');
    }
    assert.ok(!l.wallDecor.some((w) => w.kind === 'stairs'), 'plus de fausse porte d’escalier');
    assert.ok(l.staff.floorRack && levelOfRow(l, l.staff.floorRack.tile.row) === 1, 'baie réseau d’étage');
  }
});

test('étages : services au rez-de-chaussée, open spaces des départements au 1er, même emprise', () => {
  const l = planLayout({ departments: ['Dev', 'Veille'], agents: agents(3).concat(agents(2, 'Veille', 'ag_v', 3)) });
  assert.equal(l.floors, 2); assert.equal(l.rows, l.floorRows * 2);
  for (const k of ['lobby', 'control', 'approval', 'meeting', 'library', 'server'] as const) assert.ok(l.rooms.filter((r) => r.kind === k).every((r) => r.level === 0), `${k} au RDC`);
  for (const r of l.rooms.filter((x) => x.kind === 'department')) assert.equal(r.level, 1, 'open space au 1er');
  for (const d of l.desks) assert.equal(levelOfRow(l, d.row), 1, 'postes au 1er');
  assert.ok(l.rooms.some((r) => r.kind === 'break' && r.level === 1) && l.rooms.some((r) => r.kind === 'coffee' && r.level === 1), 'repos et kitchenette au 1er');
  for (const r of l.rooms) assert.equal(levelOfRow(l, r.y), r.level, `pièce ${r.key} dans son étage`);
  // même emprise : les murs extérieurs des deux étages se superposent
  const B = l.building, F = l.floorRows;
  for (let c = B.x; c < B.x + B.w; c++) for (const r of [B.y, B.y + B.h - 1]) assert.ok(l.tiles[(r + F) * l.cols + c] === T.WALL || l.tiles[(r + F) * l.cols + c] === T.WINDOW, `façade du 1er en ${c},${r}`);
  // rue, parvis et entrée seulement au rez-de-chaussée
  assert.equal(levelOfRow(l, l.spawn.row), 0); assert.equal(levelOfRow(l, l.street.far), 0);
  assert.ok(!l.furniture.some((f) => f.room < 0 && levelOfRow(l, f.row) === 1), 'pas d’abords au 1er');
  checkInvariants(l);
});
