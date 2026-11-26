// Mobilier, postes de travail personnalisés et décor mural, dessinés par code en vue de dessus « trois-quarts » :
// chaque objet a une emprise au sol (cases) et une hauteur apparente ; on voit son dessus (décalé vers le haut) et sa façade.
// Lumière venant du haut de l'écran : dessus clairs, façades plus sombres, ombres portées vers le bas (couche de sol).
import type { DecorItem, DecorTheme } from '../../api/types.ts';
import type { Desk, Furniture, WallDecor } from '../layout/plan.ts';
import { TILE } from '../layout/plan.ts';
import { FURNITURE } from '../layout/furniture.ts';
import { PANEL_H, PANEL_W, deskPlan } from '../layout/deskSlots.ts';
import { ACCENTS, C, UI } from './theme.ts';
import { FONT_FAMILY, fillRR, hash2, rr } from './draw.ts';
import type { Ctx } from './draw.ts';
import type { OfficeCalendar } from './calendar.ts';

/** Décor de saison appliqué au prochain pré-rendu (arbres extérieurs, sapins de l'entrée, guirlande). */
export const SEASON_DECOR: { cal: Pick<OfficeCalendar, 'season' | 'festive'>; xmasPlants: ReadonlySet<string> } = {
  cal: { season: 'summer', festive: null }, xmasPlants: new Set(),
};
const AUTUMN = [['#8c3f1c', '#c0612a', '#e39a45'], ['#7a4a1a', '#b07a2a', '#e0b84c'], ['#6e2f22', '#a5442f', '#d27a4a']];

/** Arbre extérieur selon la saison (printemps en fleurs, automne roux avec feuilles au sol, hiver dépouillé). */
function seasonalTree(ctx: Ctx, x: number, y: number, W: number, H: number, v: number) {
  const s = SEASON_DECOR.cal.season, cx = x + W / 2, evergreen = v % 3 === 0;
  ctx.fillStyle = '#5a4433'; ctx.fillRect(cx - 1.5, y + H - 16, 3, 12);
  if (s === 'winter' && !evergreen) {
    ctx.strokeStyle = '#5f4a3a'; ctx.lineCap = 'round';
    const br = (x0: number, y0: number, a: number, len: number, w: number, depth: number) => {
      const x1 = x0 + Math.cos(a) * len, y1 = y0 + Math.sin(a) * len;
      ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      if (depth > 0) { br(x1, y1, a - 0.5, len * 0.66, w * 0.65, depth - 1); br(x1, y1, a + 0.45, len * 0.62, w * 0.65, depth - 1); }
    };
    br(cx, y + H - 15, -Math.PI / 2 + (v % 2 ? 0.08 : -0.08), 10, 2.2, 3);
    return;
  }
  if (s === 'autumn' && !evergreen) {
    const pal = AUTUMN[v % AUTUMN.length];
    foliageP(ctx, cx, y + H - 22, 15, pal, v * 1.7); foliageP(ctx, cx + 4, y + H - 30, 10, AUTUMN[(v + 1) % AUTUMN.length], v * 0.9);
    for (let i = 0; i < 9; i++) { // feuilles tombées au pied de l'arbre
      ctx.fillStyle = pal[i % 3]; const a = hash2(v * 7 + i, 3) * Math.PI * 2, r = 6 + hash2(i, v + 2) * 11;
      ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * r, y + H - 2 + Math.sin(a) * r * 0.35, 1.1, 0.6, a, 0, 7); ctx.fill();
    }
    return;
  }
  foliage(ctx, cx, y + H - 22, 15, 3 + v, v * 1.7);
  foliage(ctx, cx + 4, y + H - 30, 10, 2 + v, v * 0.9);
  if (s === 'spring' && !evergreen) for (let i = 0; i < 14; i++) { // fleurs
    ctx.fillStyle = i % 3 ? '#f4c6d4' : '#fbeef2'; const a = hash2(v * 5 + i, 9) * Math.PI * 2, r = hash2(i, v + 4) * 12;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, y + H - 25 + Math.sin(a) * r * 0.8, 0.9, 0, 7); ctx.fill();
  }
}

/** Sapin décoré (entrée du hall, période de Noël). */
function xmasTree(ctx: Ctx, x: number, y: number) {
  fillRR(ctx, '#8a5a3c', x + 5, y + 8, 6, 6, 1);
  ctx.fillStyle = '#5a3b26'; ctx.fillRect(x + 7, y + 4, 2, 5);
  const layers = [[y + 6, 7.5], [y - 1, 6.2], [y - 8, 4.8], [y - 14, 3.2]];
  layers.forEach(([by, r], i) => { ctx.fillStyle = i % 2 ? '#2f6a45' : '#285c3c'; ctx.beginPath(); ctx.moveTo(x + 8 - r, by); ctx.lineTo(x + 8 + r, by); ctx.lineTo(x + 8, by - 9); ctx.closePath(); ctx.fill(); });
  const balls = ['#e04848', '#f2c14e', '#6fb0f2', '#f2f2f2'];
  for (let i = 0; i < 9; i++) { ctx.fillStyle = balls[i % 4]; ctx.beginPath(); ctx.arc(x + 8 + (hash2(i, 3) - 0.5) * 9 * (1 - i / 12), y + 3 - i * 2.1, 0.8, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#f5c542'; ctx.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, r = k % 2 ? 0.9 : 2.1; ctx.lineTo(x + 8 + Math.cos(a) * r, y - 23 + Math.sin(a) * r); } ctx.closePath(); ctx.fill();
}

/** Guirlande lumineuse (Noël) ou drapeaux tricolores (fête nationale) le long d'un mur, de x0 à x1, sous le chaperon. */
export function festiveWall(ctx: Ctx, x0: number, x1: number, y: number, kind: 'xmas' | 'national') {
  const span = 26;
  for (let x = x0; x < x1 - 4; x += span) {
    const xe = Math.min(x1, x + span), mid = (x + xe) / 2;
    ctx.strokeStyle = kind === 'xmas' ? '#2f5b3a' : '#7b828c'; ctx.lineWidth = kind === 'xmas' ? 1.1 : 0.4;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(mid, y + 5, xe, y); ctx.stroke();
    const n = kind === 'xmas' ? 6 : 5;
    for (let i = 1; i < n; i++) {
      const f = i / n, px = x + (xe - x) * f, py = y + 5 * 2 * f * (1 - f) * 1.0;
      if (kind === 'xmas') { ctx.fillStyle = ['#e04848', '#f2c14e', '#6fb0f2', '#7fd39a'][i % 4]; ctx.beginPath(); ctx.arc(px, py + 0.8, 0.75, 0, 7); ctx.fill(); }
      else { ctx.fillStyle = ['#2f4ea0', '#f4f4f4', '#d93a3a'][i % 3]; ctx.beginPath(); ctx.moveTo(px - 1.2, py); ctx.lineTo(px + 1.2, py); ctx.lineTo(px, py + 2.6); ctx.closePath(); ctx.fill(); }
    }
  }
}

export const WALL_Z = 14, EXT_Z = 17;
/** Géométrie verticale d'un mur horizontal de la rangée `row` (face visible depuis le sud). */
export function wallFace(row: number, ext: boolean): { capTop: number; faceTop: number; faceBottom: number } {
  const y0 = row * TILE + (ext ? 3 : 5), y1 = row * TILE + (ext ? 13 : 11), z = ext ? EXT_Z : WALL_Z;
  return { capTop: y0 - z, faceTop: y1 - z, faceBottom: y1 };
}

/** Pavé 3/4 : dessus (emprise décalée de z vers le haut) puis façade de hauteur z. */
export function box(ctx: Ctx, x: number, y: number, w: number, h: number, z: number, top: string, front: string, r = 1.6) {
  fillRR(ctx, front, x, y + h - z - r, w, z + r, r);
  fillRR(ctx, top, x, y - z, w, h, r);
  ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fillRect(x + r, y - z + h - 0.7, w - 2 * r, 0.7);
}
const dot = (ctx: Ctx, x: number, y: number, r: number, c: string) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); };
const shade = (hex: string, k: number): string => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
};
export { shade };

const SOFA_COLORS = ['#5f7486', '#7c8f72', '#a8664c', '#4d525c'] as const;
const CHAIR_FABRIC = ['#4f6c7c', '#6a7d66', '#8c5f4d', '#5b5f6b'] as const;
const BOOK = ['#9a4b3c', '#3f6c8a', '#c39a4a', '#5f8a6a', '#7b6a9a', '#d9d2c2', '#2f3a4a', '#b66d4a'] as const;

