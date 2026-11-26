// Primitives de dessin vectoriel : rectangles arrondis, pictogrammes, hachage déterministe.
export type Ctx = CanvasRenderingContext2D;

export const FONT_FAMILY = "'Inter Variable', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";

/** Chemin de rectangle arrondi (sans dépendre de ctx.roundRect, absent des navigateurs anciens). */
export function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

export function fillRR(ctx: Ctx, color: string | CanvasGradient, x: number, y: number, w: number, h: number, r: number) {
  rr(ctx, x, y, w, h, r); ctx.fillStyle = color; ctx.fill();
}

export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w)); canvas.height = Math.max(1, Math.round(h));
  return { canvas, ctx: canvas.getContext('2d')! };
}

/** Hachage déterministe 2D -> [0,1) (jamais Math.random : rendu reproductible). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 144665) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) % 10000) / 10000;
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
export const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

export type IconName =
  | 'failed' | 'timeout' | 'rate_limited' | 'denied' | 'transient' | 'auth_expired'
  | 'success' | 'hand' | 'dots' | 'plug' | 'retry' | 'read' | 'code' | 'web';

export const ICON_LABEL_FR: Record<IconName, string> = {
  failed: 'Échec', timeout: 'Délai dépassé', rate_limited: 'Quota atteint / limite de débit', denied: 'Action refusée', transient: 'Erreur transitoire',
  auth_expired: 'Authentification expirée', success: 'Réussite', hand: 'Demande d’approbation', dots: 'En file',
  plug: 'Connecteur MCP', retry: 'Nouvelle tentative', read: 'Lecture', code: 'Écriture / exécution', web: 'Web',
};

/** Pictogramme vectoriel centré en (cx, cy), tenant dans un carré de `s` unités, trait `color`. */
export function drawIcon(ctx: Ctx, name: IconName, cx: number, cy: number, s: number, color: string) {
  const u = s / 10;
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(u, u);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (name) {
    case 'failed': ctx.moveTo(-3.2, -3.2); ctx.lineTo(3.2, 3.2); ctx.moveTo(3.2, -3.2); ctx.lineTo(-3.2, 3.2); ctx.stroke(); break;
    case 'timeout':
      ctx.arc(0, 0, 4.4, 0, Math.PI * 2); ctx.moveTo(0, -2.4); ctx.lineTo(0, 0); ctx.lineTo(2, 1.2); ctx.stroke(); break;
    case 'rate_limited':
      ctx.moveTo(-3.4, -4.4); ctx.lineTo(3.4, -4.4); ctx.moveTo(-3.4, 4.4); ctx.lineTo(3.4, 4.4);
      ctx.moveTo(-2.8, -4.4); ctx.lineTo(0, 0); ctx.lineTo(-2.8, 4.4); ctx.moveTo(2.8, -4.4); ctx.lineTo(0, 0); ctx.lineTo(2.8, 4.4); ctx.stroke(); break;
    case 'denied':
      ctx.moveTo(0, -4.8); ctx.lineTo(4, -3.2); ctx.lineTo(4, 0.6); ctx.quadraticCurveTo(3.6, 3.6, 0, 5); ctx.quadraticCurveTo(-3.6, 3.6, -4, 0.6); ctx.lineTo(-4, -3.2); ctx.closePath();
      ctx.moveTo(-1.6, -1); ctx.lineTo(1.6, 2); ctx.moveTo(1.6, -1); ctx.lineTo(-1.6, 2); ctx.stroke(); break;
    case 'transient':
      ctx.moveTo(1.6, -5); ctx.lineTo(-3, 0.8); ctx.lineTo(0, 0.8); ctx.lineTo(-1.6, 5); ctx.lineTo(3.2, -1); ctx.lineTo(0.2, -1); ctx.closePath(); ctx.fill(); break;
    case 'auth_expired':
      ctx.arc(-2.6, -1.6, 2.2, 0, Math.PI * 2); ctx.moveTo(-1, -0.2); ctx.lineTo(1, 1.6); ctx.moveTo(2.4, 3); ctx.lineTo(4, 4.6); ctx.moveTo(2.6, 0.6); ctx.lineTo(3.8, 1.8); ctx.stroke(); break;
    case 'success': ctx.moveTo(-4, 0.4); ctx.lineTo(-1.4, 3); ctx.lineTo(4, -3); ctx.stroke(); break;
    case 'hand':
      ctx.moveTo(-3, 4); ctx.lineTo(-3.4, -0.6); ctx.moveTo(-1.2, 4.4); ctx.lineTo(-1.2, -3.6); ctx.moveTo(1, 4.4); ctx.lineTo(1, -4.2); ctx.moveTo(3, 4); ctx.lineTo(3.2, -2.6); ctx.stroke(); break;
    case 'dots': ctx.arc(-3.4, 0, 1.2, 0, 6.3); ctx.moveTo(1.2, 0); ctx.arc(0, 0, 1.2, 0, 6.3); ctx.moveTo(4.6, 0); ctx.arc(3.4, 0, 1.2, 0, 6.3); ctx.fill(); break;
    case 'plug':
      ctx.moveTo(-1.8, -5); ctx.lineTo(-1.8, -1.6); ctx.moveTo(1.8, -5); ctx.lineTo(1.8, -1.6); ctx.moveTo(-3.4, -1.6); ctx.lineTo(3.4, -1.6); ctx.lineTo(3.4, 0.4);
      ctx.quadraticCurveTo(3.4, 3.2, 0, 3.2); ctx.quadraticCurveTo(-3.4, 3.2, -3.4, 0.4); ctx.closePath(); ctx.moveTo(0, 3.2); ctx.lineTo(0, 5.2); ctx.stroke(); break;
    case 'retry':
      ctx.arc(0, 0, 4, -2.4, 3.2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(1.6, -5.4); ctx.lineTo(-1.2, -3.2); ctx.lineTo(1.8, -1.8); ctx.stroke(); break;
    case 'read':
      ctx.moveTo(0, -3.6); ctx.quadraticCurveTo(-2.6, -4.8, -5, -3.6); ctx.lineTo(-5, 3.6); ctx.quadraticCurveTo(-2.6, 2.4, 0, 3.6);
      ctx.quadraticCurveTo(2.6, 2.4, 5, 3.6); ctx.lineTo(5, -3.6); ctx.quadraticCurveTo(2.6, -4.8, 0, -3.6); ctx.moveTo(0, -3.6); ctx.lineTo(0, 3.6); ctx.stroke(); break;
    case 'code':
      ctx.moveTo(-1.8, -3.4); ctx.lineTo(-5, 0); ctx.lineTo(-1.8, 3.4); ctx.moveTo(1.8, -3.4); ctx.lineTo(5, 0); ctx.lineTo(1.8, 3.4); ctx.stroke(); break;
    case 'web':
      ctx.arc(0, 0, 4.6, 0, Math.PI * 2); ctx.moveTo(-4.6, 0); ctx.lineTo(4.6, 0); ctx.moveTo(0, -4.6); ctx.ellipse(0, 0, 2, 4.6, 0, -Math.PI / 2, Math.PI * 1.5); ctx.stroke(); break;
  }
  ctx.restore();
}
