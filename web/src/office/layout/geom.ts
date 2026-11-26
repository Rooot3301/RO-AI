// Unités de base du plan : une case = 16 unités monde (≈ 0,8 m). Partagé par le plan, le mobilier et le moteur.
export const TILE = 16;
export interface Tile { col: number; row: number }
export interface Rect { x: number; y: number; w: number; h: number }
export const idx = (l: { cols: number }, c: number, r: number) => r * l.cols + c;
