// Plan du siège : génération pure et déterministe (mêmes entrées ⇒ même bâtiment).
// Architecture : un bâtiment à ailes. Chaque aile = une rangée de pièces au nord, un couloir, une rangée au sud.
// Colonne ouest : hall d'accueil (entrée principale au sud) et régie de l'orchestrateur, puis services ; à l'est, les
// open spaces des départements et les salles communes, réparties pour équilibrer la largeur des rangées. Plusieurs ailes
// sont reliées par un couloir vertical (secondaire). Tout est relié par des portes ; la connexité est vérifiée.
import { TILE, idx } from './geom.ts';
import type { Rect, Tile } from './geom.ts';
import { DIR_DX, DIR_DY, FURNITURE, dims, spotsOf } from './furniture.ts';
import type { Dir4, Furniture, FurnitureKind, Spot } from './furniture.ts';
import { reachable } from './pathfinding.ts';

export { TILE, idx };
export type { Rect, Tile, Furniture, FurnitureKind, Spot, Dir4 };

export const T = { VOID: 0, WALL: 1, FLOOR: 2, DOOR: 3, GLASS: 4, WINDOW: 5, OUT: 6 } as const;
export type TileType = (typeof T)[keyof typeof T];

export type RoomKind = 'lobby' | 'control' | 'corridor' | 'department' | 'approval' | 'meeting' | 'break' | 'coffee' | 'server' | 'library' | 'nook' | 'landing' | 'quiet';
export type FloorKind = 'stone' | 'carpet' | 'wood' | 'vinyl' | 'tiles' | 'raised' | 'terrazzo' | 'dark';

export interface Room {
  id: number; key: string; kind: RoomKind; label: string;
  /** Intérieur (cases). */
  x: number; y: number; w: number; h: number;
  wing: number; band: 'N' | 'S' | 'C' | 'V';
  /** Côté du couloir (porte) : 'bottom' pour les pièces au nord du couloir, 'top' au sud. */
  corridorSide: 'top' | 'bottom' | null;
  tint: number; floor: FloorKind; dept: string | null;
  /** Étage (0 = rez-de-chaussée, 1 = 1er étage). */
  level: number;
}
export interface Door { id: number; col: number; row: number; w: number; h: number; orient: 'h' | 'v'; kind: 'glass' | 'wood' | 'entrance' | 'open'; room: number }
export interface Desk {
  agentId: string; room: number; index: number;
  /** Coin haut-gauche du plan de travail (3 cases) ; le caisson occupe la 4e case. */
  col: number; row: number;
  seat: Tile; seatX: number; seatY: number;
  /** Case debout à côté du poste (file d'attente, réussite). */
  stand: Tile; standX: number; standY: number;
}
export type WallDecorKind = 'painting' | 'clock' | 'whiteboard' | 'tv' | 'sign' | 'logo' | 'board' | 'screen' | 'menu' | 'map' | 'planning' | 'elevator' | 'stairs';
export interface WallDecor { kind: WallDecorKind; col: number; row: number; w: number; variant: number; room: number; text: string }
export interface Lamp { x: number; y: number; r: number; room: number; on: boolean }
/** Régie : console de l'orchestrateur ; `post` = pixel où il se tient. */
export interface Control { col: number; row: number; w: number; h: number; postX: number; postY: number }
export interface Board extends Rect { room: number; dept: string }

export interface Layout {
  cols: number; rows: number; width: number; height: number;
  tiles: Uint8Array; blocked: Uint8Array; walkable: Uint8Array; cost: Uint8Array;
  /** Indice de pièce par case (-1 hors pièce). */
  roomAt: Int16Array;
  rooms: Room[]; doors: Door[]; desks: Desk[]; deskByAgent: Map<string, Desk>;
  furniture: Furniture[]; wallDecor: WallDecor[]; spots: Spot[]; lamps: Lamp[]; boards: Board[];
  control: Control; entrance: Door; spawn: Tile;
  /** Emplacements de la salle d'attente des approbations (sièges d'abord), puis file dans le couloir. */
  waitSpots: number[]; queueTiles: Tile[];
  /** Chaises de la salle de réunion (conversations réelles avec l'utilisateur) et étagères de la bibliothèque (rapports). */
  meetSpots: number[]; shelfSpots: number[];
  /** Points de promenade (couloirs et espaces communs) pour la simulation sociale. */
  strollTiles: Tile[];
  building: Rect; wings: number; deskRows: number; bandH: number;
  /** Nombre d'étages et hauteur d'un étage (rangées) : l'étage n occupe les rangées [n·floorRows, (n+1)·floorRows). */
  floors: number; floorRows: number;
  /** Cage d'escalier et d'ascenseur (murs compris), en saillie au bout est du couloir principal ; coordonnées du RDC. */
  annex: Rect;
  /** Accès à l'ascenseur et à l'escalier, par étage (on y disparaît pour réapparaître à l'autre étage). */
  portals: Portal[];
  /** Rue devant l'entrée (ambiance : passants, voitures, lampadaires). */
  street: Street;
  /** Personnalisations refusées à la validation (clé du meuble, raison). */
  rejected: { key: string; reason: string }[];
  /** Postes du personnel figurant (accueil, technicien) et façades des baies de la salle serveur. */
  staff: StaffPosts;
}

/** Rangées de la rue (sous le parvis) ; `spots` = colonnes de début des places (2 cases + marge), `cross` = passage piéton. */
export interface Street { sidewalk: number; parking: number; road: number; far: number; cross: { a: number; b: number }; spots: number[]; lamps: Tile[] }
export interface StaffPost { tile: Tile; dir: Dir4 }
/** Accès à l'autre étage : case d'attente devant l'ascenseur ou au pied de l'escalier, point d'entrée (pixels monde). */
export interface Portal { level: number; kind: 'lift' | 'stairs'; tile: Tile; x: number; y: number }
export interface StaffPosts {
  reception: StaffPost | null; tech: StaffPost | null;
  /** Case devant chaque baie (furn = indice dans `furniture`). */
  rackFronts: { furn: number; tile: Tile; dir: Dir4 }[];
  /** Baie portant les jauges mémoire / disque, baie « réseau » (fournisseurs). -1 si absente. */
  gaugeRack: number; netRack: number;
  /** Case d'où le technicien lit l'écran des limites d'usage (null si la salle n'en a pas). */
  limitsSpot: StaffPost | null;
  /** Baie réseau d'étage (palier du 1er) : le technicien y passe parfois. */
  floorRack: StaffPost | null;
}
export interface PlanAgent { id: string; department: string; /** Rang de création (ordre du snapshot) : les nouveaux postes s'ajoutent à la fin. */ rank?: number }
export interface FurnitureOverride { x?: number; y?: number; dir?: Dir4; hidden?: boolean }
export interface LayoutOverrides { version: 1; furniture: Record<string, FurnitureOverride> }
export interface PlanInput {
  departments: readonly string[];
  agents: readonly PlanAgent[];
  /** Nombre d'ailes (1 à 3) ; défaut 1. */
  wings?: number;
  overrides?: LayoutOverrides | null;
}

export const LABELS: Record<RoomKind, string> = {
  lobby: 'Hall d’accueil', control: 'Régie · orchestrateur', corridor: '', department: '', approval: 'Attente · approbations',
  meeting: 'Salle de réunion', break: 'Salle de repos', coffee: 'Espace café', server: 'Serveur ro-ai', library: 'Bibliothèque', nook: 'Coin fenêtre',
  landing: 'Escalier · ascenseur', quiet: 'Salle calme',
};
const FLOOR_OF: Record<RoomKind, FloorKind> = {
  lobby: 'stone', control: 'dark', corridor: 'vinyl', department: 'carpet', approval: 'wood', meeting: 'carpet',
  break: 'wood', coffee: 'terrazzo', server: 'raised', library: 'wood', nook: 'wood', landing: 'stone', quiet: 'carpet',
};
const SERVICE_W: Partial<Record<RoomKind, number>> = { approval: 12, meeting: 11, coffee: 9, break: 11, server: 8, library: 9 };
const CANON: Partial<Record<RoomKind, number>> = { approval: 0, coffee: 1, break: 2, library: 50, meeting: 51, server: 52 };
const GLASS_KINDS: ReadonlySet<RoomKind> = new Set(['department', 'meeting', 'library', 'server', 'control', 'quiet']);
const MARGIN = 3;
/** Rue devant le bâtiment : trottoir, stationnement, chaussée (2 voies), trottoir d'en face. */
export const STREET_ROWS = 5;
export const COL_A = 14;
/** Étages : rez-de-chaussée (accueil, services) et 1er étage (open spaces des départements). */
export const FLOORS = 2;
/** Largeur intérieure du palier (cage d'escalier et d'ascenseur). */
export const LANDING_W = 6;
const MAX_PATH_TILES = 4096;

