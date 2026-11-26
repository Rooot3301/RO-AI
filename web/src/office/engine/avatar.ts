// Personnages vectoriels dessinés par code, selon l'apparence de la fiche (peau, cheveux, coiffure, tenue, accessoire),
// avec repli sur les 6 variantes historiques (`avatar.sprite`). Origine = pieds au sol, axe Y vers le bas ; ≈ 26 unités debout.
import type { Accessory, Appearance } from '../../api/types.ts';
import { rr } from './draw.ts';
import type { Ctx } from './draw.ts';

export interface AvatarStyle {
  skin: string; skinShade: string; hair: string; hairShade: string; hairStyle: number;
  top: string; topShade: string; pants: string; shoes: string;
  /** 0 col rond, 1 chemise (col), 2 veste (revers), 3 sweat à capuche, 4 pull col roulé. */
  detail: number; trim: string;
  accessory: Accessory;
}

export const SKINS: readonly [string, string][] = [
  ['#f4d6bf', '#e2b99c'], ['#ebc19d', '#d6a47e'], ['#d6a179', '#bd875f'], ['#b27b52', '#98633e'], ['#8d5b3b', '#74472c'], ['#68412b', '#553320'],
];
export const HAIRS: readonly [string, string][] = [
  ['#211c1f', '#151214'], ['#3d2b22', '#2c1f18'], ['#6a4631', '#553724'], ['#8c3f22', '#6e3018'], ['#d7b56b', '#bf9a4f'], ['#c9c6c0', '#aeaaa3'], ['#b85a2c', '#984720'], ['#33415f', '#26324b'],
];
export const OUTFITS: readonly { top: string; topShade: string; pants: string; shoes: string; detail: number; trim: string }[] = [
  { top: '#5b7fb5', topShade: '#4a6a9c', pants: '#2e3542', shoes: '#1c2028', detail: 1, trim: '#e9eef6' },
  { top: '#7c9a7e', topShade: '#678568', pants: '#3a3f4a', shoes: '#2a2a2e', detail: 0, trim: '#6a8a6c' },
  { top: '#4a4f58', topShade: '#3b3f47', pants: '#2a2e36', shoes: '#eceef2', detail: 3, trim: '#f5a742' },
  { top: '#2f3d5c', topShade: '#25314b', pants: '#2b3244', shoes: '#16181d', detail: 2, trim: '#f1f3f7' },
  { top: '#eeece7', topShade: '#d8d5cd', pants: '#3b4a63', shoes: '#2a2f3b', detail: 0, trim: '#d0ccc2' },
  { top: '#8e3d4a', topShade: '#77313d', pants: '#2e323c', shoes: '#1d1f25', detail: 4, trim: '#7a3440' },
  { top: '#c8b48e', topShade: '#b39e78', pants: '#4a4339', shoes: '#2c261f', detail: 1, trim: '#f3ead8' },
  { top: '#9aa3ae', topShade: '#848d99', pants: '#2c313b', shoes: '#1b1e24', detail: 2, trim: '#4f5866' },
];

const LEGACY: readonly Appearance[] = [
  { skin: 0, hair: 1, hair_style: 0, outfit: 0, accessory: 'none' },
  { skin: 2, hair: 0, hair_style: 1, outfit: 1, accessory: 'none' },
  { skin: 3, hair: 6, hair_style: 2, outfit: 5, accessory: 'earrings' },
  { skin: 4, hair: 0, hair_style: 4, outfit: 3, accessory: 'glasses' },
  { skin: 0, hair: 4, hair_style: 3, outfit: 6, accessory: 'none' },
  { skin: 2, hair: 5, hair_style: 5, outfit: 7, accessory: 'glasses' },
];
const ACCESSORIES: readonly Accessory[] = ['none', 'glasses', 'headset', 'cap', 'beanie', 'earrings'];
const mod = (v: unknown, n: number) => { const x = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0; return ((x % n) + n) % n; };

/** Style de dessin d'après la fiche (valeurs bornées), sinon d'après la variante historique. */
export function styleFor(app: Appearance | null | undefined, sprite = 0): AvatarStyle {
  const a = app ?? LEGACY[mod(sprite, LEGACY.length)];
  const [skin, skinShade] = SKINS[mod(a.skin, SKINS.length)];
  const [hair, hairShade] = HAIRS[mod(a.hair, HAIRS.length)];
  const o = OUTFITS[mod(a.outfit, OUTFITS.length)];
  return { skin, skinShade, hair, hairShade, hairStyle: mod(a.hair_style, 6), top: o.top, topShade: o.topShade, pants: o.pants, shoes: o.shoes, detail: o.detail, trim: o.trim, accessory: ACCESSORIES.includes(a.accessory) ? a.accessory : 'none' };
}
/** Compatibilité : les 6 variantes historiques. */
export const AVATARS: readonly AvatarStyle[] = LEGACY.map((a) => styleFor(a));