/** Boîte englobante (unités monde) d'un meuble dessiné, pour le tri en profondeur et les sous-images. */
export function furnitureBox(f: Furniture): { x: number; y: number; w: number; h: number; sortY: number } {
  const z = FURNITURE[f.kind].z + 4;
  const x = f.col * TILE, y = f.row * TILE, w = f.w * TILE, h = f.h * TILE;
  return { x: x - 3, y: y - z - 3, w: w + 6, h: h + z + 6, sortY: y + h - (f.kind === 'rug' ? 100 : 1) };
}

function foliage(ctx: Ctx, cx: number, cy: number, r: number, v: number, seed: number) {
  foliageP(ctx, cx, cy, r, [[C.leafDark, C.leaf, C.leafHi], ['#3d6e4a', '#4f8a5c', '#78ad7f'], ['#4a7d55', '#5f9a68', '#8cc092'], ['#557a45', '#6c9456', '#94b97c']][v % 4], seed);
}
function foliageP(ctx: Ctx, cx: number, cy: number, r: number, pal: readonly string[], seed: number) {
  for (let layer = 0; layer < 3; layer++) {
    ctx.fillStyle = pal[layer];
    const n = 6 - layer;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + seed + layer * 0.7;
      const rr2 = r * (0.55 - layer * 0.14);
      ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2 * 0.8 - layer * 1.2, r * (0.48 - layer * 0.08), r * (0.42 - layer * 0.08), a, 0, 7); ctx.fill();
    }
  }
}