/** Départements dans l'ordre du snapshot, puis ceux que seuls les agents mentionnent (ordre alphabétique). */
export function orderedDepartments(input: Pick<PlanInput, 'departments' | 'agents'>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of input.departments) if (!seen.has(d)) { seen.add(d); out.push(d); }
  const extra = new Set<string>();
  for (const a of input.agents) if (!seen.has(a.department)) extra.add(a.department);
  out.push(...[...extra].sort((a, b) => a.localeCompare(b, 'fr')));
  return out;
}

const byRank = (a: PlanAgent, b: PlanAgent) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
function groups(input: Pick<PlanInput, 'departments' | 'agents'>): { depts: string[]; ids: Map<string, string[]> } {
  const depts = orderedDepartments(input);
  const ids = new Map<string, string[]>();
  for (const d of depts) ids.set(d, []);
  for (const a of input.agents.slice().sort(byRank)) ids.get(a.department)!.push(a.id);
  return { depts, ids };
}

/** Clé stable décrivant la structure du plan (pour savoir s'il faut le recalculer). */
export function planKey(input: Pick<PlanInput, 'departments' | 'agents'>): string {
  const { depts, ids } = groups(input);
  return depts.map((d) => `${d}:${ids.get(d)!.join(',')}`).join('|');
}

interface Slot { kind: RoomKind; key: string; label: string; w: number; dept: string | null; ids: string[]; tint: number; order: number }

export function deskRowsFor(maxPerDept: number): number { return maxPerDept > 8 ? 3 : 2; }

/** Nombre d'ailes possible : les départements (1er étage) justifient plusieurs ailes. */
export function maxWings(nDepts: number): number { return nDepts >= 6 ? 3 : nDepts >= 3 ? 2 : 1; }

// ───────────── étages ─────────────

/** Étage d'une rangée de la grille. */
export function levelOfRow(L: Pick<Layout, 'floors' | 'floorRows'>, row: number): number { return Math.max(0, Math.min(L.floors - 1, Math.floor(row / L.floorRows))); }
/** Étage d'une position (pixels monde). */
export function levelOfY(L: Pick<Layout, 'floors' | 'floorRows'>, y: number): number { return levelOfRow(L, Math.floor(y / TILE)); }
/** Départs de la vérification de connexité : l'entrée (RDC) puis l'accès à l'ascenseur de chaque étage supérieur. */
export function levelSeeds(L: Pick<Layout, 'spawn' | 'portals'>): Tile[] { return [L.spawn, ...L.portals.filter((q) => q.level > 0 && q.kind === 'lift').map((q) => q.tile)]; }
/** Rectangle (pixels monde) d'un étage. */
export function levelRect(L: Pick<Layout, 'width' | 'floorRows'>, level: number): Rect { return { x: 0, y: level * L.floorRows * TILE, w: L.width, h: L.floorRows * TILE }; }
const inRows = (R: Rect, r: number) => r >= R.y && r < R.y + R.h;
const inCols = (R: Rect, c: number) => c >= R.x && c < R.x + R.w;
/** Mur extérieur horizontal (façades nord et sud du bâtiment et de la cage d'escalier), quel que soit l'étage. */
export function isExtRow(L: Pick<Layout, 'building' | 'annex' | 'floorRows'>, c: number, r: number): boolean {
  const rr = r % L.floorRows, B = L.building, A = L.annex;
  return ((rr === B.y || rr === B.y + B.h - 1) && inCols(B, c)) || ((rr === A.y || rr === A.y + A.h - 1) && inCols(A, c));
}
/** Mur extérieur (façades et pignons), quel que soit l'étage. */
export function isExtWall(L: Pick<Layout, 'building' | 'annex' | 'floorRows'>, c: number, r: number): boolean {
  if (isExtRow(L, c, r)) return true;
  const rr = r % L.floorRows, B = L.building, A = L.annex;
  if (c === B.x && inRows(B, rr)) return true;
  if (c === B.x + B.w - 1 && inRows(B, rr)) return !(rr > A.y && rr < A.y + A.h - 1); // pignon est, sauf contre la cage
  return c === A.x + A.w - 1 && inRows(A, rr);
}

/** Pièces d'un étage : colonne ouest (une par rangée) et pièces de la partie est. */
function floorSlots(level: number, B: number, depts: string[], ids: Map<string, string[]>, R: number): { colA: Slot[]; east: Slot[] } {
  const slot = (kind: RoomKind, key: string, label = LABELS[kind], w = SERVICE_W[kind] ?? 10, order = CANON[kind] ?? 60): Slot => ({ kind, key, label, w, dept: null, ids: [], tint: 0, order });
  const colA: Slot[] = [], east: Slot[] = [];
  if (level === 0) {
    // rez-de-chaussée : accueil, régie de l'orchestrateur et services (approbations, café, réunion, bibliothèque, serveur)
    const order: RoomKind[] = ['meeting', 'library', 'coffee', 'server', 'approval'];
    colA.push(slot('lobby', 'lobby'), slot('control', 'control'));
    for (let b = 2; b < B; b++) colA.push(slot(order[b - 2], order[b - 2]));
    for (const k of ['approval', 'coffee', 'meeting', 'library', 'server'] as RoomKind[]) if (!colA.some((s) => s.kind === k)) east.push(slot(k, k));
  } else {
    // 1er étage : salle de repos, kitchenette, puis open spaces des départements
    colA.push(slot('break', 'f1:break'), slot('coffee', 'f1:coffee', 'Kitchenette'));
    for (let b = 2; b < B; b++) colA.push(b % 2 ? slot('break', `f1:lounge:${b}`, 'Espace détente') : slot('quiet', `f1:quiet:${b}`));
    depts.forEach((d, i) => {
      const list = ids.get(d)!;
      const cols = Math.max(1, Math.ceil(list.length / R));
      east.push({ kind: 'department', key: `dept:${d}`, label: d, w: Math.max(10, 4 * cols + 2), dept: d, ids: list, tint: i, order: 10 + i });
    });
  }
  return { colA, east };
}