export type AvatarPose = 'stand' | 'walk' | 'cheer' | 'hand' | 'talk' | 'cup' | 'book' | 'reach' | 'cross' | 'behind' | 'sit-back' | 'sit-front' | 'sit-side';
export interface AvatarParams {
  pose: AvatarPose;
  /** 0 bas (face), 1 haut (dos), 2 droite, 3 gauche. */
  dir: number;
  /** Phase de marche (radians) ou temps (frappe, respiration). */
  phase: number;
  /** Assis au bureau : 0 repos, 1 frappe, 2 lecture, 3 souris (web), 4 frappe rapide (terminal), 5 alarme, 6 quota (bras croisés). */
  hands: number;
  /** Respiration 0..1. */
  breath: number;
  /** Direction de la tête si elle diffère du corps ; masque le bras droit (dessiné par l'appelant). */
  headDir?: number;
  hideRight?: boolean;
  /** Humeur (-1 soucieux, 0 neutre, 1 serein) : visible sur le visage de face. */
  mood?: number;
  /** Parle (bouche animée, geste). */
  talking?: boolean;
  /** Assis, de face : tient une tasse (1), un livre (2), lève la main (3). */
  hold?: number;
}

const OUT = 'rgba(0,0,0,0.22)';
function fillRRs(ctx: Ctx, color: string, x: number, y: number, w: number, h: number, r: number) { rr(ctx, x, y, w, h, r); ctx.fillStyle = color; ctx.fill(); }
function limb(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, w: number, color: string) {
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.stroke();
}
function dot(ctx: Ctx, x: number, y: number, r: number, color: string) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }

// ───────────── tête ─────────────

function hairBack(ctx: Ctx, a: AvatarStyle, hx: number, hy: number, back: boolean, side: number) {
  ctx.fillStyle = a.hair;
  switch (a.hairStyle) {
    case 1: rr(ctx, hx - 5.5 + side * 0.6, hy - 2.5, 11, back ? 11.5 : 10, 4.2); ctx.fill(); break; // longs
    case 2: ctx.beginPath(); ctx.arc(hx - side * 1.2, hy - 5.8 + (back ? 1.6 : 0), 2.7, 0, 7); ctx.fill(); break; // chignon
    case 3: rr(ctx, hx - 5.4, hy - 2.6, 10.8, 7.4, 3.4); ctx.fill(); break; // carré
    case 4: for (let i = 0; i < 7; i++) { const ang = Math.PI * (0.95 + i * 0.185); ctx.beginPath(); ctx.arc(hx + Math.cos(ang) * 4.9, hy - 0.6 + Math.sin(ang) * 4.9, 2.7, 0, 7); ctx.fill(); } break; // bouclés
    default: break;
  }
}
function hairFront(ctx: Ctx, a: AvatarStyle, hx: number, hy: number, back: boolean, side: number) {
  ctx.fillStyle = a.hair;
  const r = 4.85;
  if (a.hairStyle === 5) { // rasé : fine calotte
    ctx.globalAlpha *= 0.85;
    ctx.beginPath(); ctx.arc(hx - side * 0.3, hy - 0.4, r, Math.PI * 1.05, Math.PI * 1.95); ctx.closePath(); ctx.fill();
    if (back) { ctx.beginPath(); ctx.arc(hx, hy - 0.2, r - 0.2, 0, 7); ctx.fill(); }
    ctx.globalAlpha /= 0.85;
    return;
  }
  if (back) {
    ctx.beginPath(); ctx.arc(hx, hy - 0.2, r, 0, 7); ctx.fill();
    ctx.fillStyle = a.hairShade; ctx.beginPath(); ctx.ellipse(hx, hy + 2.6, 3.6, 1.6, 0, 0, Math.PI); ctx.fill();
    if (a.hairStyle === 4) { ctx.fillStyle = a.hair; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(hx + i * 3.4, hy - 3.4 - (i === 0 ? 1 : 0), 2.5, 0, 7); ctx.fill(); } }
    if (a.hairStyle === 1 || a.hairStyle === 3) { ctx.fillStyle = a.hair; rr(ctx, hx - 5.2, hy - 1, 10.4, a.hairStyle === 1 ? 9 : 6.4, 3.4); ctx.fill(); }
    return;
  }
  ctx.beginPath(); ctx.arc(hx - side * 0.5, hy - 0.4, r, Math.PI * 1.02, Math.PI * 1.98); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.ellipse(hx - side * 0.7, hy - 2.2, r, 3.1, 0, Math.PI, Math.PI * 2); ctx.fill();
  if (a.hairStyle === 4) for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(hx + i * 3.3, hy - 3.9, 2.4, 0, 7); ctx.fill(); }
  if (a.hairStyle === 3) { rr(ctx, hx - 4.6 + side * 0.4, hy - 4.3, 9.2, 2.6, 1.2); ctx.fill(); } // frange
  if (a.hairStyle === 0) { ctx.fillStyle = a.hairShade; ctx.beginPath(); ctx.ellipse(hx + 1.6 - side, hy - 3.6, 2.4, 1, -0.3, 0, 7); ctx.fill(); } // mèche
  if ((a.hairStyle === 1 || a.hairStyle === 3) && side !== 0) { ctx.fillStyle = a.hair; rr(ctx, hx - 5.2 - (side > 0 ? 1.4 : -1.4), hy - 3, 4, a.hairStyle === 1 ? 9.5 : 6.5, 2); ctx.fill(); }
  if (a.hairStyle === 1 && side === 0) { ctx.fillStyle = a.hair; rr(ctx, hx - 5.6, hy - 2, 2.4, 9, 1.2); ctx.fill(); rr(ctx, hx + 3.2, hy - 2, 2.4, 9, 1.2); ctx.fill(); }
}

