// Géométrie de la régie de l'orchestrateur (partagée entre pré-rendu statique et dessin dynamique).
import type { Control } from '../layout/plan.ts';
import { TILE } from '../layout/plan.ts';

export interface Box { x: number; y: number; w: number; h: number }
export interface ConsoleGeom {
  x: number; y: number; w: number; h: number;
  left: Box; center: Box; right: Box; pile: Box; tray: Box; bin: Box;
  clock: { x: number; y: number }; hourglass: { x: number; y: number };
  postX: number; postY: number;
}

export function consoleGeom(c: Control): ConsoleGeom {
  const x = c.col * TILE, y = c.row * TILE, w = c.w * TILE, h = c.h * TILE;
  return {
    x, y, w, h,
    left: { x: x + 14, y: y - 2, w: 32, h: 20 }, center: { x: x + 54, y: y - 6, w: 52, h: 24 }, right: { x: x + 114, y: y - 2, w: 32, h: 20 },
    pile: { x: x + 5, y: y + 19, w: 11, h: 8 }, tray: { x: x + 142, y: y + 19, w: 13, h: 8 }, bin: { x: x + w + 5, y: y + 17, w: 8, h: 11 },
    clock: { x: x + 50, y: y + 21 }, hourglass: { x: x + 110, y: y + 21 },
    postX: c.postX, postY: c.postY,
  };
}
