// Emplacements réservés d'un poste de travail (calcul pur, testable) : chaque objet de décor de la fiche reçoit une place
// dédiée qui ne chevauche ni les écrans, ni le clavier, ni un autre objet. Un objet sans place compatible est écarté
// (jamais superposé). Coordonnées en unités monde ; (x, y) = coin haut-gauche du plan de travail (case `desk.col/row`).
import type { DecorItem } from '../../api/types.ts';
import { TILE } from './geom.ts';

export interface Box { x: number; y: number; w: number; h: number }
export type PartKind = 'screens' | 'keyboard' | 'mouse' | 'panel' | 'surface' | 'floor' | 'pedestal' | 'nameplate' | 'postit';
export interface DeskPart extends Box {
  kind: PartKind; slot: string; item: DecorItem | null;
  /** Point d'ancrage du dessin de l'objet (surface : base de l'objet ; panneau : coin haut-gauche). */
  ax: number; ay: number;
}
export interface DeskScreen extends Box { main: boolean }
export interface DeskPlan { parts: DeskPart[]; screens: DeskScreen[]; dropped: DecorItem[]; floor: DecorItem | null }

export const PANEL_ITEMS: ReadonlySet<DecorItem> = new Set(['shield_poster', 'status_board', 'space_poster', 'star_map', 'code_poster', 'notes_board', 'chart_poster', 'art_poster']);
export const FLOOR_ITEMS: ReadonlySet<DecorItem> = new Set(['network_rack', 'server_mini']);
export const SCREEN_ITEMS: ReadonlySet<DecorItem> = new Set(['multi_monitor', 'second_monitor']);
/** Le clavier mécanique remplace le clavier standard (pas d'emplacement propre). */
export const KEYBOARD_ITEMS: ReadonlySet<DecorItem> = new Set(['mech_keyboard']);

/** Étendue dessinée des objets posés, relative à leur ancrage : [x0, x1, y0, y1]. */
export const ITEM_EXT: Readonly<Partial<Record<DecorItem, readonly [number, number, number, number]>>> = {
  plant_small: [-4, 4, -7, 2.2], photo_frame: [-2.6, 2.6, -5, -0.3], mug: [-1.6, 2.8, -2.4, 1], desk_lamp: [-2.2, 4.4, -9.8, 2],
  ship_model: [-4.2, 4.2, -6.2, 0.2], planet_globe: [-3.7, 3.7, -7, 1], rubber_duck: [-2.1, 3.8, -4.6, 1.1], book_stack: [-3, 3.5, -4.6, 0.5],
  documents: [-3.6, 3.6, -3.6, 1.2], magnifier: [-2.3, 2.7, -3.4, 1.5], typewriter: [-4.1, 4.1, -8.2, 2.1], drawing_tablet: [-4.1, 4.7, -3.2, 2.5],
  color_swatches: [-3.2, 3.2, -5.2, 1], calculator: [-2.1, 2.1, -3.1, 2.1], headset_stand: [-3.3, 3.3, -7.8, 0.9], cable_box: [-3.1, 3.1, -5.2, 1.1],
};
export const PANEL_W = 7.6, PANEL_H = 8;

/** Emplacements fixes d'un poste. */
function slots(x: number, y: number) {
  return {
    screens: { x: x + 9.4, y: y - 17.2, w: 29.2, h: 16.2 },
    keyboard: { x: x + 18, y: y - 1, w: 16, h: 4.4 },
    mouse: { x: x + 35.2, y: y - 0.8, w: 2.8, h: 3.4 },
    panelL: { x: x + 1.2, y: y - 18.4, w: 8, h: 8.6 },
    panelR: { x: x + 38.8, y: y - 18.4, w: 8, h: 8.6 },
    surfL: { x: x + 0.6, y: y - 9.8, w: 8.8, h: 14.4 },
    surfR: { x: x + 38.6, y: y - 9.8, w: 8.8, h: 14.4 },
    surfFront: { x: x + 9.8, y: y - 1, w: 7.9, h: 5.6 },
    pedTop: { x: x + 50, y: y - 16, w: 12, h: 19.6 },
    pedestal: { x: x + 49.6, y: y - 24, w: 12.8, h: 38 },
    nameplate: { x: x + 18, y: y + 9.2, w: 12, h: 2.8 },
    postit: { x: x + 3, y: y + 6.2, w: 4.4, h: 4.4 },
  };
}