function accessory(ctx: Ctx, a: AvatarStyle, hx: number, hy: number, back: boolean, side: number, layer: 'back' | 'front') {
  switch (a.accessory) {
    case 'glasses':
      if (layer !== 'front' || back) return;
      ctx.strokeStyle = '#1e2026'; ctx.lineWidth = 0.55;
      if (side === 0) { ctx.beginPath(); ctx.arc(hx - 1.8, hy + 0.7, 1.35, 0, 7); ctx.moveTo(hx + 3.15, hy + 0.7); ctx.arc(hx + 1.8, hy + 0.7, 1.35, 0, 7); ctx.moveTo(hx - 0.45, hy + 0.6); ctx.lineTo(hx + 0.45, hy + 0.6); ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(hx + side * 2.3, hy + 0.7, 1.3, 0, 7); ctx.moveTo(hx + side * 1, hy + 0.5); ctx.lineTo(hx - side * 2.6, hy + 0.2); ctx.stroke(); }
      return;
    case 'headset':
      if (layer !== 'front') return;
      ctx.strokeStyle = '#22252c'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.arc(hx, hy - 0.4, 5.3, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
      if (side === 0) { fillRRs(ctx, '#22252c', hx - 6.2, hy - 1.2, 2.2, 3.6, 1); fillRRs(ctx, '#22252c', hx + 4, hy - 1.2, 2.2, 3.6, 1); if (!back) { ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(hx - 5.2, hy + 2); ctx.quadraticCurveTo(hx - 4.6, hy + 4.4, hx - 2, hy + 4); ctx.stroke(); } }
      else fillRRs(ctx, '#22252c', hx - side * 0.8 - 1.4, hy - 1.4, 2.8, 3.8, 1.2);
      dot(ctx, side === 0 ? hx + 5.1 : hx - side * 0.8, hy + 0.4, 0.45, '#f5a742');
      return;
    case 'cap':
      if (layer !== 'front') return;
      fillRRs(ctx, '#3f5d7c', hx - 5, hy - 5.8, 10, 4.6, 2.4);
      if (!back) { ctx.fillStyle = '#34506c'; ctx.beginPath(); ctx.ellipse(hx + side * 3.4, hy - 1.8, side ? 3.4 : 4.8, 1.3, 0, 0, 7); ctx.fill(); }
      dot(ctx, hx, hy - 5.6, 0.6, '#2c4157');
      return;
    case 'beanie':
      if (layer !== 'front') return;
      fillRRs(ctx, '#b0583f', hx - 5.2, hy - 6.6, 10.4, 5.4, 2.8);
      fillRRs(ctx, '#9a4b35', hx - 5.3, hy - 2.4, 10.6, 1.8, 0.9);
      dot(ctx, hx, hy - 6.8, 1.1, '#c8705a');
      return;
    case 'earrings':
      if (layer !== 'front' || back) return;
      if (side === 0) { dot(ctx, hx - 4.7, hy + 2.3, 0.55, '#e9c46a'); dot(ctx, hx + 4.7, hy + 2.3, 0.55, '#e9c46a'); }
      else dot(ctx, hx - side * 0.6, hy + 2.4, 0.55, '#e9c46a');
      return;
    default: return;
  }
}

export function head(ctx: Ctx, a: AvatarStyle, hx: number, hy: number, dir: number, tilt = 0, mood = 0, talk = 0) {
  const back = dir === 1, side = dir === 2 ? 1 : dir === 3 ? -1 : 0;
  ctx.save(); ctx.translate(hx, hy); ctx.rotate(tilt); ctx.translate(-hx, -hy);
  hairBack(ctx, a, hx, hy, back, side);
  ctx.fillStyle = a.skin; ctx.beginPath(); ctx.arc(hx, hy, 4.6, 0, 7); ctx.fill();
  if (!back) { ctx.fillStyle = a.skinShade; ctx.beginPath(); ctx.arc(hx, hy, 4.6, 0.2, Math.PI - 0.2); ctx.arc(hx, hy - 1.2, 4.2, Math.PI - 0.3, 0.3, true); ctx.fill(); }
  if (side === 0 && !back) { ctx.fillStyle = a.skinShade; ctx.beginPath(); ctx.arc(hx - 4.6, hy + 0.6, 1, 0, 7); ctx.arc(hx + 4.6, hy + 0.6, 1, 0, 7); ctx.fill(); }
  hairFront(ctx, a, hx, hy, back, side);
  if (!back) {
    ctx.fillStyle = '#2a2230';
    if (side === 0) {
      ctx.beginPath(); ctx.arc(hx - 1.7, hy + 0.7, 0.72, 0, 7); ctx.arc(hx + 1.7, hy + 0.7, 0.72, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(220,110,100,0.18)'; ctx.beginPath(); ctx.arc(hx - 2.7, hy + 2.1, 1, 0, 7); ctx.arc(hx + 2.7, hy + 2.1, 1, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(60,30,30,0.6)'; ctx.lineWidth = 0.6; ctx.lineCap = 'round';
      if (talk > 0) { ctx.fillStyle = 'rgba(80,30,30,0.7)'; ctx.beginPath(); ctx.ellipse(hx, hy + 2.9, 0.9, 0.35 + talk * 0.6, 0, 0, 7); ctx.fill(); }
      else { ctx.beginPath(); ctx.moveTo(hx - 0.9 - (mood > 0 ? 0.35 : 0), hy + 2.6); ctx.quadraticCurveTo(hx, hy + (mood > 0 ? 3.7 : mood < 0 ? 2.2 : 3.2), hx + 0.9 + (mood > 0 ? 0.35 : 0), hy + 2.6); ctx.stroke(); }
      if (mood < 0) { ctx.beginPath(); ctx.moveTo(hx - 2.7, hy - 0.5); ctx.lineTo(hx - 1, hy - 1.3); ctx.moveTo(hx + 2.7, hy - 0.5); ctx.lineTo(hx + 1, hy - 1.3); ctx.stroke(); }
    } else {
      ctx.beginPath(); ctx.arc(hx + side * 2.2, hy + 0.7, 0.75, 0, 7); ctx.fill();
      ctx.fillStyle = a.skinShade; ctx.beginPath(); ctx.arc(hx + side * 4.5, hy + 1.4, 0.9, 0, 7); ctx.fill();
      if (talk > 0) { ctx.fillStyle = 'rgba(80,30,30,0.6)'; ctx.beginPath(); ctx.ellipse(hx + side * 3, hy + 2.8, 0.6, 0.3 + talk * 0.4, 0, 0, 7); ctx.fill(); }
    }
  }
  accessory(ctx, a, hx, hy, back, side, 'front');
  ctx.restore();
}

// ───────────── corps ─────────────

function torso(ctx: Ctx, a: AvatarStyle, tw: number, top: number, h: number, back: boolean, side: number) {
  ctx.fillStyle = a.top; rr(ctx, -tw, top, tw * 2, h, 3.6); ctx.fill();
  ctx.fillStyle = OUT; rr(ctx, -tw, top + h - 2.6, tw * 2, 2.6, 1.6); ctx.fill();
  if (back) { if (a.detail === 3) { fillRRs(ctx, a.topShade, -3.4, top + 0.4, 6.8, 3.6, 1.8); } return; }
  if (side !== 0) { if (a.detail === 2) { ctx.fillStyle = a.topShade; ctx.fillRect(side * 0.5 - 0.4, top + 1, 0.8, h - 3); } return; }
  switch (a.detail) {
    case 1: ctx.fillStyle = a.trim; ctx.beginPath(); ctx.moveTo(-2.4, top + 0.2); ctx.lineTo(0, top + 2.6); ctx.lineTo(2.4, top + 0.2); ctx.lineTo(1, top + 0.2); ctx.lineTo(0, top + 1.4); ctx.lineTo(-1, top + 0.2); ctx.closePath(); ctx.fill(); ctx.fillStyle = a.topShade; for (let k = 0; k < 3; k++) ctx.fillRect(-0.25, top + 3.4 + k * 2, 0.5, 0.6); break;
    case 2: ctx.fillStyle = a.trim; ctx.beginPath(); ctx.moveTo(-1.6, top + 0.2); ctx.lineTo(0, top + 5.2); ctx.lineTo(1.6, top + 0.2); ctx.closePath(); ctx.fill(); ctx.strokeStyle = a.topShade; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(-2.4, top + 0.2); ctx.lineTo(-0.4, top + 6); ctx.moveTo(2.4, top + 0.2); ctx.lineTo(0.4, top + 6); ctx.stroke(); break;
    case 3: ctx.strokeStyle = a.trim; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(-1, top + 1.2); ctx.lineTo(-1.1, top + 4.2); ctx.moveTo(1, top + 1.2); ctx.lineTo(1.1, top + 4.2); ctx.stroke(); fillRRs(ctx, a.topShade, -3, top + h - 6.4, 6, 2.6, 1); break;
    case 4: fillRRs(ctx, a.topShade, -2.6, top - 0.6, 5.2, 2.2, 1.1); break;
    default: ctx.fillStyle = a.topShade; ctx.beginPath(); ctx.moveTo(-1.8, top + 0.2); ctx.lineTo(0, top + 2); ctx.lineTo(1.8, top + 0.2); ctx.closePath(); ctx.fill();
  }
}

/** Dessine un personnage. Coordonnées locales : pieds en (0,0). */
export function drawAvatar(ctx: Ctx, a: AvatarStyle, p: AvatarParams) {
  if (p.pose === 'sit-back') return drawSitBack(ctx, a, p);
  if (p.pose === 'sit-front' || p.pose === 'sit-side') return drawSitFront(ctx, a, p);
  const dir = p.dir, side = dir === 2 ? 1 : dir === 3 ? -1 : 0, back = dir === 1;
  const walking = p.pose === 'walk';
  const s = walking ? Math.sin(p.phase) : 0;
  const bob = walking ? Math.abs(Math.cos(p.phase)) * 0.9 : p.pose === 'cheer' ? Math.abs(Math.sin(p.phase * 2)) * 2 : 0;
  const breathe = p.breath * 0.35;
  ctx.save();
  ctx.translate(0, -bob);
  // jambes
  if (side === 0) {
    const l = walking ? s * 2.4 : 0;
    limb(ctx, -1.9, -7.2, -1.9, -1.2 - Math.max(0, -l), 3.1, a.pants);
    limb(ctx, 1.9, -7.2, 1.9, -1.2 - Math.max(0, l), 3.1, a.pants);
    ctx.fillStyle = a.shoes; ctx.beginPath(); ctx.ellipse(-1.9, -0.6 - Math.max(0, -l), 2.1, 1.25, 0, 0, 7); ctx.ellipse(1.9, -0.6 - Math.max(0, l), 2.1, 1.25, 0, 0, 7); ctx.fill();
  } else {
    const l = walking ? s * 3.4 : 0;
    limb(ctx, 0, -7.2, -l, -1.2, 3.2, a.pants); limb(ctx, 0, -7.2, l, -1.2, 3.2, a.pants);
    ctx.fillStyle = a.shoes; ctx.beginPath(); ctx.ellipse(-l + side * 0.8, -0.7, 2.3, 1.25, 0, 0, 7); ctx.ellipse(l + side * 0.8, -0.7, 2.3, 1.25, 0, 0, 7); ctx.fill();
  }
  const armSwing = walking ? s * 3 : 0;
  const t = p.phase;
  const drawArms = () => {
    if (side === 0) {
      const wave = Math.sin(t * 3) * 1.2;
      const L = (x: number, y: number, hand = true) => { limb(ctx, -4.7, -14.6, x, y, 2.7, a.top); if (hand) dot(ctx, x - 0.1, y + 0.8, 1.45, a.skin); };
      const R = (x: number, y: number, hand = true) => { limb(ctx, 4.7, -14.6, x, y, 2.7, a.top); if (hand) dot(ctx, x + 0.1, y + 0.8, 1.45, a.skin); };
      switch (p.pose) {
        case 'cheer': L(-7.2, -19.6 - wave * 0.5); R(7.2, -19.6 + wave * 0.5); break;
        case 'hand': L(-5.8, -8.6); R(6.2, -22.6 + wave * 0.6); break;
        case 'talk': L(-5.8, -8.6); R(6.6, -12.4 + Math.sin(t * 5) * 1.2); break;
        case 'cup': L(-5.8, -8.6); R(3.4, -11.4); fillRRs(ctx, '#f4f2ee', 2.2, -14.2, 3, 3.4, 0.8); ctx.fillStyle = '#7a4b2a'; ctx.fillRect(2.4, -14, 2.6, 0.8); break;
        case 'book': L(-2.6, -11); R(2.6, -11); ctx.save(); ctx.translate(0, -12.6); fillRRs(ctx, '#b0583f', -3.8, -2.6, 7.6, 5, 0.6); fillRRs(ctx, '#f6f1e4', -3.4, -2.3, 3.2, 4.4, 0.3); fillRRs(ctx, '#f6f1e4', 0.2, -2.3, 3.2, 4.4, 0.3); ctx.restore(); break;
        case 'reach': L(-5.8, -8.6); R(5.6, -21); break;
        case 'cross': L(2.6, -11.6, false); R(-2.6, -11, false); dot(ctx, 2.8, -10.8, 1.3, a.skin); dot(ctx, -2.8, -10.2, 1.3, a.skin); break;
        case 'behind': L(-3.6, -8.8, false); R(3.6, -8.8, false); break;
        default: L(-5.8, -8.6 + armSwing); if (!p.hideRight) R(5.8, -8.6 - armSwing);
      }
    } else {
      const raise = p.pose === 'hand' || p.pose === 'cheer' || p.pose === 'reach';
      const fore = p.pose === 'cup' || p.pose === 'book' || p.pose === 'talk';
      const ax = raise ? side * 3.6 : fore ? side * 4.6 : armSwing * side * 0.6;
      const ay = raise ? -21.4 : fore ? -11.6 + (p.pose === 'talk' ? Math.sin(t * 5) : 0) : -8;
      limb(ctx, 0, -14.4, ax, ay, 2.7, a.topShade);
      dot(ctx, ax, ay - (raise ? 0.9 : -0.8), 1.45, a.skin);
      if (p.pose === 'cup') { fillRRs(ctx, '#f4f2ee', ax + side * 0.6 - 1.5, ay - 3.4, 3, 3.4, 0.8); }
      if (p.pose === 'book') { fillRRs(ctx, '#b0583f', ax + side * 0.4 - 1.2, ay - 4.2, 2.4, 5, 0.5); }
    }
  };
  if (side !== 0) drawArms();
  const tw = side === 0 ? 5.2 : 3.9;
  torso(ctx, a, tw, -16.4 - breathe, 10.2 + breathe, back, side);
  if (side === 0) drawArms();
  ctx.fillStyle = a.skinShade; ctx.fillRect(-1.3, -17.6, 2.6, 2);
  const talk = p.talking ? 0.5 + 0.5 * Math.sin(t * 14) : 0;
  head(ctx, a, side * 0.4, -21.2 - breathe * 0.6, p.headDir ?? dir, walking ? s * 0.04 : 0, p.mood ?? 0, talk);
  ctx.restore();
}

/** Assis au bureau, vu de dos ; mains selon l'activité réelle. */
function drawSitBack(ctx: Ctx, a: AvatarStyle, p: AvatarParams) {
  const t = p.phase, h = p.hands;
  ctx.save();
  ctx.translate(0, 6 - p.breath * 0.4);
  const lean = h === 6 ? 1.4 : 0;
  ctx.fillStyle = a.pants; rr(ctx, -4.6, -5, 9.2, 5.4, 2.2); ctx.fill();
  const fast = h === 4 ? 24 : 15;
  const lh = h === 1 || h === 4 ? Math.sin(t * fast) * 0.9 : 0;
  const rh = h === 1 || h === 4 ? Math.sin(t * fast + 2.1) * 0.9 : h === 3 ? Math.sin(t * 2.2) * 0.6 : 0;
  let lx = -6.2, ly = -19.2 + lh, rx = 6.2, ry = -19.2 + rh;
  if (h === 3) { rx = 8.2; ry = -18.4 + rh; }
  if (h === 5) { lx = -4.6; ly = -25 + Math.sin(t * 3) * 0.4; rx = 4.6; ry = -25 - Math.sin(t * 3) * 0.4; } // mains sur la tête
  if (h === 6) { lx = 2.6; ly = -12.6; rx = -2.6; ry = -12.2; } // bras croisés, adossé
  if (h === 2) { lx = -5.4; ly = -18.6; rx = 6.8; ry = -18.4 + Math.sin(t * 0.8) * 0.5; }
  if (h !== 6) {
    limb(ctx, -4.8, -11.4 + lean, lx, ly, 2.7, a.topShade);
    limb(ctx, 4.8, -11.4 + lean, rx, ry, 2.7, a.topShade);
    dot(ctx, lx - 0.1, ly - 1, 1.4, a.skin); dot(ctx, rx + 0.1, ry - 1, 1.4, a.skin);
  }
  ctx.fillStyle = a.top; rr(ctx, -5.4, -16.4 + lean, 10.8, 12 - lean, 4); ctx.fill();
  if (a.detail === 3) fillRRs(ctx, a.topShade, -3.6, -16 + lean, 7.2, 3.8, 1.8);
  ctx.fillStyle = OUT; rr(ctx, -5.4, -8.2, 10.8, 3.2, 2); ctx.fill();
  if (h === 6) { limb(ctx, -4.6, -12, 3.8, -11.4, 2.6, a.topShade); limb(ctx, 4.6, -12, -3.8, -11, 2.6, a.topShade); }
  ctx.fillStyle = a.skinShade; ctx.fillRect(-1.3, -17.4 + lean, 2.6, 2);
  const nod = h === 2 ? Math.sin(t * 1.3) * 0.6 : 0;
  head(ctx, a, 0, -21.4 + nod + lean, 1, h === 5 ? Math.sin(t * 2) * 0.06 : 0);
  ctx.restore();
}

/** Assis de face (canapé, siège d'attente) ou de profil. */
function drawSitFront(ctx: Ctx, a: AvatarStyle, p: AvatarParams) {
  const side = p.pose === 'sit-side' ? (p.dir === 3 ? -1 : 1) : 0;
  const t = p.phase;
  ctx.save();
  ctx.translate(0, 2 - p.breath * 0.3);
  if (side === 0) {
    // cuisses vers le spectateur, tibias, chaussures
    ctx.fillStyle = a.pants; rr(ctx, -4.8, -7.4, 4.4, 5.6, 1.8); ctx.fill(); rr(ctx, 0.4, -7.4, 4.4, 5.6, 1.8); ctx.fill();
    limb(ctx, -2.6, -2.4, -2.6, 1.6, 3, a.pants); limb(ctx, 2.6, -2.4, 2.6, 1.6, 3, a.pants);
    ctx.fillStyle = a.shoes; ctx.beginPath(); ctx.ellipse(-2.6, 2.4, 2, 1.2, 0, 0, 7); ctx.ellipse(2.6, 2.4, 2, 1.2, 0, 0, 7); ctx.fill();
  } else {
    ctx.fillStyle = a.pants; rr(ctx, side > 0 ? -1 : -6.6, -8, 7.6, 3.6, 1.6); ctx.fill();
    limb(ctx, side * 5.6, -5.6, side * 5.8, 1.4, 3, a.pants);
    ctx.fillStyle = a.shoes; ctx.beginPath(); ctx.ellipse(side * 6.6, 1.8, 2.3, 1.2, 0, 0, 7); ctx.fill();
  }
  const tw = side === 0 ? 5.2 : 3.9;
  torso(ctx, a, tw, -17.4, 10.6, false, side);
  // bras
  const hold = p.hold ?? 0;
  if (side === 0) {
    if (hold === 3) { limb(ctx, 4.7, -15.4, 6.2, -23.4 + Math.sin(t * 3) * 0.6, 2.7, a.top); dot(ctx, 6.3, -24.4 + Math.sin(t * 3) * 0.6, 1.45, a.skin); limb(ctx, -4.7, -15.4, -3.6, -8.6, 2.7, a.top); dot(ctx, -3.4, -7.8, 1.4, a.skin); }
    else if (hold === 1) { limb(ctx, -4.7, -15.4, -3, -9, 2.7, a.top); dot(ctx, -2.8, -8.2, 1.4, a.skin); limb(ctx, 4.7, -15.4, 3, -11.6, 2.7, a.top); fillRRs(ctx, '#f4f2ee', 1.6, -14.6, 3, 3.4, 0.8); ctx.fillStyle = '#7a4b2a'; ctx.fillRect(1.8, -14.4, 2.6, 0.8); dot(ctx, 3.2, -11, 1.4, a.skin); }
    else if (hold === 2) { limb(ctx, -4.7, -15.4, -2.6, -10.4, 2.7, a.top); limb(ctx, 4.7, -15.4, 2.6, -10.4, 2.7, a.top); ctx.save(); ctx.translate(0, -11.4); fillRRs(ctx, '#3f6c8a', -4, -2.6, 8, 5.2, 0.6); fillRRs(ctx, '#f6f1e4', -3.6, -2.3, 3.4, 4.6, 0.3); fillRRs(ctx, '#f6f1e4', 0.2, -2.3, 3.4, 4.6, 0.3); ctx.restore(); }
    else { const g = p.talking ? Math.sin(t * 5) * 1.2 : 0; limb(ctx, -4.7, -15.4, -3.6, -8.6, 2.7, a.top); dot(ctx, -3.4, -7.8, 1.4, a.skin); limb(ctx, 4.7, -15.4, 3.6, -8.6 - g, 2.7, a.top); dot(ctx, 3.4, -7.8 - g, 1.4, a.skin); }
  } else {
    limb(ctx, 0, -15.4, side * 4.4, -9.6, 2.7, a.topShade); dot(ctx, side * 4.6, -9, 1.4, a.skin);
    if (hold === 1) fillRRs(ctx, '#f4f2ee', side * 4.6 - 1.5, -12.6, 3, 3.4, 0.8);
    if (hold === 2) fillRRs(ctx, '#3f6c8a', side * 4.4 - 1.4, -13.4, 2.8, 5, 0.5);
  }
  ctx.fillStyle = a.skinShade; ctx.fillRect(-1.3, -18.6, 2.6, 2);
  const talk = p.talking ? 0.5 + 0.5 * Math.sin(t * 14) : 0;
  head(ctx, a, side * 0.4, -22.2, side === 0 ? 0 : p.dir, 0, p.mood ?? 0, talk);
  ctx.restore();
}

/** Buste pour portraits DOM (inspecteur, fiche) : même style que le bureau. */
export function drawBust(ctx: Ctx, a: AvatarStyle, size: number) {
  ctx.save(); ctx.scale(size / 20, size / 20); ctx.translate(10, 21);
  ctx.fillStyle = a.top; rr(ctx, -8, -12.5, 16, 14, 5); ctx.fill();
  if (a.detail === 1) { ctx.fillStyle = a.trim; ctx.beginPath(); ctx.moveTo(-3, -12.4); ctx.lineTo(0, -9); ctx.lineTo(3, -12.4); ctx.closePath(); ctx.fill(); }
  if (a.detail === 2) { ctx.fillStyle = a.trim; ctx.beginPath(); ctx.moveTo(-2, -12.4); ctx.lineTo(0, -6); ctx.lineTo(2, -12.4); ctx.closePath(); ctx.fill(); }
  if (a.detail === 3) { ctx.strokeStyle = a.trim; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(-1.4, -11); ctx.lineTo(-1.5, -7); ctx.moveTo(1.4, -11); ctx.lineTo(1.5, -7); ctx.stroke(); }
  if (a.detail === 4) fillRRs(ctx, a.topShade, -3.4, -13.6, 6.8, 2.8, 1.4);
  ctx.fillStyle = a.skinShade; ctx.fillRect(-2, -14.5, 4, 3);
  ctx.save(); ctx.translate(0, -17); ctx.scale(1.38, 1.38);
  head(ctx, a, 0, 0, 0, 0, 0, 0);
  ctx.restore();
  ctx.restore();
}

// ───────────── Orchestrateur (le noyau) : un peu plus grand, casque-micro, tablette, accents ambre ─────────────

export const ORCH_STYLE: AvatarStyle = { skin: '#e9c09b', skinShade: '#cfa07b', hair: '#262b36', hairShade: '#1b1f27', hairStyle: 0, top: '#4a5a78', topShade: '#394764', pants: '#2c3446', shoes: '#14171e', detail: 2, trim: '#f5a742', accessory: 'none' };
export type OrchArm = 'rest' | 'point' | 'stop' | 'go' | 'clip' | 'pick';
export interface OrchDraw { arm: OrchArm; /** Angle (radians) du bras tendu pour « point ». */ aim: number; headDir: number; t: number; scan: number }

/** Dessin de l'orchestrateur, vu de dos devant sa régie. Pieds en (0,0). */
export function drawOrchestrator(ctx: Ctx, o: OrchDraw) {
  const A = ORCH_STYLE;
  ctx.save();
  ctx.scale(1.18, 1.18);
  drawAvatar(ctx, A, { pose: 'stand', dir: 1, phase: 0, hands: 0, breath: 0, headDir: o.headDir, hideRight: o.arm !== 'rest' });
  ctx.save(); ctx.translate(-7.4, -9.6); ctx.rotate(-0.25);
  fillRRs(ctx, '#171a20', -2.6, -4, 5.2, 8, 1.2); fillRRs(ctx, '#f5a742', -1.8, -3.2, 3.6, 5.2, 0.8);
  ctx.restore();
  fillRRs(ctx, '#f5a742', -5.2, -15.8, 3, 1.1, 0.5); fillRRs(ctx, '#f5a742', 2.2, -15.8, 3, 1.1, 0.5); fillRRs(ctx, '#f5a742', -4.6, -11.2, 9.2, 1, 0.5);
  const sx = 4.8, sy = -14.6;
  const arm = (x: number, y: number) => { ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(x, y); ctx.strokeStyle = A.top; ctx.lineWidth = 2.7; ctx.lineCap = 'round'; ctx.stroke(); dot(ctx, x, y, 1.5, A.skin); };
  switch (o.arm) {
    case 'point': { const x = sx + Math.cos(o.aim) * 9.5, y = sy + Math.sin(o.aim) * 9.5; arm(x, y); dot(ctx, x + Math.cos(o.aim) * 2.8, y + Math.sin(o.aim) * 2.8, 0.9, '#f5a742'); break; }
    case 'stop': arm(8.4, -23.4); dot(ctx, 8.4, -24.6, 2.5, A.skin); break;
    case 'go': { const w = Math.sin(o.t * 9) * 1.2; arm(7.6 + w, -25.2); break; }
    case 'clip': { arm(8.6, -10.4); ctx.save(); ctx.translate(10.2, -12.2); ctx.rotate(0.18); fillRRs(ctx, '#f4f6fa', -3.2, -4.4, 6.4, 8.8, 0.9); fillRRs(ctx, '#f5a742', -1.4, -5.2, 2.8, 1.5, 0.6); ctx.fillStyle = '#9aa3b5'; ctx.fillRect(-2.2, -2, 4.4, 0.6); ctx.fillRect(-2.2, 0, 4.4, 0.6); ctx.fillRect(-2.2, 2, 3, 0.6); ctx.restore(); break; }
    case 'pick': arm(-1.5, -22.2); break;
    default: break;
  }
  const hy = -21.2 + o.scan * 0.2;
  ctx.strokeStyle = '#1a1d24'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(0, hy, 5.2, Math.PI * 1.04, Math.PI * 1.96); ctx.stroke();
  fillRRs(ctx, '#1a1d24', -6.5, hy - 1.8, 2.6, 4.2, 1.2); fillRRs(ctx, '#1a1d24', 3.9, hy - 1.8, 2.6, 4.2, 1.2);
  ctx.fillStyle = '#f5a742'; ctx.fillRect(-5.9, hy - 0.8, 1.2, 1.4); ctx.fillRect(4.7, hy - 0.8, 1.2, 1.4);
  ctx.strokeStyle = '#1a1d24'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-6, hy + 2); ctx.quadraticCurveTo(-6.8, hy + 5.2, -3.8, hy + 5.8); ctx.stroke();
  dot(ctx, -3.7, hy + 5.8, 0.9, '#f5a742');
  ctx.restore();
}