export function planLayout(input: PlanInput): Layout {
  const { depts, ids } = groups(input);
  const W = Math.max(1, Math.min(maxWings(depts.length), Math.floor(input.wings ?? 1)));
  const maxN = Math.max(0, ...depts.map((d) => ids.get(d)!.length));
  const R = deskRowsFor(maxN);
  const H = 1 + 3 * R;
  const B = 2 * W; // rangées : 0 = sud de l'aile 0, 1 = nord de l'aile 0, 2 = sud de l'aile 1…

  // 1. Pièces de chaque étage, réparties de façon équilibrée (plus grandes d'abord, vers la rangée la plus courte ;
  //    l'attente des approbations près du hall). Les deux étages ont la même emprise.
  const plans = Array.from({ length: FLOORS }, (_, f) => {
    const { colA, east } = floorSlots(f, B, depts, ids, R);
    const bands: Slot[][] = Array.from({ length: B }, () => []);
    const widthOf = (b: number) => bands[b].reduce((s, x) => s + x.w + 1, 0);
    for (const it of east.slice().sort((a, b) => b.w - a.w || a.order - b.order)) {
      let best = 0;
      if (it.kind !== 'approval') for (let b = 1; b < B; b++) if (widthOf(b) < widthOf(best)) best = b;
      bands[best].push(it);
    }
    for (const b of bands) b.sort((x, y) => x.order - y.order);
    return { colA, bands, widthOf };
  });
  const BW = Math.max(12, ...plans.flatMap((p) => p.bands.map((_, b) => p.widthOf(b))));
  // 2. Égalisation : pièces d'appoint dans les rangées très courtes, puis élargissement des pièces (tour à tour).
  plans.forEach((p, f) => {
    let n = 0;
    for (let b = 0; b < B; b++) {
      const list = p.bands[b];
      while (BW - p.widthOf(b) >= 12) {
        const quiet = (n + f) % 2 === 1;
        list.push({ kind: quiet ? 'quiet' : 'break', key: `fill:${f}:${b}:${n}`, label: quiet ? LABELS.quiet : 'Espace détente', w: Math.min(12, BW - p.widthOf(b) - 1), dept: null, ids: [], tint: 0, order: 90 + n });
        n++;
      }
      if (!list.length) list.push({ kind: 'break', key: `lounge:${f}:${b}`, label: 'Espace détente', w: 4, dept: null, ids: [], tint: 0, order: 99 });
      let extra = BW - p.widthOf(b), k = 0;
      const pref = list.filter((s) => s.kind === 'department' || s.kind === 'break' || s.kind === 'library' || s.kind === 'coffee' || s.kind === 'quiet');
      const pool = pref.length ? pref : list;
      while (extra > 0) { pool[k % pool.length].w++; extra--; k++; }
    }
  });

  // 3. Dimensions : un étage = marge, bâtiment, parvis et rue ; l'étage n est décalé de n·F rangées.
  const x0 = MARGIN + 1;
  const spineX = x0 + COL_A + 1;
  const eastX = W > 1 ? spineX + 4 : spineX;
  const rightWall = eastX + BW - 1;
  const cols = rightWall + LANDING_W + 2 + MARGIN;
  const C = 3; // couloirs de 3 cases : deux personnes se croisent sans se gêner
  const bandY: number[] = new Array(B).fill(0), corrY: number[] = new Array(W).fill(0);
  let y = MARGIN;
  const topWall = y; y++;
  for (let k = W - 1; k >= 0; k--) {
    bandY[2 * k + 1] = y; y += H + 1;
    corrY[k] = y; y += C + 1;
    bandY[2 * k] = y; y += H + 1;
  }
  const bottomWall = y - 1;
  const F = bottomWall + 1 + MARGIN + STREET_ROWS;
  const rows = F * FLOORS;
  const building: Rect = { x: MARGIN, y: topWall, w: rightWall - MARGIN + 1, h: bottomWall - topWall + 1 };
  const annex: Rect = { x: rightWall, y: corrY[0] - 3, w: LANDING_W + 2, h: C + 6 };

  const tiles = new Uint8Array(cols * rows);
  const roomAt = new Int16Array(cols * rows).fill(-1);
  const L = { cols };
  const rooms: Room[] = [];
  const doors: Door[] = [];
  const carve = (room: Room) => {
    for (let r = room.y; r < room.y + room.h; r++) for (let c = room.x; c < room.x + room.w; c++) { tiles[idx(L, c, r)] = T.FLOOR; roomAt[idx(L, c, r)] = room.id; }
  };
  const addRoom = (r: Omit<Room, 'id'>): Room => { const room = { ...r, id: rooms.length }; rooms.push(room); carve(room); return room; };
  const addDoor = (d: Omit<Door, 'id'>) => {
    const door = { ...d, id: doors.length }; doors.push(door);
    for (let j = 0; j < d.h; j++) for (let i = 0; i < d.w; i++) { tiles[idx(L, d.col + i, d.row + j)] = d.kind === 'open' ? T.FLOOR : T.DOOR; roomAt[idx(L, d.col + i, d.row + j)] = d.room; }
    return door;
  };

  const deskRooms: { room: Room; slot: Slot }[] = [];
  const landings: Room[] = [];
  let lobby: Room | null = null, control: Room | null = null;
  for (let f = 0; f < FLOORS; f++) {
    const yo = f * F;
    for (let r = topWall; r <= bottomWall; r++) for (let c = MARGIN; c <= rightWall; c++) tiles[idx(L, c, r + yo)] = T.WALL;
    for (let r = annex.y; r < annex.y + annex.h; r++) for (let c = annex.x; c < annex.x + annex.w; c++) tiles[idx(L, c, r + yo)] = T.WALL;
    // Couloirs.
    for (let k = 0; k < W; k++) addRoom({ key: f ? `f${f}:corr:${k}` : `corr:${k}`, kind: 'corridor', label: k === 0 ? 'Couloir principal' : 'Couloir', x: x0, y: corrY[k] + yo, w: rightWall - x0, h: C, wing: k, band: 'C', corridorSide: null, tint: 0, floor: 'vinyl', dept: null, level: f });
    // Couloir vertical (ailes multiples) : traverse la rangée nord de l'aile k et la rangée sud de l'aile k+1.
    for (let k = 0; k + 1 < W; k++) {
      const yTop = bandY[2 * (k + 1)] + yo, yBot = bandY[2 * k + 1] + H - 1 + yo;
      const sp = addRoom({ key: f ? `f${f}:spine:${k}` : `spine:${k}`, kind: 'corridor', label: 'Couloir', x: spineX, y: yTop, w: 3, h: yBot - yTop + 1, wing: k, band: 'V', corridorSide: null, tint: 0, floor: 'vinyl', dept: null, level: f });
      for (let i = 0; i < 3; i++) { // jonctions avec les deux couloirs
        for (const r of [yTop - 1, yBot + 1]) { tiles[idx(L, spineX + i, r)] = T.FLOOR; roomAt[idx(L, spineX + i, r)] = sp.id; }
        tiles[idx(L, spineX + i, bandY[2 * k + 1] - 1 + yo)] = T.FLOOR; roomAt[idx(L, spineX + i, bandY[2 * k + 1] - 1 + yo)] = sp.id; // mur entre les deux ailes
      }
    }
    // Palier : cage d'escalier et d'ascenseur au bout est du couloir principal, ouverte sur lui.
    const landing = addRoom({ key: f ? `f${f}:landing` : 'landing', kind: 'landing', label: LABELS.landing, x: rightWall + 1, y: corrY[0] - 2 + yo, w: LANDING_W, h: C + 4, wing: 0, band: 'C', corridorSide: null, tint: 0, floor: FLOOR_OF.landing, dept: null, level: f });
    landings.push(landing);
    addDoor({ col: rightWall, row: corrY[0] + yo, w: 1, h: C, orient: 'v', kind: 'open', room: landing.id });

    // Pièces des rangées.
    const P0 = plans[f];
    for (let b = 0; b < B; b++) {
      const k = b >> 1, north = (b & 1) === 1, by = bandY[b] + yo;
      const side: 'top' | 'bottom' = north ? 'bottom' : 'top';
      const doorRow = north ? by + H : by - 1;
      const sA = P0.colA[b];
      const keyA = f ? `f${f}:${sA.key.replace(/^f1:/, '')}` : sA.key;
      const roomA = addRoom({ key: keyA, kind: sA.kind, label: sA.label, x: x0, y: by, w: COL_A, h: H, wing: k, band: north ? 'N' : 'S', corridorSide: side, tint: 0, floor: FLOOR_OF[sA.kind], dept: null, level: f });
      if (sA.kind === 'lobby') lobby = roomA; else if (sA.kind === 'control') control = roomA;
      const list: { room: Room; slot: Slot | null }[] = [{ room: roomA, slot: null }];
      if (W > 1) {
        const isPassage = (north && k < W - 1) || (!north && k > 0);
        if (!isPassage) list.push({ room: addRoom({ key: f ? `f${f}:nook:${b}` : `nook:${b}`, kind: 'nook', label: LABELS.nook, x: spineX, y: by, w: 3, h: H, wing: k, band: north ? 'N' : 'S', corridorSide: side, tint: 0, floor: 'wood', dept: null, level: f }), slot: null });
      }
      let cx = eastX;
      for (const s of P0.bands[b]) {
        const room = addRoom({ key: s.key, kind: s.kind, label: s.label, x: cx, y: by, w: s.w, h: H, wing: k, band: north ? 'N' : 'S', corridorSide: side, tint: s.tint, floor: FLOOR_OF[s.kind], dept: s.dept, level: f });
        list.push({ room, slot: s });
        if (s.kind === 'department') deskRooms.push({ room, slot: s });
        cx += s.w + 1;
      }
      // portes et cloisons vitrées côté couloir
      for (const { room } of list) {
        if (room.kind === 'nook') { for (let i = 0; i < room.w; i++) { tiles[idx(L, room.x + i, doorRow)] = T.FLOOR; roomAt[idx(L, room.x + i, doorRow)] = room.id; } continue; }
        if (GLASS_KINDS.has(room.kind)) for (let i = 0; i < room.w; i++) tiles[idx(L, room.x + i, doorRow)] = T.GLASS;
        if (room.kind === 'lobby') {
          const c0 = room.x + Math.floor(room.w / 2) - 2;
          addDoor({ col: c0, row: doorRow, w: 4, h: 1, orient: 'h', kind: 'open', room: room.id });
        } else {
          const c0 = room.x + Math.floor((room.w - 2) / 2);
          addDoor({ col: c0, row: doorRow, w: 2, h: 1, orient: 'h', kind: GLASS_KINDS.has(room.kind) ? 'glass' : 'wood', room: room.id });
        }
      }
    }
  }
  if (!lobby || !control) throw new Error('plan incomplet');

  // Entrée principale (mur sud du hall) et parvis extérieur.
  const ecx = lobby.x + Math.floor(lobby.w / 2);
  const entrance = addDoor({ col: ecx - 1, row: bottomWall, w: 2, h: 1, orient: 'h', kind: 'entrance', room: lobby.id });
  for (let r = bottomWall + 1; r < bottomWall + 1 + MARGIN; r++) for (let c = ecx - 3; c <= ecx + 2; c++) tiles[idx(L, c, r)] = T.OUT;
  const spawn: Tile = { col: ecx - 1, row: bottomWall + MARGIN - 1 };

  // Fenêtres sur les murs extérieurs (piliers aux angles, jamais à côté de l'entrée).
  const winH = (row: number, a: number, b: number) => {
    if (b - a < 3) return;
    for (let p = a + 1; p + 2 <= b - 1; p += 3) for (let i = 0; i < 2; i++) {
      const c = p + i;
      if (row === bottomWall && Math.abs(c - (ecx - 0.5)) < 3) continue;
      if (tiles[idx(L, c, row)] === T.WALL) tiles[idx(L, c, row)] = T.WINDOW;
    }
  };
  const winV = (col: number, a: number, b: number) => {
    if (b - a < 2) { if (b - a >= 1) for (let r = a; r < b; r++) if (tiles[idx(L, col, r)] === T.WALL) tiles[idx(L, col, r)] = T.WINDOW; return; }
    for (let p = a + (b - a > 3 ? 1 : 0); p + 1 <= b - (b - a > 3 ? 1 : 0); p += 3) for (let i = 0; i < 2 && p + i < b; i++) if (tiles[idx(L, col, p + i)] === T.WALL) tiles[idx(L, col, p + i)] = T.WINDOW;
  };
  for (const room of rooms) {
    if (room.kind === 'corridor') continue;
    const yo = room.level * F;
    if (room.kind === 'landing') { // cage : vitrage sur le pignon est et la façade sud ; mur nord plein (ascenseur)
      winV(room.x + room.w, room.y, room.y + room.h);
      winH(room.y + room.h, room.x, room.x + room.w);
      continue;
    }
    if (room.y === topWall + 1 + yo) winH(topWall + yo, room.x, room.x + room.w);
    if (room.y + room.h === bottomWall + yo) winH(bottomWall + yo, room.x, room.x + room.w);
    if (room.x === x0) winV(MARGIN, room.y, room.y + room.h);
    if (room.x + room.w === rightWall && !(room.y < annex.y + annex.h - 1 + yo && room.y + room.h > annex.y + 1 + yo)) winV(rightWall, room.y, room.y + room.h);
    else if (room.x + room.w === rightWall) { // contre la cage : fenêtres seulement hors de son emprise
      winV(rightWall, room.y, Math.min(room.y + room.h, annex.y + yo));
      winV(rightWall, Math.max(room.y, annex.y + annex.h + yo), room.y + room.h);
    }
  }
  for (let f = 0; f < FLOORS; f++) for (let k = 0; k < W; k++) {
    winV(MARGIN, corrY[k] + f * F, corrY[k] + C + f * F);
    if (k > 0) winV(rightWall, corrY[k] + f * F, corrY[k] + C + f * F);
  }

  // 5. Postes de travail des départements.
  const blocked = new Uint8Array(cols * rows);
  const desks: Desk[] = [];
  const deskTiles: number[] = [];
  for (const { room, slot } of deskRooms) {
    const n = slot.ids.length, gcols = Math.max(1, Math.ceil(n / R));
    const ox = room.x + Math.floor((room.w - 4 * gcols) / 2);
    slot.ids.forEach((agentId, k) => {
      const c = k % gcols, r = Math.floor(k / gcols);
      const dc = ox + 4 * c, dr = room.y + 1 + 3 * r;
      for (let i = 0; i < 4; i++) { blocked[idx(L, dc + i, dr)] = 1; deskTiles.push(idx(L, dc + i, dr)); }
      desks.push({
        agentId, room: room.id, index: k, col: dc, row: dr,
        seat: { col: dc + 1, row: dr + 1 }, seatX: (dc + 1) * TILE + TILE / 2, seatY: (dr + 1) * TILE + TILE / 2 + 1,
        stand: { col: dc + 3, row: dr + 1 }, standX: (dc + 3) * TILE + TILE / 2, standY: (dr + 1) * TILE + TILE / 2,
      });
    });
  }
  const deskByAgent = new Map(desks.map((d) => [d.agentId, d]));

  // 6. Régie de l'orchestrateur.
  const cc = control.x + Math.floor((control.w - 10) / 2);
  const ctl: Control = { col: cc, row: control.y + 1, w: 10, h: 2, postX: (cc + 5) * TILE, postY: (control.y + 3) * TILE + TILE / 2 };
  blocked[idx(L, cc + 4, control.y + 3)] = 1; blocked[idx(L, cc + 5, control.y + 3)] = 1; // l'orchestrateur se tient là

  // 7. Accès aux étages : devant l'ascenseur (mur nord du palier) et au pied de l'escalier (côté est).
  const portals: Portal[] = [];
  for (const g of landings) {
    portals.push({ level: g.level, kind: 'lift', tile: { col: g.x + 1, row: g.y }, x: (g.x + 2) * TILE, y: g.y * TILE + 3 });
    portals.push({ level: g.level, kind: 'stairs', tile: { col: g.x + 4, row: g.y + 4 }, x: (g.x + 5) * TILE, y: (g.y + 1) * TILE });
  }

  // 8. Mobilier (placement validé : jamais de passage bloqué ; chaque étage est relié par son palier).
  const P = new Placer(cols, rows, tiles, roomAt, blocked, rooms, spawn, portals.filter((q) => q.level > 0 && q.kind === 'lift').map((q) => q.tile));
  for (const q of portals) { P.require(q.tile); P.require({ col: q.tile.col + (q.kind === 'lift' ? 1 : 0), row: q.tile.row }); }
  for (const d of doors) P.requireDoor(d);
  for (const d of desks) { P.require(d.seat); P.require(d.stand); }
  P.require({ col: cc + 4, row: control.y + 4 });
  // personnel : réceptionniste derrière la banque d'accueil, technicien au poste de supervision de la salle serveur
  const recPost: StaffPost = { tile: { col: lobby.x + lobby.w - 3, row: lobby.y + 1 }, dir: 0 };
  P.require(recPost.tile);
  const serverRoom = rooms.find((r) => r.kind === 'server') ?? null;
  let techPost: StaffPost | null = null;
  if (serverRoom) {
    techPost = { tile: { col: serverRoom.x + serverRoom.w - 2, row: serverRoom.y + serverRoom.h - 2 }, dir: 2 };
    P.require(techPost.tile);
  }
  P.place(control, 'console', ctl.col, ctl.row, 0, 0, true);
  for (const room of rooms) furnish(P, room, desks.filter((d) => d.room === room.id), R);
  outdoor(P, building, ecx, F);
  // rue : places de stationnement (hors passage piéton devant le parvis) et lampadaires sur le trottoir
  const s0 = bottomWall + 1 + MARGIN;
  const street: Street = { sidewalk: s0, parking: s0 + 1, road: s0 + 2, far: s0 + 4, cross: { a: ecx - 3, b: ecx + 3 }, spots: [], lamps: [] };
  for (let c = building.x + 1; c + 3 <= building.x + building.w; c += 3) if (c + 3 <= ecx - 4 || c >= ecx + 4) street.spots.push(c);
  for (let c = building.x + 2; c < building.x + building.w - 1; c += 8) {
    if (Math.abs(c - ecx) < 5) continue;
    if (P.place(null, 'streetlamp', c, s0, 0)) street.lamps.push({ col: c, row: s0 });
  }

  // 9. Personnalisation de l'éditeur (ordre stable), validée comme un placement manuel.
  const rejected: { key: string; reason: string }[] = [];
  const ov = input.overrides?.furniture;
  if (ov) for (const key of Object.keys(ov).sort()) { const r = P.applyOverride(key, ov[key]); if (r) rejected.push({ key, reason: r }); }

  // 10. Décor mural, éclairage, emplacements.
  const wallDecor = wallDecorFor(rooms, tiles, cols, desks);
  const boards: Board[] = [];
  for (const w of wallDecor) if (w.kind === 'whiteboard' && rooms[w.room].kind === 'department') boards.push({ x: w.col * TILE + 2, y: w.row * TILE + 2, w: w.w * TILE - 4, h: 9, room: w.room, dept: rooms[w.room].dept ?? '' });
  const lamps: Lamp[] = [];
  for (const room of rooms) {
    if (room.kind === 'corridor') {
      const horiz = room.w >= room.h;
      const len = horiz ? room.w : room.h;
      for (let p = 3; p < len - 1; p += 7) lamps.push({ x: (horiz ? room.x + p : room.x + room.w / 2) * TILE, y: (horiz ? room.y + room.h / 2 : room.y + p) * TILE, r: 50, room: room.id, on: true });
      continue;
    }
    const nx = Math.max(1, Math.round(room.w / 5)), ny = Math.max(1, Math.round(room.h / 4));
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      lamps.push({ x: (room.x + (room.w * (i + 0.5)) / nx) * TILE, y: (room.y + (room.h * (j + 0.5)) / ny) * TILE, r: room.kind === 'nook' ? 40 : 58, room: room.id, on: room.kind !== 'meeting' });
    }
  }

  const walkable = new Uint8Array(cols * rows);
  const cost = new Uint8Array(cols * rows);
  for (let i = 0; i < walkable.length; i++) {
    const t = tiles[i];
    walkable[i] = (t === T.FLOOR || t === T.DOOR || t === T.OUT) && !P.blocked[i] ? 1 : 0;
    cost[i] = 1;
  }
  for (const d of desks) cost[idx(L, d.seat.col, d.seat.row)] = 8;
  const spots = P.spots(rooms);
  for (const s of spots) if (!s.sit) cost[idx(L, s.approach.col, s.approach.row)] = Math.max(cost[idx(L, s.approach.col, s.approach.row)], 3);
  for (const d of desks) cost[idx(L, d.stand.col, d.stand.row)] = 3;

  // Salle d'attente : sièges puis cases libres ; débordement dans le couloir le long du mur.
  const approval = rooms.find((r) => r.kind === 'approval')!;
  const waitSpots = spots.filter((s) => s.room === approval.id && (s.kind === 'wait' || s.kind === 'bench')).map((s) => s.id);
  const meetSpots = spots.filter((s) => s.kind === 'meet' && rooms[s.room].kind === 'meeting').map((s) => s.id);
  const shelfSpots = spots.filter((s) => s.kind === 'shelf' && rooms[s.room].kind === 'library').map((s) => s.id);
  const queueTiles: Tile[] = [];
  {
    const door = doors.find((d) => d.room === approval.id)!;
    const corr = rooms.find((r) => r.kind === 'corridor' && r.wing === approval.wing && r.band === 'C' && r.level === approval.level)!;
    const qr = approval.corridorSide === 'top' ? corr.y + corr.h - 1 : corr.y;
    for (let k = 1; k < approval.w; k++) for (const c of [door.col - 1 - k, door.col + door.w + k]) {
      if (c > approval.x && c < approval.x + approval.w && walkable[idx(L, c, qr)] && (k % 2 === 1)) queueTiles.push({ col: c, row: qr });
    }
  }
  const strollTiles: Tile[] = [];
  for (const room of rooms) {
    if (room.kind !== 'corridor' && room.kind !== 'lobby' && room.kind !== 'nook' && room.kind !== 'break' && room.kind !== 'coffee' && room.kind !== 'library') continue;
    for (let r = room.y; r < room.y + room.h; r++) for (let c = room.x; c < room.x + room.w; c++) {
      const i = idx(L, c, r);
      if (walkable[i] && cost[i] === 1 && (c + 2 * r) % 5 === 0) strollTiles.push({ col: c, row: r });
    }
  }

  // façades des baies (rondes et interventions du technicien)
  const rackFronts: StaffPosts['rackFronts'] = [];
  if (serverRoom) {
    // les baies sont dessinées façade vers le spectateur : on intervient depuis la case au sud (visible), face à la baie
    P.furniture.forEach((f, i) => {
      if (f.kind !== 'rack' || f.room !== serverRoom.id) return;
      const t = { col: f.col, row: f.row + 1 }, k = t.row * cols + t.col;
      if (walkable[k] && roomAt[k] === serverRoom.id) rackFronts.push({ furn: i, tile: t, dir: 1 });
    });
  }
  const staff: StaffPosts = {
    reception: walkable[recPost.tile.row * cols + recPost.tile.col] ? recPost : null,
    tech: techPost && walkable[techPost.tile.row * cols + techPost.tile.col] ? techPost : null,
    rackFronts, gaugeRack: rackFronts.length ? rackFronts[0].furn : -1,
    netRack: rackFronts.length > 1 ? rackFronts[Math.floor(rackFronts.length / 2)].furn : rackFronts.length ? rackFronts[0].furn : -1,
    limitsSpot: null, floorRack: null,
  };
  const fr = P.furniture.find((f) => f.kind === 'rack' && rooms[f.room]?.kind === 'landing');
  if (fr && walkable[(fr.row + 1) * cols + fr.col]) staff.floorRack = { tile: { col: fr.col, row: fr.row + 1 }, dir: 1 };
  const board = serverRoom ? P.furniture.find((f) => f.kind === 'status_board' && f.room === serverRoom.id) : undefined;
  if (board) { // case libre juste devant l'écran (le technicien le lit, de dos)
    for (const cx of [board.col + 1, board.col]) {
      const k = (board.row + 1) * cols + cx;
      if (walkable[k] && roomAt[k] === board.room) { staff.limitsSpot = { tile: { col: cx, row: board.row + 1 }, dir: 1 }; break; }
    }
  }
  if (staff.reception) cost[recPost.tile.row * cols + recPost.tile.col] = 9;
  if (staff.tech) cost[staff.tech.tile.row * cols + staff.tech.tile.col] = 9;

  return {
    cols, rows, width: cols * TILE, height: rows * TILE, tiles, blocked: P.blocked, walkable, cost, roomAt, staff, street,
    rooms, doors, desks, deskByAgent, furniture: P.furniture, wallDecor, spots, lamps, boards,
    control: ctl, entrance, spawn, waitSpots, meetSpots, shelfSpots, queueTiles, strollTiles, building, wings: W, deskRows: R, bandH: H, rejected,
    floors: FLOORS, floorRows: F, annex, portals,
  };
}