/** Répartition des objets de la fiche sur les emplacements du poste (déterministe, ordre des objets conservé). */
export function deskPlan(col: number, row: number, items: readonly DecorItem[]): DeskPlan {
  const x = col * TILE, y = row * TILE, S = slots(x, y);
  const parts: DeskPart[] = [];
  const dropped: DecorItem[] = [];
  const add = (kind: PartKind, slot: string, b: Box, item: DecorItem | null = null, ax = b.x, ay = b.y) => parts.push({ kind, slot, item, x: b.x, y: b.y, w: b.w, h: b.h, ax, ay });
  const uniq = items.filter((it, i) => items.indexOf(it) === i).slice(0, 6);
  // écrans : multi-écran l'emporte sur l'écran secondaire
  const sc = S.screens;
  let screens: DeskScreen[];
  if (uniq.includes('multi_monitor')) screens = [{ x: x + 10.6, y: y - 14.2, w: 8.2, h: 8, main: false }, { x: x + 19.9, y: y - 16, w: 8.2, h: 9.6, main: true }, { x: x + 29.2, y: y - 14.2, w: 8.2, h: 8, main: false }];
  else if (uniq.includes('second_monitor')) screens = [{ x: x + 11.6, y: y - 16, w: 13, h: 10, main: true }, { x: x + 26.4, y: y - 15, w: 10.6, h: 9, main: false }];
  else screens = [{ x: x + 16, y: y - 16, w: 16, h: 11, main: true }];
  add('screens', 'screens', sc);
  add('keyboard', 'keyboard', S.keyboard);
  add('mouse', 'mouse', S.mouse);
  add('nameplate', 'nameplate', S.nameplate);
  add('postit', 'postit', S.postit);
  let floor: DecorItem | null = null;
  const free = { panelL: true, panelR: true, surfL: true, surfR: true, surfFront: true, pedTop: true };
  // 1. objet au sol (remplace le caisson et son dessus)
  for (const it of uniq) {
    if (!FLOOR_ITEMS.has(it)) continue;
    if (!floor) { floor = it; free.pedTop = false; add('floor', 'pedestal', S.pedestal, it); } else dropped.push(it);
  }
  // 2. affiches et tableaux sur la cloison, à gauche puis à droite des écrans
  for (const it of uniq) {
    if (!PANEL_ITEMS.has(it)) continue;
    const k = free.panelL ? 'panelL' : free.panelR ? 'panelR' : null;
    if (!k) { dropped.push(it); continue; }
    free[k] = false;
    const b = S[k], px = b.x + (b.w - PANEL_W) / 2, py = b.y + (b.h - PANEL_H) / 2;
    add('panel', k, { x: px, y: py, w: PANEL_W, h: PANEL_H }, it, px, py);
  }
  // 3. objets posés : les plus encombrants d'abord (côtés, dessus du caisson), les petits devant le clavier
  const surf = uniq.filter((it) => !FLOOR_ITEMS.has(it) && !PANEL_ITEMS.has(it) && !SCREEN_ITEMS.has(it) && !KEYBOARD_ITEMS.has(it));
  const area = (it: DecorItem) => { const e = ITEM_EXT[it]; return e ? (e[1] - e[0]) * (e[3] - e[2]) : 0; };
  for (const it of surf.slice().sort((a, b) => area(b) - area(a) || surf.indexOf(a) - surf.indexOf(b))) {
    const e = ITEM_EXT[it];
    if (!e) { dropped.push(it); continue; }
    let placed = false;
    for (const k of ['surfL', 'surfR', 'pedTop', 'surfFront'] as const) {
      if (!free[k]) continue;
      const b = S[k];
      if (e[1] - e[0] > b.w || e[3] - e[2] > b.h) continue; // trop grand pour cet emplacement
      free[k] = false;
      const ax = b.x + b.w / 2 - (e[0] + e[1]) / 2, ay = b.y + b.h - e[3];
      add('surface', k, { x: ax + e[0], y: ay + e[2], w: e[1] - e[0], h: e[3] - e[2] }, it, ax, ay);
      placed = true; break;
    }
    if (!placed) dropped.push(it);
  }
  if (!floor) add('pedestal', 'pedestal', { x: x + 49.6, y: y + 3.6, w: 12.8, h: 10.4 }); // façade du caisson (son dessus porte un objet)
  return { parts, screens, dropped, floor };
}

export const boxesOverlap = (a: Box, b: Box, eps = 0.01) => a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps;
