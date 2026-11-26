// Petits canvas utilitaires du DOM : portrait vectoriel d'un agent et pictogramme (mêmes dessins que le bureau).
import { useEffect, useRef } from 'react';
import { drawBust, styleFor } from '../engine/avatar.ts';
import { drawIcon } from '../engine/draw.ts';
import type { IconName } from '../engine/draw.ts';
import type { Appearance } from '../../api/types.ts';

const DPR = () => Math.min(3, window.devicePixelRatio || 1);

/** `appearance` (fiche d'identité) : apparence personnalisée ; à défaut, la variante `sprite`. */
export function Portrait({ sprite, size = 56, appearance }: { sprite: number; size?: number; appearance?: Appearance | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const d = DPR(); c.width = size * d; c.height = size * d;
    const ctx = c.getContext('2d')!; ctx.scale(d, d);
    ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, 7); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, 7); ctx.clip();
    ctx.translate(size * 0.1, size * 0.14); drawBust(ctx, styleFor(appearance ?? null, sprite), size * 0.8);
    ctx.restore();
  }, [sprite, size, appearance?.skin, appearance?.hair, appearance?.hair_style, appearance?.outfit, appearance?.accessory]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} className="office-portrait" style={{ width: size, height: size }} aria-hidden="true" />;
}

const COLORS: Partial<Record<IconName, string>> = {
  success: '#4ccaa1', hand: '#6fb0f2', dots: '#6fb0f2', plug: '#a58be0', retry: '#e6c04c', rate_limited: '#e6c04c', denied: '#f5a742',
  read: '#f5a742', code: '#4ccaa1', web: '#6fb0f2',
};
export function IconGlyph({ name, size = 18 }: { name: IconName; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const d = DPR(); c.width = size * d; c.height = size * d;
    const ctx = c.getContext('2d')!; ctx.scale(d, d);
    drawIcon(ctx, name, size / 2, size / 2, size * 0.9, COLORS[name] ?? '#f26d5d');
  }, [name, size]);
  return <canvas ref={ref} className="office-icon" style={{ width: size, height: size }} aria-hidden="true" />;
}
