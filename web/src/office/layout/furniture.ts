// Catalogue du mobilier (emprise, hauteur apparente, blocage, déplaçable dans l'éditeur) et emplacements d'usage
// (s'asseoir, se servir un café, consulter une étagère…). Fonctions pures, partagées par le plan, l'éditeur et la simulation.
import { TILE } from './geom.ts';
import type { Tile } from './geom.ts';

export type Dir4 = 0 | 1 | 2 | 3; // 0 bas (face au spectateur), 1 haut, 2 droite, 3 gauche
export const DIR_DX = [0, 0, 1, -1] as const;
export const DIR_DY = [1, -1, 0, 0] as const;
export const opposite = (d: number): Dir4 => (d === 0 ? 1 : d === 1 ? 0 : d === 2 ? 3 : 2);

export type FurnitureKind =
  | 'plant' | 'plant_tall' | 'sofa' | 'armchair' | 'coffee_table' | 'side_table' | 'rug'
  | 'coffee_machine' | 'vending' | 'water_cooler' | 'fridge' | 'counter' | 'high_table'
  | 'bookshelf' | 'reading_table' | 'chair' | 'meeting_table' | 'reception' | 'bench' | 'wait_chair' | 'guichet'
  | 'rack' | 'ac_unit' | 'cabinet' | 'printer' | 'floorlamp' | 'console' | 'kiosk' | 'lockers' | 'status_board' | 'mailbox' | 'streetlamp' | 'stairs'
  | 'tree' | 'bush' | 'bike_rack' | 'planter';

export interface FurnitureDef {
  /** Emprise (cases) orientée « face vers le bas » ; pivotée pour gauche/droite si `rot`. */
  w: number; h: number; rot: boolean;
  blocks: boolean;
  /** Déplaçable / masquable dans l'éditeur (mobilier décoratif uniquement). */
  movable: boolean;
  /** Hauteur apparente (unités monde) au-dessus de l'emprise, pour le tri en profondeur. */
  z: number;
  label: string;
}

export const FURNITURE: Readonly<Record<FurnitureKind, FurnitureDef>> = {
  plant: { w: 1, h: 1, rot: false, blocks: true, movable: true, z: 18, label: 'Plante' },
  plant_tall: { w: 1, h: 1, rot: false, blocks: true, movable: true, z: 28, label: 'Grande plante' },
  sofa: { w: 3, h: 1, rot: true, blocks: true, movable: true, z: 12, label: 'Canapé' },
  armchair: { w: 1, h: 1, rot: false, blocks: true, movable: true, z: 12, label: 'Fauteuil' },
  coffee_table: { w: 2, h: 1, rot: true, blocks: true, movable: true, z: 5, label: 'Table basse' },
  side_table: { w: 1, h: 1, rot: false, blocks: true, movable: true, z: 7, label: 'Guéridon' },
  rug: { w: 4, h: 3, rot: false, blocks: false, movable: true, z: 0, label: 'Tapis' },
  coffee_machine: { w: 1, h: 1, rot: false, blocks: true, movable: true, z: 20, label: 'Machine à café' },
  vending: { w: 2, h: 1, rot: false, blocks: true, movable: true, z: 30, label: 'Distributeur' },
  water_cooler: { w: 1, h: 1, rot: false, blocks: true, movable: true, z: 20, label: 'Fontaine à eau' },
  fridge: { w: 1, h: 1, rot: false, blocks: true, movable: true, z: 28, label: 'Réfrigérateur' },
  counter: { w: 1, h: 1, rot: false, blocks: true, movable: true, z: 12, label: 'Plan de travail' },
  high_table: { w: 1, h: 1, rot: false, blocks: true, movable: true, z: 14, label: 'Mange-debout' },
  bookshelf: { w: 2, h: 1, rot: true, blocks: true, movable: true, z: 28, label: 'Bibliothèque' },
  reading_table: { w: 2, h: 1, rot: true, blocks: true, movable: true, z: 8, label: 'Table de lecture' },
  chair: { w: 1, h: 1, rot: false, blocks: true, movable: true, z: 10, label: 'Chaise' },
  meeting_table: { w: 6, h: 2, rot: false, blocks: true, movable: false, z: 8, label: 'Table de réunion' },
  reception: { w: 4, h: 1, rot: false, blocks: true, movable: false, z: 13, label: 'Banque d’accueil' },
  bench: { w: 3, h: 1, rot: true, blocks: true, movable: true, z: 8, label: 'Banc' },
  wait_chair: { w: 1, h: 1, rot: false, blocks: true, movable: false, z: 10, label: 'Siège d’attente' },
  guichet: { w: 4, h: 1, rot: false, blocks: true, movable: false, z: 14, label: 'Guichet d’approbation' },
  rack: { w: 1, h: 1, rot: false, blocks: true, movable: false, z: 22, label: 'Baie serveur' },
  ac_unit: { w: 2, h: 1, rot: false, blocks: true, movable: false, z: 24, label: 'Climatisation' },
  cabinet: { w: 2, h: 1, rot: false, blocks: true, movable: true, z: 14, label: 'Caisson de rangement' },
  printer: { w: 1, h: 1, rot: false, blocks: true, movable: true, z: 12, label: 'Imprimante' },
  floorlamp: { w: 1, h: 1, rot: false, blocks: true, movable: true, z: 30, label: 'Lampadaire' },
  console: { w: 10, h: 2, rot: false, blocks: true, movable: false, z: 10, label: 'Console de la régie' },
  kiosk: { w: 1, h: 1, rot: false, blocks: true, movable: true, z: 22, label: 'Borne' },
  lockers: { w: 2, h: 1, rot: false, blocks: true, movable: true, z: 28, label: 'Casiers' },
  status_board: { w: 2, h: 1, rot: false, blocks: true, movable: false, z: 30, label: 'Écran des limites d’usage' },
  mailbox: { w: 1, h: 1, rot: false, blocks: true, movable: false, z: 16, label: 'Boîte aux lettres des rapports' },
  streetlamp: { w: 1, h: 1, rot: false, blocks: false, movable: false, z: 40, label: 'Lampadaire' },
  stairs: { w: 2, h: 4, rot: false, blocks: true, movable: false, z: 0, label: 'Escalier' },
  tree: { w: 2, h: 2, rot: false, blocks: true, movable: false, z: 40, label: 'Arbre' },
  bush: { w: 1, h: 1, rot: false, blocks: true, movable: false, z: 10, label: 'Massif' },
  bike_rack: { w: 2, h: 1, rot: false, blocks: true, movable: false, z: 8, label: 'Range-vélos' },
  planter: { w: 2, h: 1, rot: false, blocks: true, movable: false, z: 14, label: 'Jardinière' },
};

