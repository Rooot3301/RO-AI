import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEM_EXT, PANEL_ITEMS, FLOOR_ITEMS, SCREEN_ITEMS, KEYBOARD_ITEMS, boxesOverlap, deskPlan } from './deskSlots.ts';
import type { DecorItem } from '../../api/types.ts';

const ALL: DecorItem[] = ['plant_small', 'photo_frame', 'mug', 'desk_lamp', 'multi_monitor', 'network_rack', 'shield_poster', 'status_board', 'ship_model', 'space_poster', 'planet_globe', 'star_map', 'mech_keyboard', 'code_poster', 'rubber_duck', 'second_monitor', 'book_stack', 'documents', 'magnifier', 'notes_board', 'cable_box', 'server_mini', 'chart_poster', 'typewriter', 'drawing_tablet', 'color_swatches', 'art_poster', 'calculator', 'headset_stand'];
const THEMES: DecorItem[][] = [
  ['plant_small', 'photo_frame', 'mug', 'desk_lamp'], ['multi_monitor', 'network_rack', 'shield_poster', 'status_board'], ['ship_model', 'space_poster', 'planet_globe', 'star_map'],
  ['mech_keyboard', 'code_poster', 'rubber_duck', 'second_monitor'], ['book_stack', 'documents', 'magnifier', 'notes_board'], ['multi_monitor', 'status_board', 'cable_box', 'server_mini'],
  ['chart_poster', 'second_monitor', 'notes_board', 'mug'], ['book_stack', 'typewriter', 'documents', 'desk_lamp'], ['drawing_tablet', 'color_swatches', 'art_poster', 'plant_small'],
  ['calculator', 'chart_poster', 'documents', 'photo_frame'], ['headset_stand', 'notes_board', 'mug', 'plant_small'],
  ['multi_monitor', 'network_rack', 'shield_poster'], ['ship_model', 'space_poster', 'planet_globe'], // cas signalé en production (Veille)
];

function check(items: DecorItem[], col = 5, row = 7) {
  const p = deskPlan(col, row, items);
  const x = col * 16, y = row * 16;
  for (let i = 0; i < p.parts.length; i++) {
    const a = p.parts[i];
    assert.ok(a.x >= x - 0.01 && a.x + a.w <= x + 64.01 && a.y >= y - 24.01 && a.y + a.h <= y + 16.01, `${a.slot} reste dans l'emprise du poste`);
    for (let j = i + 1; j < p.parts.length; j++) assert.ok(!boxesOverlap(a, p.parts[j]), `${items.join(',')} : ${a.slot}/${a.item} chevauche ${p.parts[j].slot}/${p.parts[j].item}`);
  }
  for (const sc of p.screens) assert.ok(sc.x - 1 >= x + 9.39 && sc.x + sc.w + 1 <= x + 38.61 && sc.y - 1 >= y - 17.21, 'écrans dans leur zone');
  // chaque objet est placé une seule fois ou explicitement écarté ; aucun n'est superposé
  const placed = p.parts.filter((q) => q.item).map((q) => q.item!);
  for (const it of new Set(items)) {
    const handled = placed.includes(it) || p.dropped.includes(it) || SCREEN_ITEMS.has(it) || KEYBOARD_ITEMS.has(it);
    assert.ok(handled, `${it} traité`);
  }
  assert.equal(new Set(placed).size, placed.length);
  return p;
}

test('poste : écrans, clavier, objets de cloison et objets posés ne se chevauchent jamais (thèmes par défaut et cas réel)', () => {
  for (const t of THEMES) {
    const p = check(t);
    // jusqu'à 4 objets « simples » par thème : rien n'est écarté
    assert.deepEqual(p.dropped, [], `${t.join(',')} : tout est placé`);
  }
});

test('poste : toutes les paires et 3 000 combinaisons aléatoires de 1 à 6 objets restent sans chevauchement', () => {
  for (let i = 0; i < ALL.length; i++) for (let j = i + 1; j < ALL.length; j++) check([ALL[i], ALL[j]]);
  let s = 12345;
  const r = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
  for (let n = 0; n < 3000; n++) {
    const k = 1 + Math.floor(r() * 6), pick: DecorItem[] = [];
    while (pick.length < k) { const it = ALL[Math.floor(r() * ALL.length)]; if (!pick.includes(it)) pick.push(it); }
    check(pick, Math.floor(r() * 40), 3 + Math.floor(r() * 30));
  }
});

test('poste : chaque objet posé tient dans l\'emplacement prévu ; catégories cohérentes', () => {
  for (const it of ALL) {
    if (PANEL_ITEMS.has(it) || FLOOR_ITEMS.has(it) || SCREEN_ITEMS.has(it) || KEYBOARD_ITEMS.has(it)) continue;
    assert.ok(ITEM_EXT[it], `${it} a une étendue connue`);
    const p = deskPlan(0, 2, [it]);
    assert.equal(p.parts.find((q) => q.item === it)!.kind, 'surface');
  }
  assert.equal(deskPlan(0, 2, ['network_rack', 'server_mini']).dropped.length, 1, 'un seul objet au sol');
  assert.equal(deskPlan(0, 2, ['code_poster', 'art_poster', 'chart_poster']).dropped.length, 1, 'deux affiches au plus');
});
