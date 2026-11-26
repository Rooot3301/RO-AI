// « Photo » d'un poste pour le fil : le vrai poste de l'agent (déco de sa fiche, apparence), dessiné par le moteur du bureau
// dans un petit canvas, cadré comme une photo prise par-dessus l'épaule. Déterministe (graine = publication) ; aucun réseau.
import { useEffect, useRef } from 'react';
import type { Appearance, Decor } from '../../api/types.ts';
import { drawAvatar, styleFor } from '../engine/avatar.ts';
import type { AvatarParams } from '../engine/avatar.ts';
import { fillRR, hash2, rr } from '../engine/draw.ts';
import { DEFAULT_LOOK, deskScreens, drawDesk } from '../engine/props.ts';
import type { DeskLook } from '../engine/props.ts';
import type { Desk } from '../layout/plan.ts';

const DESK: Desk = { agentId: 'photo', room: 0, index: 0, col: 0, row: 0, seat: { col: 1, row: 1 }, seatX: 24, seatY: 25, stand: { col: 4, row: 1 }, standX: 72, standY: 24 };
const VIEW = { x: -14, y: -34, w: 92, h: 70 };
const FLOORS = [['#c9a173', '#b88f62'], ['#cfc7b8', '#bdb4a3'], ['#9fb0a6', '#8c9e94'], ['#b9a4c4', '#a891b4']] as const;
const SCREEN_INK = [['#151a22', '#4ccaa1', '#f5a742', '#c9ced8'], ['#0b1310', '#4ccaa1', '#e6c04c', '#4ccaa1'], ['#eef3f9', '#6fb0f2', '#c5d8ef', '#2f7fd6']] as const;

function seedOf(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

export function DeskPhoto({ seed, sprite, appearance, decor, caption }: { seed: string; sprite: number; appearance: Appearance | null; decor: Decor | null; caption?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const W = c.clientWidth || 300, H = Math.round(W * 0.56), d = Math.min(3, window.devicePixelRatio || 1);
    c.width = W * d; c.height = H * d; c.style.height = `${H}px`;
    const ctx = c.getContext('2d')!; ctx.setTransform(d, 0, 0, d, 0, 0);
    const n = seedOf(seed), look: DeskLook = decor ? { theme: decor.theme, items: decor.items ?? [], color: decor.color ?? 0 } : DEFAULT_LOOK;
    const s = Math.max(W / VIEW.w, H / VIEW.h);
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.scale(s, s); ctx.translate(-(VIEW.x + VIEW.w / 2) + ((n % 7) - 3) * 0.8, -(VIEW.y + VIEW.h / 2));
    // mur du fond (avec un cadre ou une fenêtre selon la graine), plinthe, sol
    ctx.fillStyle = '#e6e1d8'; ctx.fillRect(VIEW.x - 10, VIEW.y - 10, VIEW.w + 20, 24);
    if (n % 2) { fillRR(ctx, '#8ea9c4', 50, VIEW.y + 2, 22, 11, 0.6); ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(51, VIEW.y + 3, 9, 9); ctx.fillStyle = '#d7d2c8'; ctx.fillRect(60.5, VIEW.y + 2, 1, 11); }
    else { fillRR(ctx, '#6b5440', -8, VIEW.y + 3, 13, 9, 0.5); fillRR(ctx, ['#e07a5f', '#3d5a80', '#81b29a', '#f2cc8f'][n % 4], -7, VIEW.y + 4, 11, 7, 0.3); }
    ctx.fillStyle = '#cfc8bb'; ctx.fillRect(VIEW.x - 10, VIEW.y + 13, VIEW.w + 20, 1.6);
    const [f1, f2] = FLOORS[(Math.abs(look.color) + (n >>> 3)) % FLOORS.length];
    ctx.fillStyle = f1; ctx.fillRect(VIEW.x - 10, VIEW.y + 14.6, VIEW.w + 20, VIEW.h);
    ctx.fillStyle = f2; for (let y = VIEW.y + 18; y < VIEW.y + VIEW.h + 4; y += 5) ctx.fillRect(VIEW.x - 10, y, VIEW.w + 20, 0.35);
    // plante au sol et poste
    const px = n % 3 === 0 ? -8 : 70;
    fillRR(ctx, '#c46f4b', px - 3.5, 4, 7, 8, 1.4); ctx.fillStyle = '#4f8a5b';
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.ellipse(px + Math.cos(i) * 3, 1 - i * 1.4, 3.4, 2, i * 0.7, 0, 7); ctx.fill(); }
    drawDesk(ctx, DESK, look);
    // écrans allumés (lignes de code, terminal ou page web, selon la graine)
    deskScreens(DESK, look).forEach((sc, i) => {
      const [bg, a, b, c2] = SCREEN_INK[(n + i) % SCREEN_INK.length];
      ctx.save(); rr(ctx, sc.x, sc.y, sc.w, sc.h, 0.8); ctx.clip(); ctx.fillStyle = bg; ctx.fillRect(sc.x, sc.y, sc.w, sc.h);
      for (let r = 0; r < 6; r++) { ctx.fillStyle = hash2(r, n + i) < 0.25 ? b : hash2(r, n + 3) < 0.5 ? a : c2; ctx.fillRect(sc.x + 1 + (r % 2), sc.y + 1.2 + r * 1.5, 2 + hash2(r, n) * (sc.w - 5), 0.7); }
      ctx.restore();
      ctx.fillStyle = 'rgba(180,220,255,0.10)'; ctx.beginPath(); ctx.ellipse(sc.x + sc.w / 2, sc.y + sc.h + 6, sc.w * 0.8, 5, 0, 0, 7); ctx.fill();
    });
    // chaise, agent assis de dos (frappe), dossier
    const x = DESK.seatX, y = DESK.seatY + 2;
    ctx.fillStyle = 'rgba(20,20,25,0.25)'; ctx.beginPath(); ctx.ellipse(x, y + 6, 7, 2.4, 0, 0, 7); ctx.fill();
    fillRR(ctx, '#3c414b', x - 6, y - 3, 12, 6, 2.6);
    const P: AvatarParams = { pose: 'sit-back', dir: 1, phase: (n % 100) / 10, hands: 1, breath: 0.5 };
    ctx.save(); ctx.translate(x, DESK.seatY + 7 - 6); drawAvatar(ctx, styleFor(appearance, sprite), P); ctx.restore();
    fillRR(ctx, '#3c414b', x - 5.5, y - 8, 11, 7.5, 2.6); fillRR(ctx, '#4e5561', x - 4.6, y - 7.2, 9.2, 1.6, 0.8);
    ctx.restore();
    // rendu « photo » : lumière douce, vignettage
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, 'rgba(255,236,200,0.16)'); g.addColorStop(1, 'rgba(40,30,60,0.12)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.7); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  }, [seed, sprite, appearance?.skin, appearance?.hair, appearance?.hair_style, appearance?.outfit, appearance?.accessory, decor?.theme, decor?.color, decor?.items?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} className="feed-photo" role="img" aria-label={caption ? `Photo du poste : ${caption}` : 'Photo du poste'} />;
}