// ───────────────────────── placement validé ─────────────────────────

export class Placer {
  cols: number; rows: number; tiles: Uint8Array; roomAt: Int16Array; blocked: Uint8Array; rooms: Room[]; spawn: Tile;
  /** Points de départ de la vérification de connexité : l'entrée, puis l'accès de chaque étage supérieur. */
  seeds: Tile[];
  furniture: Furniture[] = [];
  private required = new Set<number>();
  private reservedT = new Set<number>();
  private counters = new Map<string, number>();

  constructor(cols: number, rows: number, tiles: Uint8Array, roomAt: Int16Array, blocked: Uint8Array, rooms: Room[], spawn: Tile, upper: Tile[] = []) {
    this.cols = cols; this.rows = rows; this.tiles = tiles; this.roomAt = roomAt; this.blocked = blocked; this.rooms = rooms; this.spawn = spawn;
    this.seeds = [spawn, ...upper];
  }

  require(t: Tile) { this.required.add(t.row * this.cols + t.col); }
  reserve(c: number, r: number) { this.reservedT.add(r * this.cols + c); }
  /** Une porte : ses cases et la case de chaque côté doivent rester libres et reliées. */
  requireDoor(d: Door) {
    for (let j = 0; j < d.h; j++) for (let i = 0; i < d.w; i++) {
      const c = d.col + i, r = d.row + j;
      this.require({ col: c, row: r });
      for (const k of [-2, -1, 1, 2]) {
        const rr = d.orient === 'h' ? r + k : r, cc = d.orient === 'h' ? c : c + k;
        if (rr >= 0 && rr < this.rows && cc >= 0 && cc < this.cols && (this.tiles[rr * this.cols + cc] === T.FLOOR || this.tiles[rr * this.cols + cc] === T.OUT)) {
          this.reserve(cc, rr);
          if (Math.abs(k) === 1) this.require({ col: cc, row: rr });
        }
      }
    }
  }

