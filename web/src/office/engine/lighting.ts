// Éclairage : voile de nuit troué par les lampes (cuit à la résolution courante) et sprites de halo / d'ombre.
import type { Layout } from '../layout/plan.ts';
import { makeCanvas } from './draw.ts';

export const BAKE_PAD = 28; // marge autour du monde (ombres portées)

export function buildVeil(layout: Layout, scale: number): HTMLCanvasElement {
  // nuit : dehors sombre ; dedans, éclairage intérieur homogène et chaud (salles allumées, réunion éteinte), lampes en plus
  const { canvas, ctx } = makeCanvas((layout.width + BAKE_PAD * 2) * scale, (layout.height + BAKE_PAD * 2) * scale);
  ctx.scale(scale, scale); ctx.translate(BAKE_PAD, BAKE_PAD);
  ctx.fillStyle = 'rgb(9,12,26)'; ctx.fillRect(-BAKE_PAD, -BAKE_PAD, layout.width + BAKE_PAD * 2, layout.height + BAKE_PAD * 2);
  ctx.globalCompositeOperation = 'destination-out';
  for (const r of layout.rooms) {
    ctx.fillStyle = `rgba(0,0,0,${r.kind === 'meeting' ? 0.22 : r.kind === 'corridor' ? 0.5 : 0.58})`;
    ctx.fillRect(r.x * 16 - 6, r.y * 16 - 14, r.w * 16 + 12, r.h * 16 + 20);
  }
  for (const l of layout.lamps) {
    if (!l.on) continue;
    const r = l.r * 1.1;
    const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, r);
    g.addColorStop(0, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(l.x - r, l.y - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  for (const l of layout.lamps) {
    if (!l.on) continue;
    const r = l.r;
    const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, r);
    g.addColorStop(0, 'rgba(255,190,110,0.12)'); g.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.fillStyle = g; ctx.fillRect(l.x - r, l.y - r, r * 2, r * 2);
  }
  return canvas;
}

/** Halo radial 128x128 d'une couleur (dessiné en mode 'lighter', mis à l'échelle). */
export function buildGlow(color: string): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, color); g.addColorStop(0.35, color + '66'); g.addColorStop(1, color + '00');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return canvas;
}

/** Ombre portée douce 64x64 (noir central vers transparent). */
export function buildShadow(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(10,12,20,0.55)'); g.addColorStop(0.6, 'rgba(10,12,20,0.22)'); g.addColorStop(1, 'rgba(10,12,20,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return canvas;
}

/** Lumière du jour entrant par les fenêtres (taches douces au sol), dessinée en mode additif selon la luminosité. */
export function buildSun(layout: Layout, scale: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas((layout.width + BAKE_PAD * 2) * scale, (layout.height + BAKE_PAD * 2) * scale);
  ctx.scale(scale, scale); ctx.translate(BAKE_PAD, BAKE_PAD);
  const B = layout.building;
  for (let f = 0; f < layout.floors; f++) for (let c = B.x; c < B.x + B.w; c++) for (const [r0, dir] of [[B.y, 1], [B.y + B.h - 1, -1]] as const) {
    const r = r0 + f * layout.floorRows;
    if (layout.tiles[r * layout.cols + c] !== 5) continue;
    const y0 = dir > 0 ? (r + 1) * 16 - 3 : r * 16 + 3, len = 46;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + dir * len);
    g.addColorStop(0, 'rgba(255,236,200,0.55)'); g.addColorStop(1, 'rgba(255,236,200,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(c * 16, y0); ctx.lineTo(c * 16 + 16, y0); ctx.lineTo(c * 16 + 24, y0 + dir * len); ctx.lineTo(c * 16 + 6, y0 + dir * len); ctx.closePath(); ctx.fill();
  }
  return canvas;
}