export interface Furniture {
  /** Clé stable (salle + type + rang) : sert de référence pour l'agencement personnalisé. */
  key: string;
  kind: FurnitureKind;
  room: number;
  col: number; row: number; w: number; h: number;
  dir: Dir4;
  variant: number;
  blocks: boolean;
  movable: boolean;
}

export function dims(kind: FurnitureKind, dir: Dir4): { w: number; h: number } {
  const d = FURNITURE[kind];
  return d.rot && (dir === 2 || dir === 3) ? { w: d.h, h: d.w } : { w: d.w, h: d.h };
}

export type SpotKind = 'sofa' | 'armchair' | 'bench' | 'wait' | 'coffee' | 'vending' | 'water' | 'shelf' | 'drink' | 'window' | 'reading' | 'meet';
export interface SpotDef {
  kind: SpotKind;
  /** Case marchable depuis laquelle on rejoint l'emplacement. */
  approach: Tile;
  /** Position finale (pixels monde) et orientation du personnage. */
  x: number; y: number; dir: Dir4;
  sit: boolean;
}
export interface Spot extends SpotDef { id: number; room: number; furn: string | null }

const cx = (c: number) => c * TILE + TILE / 2;
const cy = (r: number) => r * TILE + TILE / 2;

/** Emplacements d'usage d'un meuble (calcul pur à partir de sa position et de son orientation). */
export function spotsOf(f: Pick<Furniture, 'kind' | 'col' | 'row' | 'w' | 'h' | 'dir'>): SpotDef[] {
  const out: SpotDef[] = [];
  const fx = DIR_DX[f.dir], fy = DIR_DY[f.dir];
  const tiles: Tile[] = [];
  for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) tiles.push({ col: f.col + i, row: f.row + j });
  // cases de façade (rangée/colonne avant dans le sens de l'orientation)
  const front = tiles.filter((t) => !tiles.some((u) => u.col === t.col + fx && u.row === t.row + fy));
  const seat = (t: Tile, kind: SpotKind, back = 2.5) => out.push({
    kind, approach: { col: t.col + fx, row: t.row + fy }, x: cx(t.col) - fx * back, y: cy(t.row) - fy * back + (f.dir === 0 ? 1 : 0), dir: f.dir, sit: true,
  });
  const use = (t: Tile, kind: SpotKind) => { const a = { col: t.col + fx, row: t.row + fy }; out.push({ kind, approach: a, x: cx(a.col), y: cy(a.row), dir: opposite(f.dir), sit: false }); };
  switch (f.kind) {
    case 'sofa': if (front.length >= 3) { seat(front[0], 'sofa'); seat(front[front.length - 1], 'sofa'); } else front.forEach((t) => seat(t, 'sofa')); break;
    case 'armchair': seat(front[0], 'armchair'); break;
    case 'bench': front.forEach((t) => seat(t, 'bench', 1.5)); break;
    case 'wait_chair': seat(front[0], 'wait', 1.5); break;
    case 'chair': { // chaise de réunion : on s'y assoit depuis l'arrière (la table est devant) — conversations réelles seulement
      const t = front[0], a = { col: t.col - fx, row: t.row - fy };
      out.push({ kind: 'meet', approach: a, x: cx(t.col), y: cy(t.row) - fy * 2.5 + (f.dir === 0 ? 1 : 0), dir: f.dir, sit: true });
      break;
    }
    case 'coffee_machine': use(front[0], 'coffee'); break;
    case 'vending': use(front[0], 'vending'); break;
    case 'water_cooler': use(front[0], 'water'); break;
    case 'bookshelf': front.forEach((t) => use(t, 'shelf')); break;
    case 'high_table': {
      for (const s of [-1, 1]) {
        const a = { col: f.col + s, row: f.row };
        out.push({ kind: 'drink', approach: a, x: cx(a.col) - s * 2, y: cy(a.row), dir: s < 0 ? 2 : 3, sit: false });
      }
      break;
    }
    default: break;
  }
  return out;
}
