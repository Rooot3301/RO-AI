// Caméra à échelle fractionnaire : (zoom relatif à l'ajustement, centre en unités monde). Fonctions pures.
export interface Camera { zoom: number; cx: number; cy: number }
export interface View { scale: number; ox: number; oy: number; dpr: number }

export const MIN_ZOOM_DELTA = -3;
export const MAX_ZOOM_DELTA = 6;
export const ZOOM_STEP = 1.25;
export const MIN_ZOOM = Math.pow(ZOOM_STEP, MIN_ZOOM_DELTA);
export const MAX_ZOOM = Math.pow(ZOOM_STEP, MAX_ZOOM_DELTA);

export const zoomFromDelta = (d: number): number => Math.pow(ZOOM_STEP, Math.max(MIN_ZOOM_DELTA, Math.min(MAX_ZOOM_DELTA, d)));
export const deltaFromZoom = (z: number): number => Math.round(Math.log(z) / Math.log(ZOOM_STEP));
export const clampZoom = (z: number): number => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

/** Échelle (pixels d'appareil par unité monde) qui fait tenir le monde dans la zone, marge incluse : la carte REMPLIT la zone. */
export function fitScale(worldW: number, worldH: number, areaW: number, areaH: number, pad = 0.025): number {
  return Math.max(0.05, Math.min((areaW * (1 - 2 * pad)) / worldW, (areaH * (1 - 2 * pad)) / worldH));
}

/** Borne le centre : monde entier centré s'il est plus petit que la zone, sinon on peut sortir légèrement des bords. */
export function clampCenter(c: number, worldLen: number, areaLen: number, scale: number): number {
  const half = areaLen / 2 / scale;
  if (worldLen <= half * 2) return worldLen / 2;
  const margin = Math.min(48, half / 2);
  return Math.min(worldLen - half + margin, Math.max(half - margin, c));
}

export function viewFor(cam: Camera, worldW: number, worldH: number, areaW: number, areaH: number, dpr: number): View {
  const scale = fitScale(worldW, worldH, areaW, areaH) * cam.zoom;
  const cx = clampCenter(cam.cx, worldW, areaW, scale), cy = clampCenter(cam.cy, worldH, areaH, scale);
  return { scale, ox: areaW / 2 - cx * scale, oy: areaH / 2 - cy * scale, dpr };
}

/** Vue d'un rectangle du monde (un étage) : même cadrage que `viewFor`, origine décalée. */
export function viewForRect(cam: Camera, r: { x: number; y: number; w: number; h: number }, areaW: number, areaH: number, dpr: number): View {
  const v = viewFor({ zoom: cam.zoom, cx: cam.cx - r.x, cy: cam.cy - r.y }, r.w, r.h, areaW, areaH, dpr);
  return { ...v, ox: v.ox - r.x * v.scale, oy: v.oy - r.y * v.scale };
}

/** Lissage exponentiel de la caméra courante vers la cible. Retourne vrai tant qu'elle bouge. */
export function stepCamera(cur: Camera, tgt: Camera, dt: number): boolean {
  const a = 1 - Math.exp(-11 * dt);
  const dz = Math.log(tgt.zoom) - Math.log(cur.zoom);
  const dx = tgt.cx - cur.cx, dy = tgt.cy - cur.cy;
  if (Math.abs(dz) < 0.0008 && Math.abs(dx) < 0.03 && Math.abs(dy) < 0.03) {
    const moved = cur.zoom !== tgt.zoom || cur.cx !== tgt.cx || cur.cy !== tgt.cy;
    cur.zoom = tgt.zoom; cur.cx = tgt.cx; cur.cy = tgt.cy;
    return moved;
  }
  cur.zoom = Math.exp(Math.log(cur.zoom) + dz * a);
  cur.cx += dx * a; cur.cy += dy * a;
  return true;
}

export const toWorldX = (v: View, devX: number) => (devX - v.ox) / v.scale;
export const toWorldY = (v: View, devY: number) => (devY - v.oy) / v.scale;
