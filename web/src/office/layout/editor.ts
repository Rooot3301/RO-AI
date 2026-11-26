// Mode édition du bureau : déplacer / pivoter / masquer le mobilier décoratif sur la grille. Le document persistant est
// versionné et référence les meubles par clé stable (« salle/type-rang ») avec une position relative à la pièce.
// Toute modification est validée en recalculant le plan : pas de chevauchement, portes dégagées, toutes les pièces,
// tous les postes et tous les emplacements restent accessibles depuis l'entrée. Un meuble refusé garde sa place d'origine.
import type { OfficeLayoutDoc } from '../../api/types.ts';
import { planLayout } from './plan.ts';
import type { Dir4, FurnitureOverride, Layout, LayoutOverrides, PlanInput } from './plan.ts';

export const LAYOUT_VERSION = 1;
/** Taille maximale acceptée par le serveur (64 Kio). */
export const MAX_DOC_BYTES = 64 * 1024;
export const EMPTY_OVERRIDES: LayoutOverrides = { version: 1, furniture: {} };

const KEY_RE = /^[^\s/]{1,80}\/[a-z_]{2,20}-\d{1,3}$/;

/** Lit un document d'agencement (serveur) : toute entrée invalide est ignorée ; version inconnue => aucun agencement. */
export function parseLayoutDoc(doc: unknown): LayoutOverrides {
  if (!doc || typeof doc !== 'object') return { version: 1, furniture: {} };
  const o = doc as Record<string, unknown>;
  if (o.version !== LAYOUT_VERSION || !o.furniture || typeof o.furniture !== 'object') return { version: 1, furniture: {} };
  const out: Record<string, FurnitureOverride> = {};
  for (const [k, v] of Object.entries(o.furniture as Record<string, unknown>)) {
    if (!KEY_RE.test(k) || !v || typeof v !== 'object') continue;
    const e = v as Record<string, unknown>;
    const f: FurnitureOverride = {};
    if (e.hidden === true) f.hidden = true;
    if (typeof e.x === 'number' && Number.isInteger(e.x) && e.x >= 0 && e.x < 200) f.x = e.x;
    if (typeof e.y === 'number' && Number.isInteger(e.y) && e.y >= 0 && e.y < 200) f.y = e.y;
    if (typeof e.dir === 'number' && [0, 1, 2, 3].includes(e.dir)) f.dir = e.dir as Dir4;
    if (f.hidden || f.x !== undefined || f.y !== undefined || f.dir !== undefined) out[k] = f;
  }
  return { version: 1, furniture: out };
}

export function toLayoutDoc(o: LayoutOverrides): OfficeLayoutDoc {
  return { version: LAYOUT_VERSION, furniture: o.furniture };
}

export function docSize(o: LayoutOverrides): number { return new TextEncoder().encode(JSON.stringify(toLayoutDoc(o))).length; }

export type EditResult = { ok: true; overrides: LayoutOverrides; layout: Layout } | { ok: false; reason: string };

function attempt(input: PlanInput, next: LayoutOverrides, key: string): EditResult {
  if (docSize(next) > MAX_DOC_BYTES) return { ok: false, reason: 'agencement trop volumineux' };
  const layout = planLayout({ ...input, overrides: next });
  const rej = layout.rejected.find((r) => r.key === key);
  if (rej) return { ok: false, reason: rej.reason };
  return { ok: true, overrides: next, layout };
}

/** Déplace un meuble à la case (col,row) du plan, éventuellement pivoté. */
export function moveFurniture(input: PlanInput, layout: Layout, key: string, col: number, row: number, dir?: Dir4): EditResult {
  const f = layout.furniture.find((x) => x.key === key);
  if (!f) return { ok: false, reason: 'meuble introuvable' };
  if (!f.movable) return { ok: false, reason: 'ce meuble ne peut pas être déplacé' };
  const room = layout.rooms[f.room];
  const cur = input.overrides ?? EMPTY_OVERRIDES;
  const entry: FurnitureOverride = { x: col - room.x, y: row - room.y };
  if (dir !== undefined) entry.dir = dir; else if (cur.furniture[key]?.dir !== undefined) entry.dir = cur.furniture[key].dir;
  if (entry.x! < 0 || entry.y! < 0) return { ok: false, reason: 'hors de la pièce' };
  return attempt(input, { version: 1, furniture: { ...cur.furniture, [key]: entry } }, key);
}

export function rotateFurniture(input: PlanInput, layout: Layout, key: string): EditResult {
  const f = layout.furniture.find((x) => x.key === key);
  if (!f) return { ok: false, reason: 'meuble introuvable' };
  const order: Dir4[] = [0, 3, 1, 2];
  return moveFurniture(input, layout, key, f.col, f.row, order[(order.indexOf(f.dir) + 1) % 4]);
}

export function hideFurniture(input: PlanInput, layout: Layout, key: string): EditResult {
  const f = layout.furniture.find((x) => x.key === key);
  if (!f) return { ok: false, reason: 'meuble introuvable' };
  if (!f.movable) return { ok: false, reason: 'ce meuble ne peut pas être masqué' };
  const cur = input.overrides ?? EMPTY_OVERRIDES;
  return attempt(input, { version: 1, furniture: { ...cur.furniture, [key]: { hidden: true } } }, key);
}

/** Meubles masqués (pour pouvoir les réafficher). */
export function hiddenKeys(o: LayoutOverrides): string[] { return Object.keys(o.furniture).filter((k) => o.furniture[k].hidden); }

export function showFurniture(o: LayoutOverrides, key: string): LayoutOverrides {
  const f = { ...o.furniture }; delete f[key];
  return { version: 1, furniture: f };
}
