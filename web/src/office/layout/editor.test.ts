import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planLayout, levelSeeds } from './plan.ts';
import type { PlanInput } from './plan.ts';
import { EMPTY_OVERRIDES, hideFurniture, moveFurniture, parseLayoutDoc, rotateFurniture, showFurniture, toLayoutDoc, LAYOUT_VERSION } from './editor.ts';
import { reachable } from './pathfinding.ts';

const input = (): PlanInput => ({ departments: ['Dev', 'Veille'], agents: [0, 1, 2, 3, 4].map((i) => ({ id: `ag_${i}`, department: i % 2 ? 'Veille' : 'Dev', rank: i })), overrides: EMPTY_OVERRIDES });

test('éditeur : déplacer un meuble décoratif sur une case libre de sa pièce (position relative à la pièce, clé stable)', () => {
  const inp = input(), l = planLayout(inp);
  const plant = l.furniture.find((f) => f.kind === 'plant' && l.rooms[f.room].kind === 'coffee')!;
  const room = l.rooms[plant.room];
  // cherche une case libre de la pièce
  let target: { col: number; row: number } | null = null;
  for (let r = room.y + 2; r < room.y + room.h - 2 && !target; r++) for (let c = room.x + 1; c < room.x + room.w - 1 && !target; c++) {
    const r2 = moveFurniture(inp, l, plant.key, c, r);
    if (r2.ok) target = { col: c, row: r };
  }
  assert.ok(target, 'au moins un emplacement accepté');
  const res = moveFurniture(inp, l, plant.key, target!.col, target!.row);
  assert.ok(res.ok);
  if (!res.ok) return;
  assert.deepEqual(res.overrides.furniture[plant.key], { x: target!.col - room.x, y: target!.row - room.y });
  const moved = res.layout.furniture.find((f) => f.key === plant.key)!;
  assert.deepEqual([moved.col, moved.row], [target!.col, target!.row]);
  assert.equal(res.layout.rejected.length, 0);
});

test('éditeur : refus des chevauchements, des sorties de pièce, des portes bloquées et des meubles fixes', () => {
  const inp = input(), l = planLayout(inp);
  const plant = l.furniture.find((f) => f.kind === 'plant' && l.rooms[f.room].kind === 'coffee')!;
  const other = l.furniture.find((f) => f.room === plant.room && f.blocks && f.key !== plant.key)!;
  const over = moveFurniture(inp, l, plant.key, other.col, other.row);
  assert.equal(over.ok, false);
  const room = l.rooms[plant.room];
  assert.equal(moveFurniture(inp, l, plant.key, room.x - 3, room.y).ok, false, 'hors de la pièce');
  const door = l.doors.find((d) => d.room === plant.room)!;
  const inside = room.corridorSide === 'top' ? door.row + 1 : door.row - 1;
  const blockDoor = moveFurniture(inp, l, plant.key, door.col, inside);
  assert.equal(blockDoor.ok, false, 'devant la porte');
  const rack = l.furniture.find((f) => f.kind === 'rack')!;
  assert.equal(moveFurniture(inp, l, rack.key, rack.col, rack.row + 1).ok, false, 'baie serveur fixe');
  const console = l.furniture.find((f) => f.kind === 'console')!;
  assert.equal(hideFurniture(inp, l, console.key).ok, false, 'console de la régie fixe');
});

test('éditeur : un déplacement qui couperait un passage est refusé (connexité vérifiée)', () => {
  const inp = input(), l = planLayout(inp);
  // essaie toutes les positions d'un canapé du salon : aucune position acceptée ne rend un siège inaccessible
  const sofa = l.furniture.find((f) => f.kind === 'sofa' && l.rooms[f.room].kind === 'break')!;
  const room = l.rooms[sofa.room];
  let accepted = 0;
  for (let r = room.y; r < room.y + room.h; r++) for (let c = room.x; c < room.x + room.w; c++) {
    const res = moveFurniture(inp, l, sofa.key, c, r);
    if (!res.ok) continue;
    accepted++;
    const L2 = res.layout, reach = reachable(L2, levelSeeds(L2));
    for (const s of L2.spots) assert.ok(reach[s.approach.row * L2.cols + s.approach.col], 'emplacement accessible');
    for (const d of L2.doors) assert.ok(reach[d.row * L2.cols + d.col], 'porte accessible');
  }
  assert.ok(accepted > 0);
});

test('éditeur : masquer, réafficher, pivoter ; document versionné, lecture tolérante', () => {
  const inp = input(), l = planLayout(inp);
  const plant = l.furniture.find((f) => f.kind === 'plant_tall' && f.movable)!;
  const h = hideFurniture(inp, l, plant.key);
  assert.ok(h.ok);
  if (!h.ok) return;
  assert.ok(!h.layout.furniture.some((f) => f.key === plant.key));
  const shown = showFurniture(h.overrides, plant.key);
  assert.ok(planLayout({ ...inp, overrides: shown }).furniture.some((f) => f.key === plant.key));
  const sofa = l.furniture.find((f) => f.kind === 'sofa')!;
  const rot = rotateFurniture(inp, l, sofa.key);
  if (rot.ok) assert.notEqual(rot.layout.furniture.find((f) => f.key === sofa.key)!.dir, sofa.dir);
  const doc = toLayoutDoc(h.overrides);
  assert.equal(doc.version, LAYOUT_VERSION);
  assert.deepEqual(parseLayoutDoc(JSON.parse(JSON.stringify(doc))), h.overrides);
  assert.deepEqual(parseLayoutDoc({ version: 99, furniture: { a: { hidden: true } } }).furniture, {}, 'version inconnue ignorée');
  assert.deepEqual(parseLayoutDoc({ version: 1, furniture: { 'bad key': { x: 1 }, 'coffee/plant-0': { x: 'z', y: -4, hidden: 'oui' } } }).furniture, {}, 'entrées invalides ignorées');
  assert.deepEqual(parseLayoutDoc(null).furniture, {});
});

test('éditeur : une personnalisation devenue invalide (plan modifié) est ignorée, le meuble garde sa place', () => {
  const inp = input(), l = planLayout(inp);
  const plant = l.furniture.find((f) => f.kind === 'plant' && f.movable)!;
  const bad = { version: 1 as const, furniture: { [plant.key]: { x: 0, y: 0 } } };
  const l2 = planLayout({ ...inp, overrides: bad });
  const same = l2.furniture.find((f) => f.key === plant.key)!;
  if (l2.rejected.length) assert.deepEqual([same.col, same.row], [plant.col, plant.row]);
  const ghost = planLayout({ ...inp, overrides: { version: 1, furniture: { 'nulle/part-0': { hidden: true } } } });
  assert.equal(ghost.rejected[0].key, 'nulle/part-0');
});