  private walk(i: number, extra: ReadonlySet<number>): boolean {
    const t = this.tiles[i];
    return (t === T.FLOOR || t === T.DOOR || t === T.OUT) && !this.blocked[i] && !extra.has(i);
  }

  /** Vérifie un placement (sans l'appliquer). `ignore` : meuble déplacé (ses cases actuelles sont libérées). Retourne null si valide, sinon la raison. */
  check(kind: FurnitureKind, room: number, col: number, row: number, dir: Dir4, ignore: Furniture | null, outside = false): string | null {
    const def = FURNITURE[kind], { w, h } = dims(kind, dir);
    const own = new Set<number>();
    if (ignore && ignore.blocks) for (let j = 0; j < ignore.h; j++) for (let i = 0; i < ignore.w; i++) own.add((ignore.row + j) * this.cols + ignore.col + i);
    const cells: number[] = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const c = col + i, r = row + j;
      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return 'hors du plan';
      const k = r * this.cols + c;
      if (outside) { if (this.tiles[k] !== T.VOID) return 'emplacement occupé'; }
      else if (this.tiles[k] !== T.FLOOR || this.roomAt[k] !== room) return 'hors de la pièce';
      if (def.blocks && this.blocked[k] && !own.has(k)) return 'chevauche un autre meuble';
      if (def.blocks && this.reservedT.has(k)) return 'devant une porte';
      if (def.blocks && this.required.has(k)) return 'bloquerait un passage';
      cells.push(k);
    }
    if (!def.blocks) {
      if (kind === 'rug') for (const f of this.furniture) if (f.kind === 'rug' && f !== ignore && f.col < col + w && col < f.col + f.w && f.row < row + h && row < f.row + f.h) return 'chevauche un autre tapis';
      return null;
    }
    if (outside) return null;
    // emplacements d'usage : leur case d'accès doit être un sol libre de la pièce
    const newReq: number[] = [];
    const cellSet = new Set(cells);
    for (const s of spotsOf({ kind, col, row, w, h, dir })) {
      const k = s.approach.row * this.cols + s.approach.col;
      if (s.approach.col < 0 || s.approach.row < 0 || s.approach.col >= this.cols || s.approach.row >= this.rows) return 'accès impossible';
      if (cellSet.has(k) || (!this.walk(k, new Set()) && !own.has(k)) || this.roomAt[k] !== room) return 'accès impossible';
      newReq.push(k);
    }
    // connexité : tout ce qui doit rester accessible l'est encore depuis l'entrée
    const tmp = this.blocked.slice();
    for (const k of own) tmp[k] = 0;
    for (const k of cells) tmp[k] = 1;
    const walkable = new Uint8Array(this.cols * this.rows);
    for (let i = 0; i < walkable.length; i++) { const t = this.tiles[i]; walkable[i] = (t === T.FLOOR || t === T.DOOR || t === T.OUT) && !tmp[i] ? 1 : 0; }
    const reach = reachable({ cols: this.cols, rows: this.rows, walkable }, this.seeds);
    for (const k of this.required) if (!own.has(k) && !reach[k] && !cellSet.has(k)) return 'bloquerait un passage';
    for (const k of newReq) if (!reach[k]) return 'accès impossible';
    // les accès des meubles existants restent atteignables
    for (const f of this.furniture) {
      if (f === ignore || !FURNITURE[f.kind].blocks) continue;
      for (const s of spotsOf(f)) { const k = s.approach.row * this.cols + s.approach.col; if (cellSet.has(k) || !reach[k]) return 'bloquerait l’accès à un meuble'; }
    }
    return null;
  }

  private nextKey(room: Room | null, kind: FurnitureKind): string {
    const base = `${room ? room.key : 'ext'}/${kind}`;
    const n = this.counters.get(base) ?? 0;
    this.counters.set(base, n + 1);
    return `${base}-${n}`;
  }

  /** Place un meuble si l'emplacement est valide (sinon ignore). Retourne le meuble ou null. */
  place(room: Room | null, kind: FurnitureKind, col: number, row: number, dir: Dir4 = 0, variant = 0, force = false): Furniture | null {
    const key = this.nextKey(room, kind);
    const outside = room === null;
    if (!force && this.check(kind, room ? room.id : -1, col, row, dir, null, outside)) return null;
    const { w, h } = dims(kind, dir), def = FURNITURE[kind];
    const f: Furniture = { key, kind, room: room ? room.id : -1, col, row, w, h, dir, variant, blocks: def.blocks, movable: def.movable && !outside };
    this.furniture.push(f);
    if (def.blocks) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.blocked[(row + j) * this.cols + col + i] = 1;
    if (!outside && def.blocks) for (const s of spotsOf(f)) this.require(s.approach);
    return f;
  }

  /** Applique une personnalisation (déplacement relatif à la pièce, orientation, masquage). Retourne une raison de refus ou null. */
  applyOverride(key: string, o: FurnitureOverride): string | null {
    const f = this.furniture.find((x) => x.key === key);
    if (!f) return 'meuble inconnu';
    if (!f.movable) return 'meuble fixe';
    const room = this.rooms[f.room];
    if (o.hidden) { this.remove(f); return null; }
    const dir = (o.dir ?? f.dir) as Dir4;
    const col = typeof o.x === 'number' ? room.x + Math.round(o.x) : f.col, row = typeof o.y === 'number' ? room.y + Math.round(o.y) : f.row;
    const why = this.check(f.kind, f.room, col, row, dir, f);
    if (why) return why;
    this.move(f, col, row, dir);
    return null;
  }

  remove(f: Furniture) {
    if (f.blocks) for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) this.blocked[(f.row + j) * this.cols + f.col + i] = 0;
    if (f.blocks) for (const s of spotsOf(f)) this.required.delete(s.approach.row * this.cols + s.approach.col);
    this.furniture = this.furniture.filter((x) => x !== f);
  }

  move(f: Furniture, col: number, row: number, dir: Dir4) {
    if (f.blocks) {
      for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) this.blocked[(f.row + j) * this.cols + f.col + i] = 0;
      for (const s of spotsOf(f)) this.required.delete(s.approach.row * this.cols + s.approach.col);
    }
    const { w, h } = dims(f.kind, dir);
    f.col = col; f.row = row; f.dir = dir; f.w = w; f.h = h;
    if (f.blocks) {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.blocked[(row + j) * this.cols + col + i] = 1;
      for (const s of spotsOf(f)) this.require(s.approach);
    }
  }

  /** Emplacements finaux : ceux des meubles + fenêtres (calculés après l'éditeur). */
  spots(rooms: Room[]): Spot[] {
    const out: Spot[] = [];
    for (const f of this.furniture) {
      if (f.room < 0 || !f.blocks) continue;
      for (const s of spotsOf(f)) out.push({ ...s, id: out.length, room: f.room, furn: f.key });
    }
    // coins fenêtre : face aux fenêtres des niches et au bout des couloirs
    for (const room of rooms) {
      if (room.kind === 'nook') {
        const top = room.corridorSide === 'bottom';
        const r = top ? room.y : room.y + room.h - 1, c = room.x + 1, i = r * this.cols + c;
        if (!this.blocked[i]) out.push({ kind: 'window', approach: { col: c, row: r }, x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 + (top ? -3 : 3), dir: top ? 1 : 0, sit: false, id: out.length, room: room.id, furn: null });
      } else if (room.kind === 'corridor' && room.band === 'C') {
        const c = room.x + room.w - 1;
        for (let r = room.y; r < room.y + room.h; r++) {
          const i = r * this.cols + c;
          if (!this.blocked[i] && this.tiles[i + 1] === T.WINDOW) out.push({ kind: 'window', approach: { col: c, row: r }, x: c * TILE + TILE / 2 + 3, y: r * TILE + TILE / 2, dir: 2, sit: false, id: out.length, room: room.id, furn: null });
        }
      } else if (room.kind === 'library' || room.kind === 'break' || room.kind === 'lobby') {
        // fenêtre extérieure de la pièce : une place debout devant
        const top = room.corridorSide === 'bottom';
        const r = top ? room.y : room.y + room.h - 1, wr = top ? r - 1 : r + 1;
        for (let c = room.x + 1; c < room.x + room.w - 1; c++) {
          const i = r * this.cols + c;
          if (this.tiles[wr * this.cols + c] === T.WINDOW && !this.blocked[i] && !this.reservedT.has(i)) {
            out.push({ kind: 'window', approach: { col: c, row: r }, x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 + (top ? -3 : 3), dir: top ? 1 : 0, sit: false, id: out.length, room: room.id, furn: null });
            c += 3;
          }
        }
      }
    }
    return out;
  }
}