function pot(ctx: Ctx, cx: number, by: number, w: number, h: number, v: number) {
  const cols = [['#d7cfc2', '#bdb4a6'], ['#4f545d', '#3f434b'], ['#b8754f', '#9c5f3e'], ['#e9e5dd', '#cfcac0']][v % 4];
  ctx.fillStyle = cols[1]; ctx.beginPath(); ctx.moveTo(cx - w / 2, by - h); ctx.lineTo(cx + w / 2, by - h); ctx.lineTo(cx + w / 2 - 1.2, by); ctx.lineTo(cx - w / 2 + 1.2, by); ctx.closePath(); ctx.fill();
  ctx.fillStyle = cols[0]; ctx.beginPath(); ctx.ellipse(cx, by - h, w / 2, 1.6, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#4a3b2c'; ctx.beginPath(); ctx.ellipse(cx, by - h, w / 2 - 1, 1, 0, 0, 7); ctx.fill();
}

function screenFrame(ctx: Ctx, x: number, y: number, w: number, h: number) {
  fillRR(ctx, C.bezel, x, y, w, h, 1.2);
  fillRR(ctx, C.screenOff, x + 1, y + 1, w - 2, h - 2, 0.8);
  ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.beginPath(); ctx.moveTo(x + 1, y + 1); ctx.lineTo(x + w * 0.45, y + 1); ctx.lineTo(x + 1, y + h * 0.7); ctx.closePath(); ctx.fill();
}

export function drawFurniture(ctx: Ctx, f: Furniture) {
  const x = f.col * TILE, y = f.row * TILE, W = f.w * TILE, H = f.h * TILE, v = f.variant, d = f.dir;
  switch (f.kind) {
    case 'plant': {
      pot(ctx, x + 8, y + 13, 8, 6, v);
      if (v % 4 === 1) { // sansevière : feuilles verticales
        for (let k = -2; k <= 2; k++) { ctx.fillStyle = k % 2 ? '#4f7f4f' : '#6a9a5a'; ctx.beginPath(); ctx.ellipse(x + 8 + k * 1.6, y + 1 - Math.abs(k) * -0.6, 1.2, 7 - Math.abs(k), k * 0.12, 0, 7); ctx.fill(); }
      } else foliage(ctx, x + 8, y + 2, 7.5, v, v * 1.3);
      break;
    }
    case 'plant_tall': {
      if (SEASON_DECOR.cal.festive === 'xmas' && SEASON_DECOR.xmasPlants.has(f.key)) { xmasTree(ctx, x, y); break; }
      pot(ctx, x + 8, y + 14, 10, 8, v);
      ctx.strokeStyle = '#6b5440'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x + 8, y + 6); ctx.lineTo(x + 7.4, y - 6); ctx.stroke();
      foliage(ctx, x + 8, y - 8, 9.5, v + 1, v * 2.1);
      foliage(ctx, x + 6, y - 15, 6.5, v + 2, v * 0.7);
      break;
    }
    case 'sofa': case 'armchair': {
      const col = SOFA_COLORS[v % SOFA_COLORS.length], dark = shade(col, -0.22), hi = shade(col, 0.12);
      if (d === 0) {
        box(ctx, x + 1, y + 1, W - 2, 7, 15, hi, dark, 2.5);
        box(ctx, x + 3, y + 6, W - 6, 9, 7, col, dark, 2);
        if (W > 20) { ctx.fillStyle = 'rgba(0,0,0,0.10)'; for (let i = 1; i < 3; i++) ctx.fillRect(x + 3 + ((W - 6) * i) / 3, y - 1, 0.7, 8); }
        box(ctx, x + 1, y + 3, 4, 12, 10, hi, dark, 1.6); box(ctx, x + W - 5, y + 3, 4, 12, 10, hi, dark, 1.6);
        if (W > 20) fillRR(ctx, UI.amber, x + 7, y - 8, 7, 5, 2);
      } else if (d === 1) {
        box(ctx, x + 3, y + 1, W - 6, 9, 7, col, dark, 2);
        box(ctx, x + 1, y + 1, 4, 13, 10, hi, dark, 1.6); box(ctx, x + W - 5, y + 1, 4, 13, 10, hi, dark, 1.6);
        box(ctx, x + 1, y + 9, W - 2, 6, 14, hi, dark, 2.5);
      } else {
        const right = d === 2; // regarde vers la droite : dossier à gauche
        box(ctx, x + 3, y + 1, W - 6, 4, 10, hi, dark, 1.6);
        box(ctx, x + (right ? 5 : 2), y + 4, W - 7, H - 8, 7, col, dark, 2);
        box(ctx, x + (right ? 1 : W - 6), y + 1, 5, H - 2, 15, hi, dark, 2.2);
        box(ctx, x + 3, y + H - 5, W - 6, 4, 10, hi, dark, 1.6);
      }
      break;
    }
    case 'coffee_table': case 'reading_table': {
      const wood = f.kind === 'reading_table' ? C.oak : '#8a6a4c';
      box(ctx, x + 2, y + 3, W - 4, H - 5, f.kind === 'reading_table' ? 8 : 5, shade(wood, 0.1), shade(wood, -0.25), 1.5);
      if (f.kind === 'coffee_table') { fillRR(ctx, '#e8e2d6', x + 5, y - 1, 7, 5, 0.6); fillRR(ctx, '#3f6c8a', x + 14, y, 6, 4, 0.6); dot(ctx, x + W - 7, y + 1, 2, '#f4f2ee'); }
      else { fillRR(ctx, '#f3eee4', x + 6, y - 3, 8, 5, 0.6); dot(ctx, x + W - 8, y - 2, 1.8, '#f4f2ee'); }
      break;
    }
    case 'side_table': {
      ctx.fillStyle = '#5d4a38'; ctx.fillRect(x + 7.3, y + 3, 1.4, 10);
      ctx.fillStyle = '#8a6a4c'; ctx.beginPath(); ctx.ellipse(x + 8, y + 3, 5.4, 3.6, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#a07e5c'; ctx.beginPath(); ctx.ellipse(x + 8, y + 2.4, 5, 3.2, 0, 0, 7); ctx.fill();
      foliage(ctx, x + 8, y - 1, 3.6, v + 1, 0.4);
      break;
    }
    case 'stairs': {
      // escalier en U vu de dessus : au RDC, volée qui monte vers le nord (marches de plus en plus claires) ;
      // au 1er, trémie et volée qui descend (de plus en plus sombre), garde-corps vitré. Dessiné au sol : on marche dessus.
      const up = v === 0, n = 9, sh = (H - 4) / n;
      fillRR(ctx, '#6f747c', x + 1, y + 1, W - 2, H - 2, 1.4);
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1); // 0 = marche la plus au sud
        const yy = y + H - 2 - (k + 1) * sh;
        const col = up ? shade('#b9b1a5', t * 0.55) : shade('#c9c1b5', -t * 0.72);
        ctx.fillStyle = col; ctx.fillRect(x + 3, yy, W - 6, sh - 0.3);
        ctx.fillStyle = up ? 'rgba(40,35,30,0.22)' : 'rgba(20,18,16,0.35)'; ctx.fillRect(x + 3, yy + sh - 0.9, W - 6, 0.6); // nez de marche
      }
      if (!up) { // trémie : ombre vers le fond, garde-corps vitré sur trois côtés
        const g = ctx.createLinearGradient(0, y + 2, 0, y + H * 0.7); g.addColorStop(0, 'rgba(10,12,16,0.55)'); g.addColorStop(1, 'rgba(10,12,16,0)');
        ctx.fillStyle = g; ctx.fillRect(x + 3, y + 2, W - 6, H * 0.7);
        ctx.fillStyle = 'rgba(190,220,232,0.35)'; ctx.fillRect(x + 1, y + 1, 1.6, H - 6); ctx.fillRect(x + 1, y + 1, W - 2, 1.4);
        ctx.fillStyle = '#8b929c'; ctx.fillRect(x + 1, y + 1, 0.6, H - 6); ctx.fillRect(x + 1, y + 1, W - 2, 0.5);
      }
      // main courante côté ouest (poteaux), limon côté est
      ctx.fillStyle = '#4f555e'; ctx.fillRect(x + 1.6, y + 2, 1, H - 4);
      ctx.fillStyle = '#c2a477'; ctx.fillRect(x + 1.4, y + 2, 0.6, H - 4);
      for (let k = 0; k < 4; k++) { ctx.fillStyle = '#3e434b'; ctx.fillRect(x + 1.3, y + 4 + k * (H - 8) / 3, 1.6, 1.2); }
      ctx.fillStyle = '#5c6169'; ctx.fillRect(x + W - 2.6, y + 2, 1.2, H - 4);
      // flèche et destination sur la première marche
      const ax = x + W / 2 + 1, ay = y + H - 7;
      ctx.fillStyle = up ? '#2c3038' : '#f3efe6'; ctx.beginPath();
      if (up) { ctx.moveTo(ax, ay - 2.6); ctx.lineTo(ax + 2.2, ay); ctx.lineTo(ax - 2.2, ay); } else { ctx.moveTo(ax, ay + 1.2); ctx.lineTo(ax + 2.2, ay - 1.4); ctx.lineTo(ax - 2.2, ay - 1.4); }
      ctx.closePath(); ctx.fill();
      ctx.font = `700 2.6px ${FONT_FAMILY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = up ? '#2c3038' : '#f3efe6';
      ctx.fillText(up ? '1er' : 'RDC', ax, ay + 3.2); ctx.textAlign = 'start';
      break;
    }
    case 'rug': {
      const pal = [['#b9a68c', '#a99579', '#d9cbb4'], ['#4a5058', '#3d4249', '#f5a742'], ['#8a5a48', '#7a4d3d', '#d8b9a0'], ['#7b8c76', '#6b7c67', '#c9d2bd']][v % 4];
      fillRR(ctx, pal[1], x + 2, y + 2, W - 4, H - 4, 4);
      fillRR(ctx, pal[0], x + 4, y + 4, W - 8, H - 8, 3);
      ctx.strokeStyle = pal[2]; ctx.globalAlpha = 0.55; ctx.lineWidth = 0.8; rr(ctx, x + 6.5, y + 6.5, W - 13, H - 13, 2); ctx.stroke(); ctx.globalAlpha = 1;
      if (v % 4 === 1) { // motif RO·AI : losange ambre
        ctx.fillStyle = UI.amber; ctx.beginPath(); ctx.moveTo(x + W / 2, y + H / 2 - 7); ctx.lineTo(x + W / 2 + 7, y + H / 2); ctx.lineTo(x + W / 2, y + H / 2 + 7); ctx.lineTo(x + W / 2 - 7, y + H / 2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = pal[0]; ctx.beginPath(); ctx.moveTo(x + W / 2, y + H / 2 - 3.5); ctx.lineTo(x + W / 2 + 3.5, y + H / 2); ctx.lineTo(x + W / 2, y + H / 2 + 3.5); ctx.lineTo(x + W / 2 - 3.5, y + H / 2); ctx.closePath(); ctx.fill();
      }
      break;
    }
    case 'counter': {
      box(ctx, x, y + 2, W, H - 3, 12, '#e8e3da', '#b5ab9b', 1);
      ctx.fillStyle = 'rgba(60,50,40,0.25)'; ctx.fillRect(x + W / 2 - 0.3, y + H - 10, 0.6, 9);
      if ((f.col + f.row) % 2) { fillRR(ctx, '#c7ccd2', x + 3, y - 8, 10, 6, 2); fillRR(ctx, '#9aa1aa', x + 5, y - 7, 6, 4, 1.6); ctx.fillStyle = '#9aa1aa'; ctx.fillRect(x + 7.5, y - 12, 1, 4); }
      else { fillRR(ctx, '#f4f2ee', x + 4, y - 9, 4, 4, 0.8); fillRR(ctx, '#3f6c8a', x + 9, y - 9, 3, 4, 0.8); }
      break;
    }
    case 'coffee_machine': {
      box(ctx, x, y + 2, W, H - 3, 12, '#e8e3da', '#b5ab9b', 1);
      box(ctx, x + 2.5, y + 1, 11, 7, 23, '#3a3f47', '#2b2f36', 1.6);
      fillRR(ctx, '#1b1e23', x + 4.5, y - 15, 7, 4, 0.8); dot(ctx, x + 6, y - 13, 0.7, UI.amber); dot(ctx, x + 8.4, y - 13, 0.7, UI.ok);
      fillRR(ctx, '#1b1e23', x + 5, y - 8, 6, 4, 0.8);
      fillRR(ctx, '#f4f2ee', x + 6.4, y - 6.6, 3.2, 3, 0.6);
      break;
    }
    case 'vending': {
      box(ctx, x + 1, y + 2, W - 2, H - 3, 30, '#3d4a5a', '#2e3a48', 2);
      fillRR(ctx, '#18212b', x + 3.5, y - 25, W - 13, 20, 1.2);
      for (let r = 0; r < 4; r++) for (let i = 0; i < 4; i++) fillRR(ctx, BOOK[(i + r * 3 + v) % BOOK.length], x + 5 + i * 3.6, y - 23.5 + r * 4.8, 2.6, 3.4, 0.6);
      ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.beginPath(); ctx.moveTo(x + 3.5, y - 25); ctx.lineTo(x + 10, y - 25); ctx.lineTo(x + 3.5, y - 14); ctx.closePath(); ctx.fill();
      fillRR(ctx, '#556477', x + W - 8, y - 24, 5, 10, 1); dot(ctx, x + W - 5.5, y - 21, 0.9, UI.amber);
      fillRR(ctx, '#18212b', x + 5, y - 3.5, W - 14, 3, 0.8);
      break;
    }
    case 'water_cooler': {
      box(ctx, x + 3, y + 4, 10, 10, 13, '#eef0f2', '#c9cdd2', 1.4);
      ctx.fillStyle = 'rgba(120,175,215,0.85)'; rr(ctx, x + 4.5, y - 17, 7, 9, 3); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(x + 5.5, y - 16, 1.2, 7);
      dot(ctx, x + 6.2, y - 1, 0.8, '#4a8cc0'); dot(ctx, x + 9.6, y - 1, 0.8, '#c0504a');
      break;
    }
    case 'fridge': {
      box(ctx, x + 1, y + 2, W - 2, H - 3, 28, '#eef0f2', '#cdd1d6', 1.6);
      ctx.fillStyle = '#b8bdc4'; ctx.fillRect(x + 2, y - 10, W - 4, 0.7); ctx.fillRect(x + W - 4.5, y - 22, 1, 7); ctx.fillRect(x + W - 4.5, y - 7, 1, 5);
      break;
    }
    case 'high_table': {
      ctx.fillStyle = '#3a3f47'; ctx.beginPath(); ctx.ellipse(x + 8, y + 12, 4.4, 1.8, 0, 0, 7); ctx.fill();
      ctx.fillRect(x + 7.3, y - 1, 1.4, 13);
      ctx.fillStyle = shade(C.oak, -0.2); ctx.beginPath(); ctx.ellipse(x + 8, y - 0.6, 6.6, 4.2, 0, 0, 7); ctx.fill();
      ctx.fillStyle = C.oak; ctx.beginPath(); ctx.ellipse(x + 8, y - 1.6, 6.6, 4, 0, 0, 7); ctx.fill();
      dot(ctx, x + 6, y - 2.4, 1.3, '#f4f2ee');
      break;
    }
    case 'bookshelf': {
      if (d === 2 || d === 3) {
        box(ctx, x + 2, y + 1, W - 4, H - 2, 26, '#a8865a', '#7f6444', 1.4);
        for (let i = 0; i < 8; i++) fillRR(ctx, BOOK[(i * 3 + v) % BOOK.length], x + 4 + (d === 2 ? 4 : 0), y - 23 + i * 3.6, 4, 2.6, 0.4);
      } else {
        box(ctx, x + 1, y + 2, W - 2, H - 4, 28, '#b08e61', '#8a6c48', 1.4);
        for (let s = 0; s < 4; s++) {
          const sy = y - 25 + s * 6.4;
          fillRR(ctx, '#5c452c', x + 2.5, sy, W - 5, 5.6, 0.6);
          let bx = x + 3.2;
          for (let i = 0; bx < x + W - 4; i++) {
            const bw = 1.4 + hash2(i, s, v + f.col) * 1.6, bh = 3.6 + hash2(i, s + 3, v) * 1.6;
            if (hash2(i, s, 7 + v) < 0.12) { bx += 2; continue; }
            ctx.fillStyle = BOOK[Math.floor(hash2(i, s, v + 11) * BOOK.length)]; ctx.fillRect(bx, sy + 5.6 - bh, bw, bh);
            bx += bw + 0.25;
          }
        }
      }
      break;
    }
    case 'chair': case 'wait_chair': {
      const col = f.kind === 'wait_chair' ? CHAIR_FABRIC[(v >> 1) % 4] : '#4a505b', dark = shade(col, -0.25);
      ctx.fillStyle = '#2f333a'; ctx.fillRect(x + 4, y + 9, 1, 5); ctx.fillRect(x + 11, y + 9, 1, 5);
      if (d === 0) { box(ctx, x + 3, y + 2, 10, 4, 12, shade(col, 0.1), dark, 1.6); box(ctx, x + 3, y + 5, 10, 8, 6, col, dark, 1.6); }
      else if (d === 1) { box(ctx, x + 3, y + 3, 10, 8, 6, col, dark, 1.6); box(ctx, x + 3, y + 10, 10, 4, 12, shade(col, 0.1), dark, 1.6); }
      else { box(ctx, x + 3, y + 3, 10, 10, 6, col, dark, 1.6); box(ctx, x + (d === 2 ? 2 : 11), y + 3, 3, 10, 13, shade(col, 0.1), dark, 1.2); }
      break;
    }
    case 'meeting_table': {
      ctx.fillStyle = '#3a3f47'; ctx.fillRect(x + 12, y + H - 6, 2, 5); ctx.fillRect(x + W - 14, y + H - 6, 2, 5);
      box(ctx, x + 1, y + 2, W - 2, H - 4, 8, '#c9a676', '#9a7b52', 8);
      ctx.fillStyle = 'rgba(255,255,255,0.14)'; rr(ctx, x + 5, y - 4, W - 10, 3, 1.5); ctx.fill();
      for (let i = 0; i < 3; i++) dot(ctx, x + W * (0.25 + i * 0.25), y + 6, 1.6, '#2a2e35');
      break;
    }
    case 'reception': {
      box(ctx, x + 1, y + 2, W - 2, H - 3, 14, '#efeae2', '#cfc6b8', 3);
      fillRR(ctx, UI.amber, x + 4, y + 9, W - 8, 1.4, 0.7);
      ctx.font = `600 4px ${FONT_FAMILY}`; ctx.fillStyle = '#6b6357'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('ACCUEIL', x + W / 2, y + 5.6); ctx.textAlign = 'start';
      screenFrame(ctx, x + W - 18, y - 21, 12, 9); fillRR(ctx, C.metal, x + W - 13, y - 13, 2, 3, 0.5);
      foliage(ctx, x + 8, y - 13, 4, 2, 0.3); fillRR(ctx, '#e9e5dd', x + 5, y - 12, 6, 4, 1);
      break;
    }
    case 'guichet': {
      box(ctx, x + 1, y + 2, W - 2, H - 3, 14, '#e9e4db', '#c4baa9', 2);
      fillRR(ctx, '#6fb0f2', x + 4, y + 8, W - 8, 1.2, 0.6);
      screenFrame(ctx, x + W / 2 - 8, y - 23, 16, 10);
      ctx.fillStyle = 'rgba(205,228,238,0.5)'; ctx.fillRect(x + 3, y - 26, W - 6, 13);
      ctx.strokeStyle = C.frame; ctx.lineWidth = 0.8; ctx.strokeRect(x + 3, y - 26, W - 6, 13);
      break;
    }
    case 'bench': {
      const vert = d === 2 || d === 3;
      ctx.fillStyle = '#3a3f47';
      if (vert) { ctx.fillRect(x + 4, y + 3, 8, 1); ctx.fillRect(x + 4, y + H - 4, 8, 1); box(ctx, x + 3, y + 2, 10, H - 4, 8, '#c9a676', '#9a7b52', 1.2); }
      else { box(ctx, x + 2, y + 4, W - 4, 9, 8, '#c9a676', '#9a7b52', 1.2); ctx.fillStyle = 'rgba(80,55,30,0.35)'; for (let i = 1; i < 4; i++) ctx.fillRect(x + 2, y - 4 + i * 2.3, W - 4, 0.5); }
      break;
    }
    case 'rack': {
      box(ctx, x + 1, y + 2, W - 2, H - 3, 22, '#2f343c', '#22262d', 1.2);
      fillRR(ctx, '#1a1d22', x + 2.5, y - 6.2, W - 5, 19.6, 0.8);
      ctx.fillStyle = '#2c3138'; for (let i = 0; i < 7; i++) ctx.fillRect(x + 3, y - 5.6 + i * 2.6, W - 6, 1.8);
      ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(x + 2.5, y - 6.2, 2, 19.6);
      break;
    }
    case 'ac_unit': {
      box(ctx, x + 1, y + 2, W - 2, H - 3, 24, '#d9dde2', '#b7bdc5', 1.6);
      ctx.fillStyle = '#9aa1aa'; for (let i = 0; i < 6; i++) ctx.fillRect(x + 4, y - 19 + i * 2.6, W - 8, 1);
      dot(ctx, x + W - 6, y - 4, 0.9, UI.ok);
      break;
    }
    case 'cabinet': {
      box(ctx, x + 1, y + 2, W - 2, H - 3, 14, '#d7d2c9', '#b3ac9f', 1.4);
      ctx.fillStyle = 'rgba(60,50,40,0.25)'; for (let i = 0; i < 2; i++) { ctx.fillRect(x + 2, y + 1 + i * 6, W - 4, 0.5); ctx.fillRect(x + W / 2 - 3, y + 3.4 + i * 6, 6, 0.9); }
      if (v % 2) { fillRR(ctx, '#f3eee4', x + 4, y - 15, 8, 5, 0.5); fillRR(ctx, '#3f6c8a', x + 15, y - 16, 6, 4, 0.5); }
      else foliage(ctx, x + W - 8, y - 16, 4, v, 0.2);
      break;
    }
    case 'printer': {
      box(ctx, x + 2, y + 3, 12, 11, 12, '#e3e5e8', '#b9bec5', 1.6);
      fillRR(ctx, '#3a3f47', x + 4, y - 8, 8, 3, 0.8); fillRR(ctx, '#f6f4ef', x + 4.5, y - 11, 7, 4, 0.4);
      dot(ctx, x + 12, y - 4, 0.7, UI.ok);
      break;
    }
    case 'floorlamp': {
      ctx.fillStyle = '#3a3f47'; ctx.beginPath(); ctx.ellipse(x + 8, y + 12, 4, 1.6, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = '#3a3f47'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 8, y + 12); ctx.lineTo(x + 8, y - 20); ctx.stroke();
      ctx.fillStyle = '#efe3c8'; ctx.beginPath(); ctx.moveTo(x + 3.4, y - 18); ctx.lineTo(x + 12.6, y - 18); ctx.lineTo(x + 10.6, y - 25); ctx.lineTo(x + 5.4, y - 25); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(x + 3.4, y - 19, 9.2, 1);
      break;
    }
    case 'kiosk': {
      ctx.fillStyle = '#3a3f47'; ctx.fillRect(x + 7, y - 4, 2, 15); fillRR(ctx, '#3a3f47', x + 4, y + 10, 8, 3, 1);
      screenFrame(ctx, x + 2.5, y - 16, 11, 13);
      fillRR(ctx, UI.amber, x + 5, y - 12, 6, 1.2, 0.6); fillRR(ctx, '#5b6470', x + 5, y - 9, 6, 1, 0.5); fillRR(ctx, '#5b6470', x + 5, y - 7, 4, 1, 0.5);
      break;
    }
    case 'lockers': {
      box(ctx, x + 1, y + 2, W - 2, H - 3, 28, '#8f9aa6', '#6f7a86', 1.2);
      ctx.fillStyle = 'rgba(30,40,50,0.35)'; for (let i = 1; i < 3; i++) ctx.fillRect(x + 1 + ((W - 2) * i) / 3, y - 13, 0.6, 26);
      ctx.fillStyle = '#cfd5db'; for (let i = 0; i < 3; i++) ctx.fillRect(x + 4 + ((W - 2) * i) / 3, y - 2, 1, 3);
      break;
    }
    case 'console': drawConsole(ctx, f); break;
    case 'mailbox': {
      // boîte aux lettres sur pied (le courrier réel est dessiné à chaque image)
      ctx.fillStyle = '#4a4f57'; ctx.fillRect(x + 7, y + 2, 2, 11); fillRR(ctx, '#4a4f57', x + 4.5, y + 12, 7, 2, 0.8);
      box(ctx, x + 2.5, y - 2, 11, 6, 9, '#2f5d8c', '#244a72', 1.4);
      ctx.fillStyle = '#1a2736'; ctx.fillRect(x + 4.5, y - 2.4, 7, 1);
      ctx.font = `700 2px ${FONT_FAMILY}`; ctx.fillStyle = '#dce6f0'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('RAPPORTS', x + 8, y + 1.6, 9.5); ctx.textAlign = 'start';
      break;
    }
    case 'streetlamp': {
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(x + 8, y + 13, 3.6, 1.4, 0, 0, 7); ctx.fill();
      fillRR(ctx, '#3b4048', x + 6, y + 10.5, 4, 3, 0.8);
      ctx.strokeStyle = '#3b4048'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(x + 8, y + 11); ctx.lineTo(x + 8, y - 26); ctx.quadraticCurveTo(x + 8, y - 30, x + 12, y - 30); ctx.stroke();
      fillRR(ctx, '#2c3037', x + 10, y - 31.5, 6, 2.4, 1); ctx.fillStyle = '#e9e2cf'; ctx.fillRect(x + 11, y - 29.4, 4, 0.8);
      break;
    }
    case 'status_board': {
      // grand écran de supervision sur pied (contenu réel dessiné à chaque image : limites d'usage)
      ctx.fillStyle = '#2f343c'; ctx.fillRect(x + 6, y - 6, 1.6, 17); ctx.fillRect(x + W - 7.6, y - 6, 1.6, 17);
      fillRR(ctx, '#2f343c', x + 3, y + 10, 8, 2.4, 1); fillRR(ctx, '#2f343c', x + W - 11, y + 10, 8, 2.4, 1);
      fillRR(ctx, '#15181d', x + 1, y - 25, W - 2, 21, 1.6); fillRR(ctx, '#0b0e12', x + 2.2, y - 23.8, W - 4.4, 18.6, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.beginPath(); ctx.moveTo(x + 2.2, y - 23.8); ctx.lineTo(x + W * 0.42, y - 23.8); ctx.lineTo(x + 2.2, y - 12); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#4ccaa1'; ctx.beginPath(); ctx.arc(x + W - 4, y - 6.6, 0.6, 0, 7); ctx.fill();
      break;
    }
    case 'tree': seasonalTree(ctx, x, y, W, H, v); break;
    case 'bush': foliage(ctx, x + 8, y + 7, 8, v + 2, v); break;
    case 'planter': {
      box(ctx, x + 1, y + 4, W - 2, H - 6, 8, '#b9b3a8', '#9d978c', 1);
      for (let i = 0; i < 3; i++) foliage(ctx, x + 6 + i * 10, y - 3, 5, i + 1, i);
      break;
    }
    case 'bike_rack': {
      ctx.strokeStyle = '#7b828c'; ctx.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(x + 6 + i * 10, y + 10, 4, Math.PI, 0); ctx.stroke(); }
      break;
    }
  }
}

/** Console de l'orchestrateur (éléments statiques ; écrans et fiches dessinés dynamiquement). */
function drawConsole(ctx: Ctx, f: Furniture) {
  const x = f.col * TILE, y = f.row * TILE, w = f.w * TILE, h = f.h * TILE;
  // plan de travail en arc, graphite et liseré ambre
  box(ctx, x, y + 12, w, h - 12, 9, '#6e7788', '#4c5463', 7);
  fillRR(ctx, '#2a2f38', x + 1, y + h - 5, w - 2, 5, 3);
  fillRR(ctx, UI.amber, x + 8, y + h - 5.6, w - 16, 1.3, 0.7);
  for (const m of [{ x: x + 14, y: y - 2, w: 32, h: 20 }, { x: x + 54, y: y - 6, w: 52, h: 24 }, { x: x + 114, y: y - 2, w: 32, h: 20 }]) {
    fillRR(ctx, C.metal, m.x + m.w / 2 - 3, m.y + m.h - 1, 6, 5, 1); fillRR(ctx, C.metal, m.x + m.w / 2 - 8, m.y + m.h + 2, 16, 2, 1);
    fillRR(ctx, '#171a20', m.x, m.y, m.w, m.h, 3);
  }
  const pile = { x: x + 5, y: y + 19, w: 11, h: 8 }, tray = { x: x + 142, y: y + 19, w: 13, h: 8 }, bin = { x: x + w + 5, y: y + 17, w: 8, h: 11 };
  fillRR(ctx, '#2a303b', pile.x - 1.5, pile.y + pile.h - 1.5, pile.w + 3, 3.2, 1.4);
  fillRR(ctx, '#2a303b', tray.x - 1.5, tray.y + tray.h - 1.5, tray.w + 3, 3.2, 1.4);
  fillRR(ctx, UI.amber, tray.x - 1.5, tray.y + tray.h - 0.3, tray.w + 3, 1, 0.5);
  ctx.fillStyle = '#6b7385'; ctx.beginPath(); ctx.moveTo(bin.x, bin.y); ctx.lineTo(bin.x + bin.w, bin.y); ctx.lineTo(bin.x + bin.w - 1.4, bin.y + bin.h); ctx.lineTo(bin.x + 1.4, bin.y + bin.h); ctx.closePath(); ctx.fill();
  fillRR(ctx, '#8590a2', bin.x - 0.8, bin.y - 1.2, bin.w + 1.6, 1.8, 0.9);
  const ck = { x: x + 50, y: y + 21 };
  dot(ctx, ck.x, ck.y, 3.4, '#e9ebef');
  ctx.strokeStyle = '#30384a'; ctx.lineWidth = 0.7; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(ck.x, ck.y, 3.4, 0, 7); ctx.moveTo(ck.x, ck.y); ctx.lineTo(ck.x, ck.y - 2); ctx.moveTo(ck.x, ck.y); ctx.lineTo(ck.x + 1.4, ck.y + 0.4); ctx.stroke();
  dot(ctx, ck.x - 2.2, ck.y - 3.4, 1.2, UI.amber); dot(ctx, ck.x + 2.2, ck.y - 3.4, 1.2, UI.amber);
}

// ───────────── poste de travail personnalisé ─────────────

export interface DeskLook { theme: DecorTheme; items: readonly DecorItem[]; color: number }
export const DEFAULT_LOOK: DeskLook = { theme: 'general', items: [], color: 0 };
/** Position des écrans du poste (contenu dynamique) selon les objets (écran secondaire, multi-écrans). */
export function deskScreens(d: Desk, look: DeskLook): { x: number; y: number; w: number; h: number; main: boolean }[] {
  return deskPlan(d.col, d.row, look.items).screens;
}

/** Partie statique du poste : cloison personnalisée, plan de travail, caisson, écrans éteints, clavier, objets (chacun à sa place réservée). */
export function drawDesk(ctx: Ctx, d: Desk, look: DeskLook) {
  const x = d.col * TILE, y = d.row * TILE;
  const accent = ACCENTS[((look.color % ACCENTS.length) + ACCENTS.length) % ACCENTS.length];
  const plan = deskPlan(d.col, d.row, look.items);
  // cloison de confidentialité (tissu teinté par la couleur d'accent, très atténuée)
  const fabric = mix(accent, '#8e959f', 0.72);
  box(ctx, x + 1, y + 0.5, 46, 3, 22, '#d9d4cc', shade(fabric, -0.05), 1);
  ctx.fillStyle = accent; ctx.globalAlpha = 0.85; ctx.fillRect(x + 2, y - 18.6, 44, 0.9); ctx.globalAlpha = 1;
  for (const p of plan.parts) if (p.kind === 'panel' && p.item) drawPanelItem(ctx, p.item, p.ax, p.ay, accent);
  // plan de travail
  ctx.fillStyle = C.deskLeg; ctx.fillRect(x + 3, y + 10, 1.6, 5); ctx.fillRect(x + 43.4, y + 10, 1.6, 5);
  box(ctx, x + 1, y + 3, 46, 9, 7, C.deskTop, C.deskFront, 1.4);
  ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(x + 1, y + 8, 46, 0.6);
  // caisson ou objet au sol
  if (plan.floor === 'network_rack') { box(ctx, x + 50, y + 2, 12, 12, 22, '#2f343c', '#22262d', 1); for (let i = 0; i < 5; i++) { fillRR(ctx, '#1a1d22', x + 51.5, y - 17 + i * 3.6, 9, 2.4, 0.4); } }
  else if (plan.floor === 'server_mini') { box(ctx, x + 51, y + 4, 10, 10, 14, '#3a3f47', '#2b2f36', 1); ctx.fillStyle = '#1b1e23'; for (let i = 0; i < 3; i++) ctx.fillRect(x + 52.5, y - 7 + i * 3, 7, 1.6); }
  else { box(ctx, x + 50, y + 4, 12, 10, 10, '#e4dfd6', '#bcb3a5', 1.2); ctx.fillStyle = 'rgba(60,50,40,0.3)'; ctx.fillRect(x + 51, y + 6.5, 10, 0.5); ctx.fillRect(x + 54, y + 8.4, 4, 0.8); }
  // écrans (éteints : le contenu est dessiné à l'exécution)
  for (const s of plan.screens) {
    fillRR(ctx, C.metal, s.x + s.w / 2 - 1.2, s.y + s.h - 1, 2.4, 4, 0.6); fillRR(ctx, C.metal, s.x + s.w / 2 - 4, s.y + s.h + 2.4, 8, 1.6, 0.8);
    fillRR(ctx, C.bezel, s.x - 1, s.y - 1, s.w + 2, s.h + 2, 1.4); fillRR(ctx, C.screenOff, s.x, s.y, s.w, s.h, 0.8);
  }
  // clavier (mécanique : rétroéclairage ambre) et souris
  const mech = look.items.includes('mech_keyboard');
  fillRR(ctx, mech ? '#2a2e35' : '#f1efe9', x + 18, y - 1, 16, 4.4, 1);
  ctx.fillStyle = mech ? 'rgba(245,167,66,0.75)' : 'rgba(80,90,110,0.35)';
  for (let r = 0; r < 2; r++) for (let k = 0; k < 8; k++) ctx.fillRect(x + 19 + k * 1.8, y - 0.2 + r * 1.6, 1.2, 0.9);
  ctx.fillStyle = '#e4e8ef'; ctx.beginPath(); ctx.ellipse(x + 36.6, y + 0.9, 1.2, 1.6, 0, 0, 7); ctx.fill();
  // objets posés, chacun sur son emplacement réservé
  for (const p of plan.parts) if (p.kind === 'surface' && p.item) drawSurfaceItem(ctx, p.item, p.ax, p.ay, accent);
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const f = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${((f(16) << 16) | (f(8) << 8) | f(0)).toString(16).padStart(6, '0')}`;
}

function drawPanelItem(ctx: Ctx, it: DecorItem, px: number, py: number, accent: string) {
  const w = 11, h = 12, x = 0, y = 0;
  ctx.save(); ctx.translate(px, py); ctx.scale(PANEL_W / w, PANEL_H / h);
  switch (it) {
    case 'shield_poster': fillRR(ctx, '#1f2a3a', x, y, w, h, 0.6); ctx.fillStyle = '#4ccaa1'; ctx.beginPath(); ctx.moveTo(x + 5.5, y + 2); ctx.lineTo(x + 9, y + 3.4); ctx.lineTo(x + 8.6, y + 7); ctx.quadraticCurveTo(x + 7.6, y + 9.6, x + 5.5, y + 10.4); ctx.quadraticCurveTo(x + 3.4, y + 9.6, x + 2.4, y + 7); ctx.lineTo(x + 2, y + 3.4); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#1f2a3a'; ctx.fillRect(x + 4.8, y + 4.5, 1.4, 3.6); break;
    case 'status_board': fillRR(ctx, '#20242b', x - 1, y, w + 2, h, 0.6); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { ctx.fillStyle = (r * 4 + c) % 7 === 3 ? '#e6c04c' : '#4ccaa1'; ctx.globalAlpha = 0.8; ctx.fillRect(x + 0.6 + c * 2.6, y + 1.4 + r * 2.6, 1.8, 1.8); } ctx.globalAlpha = 1; break;
    case 'space_poster': fillRR(ctx, '#151b33', x, y, w, h, 0.6); for (let i = 0; i < 8; i++) { ctx.fillStyle = '#fff'; ctx.fillRect(x + hash2(i, 1) * w, y + hash2(i, 2) * 6, 0.5, 0.5); } dot(ctx, x + 7.6, y + 8.4, 2.6, '#c98a52'); ctx.strokeStyle = '#e8c99a'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.ellipse(x + 7.6, y + 8.4, 4.2, 1.1, -0.3, 0, 7); ctx.stroke(); break;
    case 'star_map': fillRR(ctx, '#0f1a2e', x, y, w, h, 0.6); ctx.strokeStyle = 'rgba(140,180,230,0.7)'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.moveTo(x + 2, y + 9); ctx.lineTo(x + 4.5, y + 4); ctx.lineTo(x + 8, y + 6); ctx.lineTo(x + 9.4, y + 2.4); ctx.stroke(); for (const [a, b] of [[2, 9], [4.5, 4], [8, 6], [9.4, 2.4]]) dot(ctx, x + a, y + b, 0.6, '#e6eefb'); break;
    case 'code_poster': fillRR(ctx, '#1d2128', x, y, w, h, 0.6); for (let r = 0; r < 5; r++) { ctx.fillStyle = r % 3 === 1 ? '#f5a742' : '#4ccaa1'; ctx.fillRect(x + 1.4 + (r % 2) * 1.6, y + 1.6 + r * 2, 3 + hash2(r, 4) * 4, 0.8); } break;
    case 'notes_board': fillRR(ctx, '#b9915f', x - 1, y, w + 2, h, 0.6); fillRR(ctx, '#d8b884', x - 0.2, y + 0.8, w + 0.4, h - 1.6, 0.4); for (let i = 0; i < 4; i++) { ctx.fillStyle = ['#ffe58a', '#a8d8f0', '#f6b6a8', '#c8e6a0'][i]; ctx.fillRect(x + 0.6 + (i % 2) * 5, y + 1.6 + Math.floor(i / 2) * 5, 4, 3.8); } break;
    case 'chart_poster': fillRR(ctx, '#f4f2ee', x, y, w, h, 0.6); for (let i = 0; i < 4; i++) { ctx.fillStyle = i === 2 ? accent : '#6f8fb0'; const bh = 2 + hash2(i, 9) * 6; ctx.fillRect(x + 1.6 + i * 2.2, y + h - 1.6 - bh, 1.5, bh); } break;
    case 'art_poster': fillRR(ctx, '#f1ece2', x, y, w, h, 0.6); dot(ctx, x + 4, y + 5, 2.6, '#e07a5f'); ctx.fillStyle = '#3d5a80'; ctx.fillRect(x + 5, y + 6, 4.6, 4.4); ctx.fillStyle = '#f2cc8f'; ctx.beginPath(); ctx.moveTo(x + 2, y + 10.4); ctx.lineTo(x + 5, y + 7); ctx.lineTo(x + 7, y + 10.4); ctx.closePath(); ctx.fill(); break;
    default: break;
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + w / 2 - 0.4, y - 0.4, 0.8, 0.8); // punaise
  ctx.restore();
}

function drawSurfaceItem(ctx: Ctx, it: DecorItem, x: number, y: number, accent: string) {
  switch (it) {
    case 'plant_small': pot(ctx, x, y + 2, 4.4, 3, 0); foliage(ctx, x, y - 3, 3.6, 1, 0.5); break;
    case 'photo_frame': fillRR(ctx, '#6b5440', x - 2.6, y - 5, 5.2, 4.6, 0.5); fillRR(ctx, '#bcd3e6', x - 1.8, y - 4.2, 3.6, 3, 0.3); ctx.fillStyle = '#7a9a6a'; ctx.beginPath(); ctx.moveTo(x - 1.8, y - 1.2); ctx.lineTo(x - 0.2, y - 3); ctx.lineTo(x + 1.8, y - 1.2); ctx.closePath(); ctx.fill(); break;
    case 'mug': fillRR(ctx, accent, x - 1.6, y - 2.4, 3.2, 3.4, 0.8); ctx.strokeStyle = accent; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.arc(x + 1.9, y - 0.8, 0.9, -1.4, 1.4); ctx.stroke(); ctx.fillStyle = '#5a3a22'; ctx.fillRect(x - 1.3, y - 2.2, 2.6, 0.7); break;
    case 'desk_lamp': ctx.fillStyle = '#3a3f47'; ctx.beginPath(); ctx.ellipse(x, y + 1, 2.2, 1, 0, 0, 7); ctx.fill(); ctx.strokeStyle = '#3a3f47'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(x, y + 1); ctx.lineTo(x - 1.2, y - 6); ctx.lineTo(x + 2, y - 8.6); ctx.stroke(); ctx.fillStyle = accent; ctx.beginPath(); ctx.moveTo(x + 0.6, y - 9.6); ctx.lineTo(x + 4.4, y - 8.6); ctx.lineTo(x + 3.2, y - 6.6); ctx.closePath(); ctx.fill(); break;
    case 'ship_model': ctx.fillStyle = '#3a3f47'; ctx.fillRect(x - 0.3, y - 3, 0.6, 3); ctx.fillStyle = '#c9ced8'; ctx.beginPath(); ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y - 6); ctx.lineTo(x + 1, y - 3.4); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#6fb0f2'; ctx.fillRect(x + 1.4, y - 5.6, 1.6, 0.7); dot(ctx, x - 3.8, y - 4, 0.6, UI.amber); break;
    case 'planet_globe': ctx.fillStyle = '#5d4a38'; ctx.fillRect(x - 1.4, y, 2.8, 1); dot(ctx, x, y - 3.4, 3, '#4f7fa8'); ctx.fillStyle = '#7fae6a'; ctx.beginPath(); ctx.ellipse(x - 0.8, y - 4.2, 1.4, 1, 0.4, 0, 7); ctx.fill(); ctx.strokeStyle = '#c9a676'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.arc(x, y - 3.4, 3.6, 2, 5.2); ctx.stroke(); break;
    case 'rubber_duck': dot(ctx, x, y - 1, 2, '#f2cf3c'); dot(ctx, x + 1.6, y - 3.2, 1.3, '#f2cf3c'); ctx.fillStyle = '#e8892e'; ctx.fillRect(x + 2.5, y - 3.2, 1.2, 0.7); dot(ctx, x + 1.9, y - 3.6, 0.3, '#222'); break;
    case 'book_stack': for (let i = 0; i < 3; i++) fillRR(ctx, BOOK[i * 2 + 1], x - 3 + (i % 2) * 0.4, y - 1 - i * 1.5, 6, 1.4, 0.3); break;
    case 'documents': for (let i = 0; i < 3; i++) { ctx.save(); ctx.translate(x, y - 1 - i * 0.4); ctx.rotate(-0.15 + i * 0.12); fillRR(ctx, '#faf7f0', -2.6, -2, 5.2, 4, 0.2); ctx.restore(); } ctx.fillStyle = 'rgba(60,60,70,0.4)'; ctx.fillRect(x - 1.6, y - 2.6, 3, 0.4); ctx.fillRect(x - 1.6, y - 1.8, 2.2, 0.4); break;
    case 'magnifier': ctx.strokeStyle = '#3a3f47'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.arc(x - 0.6, y - 1.6, 1.6, 0, 7); ctx.moveTo(x + 0.6, y - 0.4); ctx.lineTo(x + 2.4, y + 1.2); ctx.stroke(); ctx.fillStyle = 'rgba(190,220,240,0.6)'; ctx.beginPath(); ctx.arc(x - 0.6, y - 1.6, 1.3, 0, 7); ctx.fill(); break;
    case 'typewriter': box(ctx, x - 4, y - 2, 8, 4, 3, '#3a4a40', '#2c3a32', 1); fillRR(ctx, '#f6f3ea', x - 2.6, y - 8, 5.2, 3.6, 0.2); break;
    case 'drawing_tablet': fillRR(ctx, '#2a2e35', x - 4, y - 2.6, 8, 5, 0.8); fillRR(ctx, '#3d434c', x - 3, y - 1.8, 5.4, 3.4, 0.4); ctx.strokeStyle = accent; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(x + 2.6, y - 3); ctx.lineTo(x + 4.6, y + 1); ctx.stroke(); break;
    case 'color_swatches': ['#e07a5f', '#f2cc8f', '#81b29a', '#3d5a80'].forEach((c, i) => { ctx.save(); ctx.translate(x, y); ctx.rotate(-0.5 + i * 0.32); fillRR(ctx, c, -0.8, -5, 1.6, 5, 0.4); ctx.restore(); }); break;
    case 'calculator': fillRR(ctx, '#3a3f47', x - 2, y - 3, 4, 5, 0.6); fillRR(ctx, '#b8d0b0', x - 1.4, y - 2.5, 2.8, 1.2, 0.2); ctx.fillStyle = '#c9ced8'; for (let i = 0; i < 6; i++) ctx.fillRect(x - 1.4 + (i % 3) * 1, y - 0.8 + Math.floor(i / 3) * 1, 0.7, 0.7); break;
    case 'headset_stand': ctx.fillStyle = '#3a3f47'; ctx.fillRect(x - 0.4, y - 6, 0.8, 6); ctx.fillRect(x - 2, y, 4, 0.8); ctx.strokeStyle = '#22252c'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y - 5, 2.6, Math.PI, 0); ctx.stroke(); fillRR(ctx, '#22252c', x - 3.2, y - 5, 1.6, 2.6, 0.6); fillRR(ctx, '#22252c', x + 1.6, y - 5, 1.6, 2.6, 0.6); dot(ctx, x + 2.4, y - 3.6, 0.4, UI.amber); break;
    case 'cable_box': fillRR(ctx, '#3a3f47', x - 3, y - 2, 6, 3, 0.8); ctx.strokeStyle = '#6fb0f2'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.moveTo(x - 2, y - 2); ctx.quadraticCurveTo(x - 1, y - 5, x + 2, y - 4); ctx.stroke(); dot(ctx, x + 2, y - 0.6, 0.4, UI.ok); break;
    default: break;
  }
}