// ───────────────────────── aménagement des pièces ─────────────────────────

function furnish(P: Placer, room: Room, desks: Desk[], R: number) {
  const { x, y, w, h } = room;
  const top = room.corridorSide === 'bottom'; // pièce au nord du couloir : mur du fond en haut
  const far = top ? y : y + h - 1, near = top ? y + h - 1 : y;
  const towardNear = top ? 1 : -1;
  const rowFromFar = (i: number) => far + towardNear * i;
  const faceFar: Dir4 = top ? 1 : 0, faceNear: Dir4 = top ? 0 : 1;
  const v = (n: number) => (room.id * 7 + n * 3) % 4;
  switch (room.kind) {
    case 'lobby': {
      const cx = x + Math.floor(w / 2);
      P.place(room, 'rug', cx - 2, y + 2, 0, 1);
      // salon d'attente à gauche
      P.place(room, 'sofa', x + 1, y + 1, 0, 0);
      P.place(room, 'coffee_table', x + 2, y + 3, 0);
      P.place(room, 'armchair', x + 1, y + 4, 1, 0);
      P.place(room, 'armchair', x + 3, y + 4, 1, 0);
      // banque d'accueil et borne à droite
      P.place(room, 'reception', x + w - 5, y + 2, 0);
      P.place(room, 'kiosk', x + w - 2, y + 4, 3);
      // boîte aux lettres des rapports (réels), au bout de la banque d'accueil
      P.place(room, 'mailbox', x + w - 1, y + 3, 3);
      // (pas de grande plante juste sous le tableau du planning : son volume pré-calculé masquerait le texte réel)
      P.place(room, 'plant', x + w - 1, y + 1, 0, 1);
      P.place(room, 'plant_tall', cx - 3, y + h - 1, 0, 1);
      P.place(room, 'plant_tall', cx + 2, y + h - 1, 0, 2);
      P.place(room, 'plant', x, y + h - 1, 0, 3);
      P.place(room, 'plant', x + w - 1, y + h - 1, 0, 0);
      P.place(room, 'water_cooler', x, y + 1, 2);
      if (h >= 10) { P.place(room, 'bench', x + 1, y + h - 3, 1); P.place(room, 'bench', x + w - 4, y + h - 3, 1); }
      break;
    }
    case 'control': {
      P.place(room, 'plant_tall', x, y);
      P.place(room, 'plant_tall', x + w - 1, y);
      P.place(room, 'floorlamp', x, y + h - 2);
      P.place(room, 'cabinet', x + w - 3, y + h - 2);
      P.place(room, 'rug', x + 3, y + 3, 0, 2);
      P.place(room, 'armchair', x + 1, y + h - 2, 1, 3);
      P.place(room, 'side_table', x + 2, y + h - 2);
      P.place(room, 'plant', x + w - 1, y + 3, 0, 2);
      break;
    }
    case 'approval': {
      const gw = w >= 14 ? 6 : 4;
      P.place(room, 'guichet', x + Math.floor((w - gw) / 2), far, faceNear);
      P.place(room, 'plant', x, far, 0, v(1));
      P.place(room, 'plant', x + w - 1, far, 0, v(2));
      for (let ri = 2; ri < h - 2; ri += 2) {
        const r = rowFromFar(ri);
        for (let c = x + 1; c < x + w - 1; c++) if ((c - (x + 1)) % 4 !== 3) P.place(room, 'wait_chair', c, r, faceFar, ri);
      }
      P.place(room, 'water_cooler', x, near - towardNear, 2);
      P.place(room, 'plant', x + w - 1, near - towardNear * 0, 0, v(3));
      break;
    }
    case 'meeting': {
      const tw = Math.min(w - 4, 8);
      const tx = x + Math.floor((w - tw) / 2), ty = y + Math.floor((h - 2) / 2);
      P.place(room, 'rug', tx - 1, ty - 1, 0, 3);
      const t = P.place(room, 'meeting_table', tx, ty, 0);
      if (t) { t.w = tw; } // la table s'adapte à la pièce
      if (t) for (let i = 6; i < tw; i++) P.blocked[ty * P.cols + tx + i] = P.blocked[(ty + 1) * P.cols + tx + i] = 1;
      for (let i = 0; i < tw; i += 2) { P.place(room, 'chair', tx + i + (tw % 2 ? 0 : 0), ty - 1, 0); P.place(room, 'chair', tx + i, ty + 2, 1); }
      P.place(room, 'plant_tall', x, far, 0, 0);
      P.place(room, 'plant', x + w - 1, far, 0, 2);
      break;
    }
    case 'coffee': {
      // comptoir le long du mur du fond : réfrigérateur, machines à café, évier, distributeur, fontaine
      let c = x;
      const putF = (k: FurnitureKind, dir: Dir4 = faceNear) => { const f = P.place(room, k, c, far, dir); c += f ? f.w : 1; return f; };
      putF('fridge'); putF('coffee_machine'); putF('counter'); putF('coffee_machine'); putF('counter');
      if (x + w - c >= 3) putF('vending');
      if (x + w - c >= 1) putF('water_cooler');
      // mange-debout en quinconce, salon près de la porte, plantes
      for (let ri = 3; ri < h - 1; ri += 3) for (let cc = x + 2 + (ri % 2); cc < x + w - 2; cc += 4) P.place(room, 'high_table', cc, rowFromFar(ri));
      if (w >= 11) { P.place(room, 'armchair', x + w - 1, rowFromFar(h - 2), 3, 2); P.place(room, 'side_table', x + w - 1, rowFromFar(h - 3)); }
      P.place(room, 'plant', x, near, 0, v(1));
      P.place(room, 'plant_tall', x + w - 1, near, 0, v(2));
      break;
    }
    case 'break': {
      const groupsN = w >= 12 ? 2 : 1;
      for (let g = 0; g < groupsN; g++) {
        const gx = x + Math.floor(((g + 0.5) * w) / groupsN) - 2;
        const sy = top ? far : y + 2;
        P.place(room, 'rug', gx - 1, sy, 0, g);
        P.place(room, 'sofa', gx, sy, 0, g);
        P.place(room, 'coffee_table', gx + 1, sy + 2, 0);
        P.place(room, 'armchair', gx - 1, sy + 2, 2, g);
        P.place(room, 'armchair', gx + 3, sy + 2, 3, g);
      }
      P.place(room, 'plant_tall', x, far, 0, v(1));
      P.place(room, 'plant_tall', x + w - 1, far, 0, v(2));
      P.place(room, 'floorlamp', x, near, 0);
      P.place(room, 'bookshelf', x + w - 2, near - towardNear * 0, top ? 1 : 0, 1);
      if (h >= 10) { P.place(room, 'sofa', x + Math.floor(w / 2) - 1, rowFromFar(6), faceFar === 1 ? 0 : 1, 2); }
      break;
    }
    case 'server': {
      // écran des limites d'usage sur pied (données réelles), face à la salle, avec une case libre devant pour le lire
      if (w >= 7) P.place(room, 'status_board', x + 1, top ? y : y + 1, 0);
      // rangées de baies espacées de deux allées : on voit le technicien quand il intervient devant une baie
      for (let r = y + (top ? 0 : 1); r <= y + h - 3; r += 3) {
        for (let c = x + 1; c < x + w - 1; c++) P.place(room, 'rack', c, r, 0, (c * 3 + r) % 4);
      }
      P.place(room, 'ac_unit', x + w - 2, near, faceFar);
      P.place(room, 'kiosk', x + w - 1, y + h - 2, 3, 1); // poste de supervision du technicien
      break;
    }
    case 'library': {
      // étagères contre le mur du fond, rangée libre au milieu, fauteuils de lecture
      for (let c = x + 1; c + 2 <= x + w - 1; c += 2) P.place(room, 'bookshelf', c, top ? far : rowFromFar(h - 3), 0, c);
      const mr = top ? far + 3 : rowFromFar(3);
      for (let c = x + 1; c + 2 <= x + w - 3; c += 3) P.place(room, 'bookshelf', c, mr, 0, c + 1);
      P.place(room, 'armchair', x, near - towardNear, 2, 1);
      P.place(room, 'armchair', x + w - 1, near - towardNear, 3, 1);
      P.place(room, 'floorlamp', x + w - 1, top ? far : near, 0);
      P.place(room, 'plant', x, top ? far : near, 0, v(1));
      P.place(room, 'side_table', x + 1, top ? near : near, 0);
      break;
    }
    case 'landing': {
      // escalier en U contre le pignon est (montée au RDC, trémie et descente au 1er), ascenseur au mur nord (décor mural)
      P.place(room, 'stairs', x + 4, y, 0, room.level, true);
      P.place(room, 'plant_tall', x, y + h - 1, 0, v(1));
      P.place(room, 'plant', x, y, 0, v(3));
      if (room.level > 0) P.place(room, 'rack', x + w - 1, y + h - 2, 0, 1); // baie réseau d'étage
      else P.place(room, 'plant', x + w - 1, y + h - 1, 0, v(2));
      break;
    }
    case 'quiet': {
      // salle calme : fauteuils de lecture, lampadaire, plantes (ambiance)
      const cx = x + Math.floor(w / 2);
      P.place(room, 'rug', cx - 2, top ? rowFromFar(1) : rowFromFar(3), 0, 3);
      P.place(room, 'armchair', cx - 2, rowFromFar(1), faceNear, 1);
      P.place(room, 'side_table', cx - 1, rowFromFar(1));
      P.place(room, 'armchair', cx, rowFromFar(1), faceNear, 3);
      P.place(room, 'floorlamp', cx + 1, rowFromFar(1));
      P.place(room, 'plant_tall', x, far, 0, v(1));
      P.place(room, 'plant_tall', x + w - 1, far, 0, v(2));
      P.place(room, 'bookshelf', x + 1, near, 0, room.id);
      P.place(room, 'plant', x + w - 1, near, 0, v(3));
      break;
    }
    case 'nook': {
      const r = top ? y : y + h - 1;
      P.place(room, 'plant_tall', x, r, 0, v(1));
      P.place(room, 'plant', x + 2, r, 0, v(2));
      P.place(room, 'armchair', x + 1, top ? y + 2 : y + h - 3, top ? 1 : 0, 2);
      P.place(room, 'side_table', x + 2, top ? y + 2 : y + h - 3);
      break;
    }
    case 'corridor': {
      if (room.band === 'C') {
        P.place(room, 'plant_tall', x, y, 0, 1);
        P.place(room, 'plant_tall', x, y + h - 1, 0, 2);
        P.place(room, 'plant', x + w - 1, y, 0, 0);
        P.place(room, 'plant', x + w - 1, y + h - 1, 0, 3);
      }
      break;
    }
    case 'department': {
      // cases vides de la grille de postes : rangements, imprimante, coin détente ; plantes dans les marges
      const n = desks.length, gcols = Math.max(1, Math.ceil(n / R));
      const ox = x + Math.floor((w - 4 * gcols) / 2);
      for (let k = n; k < gcols * R; k++) {
        const c = k % gcols, r = Math.floor(k / gcols);
        const dc = ox + 4 * c, dr = y + 1 + 3 * r;
        const pick = (room.id + k) % 3;
        if (pick === 0) { P.place(room, 'cabinet', dc, dr, 0, k); P.place(room, 'plant', dc + 3, dr, 0, v(k)); }
        else if (pick === 1) { P.place(room, 'sofa', dc, dr, 0, k); P.place(room, 'side_table', dc + 3, dr); }
        else { P.place(room, 'printer', dc, dr); P.place(room, 'lockers', dc + 1, dr); P.place(room, 'plant', dc + 3, dr, 0, v(k)); }
      }
      const lm = ox - x, rm = x + w - (ox + 4 * gcols);
      if (lm >= 2) { P.place(room, 'plant_tall', x, near, 0, v(1)); P.place(room, 'plant_tall', x, y + 1, 0, v(3)); }
      else P.place(room, 'plant', x, near, 0, v(1));
      if (rm >= 2) { P.place(room, 'plant_tall', x + w - 1, near, 0, v(2)); P.place(room, 'cabinet', x + w - 2, top ? y : near - towardNear * 0, 0); }
      else P.place(room, 'plant', x + w - 1, near, 0, v(2));
      if (rm >= 3 || lm >= 3) P.place(room, 'water_cooler', rm >= 3 ? x + w - 1 : x, rowFromFar(Math.floor(h / 2)), rm >= 3 ? 3 : 2);
      break;
    }
  }
}

function outdoor(P: Placer, b: Rect, ecx: number, rows: number) {
  // abords : arbres, massifs et jardinières le long de la façade sud, range-vélos près du parvis
  const yb = b.y + b.h;
  for (let c = b.x + 1; c + 2 <= b.x + b.w - 1; c += 7) {
    if (Math.abs(c + 1 - ecx) < 5) continue;
    P.place(null, 'tree', c, yb + 1, 0, c % 3);
  }
  for (let c = b.x + 4; c < b.x + b.w - 1; c += 7) if (Math.abs(c - ecx) > 4) P.place(null, 'bush', c, yb, 0, c % 2);
  P.place(null, 'planter', ecx - 5, yb, 0);
  P.place(null, 'planter', ecx + 3, yb, 0);
  P.place(null, 'bike_rack', ecx + 4, Math.min(rows - 2, yb + 1), 0);
  for (let c = b.x + 2; c + 2 <= b.x + b.w - 1; c += 9) P.place(null, 'tree', c, b.y - 3, 0, (c + 1) % 3);
}

// ───────────────────────── décor mural ─────────────────────────

function wallDecorFor(rooms: Room[], tiles: Uint8Array, cols: number, desks: Desk[]): WallDecor[] {
  const out: WallDecor[] = [];
  // segments de mur plein au-dessus d'une pièce (face visible depuis le sud)
  const runs = (room: Room): { a: number; b: number; row: number }[] => {
    const row = room.y - 1, res: { a: number; b: number; row: number }[] = [];
    let a = -1;
    for (let c = room.x; c <= room.x + room.w; c++) {
      const ok = c < room.x + room.w && tiles[row * cols + c] === T.WALL;
      if (ok && a < 0) a = c;
      if (!ok && a >= 0) { res.push({ a, b: c, row }); a = -1; }
    }
    return res;
  };
  const put = (room: Room, kind: WallDecorKind, w: number, variant = 0, text = '', at: 'center' | 'left' | 'right' | number = 'center') => {
    for (const r of runs(room).sort((p, q) => (q.b - q.a) - (p.b - p.a))) {
      if (r.b - r.a < w) continue;
      let c = at === 'left' ? r.a + 1 : at === 'right' ? r.b - w - 1 : typeof at === 'number' ? Math.max(r.a, Math.min(r.b - w, at)) : r.a + Math.floor((r.b - r.a - w) / 2);
      c = Math.max(r.a, Math.min(r.b - w, c));
      if (out.some((o) => o.row === r.row && o.col < c + w && c < o.col + o.w)) continue;
      out.push({ kind, col: c, row: r.row, w, variant, room: room.id, text });
      return true;
    }
    return false;
  };
  for (const room of rooms) {
    switch (room.kind) {
      case 'lobby': {
        // logo, puis tableau du planning du jour (données réelles), puis l'horloge là où il reste de la place
        put(room, 'logo', 4, 0, 'RO·AI', 'left');
        if (!put(room, 'planning', 5, 0, 'Planning', 'right')) put(room, 'planning', 4, 0, 'Planning', 'right');
        if (!put(room, 'clock', 1, 0, '', 'right')) put(room, 'clock', 1, 0, '', room.x);
        break;
      }
      case 'control': put(room, 'sign', 4, 0, 'RÉGIE'); put(room, 'clock', 1, 0, '', 'right'); put(room, 'board', 2, 0, '', 'left'); break;
      case 'department': {
        const mine = desks.filter((d) => d.room === room.id);
        put(room, 'whiteboard', 4, room.tint, room.dept ?? '', mine.length ? 'left' : 'center');
        put(room, 'clock', 1, 0, '', 'right');
        put(room, 'painting', 2, room.id % 6);
        break;
      }
      case 'approval': put(room, 'screen', 3, 0, 'Approbations'); put(room, 'clock', 1, 0, '', 'right'); break;
      case 'meeting': put(room, 'tv', 4, 0, ''); put(room, 'whiteboard', 3, 9, '', 'left'); break; // écran : « Salle disponible » ou conversation réelle en cours
      case 'break': put(room, 'tv', 3, 1, ''); put(room, 'painting', 2, (room.id + 2) % 6, '', 'left'); put(room, 'painting', 2, (room.id + 4) % 6, '', 'right'); break;
      case 'coffee': put(room, 'menu', 2, 0, 'Café'); put(room, 'clock', 1, 0, '', 'right'); break;
      case 'server': put(room, 'board', 2, 1); break;
      case 'library': put(room, 'map', 3, 0); put(room, 'painting', 2, (room.id + 1) % 6, '', 'left'); break;
      case 'landing': put(room, 'elevator', 2, room.level, '', room.x + 1); put(room, 'sign', 2, 0, room.level ? '1er' : 'RDC', room.x + 4); break;
      case 'quiet': put(room, 'painting', 3, (room.id + 3) % 6); put(room, 'clock', 1, 0, '', 'right'); break;
      case 'corridor': {
        if (room.band !== 'C') break;
        const rs = runs(room);
        let n = 0;
        for (const r of rs) for (let c = r.a + 1; c + 2 <= r.b - 1; c += 9) {
          if (out.some((o) => o.row === r.row && o.col < c + 2 && c < o.col + o.w)) continue;
          out.push({ kind: n === 1 ? 'clock' : 'painting', col: c, row: r.row, w: n === 1 ? 1 : 2, variant: (c + room.id) % 6, room: room.id, text: '' }); n++;
        }
        break;
      }
      default: break;
    }
  }
  return out;
}

// ───────────────────────── ajustement à l'écran ─────────────────────────

/** Choisit le nombre d'ailes qui donne la plus grande échelle dans une zone de proportions `aspect` (largeur / hauteur). */
export function fitPlan(input: PlanInput, aspect: number): Layout {
  const { depts } = groups(input);
  let best: Layout | null = null, bestScore = -1;
  for (let W = 1; W <= maxWings(depts.length); W++) {
    const l = planLayout({ ...input, wings: W });
    const bw = (l.building.w + l.annex.w - 1) * TILE, bh = (l.building.h + 4) * TILE;
    const score = Math.min(aspect / bw, 1 / bh) * (W === 1 ? 1.08 : 1); // légère préférence pour une seule aile
    if (score > bestScore) { bestScore = score; best = l; }
  }
  return best!;
}

/** Longueur maximale d'un chemin (tampons de la simulation). */
export const MAX_PATH = MAX_PATH_TILES;
export { DIR_DX, DIR_DY };