// ───────────── décor mural ─────────────

const PAINT = [['#d9c7a7', '#6f8f7a', '#c98a52'], ['#e9e3d6', '#3d5a80', '#e07a5f'], ['#cfd8dc', '#81b29a', '#f2cc8f'], ['#efe6da', '#a8664c', '#4f6c7c'], ['#dde1e6', '#5b6b86', '#e6c04c'], ['#e6ddd0', '#7c8f72', '#b56c78']] as const;

/** Décor accroché sur la face visible d'un mur horizontal. */
export function drawWallDecor(ctx: Ctx, w: WallDecor, ext: boolean) {
  const g = wallFace(w.row, ext);
  const x = w.col * TILE, W = w.w * TILE, top = g.faceTop + 2, H = g.faceBottom - g.faceTop - 5;
  switch (w.kind) {
    case 'painting': {
      const p = PAINT[w.variant % PAINT.length];
      fillRR(ctx, '#6b5440', x + 3, top, W - 6, H - 1, 0.8); fillRR(ctx, p[0], x + 4, top + 1, W - 8, H - 3, 0.4);
      ctx.save(); rr(ctx, x + 4, top + 1, W - 8, H - 3, 0.4); ctx.clip();
      ctx.fillStyle = p[1]; ctx.beginPath(); ctx.moveTo(x + 4, top + H - 2); ctx.lineTo(x + 4 + (W - 8) * 0.4, top + 3); ctx.lineTo(x + W - 4, top + H - 2); ctx.closePath(); ctx.fill();
      dot(ctx, x + W - 9, top + 3.5, 1.6, p[2]);
      ctx.restore();
      break;
    }
    case 'clock': {
      const cx = x + 8, cy = top + H / 2;
      dot(ctx, cx, cy, 4.4, '#f4f2ee'); ctx.strokeStyle = '#3a3f47'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(cx, cy, 4.4, 0, 7); ctx.stroke();
      ctx.fillStyle = '#3a3f47'; for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; ctx.fillRect(cx + Math.cos(a) * 3.5 - 0.25, cy + Math.sin(a) * 3.5 - 0.25, 0.5, 0.5); }
      break;
    }
    case 'whiteboard': {
      fillRR(ctx, '#8a919b', x + 2, top - 1, W - 4, H + 1, 0.8); fillRR(ctx, '#f7f8f9', x + 3, top, W - 6, H - 1, 0.5);
      ctx.fillStyle = '#9aa1aa'; ctx.fillRect(x + W / 2 - 6, top + H, 12, 1);
      if (!w.text) { ctx.strokeStyle = 'rgba(60,90,140,0.45)'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(x + 6, top + 4); ctx.lineTo(x + 16, top + 4); ctx.moveTo(x + 6, top + 7); ctx.lineTo(x + 12, top + 7); ctx.stroke(); }
      break;
    }
    case 'tv': {
      fillRR(ctx, '#1b1e23', x + 2, top - 1, W - 4, H + 1, 1); fillRR(ctx, '#23272e', x + 3, top, W - 6, H - 1, 0.6);
      if (w.text) { ctx.font = `600 3.6px ${FONT_FAMILY}`; ctx.fillStyle = '#9aa3ae'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(w.text, x + W / 2, top + H / 2, W - 10); ctx.textAlign = 'start'; }
      break;
    }
    case 'sign': case 'logo': {
      const logo = w.kind === 'logo';
      fillRR(ctx, logo ? '#2c3038' : '#3a3f47', x + 2, top, W - 4, H - 1, 1.2);
      ctx.font = `700 ${logo ? 5.4 : 4.2}px ${FONT_FAMILY}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      if (logo) {
        ctx.fillStyle = UI.amber; ctx.beginPath(); const lx = x + 10, ly = top + H / 2 - 0.5; ctx.moveTo(lx, ly - 3); ctx.lineTo(lx + 3, ly); ctx.lineTo(lx, ly + 3); ctx.lineTo(lx - 3, ly); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#f1ede6'; ctx.fillText(w.text, x + W / 2 + 4, top + H / 2, W - 20);
      } else { ctx.fillStyle = '#e9ebef'; ctx.fillText(w.text, x + W / 2, top + H / 2, W - 8); ctx.fillStyle = UI.amber; ctx.fillRect(x + 6, top + H - 3, W - 12, 0.8); }
      ctx.textAlign = 'start';
      break;
    }
    case 'board': {
      fillRR(ctx, '#2c3038', x + 3, top, W - 6, H - 1, 0.8);
      for (let i = 0; i < 6; i++) dot(ctx, x + 7 + (i % 3) * 4.2, top + 3 + Math.floor(i / 3) * 3.6, 0.9, i % 4 === 3 ? '#e6c04c' : '#4ccaa1');
      break;
    }
    case 'screen': {
      fillRR(ctx, '#1b1e23', x + 2, top - 1, W - 4, H + 1, 1); fillRR(ctx, '#12151a', x + 3, top, W - 6, H - 1, 0.6);
      break;
    }
    case 'elevator': {
      // ascenseur : encadrement inox, deux portes, indicateur d'étage au-dessus (animé par le rendu dynamique)
      fillRR(ctx, '#9aa1aa', x + 1.5, top - 1.8, W - 3, H + 3.8, 0.8);
      fillRR(ctx, '#c9ced5', x + 3, top + 1.6, W - 6, H + 0.4, 0.4);
      ctx.fillStyle = '#aab1ba'; ctx.fillRect(x + W / 2 - 0.25, top + 1.6, 0.5, H + 0.4);
      fillRR(ctx, '#1b1f25', x + W / 2 - 4, top - 1.4, 8, 2.4, 0.6);
      fillRR(ctx, '#8d949d', x + W - 3.2, top + H / 2 - 1, 1.4, 3, 0.5); ctx.fillStyle = '#f5c26b'; ctx.beginPath(); ctx.arc(x + W - 2.5, top + H / 2 + 0.5, 0.45, 0, 7); ctx.fill();
      break;
    }
    case 'stairs': {
      // porte de l'escalier de secours + pictogramme vert
      fillRR(ctx, '#6a6f77', x + 4, top + 1.4, W - 8, H + 0.6, 0.6); fillRR(ctx, '#7d838c', x + 5, top + 2.2, W - 10, H - 0.2, 0.4);
      ctx.fillStyle = '#c9ced5'; ctx.fillRect(x + W - 8, top + H / 2, 2.4, 0.7);
      fillRR(ctx, '#1f8a4c', x + W / 2 - 5, top - 1.8, 10, 2.9, 0.6);
      ctx.fillStyle = '#e9fff1'; ctx.font = `700 1.9px ${FONT_FAMILY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('ESCALIER', x + W / 2 + 1, top - 0.35, 7.5); ctx.textAlign = 'start';
      ctx.strokeStyle = '#e9fff1'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.moveTo(x + W / 2 - 4.4, top + 0.6); ctx.lineTo(x + W / 2 - 3.6, top + 0.6); ctx.lineTo(x + W / 2 - 3.6, top - 0.2); ctx.lineTo(x + W / 2 - 2.8, top - 0.2); ctx.lineTo(x + W / 2 - 2.8, top - 1); ctx.stroke();
      break;
    }
    case 'planning': {
      // tableau d'affichage façon « départs » : cadre laiton, fond ardoise ; le contenu réel est dessiné à chaque image
      fillRR(ctx, '#8c7752', x + 1.5, top - 1.6, W - 3, H + 2.4, 1);
      fillRR(ctx, '#1c2128', x + 2.4, top - 0.8, W - 4.8, H + 0.8, 0.6);
      ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(x + 2.4, top - 0.8, W - 4.8, 2.6);
      dot(ctx, x + 4, top + H - 1.4, 0.45, '#8c7752'); dot(ctx, x + W - 4, top + H - 1.4, 0.45, '#8c7752');
      break;
    }
    case 'menu': {
      fillRR(ctx, '#2f3a33', x + 3, top - 1, W - 6, H + 1, 0.8);
      ctx.font = `600 3.4px ${FONT_FAMILY}`; ctx.fillStyle = '#efe9dc'; ctx.textBaseline = 'middle'; ctx.fillText('Café', x + 5.6, top + 2.6);
      ctx.fillStyle = 'rgba(239,233,220,0.55)'; ctx.fillRect(x + 5.6, top + 5.4, 12, 0.5); ctx.fillRect(x + 5.6, top + 7.2, 9, 0.5);
      break;
    }
    case 'map': {
      fillRR(ctx, '#6b5440', x + 2, top - 1, W - 4, H + 1, 0.8); fillRR(ctx, '#e9dfc6', x + 3, top, W - 6, H - 1, 0.4);
      ctx.strokeStyle = 'rgba(90,110,120,0.6)'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(x + 6, top + 6); ctx.quadraticCurveTo(x + 14, top + 1, x + 22, top + 6); ctx.quadraticCurveTo(x + 30, top + 9, x + W - 6, top + 4); ctx.stroke();
      ctx.fillStyle = 'rgba(110,140,100,0.5)'; ctx.beginPath(); ctx.ellipse(x + 14, top + 6, 5, 2.4, 0.3, 0, 7); ctx.fill();
      break;
    }
  }
}
