// Simulation des personnages : priorité absolue à l'état réel (snapshot + événements), puis vie sociale locale
// (décorative, désactivable). Déplacements sur grille (A* 8-connexe, tampons réutilisés, nombre de recherches limité
// par image), réservation des cases et des emplacements, évitement local (attendre, céder, contourner, se décaler).
// Aucune allocation dans la boucle courante ; aucune requête réseau ni événement émis.
import type { Layout, Portal, Spot, Tile } from '../layout/plan.ts';
import { TILE, levelOfRow, levelOfY } from '../layout/plan.ts';
import { PathFinder } from '../layout/pathfinding.ts';
import type { OfficeAgentModel } from '../state/model.ts';
import type { Visual } from '../state/visual.ts';
import { newVisual, selectVisual } from '../state/visual.ts';
import type { Personality } from '../../api/types.ts';
import type { Activity, Dialogue, Line, Rng, SocialClock } from './social.ts';
import { EMPTY_STAFF_INFO, STAFF_IDS, STAFF_LABEL, receptionFacts, receptionGreeting, techAlert, techRemarks } from './staff.ts';
import type { ExtraKind, StaffInfo } from './staff.ts';
import type { DevSession } from '../../api/types.ts';
import { DEV_WAIT_BUBBLE, devBubble, devCharId } from '../state/devteam.ts';
import { CHATS, DEFAULT_CLOCK, DEFAULT_PERSONALITY, GREETINGS, SOLO, activityWeights, clampPersonality, hashStr, lineDuration, pickDialogue, pickWeighted, rnd } from './social.ts';

export const Dir = { DOWN: 0, UP: 1, RIGHT: 2, LEFT: 3 } as const;
export const Mode = { STAND: 0, WALK: 1, SIT: 2 } as const;
export type Anim = 'stand' | 'walk' | 'sit' | 'type' | 'terminal' | 'read' | 'web' | 'alarm' | 'quota' | 'wait' | 'hand' | 'cheer' | 'use' | 'drink' | 'browse' | 'look' | 'book';

export const WALK_SPEED = 40; // unités/s (≈ 2 m/s… à l'échelle du dessin, une allure de marche posée)
export const STRIDE = 0.55;
const MAX_PATH = 900;
/** Recherches de chemin au plus par image. */
export const PATHS_PER_FRAME = 6;
/** Conversations simultanées au plus (en plus du plafond proportionnel). */
const MAX_CONVOS = 6;

const G = { NONE: 0, DESK: 1, STAND: 2, APPROVAL: 3, SPOT: 4, TILE: 5, EXIT: 6, VISIT: 7, MEET: 8, SHELF: 9 } as const;

export interface Char {
  id: string; uid: number; agent: OfficeAgentModel; vis: Visual;
  pers: Personality;
  x: number; y: number; dir: number; mode: number; anim: Anim;
  phase: number; vel: number; alpha: number; clock: number;
  /** Faux tant que le personnage n'a jamais reçu de position ; `present` : dans le bâtiment. */
  placed: boolean; present: boolean; visible: boolean; leaving: boolean;
  spawnInstant: boolean;
  // trajet
  pc: Int16Array; pr: Int16Array; pLen: number; pIdx: number;
  tile: number; next: number; needPath: boolean; pathFails: number; blockT: number; repathTried: boolean; ghost: boolean; afterSide: boolean;
  avoidTile: number; paused: boolean;
  // but courant
  goal: number; goalKey: number; gx: number; gy: number; gdir: number; gsit: boolean; ganim: Anim; gTile: Tile; gSpot: number;
  arrived: boolean; real: boolean; atDesk: boolean;
  // vie sociale (décorative)
  act: Activity | null; actPhase: number; actT: number; actHops: number; decideT: number; lastAct: Activity | null; afterWork: boolean;
  visit: Char | null; visitT: number; convo: Convo | null; greetT: number;
  bubble: string; bubbleUntil: number; speaking: boolean;
  rng: Rng; exitT: number;
  /** Temporisation avant une nouvelle recherche de chemin (s). */
  retry: number;
  ghostT: number;
  /** Temps passé bloqué sans avancer (ne se remet à zéro qu'en progressant). */
  stuckT: number;
  /** Personnel figurant (null pour un agent). */
  extra: ExtraKind | null;
  staffT: number; staffIdx: number; staffAlert: string;
  /** Réceptionniste : petite tâche du hall en cours (index, -1 = aucune), durée restante, délai avant la suivante, déjà annoncée. */
  errand: number; errandT: number; errandCool: number; errandSaid: boolean;
  /** Session Claude Code représentée (extra `dev`) et son emplacement en salle serveur. */
  dev: DevSession | null; devSlot: number;
  /** Changement d'étage : 0 aucun, 1 en route vers l'ascenseur ou l'escalier, 2 en transit (entre deux étages). */
  xfer: number; xTo: number; xLift: boolean; xT: number; xPh: number; xTrips: number;
  xFrom: Portal | null; xDest: Portal | null;
  /** Déplacement de l'orchestrateur (extra `orch`) : null hors de ce cas. */
  orch: OrchTrip | null;
}

/** Sortie de l'orchestrateur de sa régie : motif réel (alerte, approbation, fiche déposée) ou petite balade au repos. */
export interface OrchTrip { kind: 'alert' | 'approval' | 'visit' | 'stroll'; agentId: string | null; phase: 0 | 1 | 2; t: number; cap: number; home: Tile }
/** Signaux réels transmis par le Conductor (états dérivés des événements du noyau). */
export interface OrchSignals { alertAgent: string | null; approvals: number; quiet: boolean }

/** Ascenseur (simulation locale) : étage de la cabine, déplacement en cours, ouverture des portes par étage (temps). */
export interface Lift { level: number; target: number; moveUntil: number; open: number[] }
/** Durées du changement d'étage (s). */
export const LIFT_TRAVEL = 2.4, LIFT_DOOR = 0.9, STAIRS_CLIMB = 1.3, STAIRS_GAP = 0.5;

export interface Convo { a: Char; b: Char; lines: Line[]; i: number; t: number; id: string }
export interface WorldOptions { social: boolean; decor?: boolean; /** Personnel figurant (accueil, technicien, entretien) ; défaut vrai. */ staff?: boolean }

const tileCx = (c: number) => c * TILE + TILE / 2;
const tileCy = (r: number) => r * TILE + TILE / 2;
const ANIM_CODE: Record<Anim, number> = { stand: 0, walk: 1, sit: 2, type: 3, terminal: 4, read: 5, web: 6, alarm: 7, quota: 8, wait: 9, hand: 10, cheer: 11, use: 12, drink: 13, browse: 14, look: 15, book: 16 };
const SPOT_ANIM: Record<string, Anim> = { coffee: 'use', vending: 'use', water: 'use', drink: 'drink', shelf: 'browse', window: 'look', sofa: 'sit', armchair: 'sit', bench: 'sit', wait: 'sit', reading: 'book' };

export class OfficeWorld {
  layout: Layout;
  pf: PathFinder;
  chars: Char[] = [];
  byId = new Map<string, Char>();
  social: boolean;
  decor: boolean;
  clock: SocialClock = { ...DEFAULT_CLOCK };
  /** Temps de simulation (s) : bulles, recharges. */
  time = 0;
  /** Au moins un agent libre visible. */
  hasIdle = false;
  convos: Convo[] = [];
  /** Nombre de recherches de chemin effectuées (mesure de performance). */
  pathSearches = 0;
  private uidSeq = 1;
  private hasLoaded = false;
  private occ: Int32Array;
  private spotOwner: Int32Array;
  private queue: Char[] = [];
  private tmpC = new Int16Array(MAX_PATH);
  private tmpR = new Int16Array(MAX_PATH);
  private avoidBuf = new Int32Array(4);
  private pairCool = new Map<string, number>();
  private recentDialogues: string[] = [];
  private encounterT = 0;
  private worldRng: Rng = { s: 0x9e3779b9 };
  private profiles: Record<string, { personality?: Partial<Personality> } | undefined> = {};
  /** Faits réels transmis au personnel figurant. */
  staffInfo: StaffInfo = EMPTY_STAFF_INFO;
  private orchSig: OrchSignals = { alertAgent: null, approvals: 0, quiet: false };
  private orchVisits: { agentId: string; at: number }[] = [];
  private orchCool = 6;
  private staffOn: boolean;
  private greetCool = new Map<string, number>();
  /** Ascenseur partagé par les deux étages. */
  lift: Lift = { level: 0, target: 0, moveUntil: 0, open: [0, 0] };

  constructor(layout: Layout, opts: WorldOptions) {
    this.layout = layout; this.pf = new PathFinder(layout); this.social = opts.social; this.decor = opts.decor ?? opts.social; this.staffOn = opts.staff ?? true;
    this.occ = new Int32Array(layout.cols * layout.rows); this.spotOwner = new Int32Array(layout.spots.length);
  }

  setOptions(o: Partial<WorldOptions>) {
    if (o.decor !== undefined) this.decor = o.decor;
    if (o.social !== undefined && o.social !== this.social) {
      this.social = o.social;
      if (!o.social) for (const c of this.chars) { this.endConvo(c); this.endActivity(c); c.bubble = ''; }
    }
  }

  setClock(c: Partial<SocialClock>) { this.clock = { ...this.clock, ...c }; }

  /** Personnalités (fiches) : modulent uniquement la vie sociale. */
  setProfiles(p: Record<string, { personality?: Partial<Personality> } | undefined>) {
    this.profiles = p;
    for (const c of this.chars) c.pers = clampPersonality(p[c.id]?.personality ?? DEFAULT_PERSONALITY);
  }

  setLayout(layout: Layout) {
    this.layout = layout; this.pf = new PathFinder(layout);
    this.occ = new Int32Array(layout.cols * layout.rows); this.spotOwner = new Int32Array(layout.spots.length);
    this.queue.length = 0; this.receptionFront = undefined; this.errands = undefined; this.outsideTiles = null;
    this.lift = { level: 0, target: 0, moveUntil: 0, open: new Array(layout.floors).fill(0) };
    for (const c of this.chars) {
      c.xfer = 0; c.xFrom = null; c.xDest = null;
      this.endConvo(c); c.act = null; c.actPhase = 0; c.visit = null; c.decideT = 2 + rnd(c.rng) * 10;
      c.tile = -1; c.next = -1; c.pLen = 0; c.pIdx = 0; c.goal = G.NONE; c.goalKey = -1; c.gSpot = -1; c.needPath = false; c.arrived = false; c.atDesk = false;
      if (c.leaving) { c.alpha = 0; continue; }
      if (c.placed && c.present) { c.placed = false; c.spawnInstant = true; } // réorganisation du bâtiment : replacement direct
    }
  }

  /** Synchronise les personnages avec les agents du modèle. Première charge : placement direct (pas d'entrée par la porte). */
  setAgents(agents: readonly OfficeAgentModel[]) {
    const instant = !this.hasLoaded;
    this.hasLoaded = true;
    const keep = new Set<string>();
    for (const a of agents) {
      keep.add(a.id);
      let c = this.byId.get(a.id);
      if (!c) { c = this.makeChar(a); c.spawnInstant = instant; this.byId.set(a.id, c); this.chars.push(c); }
      else c.agent = a;
    }
    if (this.staffOn) this.ensureStaff(instant);
    for (const c of this.chars) {
      if (keep.has(c.id) || c.leaving || c.extra) continue;
      c.leaving = true; c.exitT = 0; this.endConvo(c); this.endActivity(c); this.byId.delete(c.id);
      if (!c.present || !c.placed) c.alpha = 0;
      else this.setGoal(c, G.EXIT, 9999);
    }
  }

  private makeChar(a: OfficeAgentModel): Char {
    const h = hashStr(a.id);
    return {
      id: a.id, uid: this.uidSeq++, agent: a, vis: newVisual(), pers: clampPersonality(this.profiles[a.id]?.personality ?? DEFAULT_PERSONALITY),
      x: 0, y: 0, dir: Dir.UP, mode: Mode.STAND, anim: 'stand', phase: 0, vel: 0, alpha: 1, clock: (h % 1000) / 100,
      placed: false, present: false, visible: false, leaving: false, spawnInstant: false,
      pc: new Int16Array(MAX_PATH), pr: new Int16Array(MAX_PATH), pLen: 0, pIdx: 0,
      tile: -1, next: -1, needPath: false, pathFails: 0, blockT: 0, repathTried: false, ghost: false, afterSide: false, avoidTile: -1, paused: false,
      goal: G.NONE, goalKey: -1, gx: 0, gy: 0, gdir: Dir.UP, gsit: false, ganim: 'stand', gTile: { col: 0, row: 0 }, gSpot: -1,
      arrived: false, real: false, atDesk: false,
      act: null, actPhase: 0, actT: 0, actHops: 0, decideT: 3 + ((h >>> 5) % 1000) / 1000 * 18, lastAct: null, afterWork: false,
      visit: null, visitT: 0, convo: null, greetT: 0, bubble: '', bubbleUntil: 0, speaking: false,
      rng: { s: h || 1 }, exitT: 0, retry: 0, ghostT: 0, stuckT: 0, extra: null, staffT: 6 + ((h >>> 9) % 1000) / 1000 * 20, staffIdx: 0, staffAlert: '', errand: -1, errandT: 0, errandCool: 25 + ((h >>> 13) % 1000) / 1000 * 40, errandSaid: false, dev: null, devSlot: 0,
      xfer: 0, xTo: 0, xLift: false, xT: 0, xPh: 0, xTrips: 0, xFrom: null, xDest: null, orch: null,
    };
  }

  // ───────────── occupation ─────────────

  private idx(c: number, r: number) { return r * this.layout.cols + c; }
  private release(c: Char) {
    if (c.tile >= 0 && this.occ[c.tile] === c.uid) this.occ[c.tile] = 0;
    if (c.next >= 0 && this.occ[c.next] === c.uid) this.occ[c.next] = 0;
    c.tile = -1; c.next = -1;
  }
  private releaseSpot(c: Char) {
    if (c.gSpot >= 0 && c.gSpot < this.spotOwner.length && this.spotOwner[c.gSpot] === c.uid) this.spotOwner[c.gSpot] = 0;
    c.gSpot = -1;
  }
  private freeSpot(kinds: readonly string[], c: Char, filter?: (s: Spot) => boolean): number {
    // emplacement libre plutôt proche (avec une part de hasard) : la vie de bureau reste surtout locale
    const S = this.layout.spots, n = S.length;
    let best = -1, bs = 1e18;
    for (let i = 0; i < n; i++) {
      const s = S[i];
      if (this.spotOwner[i] || !kinds.includes(s.kind) || (filter && !filter(s))) continue;
      const rk = this.layout.rooms[s.room].kind; // la vie sociale n'utilise jamais la réunion, la régie, la salle serveur ni l'attente des approbations
      if (rk === 'meeting' || rk === 'control' || rk === 'server' || rk === 'approval') continue;
      const a = this.idx(s.approach.col, s.approach.row);
      if (this.occ[a] && this.occ[a] !== c.uid) continue;
      const sc = this.reach(c, s.x, s.y) + rnd(c.rng) * 420;
      if (sc < bs) { bs = sc; best = i; }
    }
    return best;
  }
  /** Distance « ressentie » vers un point : à un autre étage, un détour fixe (escalier) plutôt que l'écart vertical
   *  du plan, pour que les agents montent et descendent de temps en temps. */
  private reach(c: Char, x: number, y: number): number {
    const L = this.layout;
    return levelOfY(L, y) === levelOfY(L, c.y) ? Math.abs(x - c.x) + Math.abs(y - c.y) : Math.abs(x - c.x) * 0.5 + 340;
  }
  private outsideTiles: Tile[] | null = null;
  /** Cases du parvis (dehors, devant l'entrée) où l'on peut prendre l'air. */
  private plaza(): Tile[] {
    if (this.outsideTiles) return this.outsideTiles;
    const L = this.layout, out: Tile[] = [];
    for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++) {
      const i = r * L.cols + c;
      if (L.tiles[i] === 6 && L.walkable[i] && L.cost[i] === 1 && !(c === L.spawn.col && r === L.spawn.row)) out.push({ col: c, row: r });
    }
    return (this.outsideTiles = out);
  }
  private placeAt(c: Char, x: number, y: number) {
    this.release(c);
    c.x = x; c.y = y; c.placed = true; c.pLen = 0; c.pIdx = 0;
    const col = Math.floor(x / TILE), row = Math.floor(y / TILE);
    const t = this.idx(col, row);
    if (col >= 0 && row >= 0 && col < this.layout.cols && row < this.layout.rows && !this.occ[t]) { this.occ[t] = c.uid; c.tile = t; }
  }

  // ───────────── buts ─────────────

  /** Fixe un but ; `key` identifie la consigne (un changement de clé relance le trajet). */
  private setGoal(c: Char, kind: number, key: number) {
    if (c.goal === kind && c.goalKey === key && (c.arrived || c.mode === Mode.WALK || c.needPath)) return;
    const L = this.layout;
    this.releaseSpot(c);
    c.goal = kind; c.goalKey = key; c.arrived = false; c.atDesk = false;
    const d = L.deskByAgent.get(c.id);
    switch (kind) {
      case G.DESK:
        if (!d) { c.goal = G.NONE; return; }
        c.gTile = d.seat; c.gx = d.seatX; c.gy = d.seatY; c.gdir = Dir.UP; c.gsit = true; break;
      case G.STAND:
        if (!d) { c.goal = G.NONE; return; }
        c.gTile = d.stand; c.gx = d.standX; c.gy = d.standY; c.gdir = Dir.LEFT; c.gsit = false; break;
      case G.APPROVAL: {
        let si = -1;
        for (const k of L.waitSpots) if (!this.spotOwner[k]) { si = k; break; }
        if (si >= 0) { this.takeSpot(c, si); break; }
        // salle pleine : file dans le couloir, sinon une case libre de la salle
        const q = L.queueTiles.find((t) => !this.occ[this.idx(t.col, t.row)] || this.occ[this.idx(t.col, t.row)] === c.uid) ?? L.queueTiles[c.uid % Math.max(1, L.queueTiles.length)];
        if (!q) { c.goal = G.NONE; return; }
        c.gTile = q; c.gx = tileCx(q.col); c.gy = tileCy(q.row); c.gdir = Dir.DOWN; c.gsit = false; break;
      }
      case G.MEET: case G.SHELF: { // salle de réunion (conversation réelle) / bibliothèque (rapport réel)
        const pool = kind === G.MEET ? L.meetSpots : L.shelfSpots;
        let si = -1;
        for (let k = 0; k < pool.length; k++) { const s = pool[(k + c.uid) % pool.length]; if (!this.spotOwner[s]) { si = s; break; } }
        if (si >= 0) { this.takeSpot(c, si); break; }
        if (!d) { c.goal = G.NONE; return; } // salle pleine ou absente : il reste à son poste
        c.gTile = d.seat; c.gx = d.seatX; c.gy = d.seatY; c.gdir = Dir.UP; c.gsit = true; break;
      }
      case G.EXIT:
        c.gTile = L.spawn; c.gx = tileCx(L.spawn.col); c.gy = tileCy(L.spawn.row); c.gdir = Dir.DOWN; c.gsit = false; break;
      default: break; // SPOT / TILE / VISIT : renseignés par l'appelant
    }
    this.requestPath(c);
  }
  private takeSpot(c: Char, si: number) {
    const s = this.layout.spots[si];
    this.spotOwner[si] = c.uid; c.gSpot = si;
    c.gTile = s.approach; c.gx = s.x; c.gy = s.y; c.gdir = s.dir; c.gsit = s.sit;
  }
  private requestPath(c: Char, avoid = -1) {
    c.avoidTile = avoid;
    if (!c.needPath) { c.needPath = true; this.queue.push(c); }
  }

  private computePath(c: Char) {
    c.needPath = false;
    if (!c.placed || c.leaving && !c.present) return;
    if (c.xfer === 2) return; // en transit : le trajet est recalculé à l'arrivée à l'autre étage
    const L = this.layout;
    if (c.tile < 0) { // position hors grille (réorganisation) : on reprend la case la plus proche
      const col = Math.floor(c.x / TILE), row = Math.floor(c.y / TILE);
      const t = this.idx(col, row);
      if (col >= 0 && row >= 0 && col < L.cols && row < L.rows && L.walkable[t] && (!this.occ[t] || this.occ[t] === c.uid)) { this.occ[t] = c.uid; c.tile = t; }
      else { this.arrive(c, true); return; }
    }
    if (c.next >= 0 && this.occ[c.next] === c.uid && c.next !== c.tile) this.occ[c.next] = 0;
    c.next = -1;
    const sc = c.tile % L.cols, sr = (c.tile - sc) / L.cols;
    let n = 0, tc = c.gTile.col, tr = c.gTile.row;
    // but à un autre étage : d'abord l'ascenseur ou l'escalier de l'étage courant
    const fs = levelOfRow(L, sr), fg = levelOfRow(L, tr);
    c.xfer = 0;
    if (fs !== fg) {
      const lift = this.prefersLift(c);
      const p = L.portals.find((q) => q.level === fs && (q.kind === 'lift') === lift) ?? L.portals.find((q) => q.level === fs);
      if (p) { tc = p.tile.col; tr = p.tile.row; c.xfer = 1; c.xTo = fg; c.xLift = p.kind === 'lift'; }
    }
    this.avoidBuf[0] = c.avoidTile;
    this.pathSearches++;
    n = this.pf.find(sc, sr, tc, tr, this.tmpC, this.tmpR, this.avoidBuf, c.avoidTile >= 0 ? 1 : 0);
    if (n < 0) {
      c.pathFails++;
      if (c.pathFails >= 4) { c.pathFails = 0; c.xfer = 0; this.placeAt(c, c.gx, c.gy); this.arrive(c, true); } // secours exceptionnel (plan modifié)
      else { c.blockT = 0; this.requestLater(c); }
      return;
    }
    c.pathFails = 0;
    let k = 0;
    const tcx = tileCx(sc), tcy = tileCy(sr);
    if (Math.abs(c.x - tcx) + Math.abs(c.y - tcy) > 3 && k < MAX_PATH) { c.pc[k] = sc; c.pr[k] = sr; k++; }
    for (let i = 0; i < n && k < MAX_PATH; i++) { c.pc[k] = this.tmpC[i]; c.pr[k] = this.tmpR[i]; k++; }
    c.pLen = k; c.pIdx = 0; c.ghost = false;
    c.mode = Mode.WALK; c.arrived = false; c.atDesk = false;
  }
  private requestLater(c: Char) { c.blockT = -0.8; c.mode = Mode.STAND; c.pLen = 0; c.pIdx = 0; c.retry = 1; }

  private arrive(c: Char, instant = false) {
    c.pLen = 0; c.pIdx = 0; c.vel = 0; c.arrived = true;
    if (instant) { c.x = c.gx; c.y = c.gy; }
    c.dir = c.gdir;
    c.mode = c.gsit ? Mode.SIT : Mode.STAND;
    c.atDesk = c.goal === G.DESK;
    c.anim = c.ganim;
    if (c.goal === G.EXIT) {
      c.present = false;
      this.release(c);
    }
  }

  // ───────────── mise à jour ─────────────

  update(dt: number, nowMs: number) {
    this.time += dt;
    if (this.lift.moveUntil && this.time >= this.lift.moveUntil) { this.lift.level = this.lift.target; this.lift.moveUntil = 0; }
    let removed = false, idle = false;
    for (let i = 0; i < this.chars.length; i++) {
      const c = this.chars[i];
      c.clock += dt;
      if (c.leaving) {
        c.exitT += dt;
        if (c.placed && c.present && (c.exitT < 50 || c.xfer === 2)) { this.move(c, dt); if (c.mode !== Mode.WALK && c.arrived) c.present = false; continue; }
        c.alpha -= dt * 2.2; if (c.alpha <= 0) { removed = true; this.release(c); this.releaseSpot(c); }
        continue;
      }
      const v = c.extra ? c.vis : selectVisual(c.agent, nowMs, c.vis);
      if (!c.extra) this.directive(c, v);
      else if (c.goal === G.NONE) this.staffTick(c, 0);
      if (!c.placed) {
        if (c.goal === G.NONE || c.goal === G.EXIT) { c.visible = false; continue; }
        if (c.spawnInstant) { this.placeAt(c, c.gx, c.gy); c.needPath = false; this.arrive(c, true); c.alpha = 1; }
        else { this.placeAt(c, tileCx(this.layout.spawn.col), tileCy(this.layout.spawn.row)); c.alpha = 0; this.requestPath(c); }
        c.present = true;
      }
      if (!c.present) {
        if (c.goal !== G.EXIT && c.goal !== G.NONE) { c.present = true; c.placed = false; c.spawnInstant = false; i--; continue; } // retour : entre par la porte
        c.alpha = Math.max(0, c.alpha - dt * 2.5); c.visible = c.alpha > 0.01; continue;
      }
      c.visible = true;
      if (c.goal === G.EXIT && c.arrived) { c.present = false; }
      if (c.alpha < 1 && c.xfer !== 2) c.alpha = Math.min(1, c.alpha + dt * 2.5);
      if (v.ambient) idle = true;
      if (c.retry > 0) { c.retry -= dt; if (c.retry <= 0 && !c.arrived) this.requestPath(c); }
      this.move(c, dt);
      if (c.bubble && this.time > c.bubbleUntil) { c.bubble = ''; c.speaking = false; }
    }
    // recherches de chemin plafonnées par image
    for (let k = 0; k < PATHS_PER_FRAME && this.queue.length; k++) { const c = this.queue.shift()!; if (c.needPath) this.computePath(c); }
    if (this.social) { this.updateConvos(dt); this.encounters(dt); }
    if (this.staffOn && this.hasLoaded) { this.cleanerShift(); this.devShift(); this.courierShift(); this.orchShift(dt); }
    this.hasIdle = idle;
    if (removed) this.chars = this.chars.filter((c) => !(c.leaving && c.alpha <= 0));
  }

  /** Consigne issue de l'état réel ; à défaut (agent libre), la vie sociale décide. */
  private directive(c: Char, v: Visual) {
    let kind: number = G.NONE, anim: Anim = 'stand';
    switch (v.place) {
      case 'none': kind = G.EXIT; break;
      case 'desk': kind = G.DESK; anim = v.pose === 'terminal' ? 'terminal' : v.pose === 'read' ? 'read' : v.pose === 'web' ? 'web' : v.pose === 'alarm' ? 'alarm' : v.pose === 'quota' ? 'quota' : 'type'; break;
      case 'stand': kind = G.STAND; anim = v.pose === 'cheer' ? 'cheer' : 'wait'; break;
      case 'approval': kind = G.APPROVAL; anim = 'hand'; break;
      case 'meeting': kind = G.MEET; anim = v.pose === 'type' ? 'type' : 'sit'; break;
      case 'library': kind = G.SHELF; anim = 'browse'; break;
      default: break;
    }
    if (kind !== G.NONE) {
      // l'état réel l'emporte : fin immédiate de toute activité sociale
      if (!c.real) { this.endConvo(c); this.endActivity(c); c.bubble = ''; }
      if (c.agent.state === 'working') c.afterWork = true;
      c.real = true;
      const key = kind * 64 + ANIM_CODE[anim];
      if (c.goal !== kind || c.goalKey !== key) { c.ganim = anim; this.setGoal(c, kind, key); }
      else if (c.arrived) c.anim = anim;
      if (c.mode !== Mode.WALK || c.arrived) c.ganim = anim;
      return;
    }
    // agent libre
    if (c.real) { // vient de terminer : reste un moment à son poste avant de se lever (départ progressif)
      c.real = false; c.act = 'desk'; c.actPhase = 0; c.actT = (c.afterWork ? 4 : 1) + rnd(c.rng) * (c.afterWork ? 10 : 4); c.ganim = 'sit';
      this.setGoal(c, G.DESK, G.DESK * 64 + ANIM_CODE.sit);
      return;
    }
    if (!this.social) {
      if (c.goal !== G.DESK || c.ganim !== 'sit') { c.ganim = 'sit'; this.setGoal(c, G.DESK, G.DESK * 64 + ANIM_CODE.sit); }
      return;
    }
    this.socialStep(c);
  }

  // ───────────── vie sociale (locale, décorative) ─────────────

  private endActivity(c: Char) {
    if (c.visit) { c.visit = null; }
    c.act = null; c.actPhase = 0; c.actT = 0; c.actHops = 0;
    if (c.goal === G.SPOT || c.goal === G.TILE || c.goal === G.VISIT) this.releaseSpot(c);
  }

  private socialStep(c: Char) {
    // les décisions sont prises par socialTick (minuteries) ; au départ, l'agent est à son poste
    if (!c.convo && !c.act && c.goal === G.NONE) { c.ganim = 'sit'; this.setGoal(c, G.DESK, G.DESK * 64 + ANIM_CODE.sit); }
  }

  /** Minuteries sociales (appelées depuis move pour disposer de dt). */
  private socialTick(c: Char, dt: number) {
    if (c.extra) { this.staffTick(c, dt); return; }
    if (!this.social || c.real || c.convo || c.leaving) return;
    if (!c.act) {
      c.decideT -= this.clock.calm ? dt * 0.45 : dt; // week-end, jour férié : moins d'allées et venues
      if (c.decideT <= 0) this.decide(c);
      return;
    }
    if (c.act === 'visit') {
      const p = c.visit;
      c.visitT += dt;
      if (!p || p.real || p.leaving || !p.present || p.convo || p.xfer === 2 || c.visitT > 25) { this.finishAct(c); return; }
      const dx = p.x - c.x, dy = p.y - c.y;
      if (dx * dx + dy * dy < (TILE * 1.6) ** 2 && (c.mode !== Mode.WALK || c.pIdx >= c.pLen - 1)) {
        if (!this.startConvo(c, p, this.generated(c, p) ?? pickDialogue(CHATS, this.clock, c.rng, this.recentDialogues))) this.finishAct(c);
        return;
      }
      if ((c.arrived || Math.floor(c.visitT * 2) !== Math.floor((c.visitT - dt) * 2)) && c.visitT > 0.4 && (c.arrived || c.visitT % 2 < dt)) this.aimVisit(c, p);
      return;
    }
    if (c.actPhase === 0) { if (c.arrived) { c.actPhase = 1; this.onStayStart(c); } return; }
    c.actT -= dt;
    if (c.actT <= 0) {
      if (c.act === 'wander' && c.actHops > 0) { c.actHops--; this.goStroll(c); return; }
      if (c.act === 'coffee' && c.actHops > 0) { c.actHops = 0; const s = this.freeSpot(['drink'], c); if (s >= 0) { this.goSpot(c, s, 8 + rnd(c.rng) * 12); return; } }
      if (c.act === 'shelf' && c.actHops > 0) { c.actHops = 0; const s = this.freeSpot(['armchair', 'sofa'], c, (sp) => this.layout.rooms[sp.room].kind === 'library'); if (s >= 0) { this.goSpot(c, s, 15 + rnd(c.rng) * 18, 'book'); return; } }
      this.finishAct(c);
    }
  }

  private finishAct(c: Char) {
    this.endActivity(c);
    c.decideT = 0.5 + rnd(c.rng) * 2.5;
  }

  private onStayStart(c: Char) {
    // pensée discrète, rare
    const p = 0.12 + 0.18 * c.pers.sociability;
    if (rnd(c.rng) > p) return;
    const bank = c.act === 'coffee' ? (c.ganim === 'drink' ? null : SOLO.coffee) : c.act === 'outside' ? SOLO.outside : c.act === 'window' ? SOLO.window : c.act === 'shelf' ? SOLO.shelf : c.act === 'sofa' ? SOLO.sofa : c.act === 'water' ? SOLO.water : c.act === 'vending' ? SOLO.vending : null;
    if (bank) this.say(c, bank[Math.floor(rnd(c.rng) * bank.length) % bank.length], 2.6);
  }

  private say(c: Char, text: string, dur: number) { c.bubble = text; c.bubbleUntil = this.time + dur; }

  private decide(c: Char) {
    const w = activityWeights(c.pers, this.clock, c.lastAct, c.afterWork);
    c.afterWork = false;
    let act = pickWeighted(w, c.rng);
    for (let tries = 0; tries < 4; tries++) {
      if (this.begin(c, act)) { c.lastAct = act; return; }
      act = tries < 2 ? pickWeighted(w, c.rng) : 'desk';
    }
    this.begin(c, 'desk'); c.lastAct = 'desk';
  }

  private begin(c: Char, act: Activity): boolean {
    c.act = act; c.actPhase = 0; c.actHops = 0; c.visitT = 0;
    switch (act) {
      case 'desk': {
        if (!this.layout.deskByAgent.get(c.id)) return false;
        c.actT = (20 + rnd(c.rng) * 60) * (0.6 + c.pers.focus); c.ganim = 'sit';
        this.setGoal(c, G.DESK, G.DESK * 64 + ANIM_CODE.sit);
        return true;
      }
      case 'coffee': case 'water': case 'vending': {
        const s = this.freeSpot([act], c); if (s < 0) return false;
        c.actHops = act === 'coffee' && rnd(c.rng) < 0.55 ? 1 : 0;
        this.goSpot(c, s, act === 'coffee' ? 4 + rnd(c.rng) * 3 : 2.5 + rnd(c.rng) * 2);
        return true;
      }
      case 'sofa': {
        const s = this.freeSpot(['sofa', 'armchair', 'bench'], c, (sp) => { const k = this.layout.rooms[sp.room].kind; return k === 'break' || k === 'lobby' || k === 'nook' || (k === 'department' && this.layout.rooms[sp.room].dept === c.agent.department); });
        if (s < 0) return false;
        this.goSpot(c, s, 15 + rnd(c.rng) * 30);
        return true;
      }
      case 'shelf': {
        const s = this.freeSpot(['shelf'], c); if (s < 0) return false;
        c.actHops = rnd(c.rng) < 0.4 ? 1 : 0;
        this.goSpot(c, s, 6 + rnd(c.rng) * 8);
        return true;
      }
      case 'window': {
        const s = this.freeSpot(['window'], c); if (s < 0) return false;
        this.goSpot(c, s, 8 + rnd(c.rng) * 12);
        return true;
      }
      case 'wander': {
        if (!this.layout.strollTiles.length) return false;
        c.actHops = Math.floor(rnd(c.rng) * 3);
        this.goStroll(c);
        return true;
      }
      case 'outside': {
        const T = this.plaza().filter((t) => !this.occ[this.idx(t.col, t.row)]);
        if (!T.length) return false;
        const t = T[Math.floor(rnd(c.rng) * T.length) % T.length], i = this.idx(t.col, t.row);
        this.releaseSpot(c);
        c.actPhase = 0; c.actT = 15 + rnd(c.rng) * 25; c.ganim = 'stand';
        c.goal = G.TILE; c.goalKey = 250000 + i; c.arrived = false; c.atDesk = false;
        c.gTile = t; c.gx = tileCx(t.col); c.gy = tileCy(t.row); c.gdir = Dir.DOWN; c.gsit = false;
        this.requestPath(c);
        return true;
      }
      case 'visit': {
        if (this.convos.length >= this.convoCap()) return false;
        const p = this.partnerFor(c); if (!p) return false;
        c.visit = p; this.aimVisit(c, p);
        return true;
      }
    }
    return false;
  }

  private goSpot(c: Char, si: number, stay: number, anim?: Anim) {
    this.releaseSpot(c);
    const s = this.layout.spots[si];
    c.actPhase = 0; c.actT = stay; c.ganim = anim ?? SPOT_ANIM[s.kind] ?? 'stand';
    c.goal = G.SPOT; c.goalKey = 100000 + si; c.arrived = false; c.atDesk = false;
    this.takeSpot(c, si);
    this.requestPath(c);
  }
  private goStroll(c: Char) {
    const T = this.layout.strollTiles;
    let pick: Tile | null = null, bs = 1e18;
    for (let k = 0; k < 6 && T.length; k++) { // meilleur de quelques tirages : plutôt à proximité
      const t = T[Math.floor(rnd(c.rng) * T.length) % T.length];
      if (this.occ[this.idx(t.col, t.row)]) continue;
      const sc = this.reach(c, t.col * TILE, t.row * TILE) + rnd(c.rng) * 500;
      if (sc < bs) { bs = sc; pick = t; }
    }
    if (!pick) { this.finishAct(c); return; }
    const t = pick, i = this.idx(t.col, t.row);
    this.releaseSpot(c);
    c.actPhase = 0; c.actT = 1.5 + rnd(c.rng) * 3; c.ganim = 'stand';
    c.goal = G.TILE; c.goalKey = 200000 + i; c.arrived = false; c.atDesk = false;
    c.gTile = t; c.gx = tileCx(t.col); c.gy = tileCy(t.row); c.gdir = Math.floor(rnd(c.rng) * 4); c.gsit = false;
    this.requestPath(c);
  }
  private aimVisit(c: Char, p: Char) {
    // case libre voisine de l'interlocuteur
    const L = this.layout;
    const pc = Math.floor(p.x / TILE), pr = Math.floor(p.y / TILE);
    let best: Tile | null = null, bd = 1e9;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (!dx && !dy) continue;
      const col = pc + dx, row = pr + dy;
      if (col < 0 || row < 0 || col >= L.cols || row >= L.rows) continue;
      const i = this.idx(col, row);
      if (!L.walkable[i] || (this.occ[i] && this.occ[i] !== c.uid) || L.cost[i] > 3) continue;
      const rk = L.roomAt[i] >= 0 ? L.rooms[L.roomAt[i]].kind : 'corridor';
      if (rk === 'meeting' || rk === 'approval' || rk === 'server' || rk === 'control') continue;
      const d = Math.abs(dx) + Math.abs(dy) + (Math.abs(col * TILE - c.x) + Math.abs(row * TILE - c.y)) / 400;
      if (d < bd) { bd = d; best = { col, row }; }
    }
    if (!best) { this.finishAct(c); return; }
    c.goal = G.VISIT; c.goalKey = 300000 + this.idx(best.col, best.row); c.arrived = false; c.atDesk = false;
    c.gTile = best; c.gx = tileCx(best.col); c.gy = tileCy(best.row); c.gdir = Math.abs(p.x - c.gx) > Math.abs(p.y - c.gy) ? (p.x > c.gx ? Dir.RIGHT : Dir.LEFT) : (p.y > c.gy ? Dir.DOWN : Dir.UP); c.gsit = false; c.ganim = 'stand';
    this.requestPath(c);
  }
  /** En pause à un endroit commun (café, fontaine, distributeur, parvis, canapé), arrivé sur place. */
  private resting(c: Char): boolean { return !!c.act && c.arrived && c.actPhase === 1 && (c.act === 'coffee' || c.act === 'water' || c.act === 'vending' || c.act === 'outside' || c.act === 'sofa'); }
  private available(p: Char): boolean { return !p.extra && p.present && p.placed && !p.leaving && !p.real && !p.convo && p.visible && !p.visit && p.xfer !== 2; }
  /** On ne s'arrête pas pour bavarder dans un passage étroit (couloir vertical, porte). */
  private roomy(c: Char): boolean {
    const L = this.layout, i = this.idx(Math.floor(c.x / TILE), Math.floor(c.y / TILE));
    if (i >= 0 && i < L.tiles.length && L.tiles[i] === 6) return true; // parvis : on peut y bavarder
    if (i < 0 || i >= L.tiles.length || L.tiles[i] !== 2) return false;
    const r = L.roomAt[i];
    return r < 0 ? false : L.rooms[r].band !== 'V';
  }
  private partnerFor(c: Char): Char | null {
    let best: Char | null = null, bs = -1;
    for (const p of this.chars) {
      if (p === c || !this.available(p)) continue;
      if ((this.pairCool.get(this.pairKey(c, p)) ?? 0) > this.time) continue;
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      const s = (p.pers.sociability + 0.3) / (1 + d / 200) + rnd(c.rng) * 0.3;
      if (s > bs) { bs = s; best = p; }
    }
    return best;
  }
  private pairKey(a: Char, b: Char) { return a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`; }
  private convoCap() { return Math.min(MAX_CONVOS, Math.max(1, Math.floor(this.chars.length / 3))); }

  /** Publication qui vient d'apparaître sur le fil interne : l'auteur le dit (s'il est libre et visible, vie sociale active). */
  announce(agentId: string, text: string) {
    const c = this.byId.get(agentId);
    if (!c || !this.social || c.real || c.convo || !c.visible || c.bubble) return;
    this.say(c, text, 3);
  }
  // ───────────── dialogues générés (vie intérieure : 1 appel Haiku par jour, faits réels) ─────────────
  private gen: { a: string; b: string; lines: string[]; key: string }[] = [];
  private genUsed = new Set<string>();
  /** Banque du jour générée par le serveur : chaque dialogue sert une fois (puis retour à la banque locale). */
  setGeneratedDialogues(list: readonly { a: string; b: string; lines: readonly string[] }[], day: string | null) {
    this.gen = list.map((d, i) => ({ a: d.a, b: d.b, lines: d.lines.slice(0, 4), key: `${day ?? ''}:${i}` }));
  }
  /** Dialogue généré pour ce duo (dans un sens ou l'autre), répliques réattribuées au bon interlocuteur. */
  private generated(a: Char, b: Char): Dialogue | null {
    if (a.extra || b.extra) return null;
    const g = this.gen.find((d) => !this.genUsed.has(d.key) && ((d.a === a.id && d.b === b.id) || (d.a === b.id && d.b === a.id)));
    if (!g) return null;
    this.genUsed.add(g.key);
    const first: 0 | 1 = g.a === a.id ? 0 : 1;
    return { id: `gen:${g.key}`, when: () => true, lines: g.lines.map((text, i) => ({ s: ((i % 2 === 0 ? first : 1 - first) as 0 | 1), text: text.length > 44 ? text.slice(0, 43) + '…' : text })) };
  }
  private startConvo(a: Char, b: Char, dlg: Dialogue): boolean {
    if (a.convo || b.convo || a.real || b.real || this.convos.length >= this.convoCap()) return false;
    const cv: Convo = { a, b, lines: dlg.lines, i: -1, t: 0.25, id: dlg.id };
    this.convos.push(cv);
    a.convo = cv; b.convo = cv;
    for (const c of [a, b]) {
      c.paused = true;
      if (c.mode === Mode.WALK) { c.mode = Mode.STAND; c.anim = 'stand'; c.vel = 0; }
    }
    this.face(a, b); this.face(b, a);
    this.recentDialogues.push(dlg.id); if (this.recentDialogues.length > 14) this.recentDialogues.shift();
    this.pairCool.set(this.pairKey(a, b), this.time + 90 + rnd(this.worldRng) * 60);
    return true;
  }
  private face(c: Char, o: Char) {
    if (c.mode === Mode.SIT) return;
    const dx = o.x - c.x, dy = o.y - c.y;
    c.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? Dir.RIGHT : Dir.LEFT) : (dy > 0 ? Dir.DOWN : Dir.UP);
  }
  private endConvo(c: Char) {
    const cv = c.convo; if (!cv) return;
    this.convos = this.convos.filter((x) => x !== cv);
    for (const p of [cv.a, cv.b]) {
      p.convo = null; p.paused = false; p.speaking = false;
      if (p !== c && p.bubble) p.bubbleUntil = Math.min(p.bubbleUntil, this.time + 0.6);
      if (p.mode === Mode.STAND && p.pIdx < p.pLen) p.mode = Mode.WALK;
      if (p.act === 'visit') this.finishAct(p);
    }
    if (c.bubble) c.bubble = '';
  }
  private updateConvos(dt: number) {
    for (let k = this.convos.length - 1; k >= 0; k--) {
      const cv = this.convos[k];
      cv.t -= dt;
      if (cv.t > 0) continue;
      cv.i++;
      if (cv.i >= cv.lines.length) { const a = cv.a; this.endConvo(a); a.bubble = ''; continue; }
      const ln = cv.lines[cv.i], sp = ln.s === 0 ? cv.a : cv.b, other = ln.s === 0 ? cv.b : cv.a;
      const dur = lineDuration(ln.text);
      this.say(sp, ln.text, dur); sp.speaking = true; other.speaking = false;
      this.face(sp, other); this.face(other, sp);
      cv.t = dur + 0.25;
    }
  }
  /** Rencontres fortuites : deux agents libres qui se croisent peuvent se saluer (recharge par paire). */
  private encounters(dt: number) {
    this.encounterT -= dt;
    if (this.encounterT > 0) return;
    this.encounterT = 0.3;
    const cs = this.chars, R2 = (TILE * 1.7) ** 2;
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i];
      const aRest = this.resting(a);
      if (!this.available(a) || (a.mode !== Mode.WALK && !aRest) || !this.roomy(a)) continue;
      for (let j = 0; j < cs.length; j++) {
        if (i === j) continue;
        const b = cs[j];
        const bRest = aRest && this.resting(b);
        if (!this.available(b) || (b.mode === Mode.SIT && !bRest) || !this.roomy(b)) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        if (dx * dx + dy * dy > (bRest ? R2 * 2.2 : R2)) continue; // à la pause (café, fontaine, parvis, canapé) : on discute avec ses voisins
        const key = this.pairKey(a, b);
        if ((this.pairCool.get(key) ?? 0) > this.time) continue;
        this.pairCool.set(key, this.time + 25); // déjà « vus » : pas de nouvelle tentative avant un moment
        const soc = (a.pers.sociability + b.pers.sociability) / 2;
        if (rnd(this.worldRng) > 0.25 + 0.55 * soc) continue;
        const long = rnd(this.worldRng) < soc * 0.45;
        this.startConvo(a, b, (long ? this.generated(a, b) : null) ?? pickDialogue(long ? CHATS : GREETINGS, this.clock, this.worldRng, this.recentDialogues));
        break;
      }
    }
  }

  // ───────────── déplacement ─────────────

  private move(c: Char, dt: number) {
    if (!c.leaving) this.socialTick(c, dt);
    if (c.xfer === 2) { this.transitTick(c, dt); return; }
    if (c.paused || c.needPath) return;
    if (c.mode !== Mode.WALK) return;
    const L = this.layout;
    if (c.pIdx < c.pLen) {
      const n = this.idx(c.pc[c.pIdx], c.pr[c.pIdx]);
      if (c.next !== n && n !== c.tile) {
        const o = this.occ[n];
        if (o && o !== c.uid && !c.ghost) { this.blocked(c, o, n, dt); return; }
        if (!o || o === c.uid) this.occ[n] = c.uid;
        c.next = n;
      }
      c.blockT = 0; c.repathTried = false; c.stuckT = 0;
      const tx = tileCx(c.pc[c.pIdx]), ty = tileCy(c.pr[c.pIdx]);
      if (this.step(c, tx, ty, dt, c.pLen - c.pIdx)) {
        if (c.tile >= 0 && c.tile !== n && this.occ[c.tile] === c.uid) this.occ[c.tile] = 0;
        c.tile = n; c.next = -1; c.pIdx++;
        if (c.ghost && (c.ghostT -= 0.25) <= 0) c.ghost = false;
        if (c.pIdx >= c.pLen && c.afterSide) { c.afterSide = false; this.requestPath(c); }
      }
      return;
    }
    // au pied de l'escalier ou devant l'ascenseur : changement d'étage
    if (c.xfer === 1) { this.startTransit(c); return; }
    // approche finale (siège, fauteuil, place devant une machine) : petit glissement hors grille
    if (this.step(c, c.gx, c.gy, dt, 0)) this.arrive(c);
    void L;
  }

  // ───────────── changement d'étage (ascenseur, escalier) ─────────────

  /** Ascenseur ou escalier : le technicien prend l'escalier, l'agent d'entretien l'ascenseur (chariot), les agents
   * alternent de façon déterministe (environ deux trajets sur cinq en ascenseur). */
  private prefersLift(c: Char): boolean {
    if (c.extra === 'tech') return false;
    if (c.extra === 'cleaner') return true;
    return (c.uid * 7 + c.xTrips) % 5 < 2;
  }
  private startTransit(c: Char) {
    const L = this.layout, fs = levelOfY(L, c.y);
    const from = L.portals.find((q) => q.level === fs && (q.kind === 'lift') === c.xLift);
    const to = L.portals.find((q) => q.level === c.xTo && (q.kind === 'lift') === c.xLift);
    if (!from || !to) { c.xfer = 0; this.requestPath(c); return; }
    this.release(c);
    c.xfer = 2; c.xT = 0; c.xPh = 0; c.xFrom = from; c.xDest = to; c.xTrips++;
    c.mode = Mode.WALK; c.vel = 0; c.pLen = 0; c.pIdx = 0;
    c.x = tileCx(from.tile.col); c.y = tileCy(from.tile.row);
    if (c.xLift) this.callLift(fs);
  }
  private callLift(level: number) {
    if (this.lift.moveUntil) return; // déjà en mouvement : on l'appellera à son arrivée
    if (this.lift.level === level) return;
    this.lift.target = level; this.lift.moveUntil = this.time + LIFT_TRAVEL;
  }
  /** Déroulé : ascenseur = attente de la cabine, entrée (portes ouvertes), trajet, sortie ; escalier = montée, palier, descente.
   * Le personnage s'efface en entrant et réapparaît à l'autre étage. */
  private transitTick(c: Char, dt: number) {
    const from = c.xFrom!, to = c.xDest!, lift = this.lift;
    c.xT += dt;
    const towards = (x0: number, y0: number, x1: number, y1: number, p: number) => {
      const q = Math.max(0, Math.min(1, p)), nx = x0 + (x1 - x0) * q, ny = y0 + (y1 - y0) * q;
      c.phase += Math.hypot(nx - c.x, ny - c.y) * STRIDE; c.x = nx; c.y = ny;
    };
    const tx0 = tileCx(from.tile.col), ty0 = tileCy(from.tile.row), tx1 = tileCx(to.tile.col), ty1 = tileCy(to.tile.row);
    if (c.xLift) {
      switch (c.xPh) {
        case 0: // attente de la cabine, face aux portes
          c.anim = 'stand'; c.dir = Dir.UP; c.vel = 0;
          if (lift.level === from.level && !lift.moveUntil) { c.xPh = 1; c.xT = 0; lift.open[from.level] = this.time + LIFT_DOOR + 0.8; }
          else if (!lift.moveUntil) this.callLift(from.level);
          else if (c.xT > 12) { lift.level = from.level; lift.moveUntil = 0; } // secours : jamais d'attente sans fin
          return;
        case 1: // entrée dans la cabine
          c.anim = 'walk'; c.dir = Dir.UP;
          towards(tx0, ty0, from.x, from.y, c.xT / LIFT_DOOR); c.alpha = Math.max(0, 1 - c.xT / LIFT_DOOR);
          if (c.xT >= LIFT_DOOR) { c.xPh = 2; c.xT = 0; c.alpha = 0; if (!lift.moveUntil) { lift.target = to.level; lift.moveUntil = this.time + LIFT_TRAVEL; } }
          return;
        case 2: // trajet (invisible)
          if (((lift.level === to.level && !lift.moveUntil) || c.xT > LIFT_TRAVEL * 3) && this.exitFree(to, c.xT > LIFT_TRAVEL * 3 + 6, c)) {
            lift.level = to.level; lift.moveUntil = 0; lift.open[to.level] = this.time + LIFT_DOOR + 0.8;
            c.xPh = 3; c.xT = 0; c.x = to.x; c.y = to.y; c.dir = Dir.DOWN;
          } else if (!lift.moveUntil) { lift.target = to.level; lift.moveUntil = this.time + LIFT_TRAVEL; }
          return;
        default: // sortie
          c.anim = 'walk'; c.dir = Dir.DOWN;
          towards(to.x, to.y, tx1, ty1, c.xT / LIFT_DOOR); c.alpha = Math.min(1, c.xT / LIFT_DOOR);
          if (c.xT >= LIFT_DOOR) this.endTransit(c);
          return;
      }
    }
    switch (c.xPh) {
      case 0: // montée (ou descente) des marches
        c.anim = 'walk'; c.dir = Dir.UP;
        towards(tx0, ty0, from.x, from.y, c.xT / STAIRS_CLIMB); c.alpha = Math.max(0, Math.min(1, 1.6 - 1.6 * c.xT / STAIRS_CLIMB));
        if (c.xT >= STAIRS_CLIMB) { c.xPh = 1; c.xT = 0; c.alpha = 0; }
        return;
      case 1: // entre deux étages
        if (c.xT >= STAIRS_GAP && this.exitFree(to, c.xT > STAIRS_GAP + 6, c)) { c.xPh = 2; c.xT = 0; c.x = to.x; c.y = to.y; }
        return;
      default: // arrivée par l'escalier de l'autre étage
        c.anim = 'walk'; c.dir = Dir.DOWN;
        towards(to.x, to.y, tx1, ty1, c.xT / STAIRS_CLIMB); c.alpha = Math.min(1, 1.6 * c.xT / STAIRS_CLIMB);
        if (c.xT >= STAIRS_CLIMB) this.endTransit(c);
    }
  }
  /** Case d'arrivée libre (sinon on patiente, invisible, au lieu d'apparaître une case plus loin) ; `force` : délai dépassé. */
  private exitFree(to: Portal, force: boolean, c?: Char): boolean {
    const i = this.idx(to.tile.col, to.tile.row), o = this.occ[i];
    if (o && (!c || o !== c.uid) && !force) return false;
    if (c && !o) { this.occ[i] = c.uid; c.tile = i; }
    return true;
  }
  private endTransit(c: Char) {
    const to = c.xDest!;
    c.xfer = 0; c.xFrom = null; c.xDest = null; c.alpha = 1; c.vel = 0;
    this.placeNear(c, to.tile.col, to.tile.row);
    this.requestPath(c);
  }
  /** Place sur la case voulue, ou la plus proche case libre (quelqu'un attend peut-être l'ascenseur). */
  private placeNear(c: Char, col: number, row: number) {
    const L = this.layout;
    for (let rad = 0; rad <= 2; rad++) for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
      const cc = col + dx, rr = row + dy, i = this.idx(cc, rr);
      if (cc < 0 || rr < 0 || cc >= L.cols || rr >= L.rows || !L.walkable[i] || (this.occ[i] && this.occ[i] !== c.uid) || levelOfRow(L, rr) !== levelOfRow(L, row)) continue;
      this.placeAt(c, tileCx(cc), tileCy(rr));
      return;
    }
    this.placeAt(c, tileCx(col), tileCy(row));
  }

  /** Avance vers (tx,ty) ; vrai à l'arrivée. */
  private step(c: Char, tx: number, ty: number, dt: number, remaining: number): boolean {
    const dx = tx - c.x, dy = ty - c.y;
    const dist = Math.hypot(dx, dy);
    const want = WALK_SPEED * (remaining <= 1 ? Math.max(0.45, Math.min(1, dist / 14 + 0.3)) : 1) * (0.92 + 0.16 * c.pers.energy);
    c.vel += (want - c.vel) * Math.min(1, dt * 8);
    const s = c.vel * dt;
    c.phase += s * STRIDE;
    if (dist > 0.01) c.dir = Math.abs(dx) >= Math.abs(dy) * 0.9 ? (dx > 0 ? Dir.RIGHT : Dir.LEFT) : (dy > 0 ? Dir.DOWN : Dir.UP);
    c.anim = 'walk';
    if (dist <= s) { c.x = tx; c.y = ty; return true; }
    c.x += (dx / dist) * s; c.y += (dy / dist) * s;
    return false;
  }

  private priority(c: Char): number { return (c.real ? 2 : 0) + (c.leaving ? 3 : 0); }

  /** Case suivante occupée : attendre, contourner, céder le passage (se décaler), en dernier recours passer. */
  private blocked(c: Char, o: number, n: number, dt: number) {
    c.blockT += dt; c.stuckT += dt;
    c.vel *= 0.7;
    c.anim = 'stand'; // à l'arrêt, en attente
    let other: Char | null = null;
    for (const p of this.chars) if (p.uid === o) { other = p; break; }
    const stationary = !other || other.mode !== Mode.WALK || other.paused || other.blockT > 0.25;
    const headOn = !!other && other.pIdx < other.pLen && this.idx(other.pc[other.pIdx], other.pr[other.pIdx]) === c.tile;
    // arrivée : la destination est prise par quelqu'un d'immobile (promenade) => on s'arrête là
    if (stationary && c.pIdx === c.pLen - 1 && (c.goal === G.TILE || c.goal === G.VISIT) && c.blockT > 0.3) { c.gx = c.x; c.gy = c.y; c.pIdx = c.pLen; return; }
    if (!c.repathTried && c.blockT > (stationary ? 0.35 : 1.1)) { c.repathTried = true; this.requestPath(c, n); return; }
    if (c.blockT > 2.2 && !c.afterSide && other && (headOn || stationary) && (this.priority(c) < this.priority(other) || (this.priority(c) === this.priority(other) && c.uid < other.uid) || c.blockT > 4)) {
      // céder : se décaler sur une case libre perpendiculaire, puis repartir
      const L = this.layout, cc = c.tile % L.cols, cr = (c.tile - cc) / L.cols;
      const opts = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1], [-1, 1], [1, -1]];
      for (const [dx, dy] of opts) {
        const col = cc + dx, row = cr + dy, i = this.idx(col, row);
        if (col < 0 || row < 0 || col >= L.cols || row >= L.rows || i === n || !L.walkable[i] || this.occ[i]) continue;
        if (dx && dy && (!L.walkable[this.idx(cc + dx, cr)] || !L.walkable[this.idx(cc, cr + dy)])) continue;
        c.pc[0] = col; c.pr[0] = row; c.pLen = 1; c.pIdx = 0; c.afterSide = true; c.blockT = 0; c.repathTried = false;
        return;
      }
    }
    if (c.blockT > 4.5 && c.repathTried) { c.repathTried = false; c.blockT = 1.2; }
    if (c.stuckT > 6) { c.ghost = true; c.ghostT = 1; c.stuckT = 0; } // ultime recours après une longue attente : on se croise
  }

  // ───────────── personnel figurant (non piloté par l'IA) ─────────────

  setStaffInfo(info: StaffInfo) { this.staffInfo = info; }

  // ───────────── sessions Claude Code qui développent RO·AI (données réelles du hook local) ─────────────

  private devList: DevSession[] = [];
  /** 0 : jamais reçu ; 1 : première liste reçue (placement direct, page ouverte en cours de session) ; 2 : suivi normal. */
  private devStage = 0;
  // ───────────── livraisons réelles (camionnette, livreur, accueil) ─────────────

  private couriers: { at: number; seq: number; source: string; agent: string | null }[] = [];
  private receptionFront: Tile | null | undefined;
  /** Livraison réelle reçue : un livreur descend de la camionnette (≈ 4 s), apporte le colis à l'accueil et repart. */
  deliver(seq: number, source: string, agentName: string | null) {
    if (!this.staffOn || this.couriers.length > 3) return;
    this.couriers.push({ at: this.time + 4, seq, source, agent: agentName });
  }
  private errands: { tile: Tile; dir: number; anim: Anim; line: string }[] | undefined;
  /** Petites tâches de la réceptionniste dans le hall (décor, sans IA) : une case libre devant chaque meuble, tournée vers lui. */
  private receptionErrands(): { tile: Tile; dir: number; anim: Anim; line: string }[] {
    if (this.errands) return this.errands;
    const L = this.layout, post = L.staff.reception, out: { tile: Tile; dir: number; anim: Anim; line: string }[] = [];
    if (post) {
      const room = L.roomAt[this.idx(post.tile.col, post.tile.row)];
      const KIND: Record<string, { anim: Anim; lines: string[] }> = {
        plant: { anim: 'use', lines: ['Un peu d’eau pour les plantes.', 'Elle a soif, celle-là.'] },
        plant_tall: { anim: 'use', lines: ['Un peu d’eau pour les plantes.', 'Je tourne le pot vers la lumière.'] },
        kiosk: { anim: 'look', lines: ['Petit coup d’œil à la borne.', 'La borne est à jour.'] },
        mailbox: { anim: 'look', lines: ['Je jette un œil à la boîte aux lettres.'] },
        water_cooler: { anim: 'drink', lines: ['Une petite pause eau.', 'Un verre d’eau et je reviens.'] },
        coffee_table: { anim: 'stand', lines: ['Je range les magazines.', 'Un peu de rangement.'] },
      };
      // dir : 0 bas, 1 haut, 2 droite, 3 gauche (face au meuble)
      const sides: [number, number, number][] = [[0, 1, 1], [0, -1, 0], [-1, 0, 2], [1, 0, 3]];
      for (const f of L.furniture) {
        const k = KIND[f.kind]; if (!k || L.roomAt[this.idx(f.col, f.row)] !== room) continue;
        let found: { tile: Tile; dir: number } | null = null;
        for (const [dx, dy, dir] of sides) {
          for (let i = 0; i < Math.max(f.w, f.h) && !found; i++) {
            const col = dx ? (dx > 0 ? f.col + f.w : f.col - 1) : f.col + Math.min(i, f.w - 1), row = dy ? (dy > 0 ? f.row + f.h : f.row - 1) : f.row + Math.min(i, f.h - 1);
            if (col < 0 || row < 0 || col >= L.cols || row >= L.rows || !L.walkable[row * L.cols + col] || L.roomAt[this.idx(col, row)] !== room) continue;
            found = { tile: { col, row }, dir };
          }
          if (found) break;
        }
        if (found) out.push({ ...found, anim: k.anim, line: k.lines[(f.col + f.row) % k.lines.length] });
      }
    }
    this.errands = out;
    return out;
  }
  private frontOfReception(): Tile | null {
    if (this.receptionFront !== undefined) return this.receptionFront;
    const L = this.layout, f = L.furniture.find((q) => q.kind === 'reception');
    let best: Tile | null = null;
    if (f) for (let k = 0; k < f.w && !best; k++) {
      const col = f.col + ((Math.floor(f.w / 2) + k) % f.w), row = f.row + f.h;
      if (row < L.rows && L.walkable[row * L.cols + col]) best = { col, row };
    }
    this.receptionFront = best;
    return best;
  }
  private courierShift() {
    for (let k = this.couriers.length - 1; k >= 0; k--) {
      const d = this.couriers[k];
      if (this.time < d.at) continue;
      this.couriers.splice(k, 1);
      const id = STAFF_IDS.courier + d.seq;
      if (this.byId.has(id) || !this.frontOfReception()) continue;
      this.addStaff('courier', false, id, `Livreur · ${d.source}`);
      const c = this.byId.get(id)!; c.staffIdx = 0; c.staffAlert = d.agent ?? ''; c.dev = null;
    }
  }
  private courierTick(c: Char, dt: number) {
    const t = this.frontOfReception();
    if (!t) return;
    if (c.staffIdx === 0) {
      this.goStaff(c, t, Dir.UP, 'stand', 580000);
      if (!c.arrived) return;
      c.staffIdx = 1; c.actT = 2.5;
      const rec = this.byId.get(STAFF_IDS.reception), src = c.agent.name.replace(/^Livreur · /, '');
      const who = c.staffAlert ? (c.staffAlert.length > 14 ? c.staffAlert.slice(0, 13) + '…' : c.staffAlert) : '';
      if (this.social && rec && rec.present) this.say(rec, who ? `Colis de ${src.slice(0, 14)} pour ${who} !` : `Colis de ${src.slice(0, 20)} !`, 3.8);
      if (this.social) this.say(c, 'Bonjour, une livraison !', 2.4);
    } else if (c.staffIdx === 1) {
      c.actT -= dt;
      if (c.actT > 0) return;
      c.staffIdx = 2; c.leaving = true; c.exitT = 0; this.byId.delete(c.id); this.setGoal(c, G.EXIT, 9999);
    }
  }

  setDevTeam(list: readonly DevSession[]) { this.devList = list.slice(); if (this.devStage === 0) this.devStage = 1; }
  /** Une session active = un technicien Claude Code qui entre par l'accueil, travaille en salle serveur, puis repart. */
  private devShift() {
    if (this.devStage === 0) return;
    const instant = this.devStage === 1; this.devStage = 2;
    const want = new Map<string, DevSession>();
    for (const d of this.devList) if (d.present) want.set(devCharId(d.id), d);
    for (const [id, d] of want) {
      let c = this.byId.get(id);
      if (!c) {
        const used = new Set(this.chars.filter((x) => x.extra === 'dev' && !x.leaving).map((x) => x.devSlot));
        let slot = 0; while (used.has(slot)) slot++;
        this.addStaff('dev', instant, id, d.label);
        c = this.byId.get(id)!; c.devSlot = slot; c.staffT = 0;
      }
      c.dev = d; c.agent.name = d.label;
      c.agent.state = d.state === 'working' ? 'working' : d.state === 'waiting' ? 'waiting' : 'idle';
    }
    for (const c of this.chars) {
      if (c.extra !== 'dev' || c.leaving || want.has(c.id)) continue;
      c.leaving = true; c.exitT = 0; c.bubble = ''; this.byId.delete(c.id);
      if (!c.placed) c.alpha = 0; else this.setGoal(c, G.EXIT, 9999);
    }
  }
  private devTick(c: Char, dt: number) {
    const L = this.layout, d = c.dev, fronts = L.staff.rackFronts;
    c.staffT -= dt;
    if (!d) return;
    // une baie par session, en partant du fond de la salle (le technicien figurant garde les premières)
    const fr = fronts.length ? fronts[(((fronts.length - 1 - c.devSlot * 2) % fronts.length) + fronts.length) % fronts.length] : null;
    const spot = fr ? { tile: fr.tile, dir: fr.dir, furn: fr.furn } : L.staff.tech ? { tile: L.staff.tech.tile, dir: L.staff.tech.dir, furn: 99 } : null;
    if (!spot) return;
    if (d.state === 'waiting') this.goStaff(c, spot.tile, Dir.DOWN, 'hand', 560000 + spot.furn); // il se retourne et lève la main : il t'attend
    else if (d.state === 'working') this.goStaff(c, spot.tile, spot.dir, 'use', 550000 + spot.furn);
    else this.goStaff(c, spot.tile, Dir.DOWN, 'stand', 570000 + spot.furn);
    if (!this.social || !c.arrived) return;
    const last = d.actions[d.actions.length - 1];
    const key = `${d.state}|${last ? last.at + last.kind + last.target : ''}`;
    if (key === c.staffAlert) return;
    c.staffAlert = key;
    const text = d.state === 'waiting' ? DEV_WAIT_BUBBLE : last ? devBubble(last) : null;
    const notable = d.state === 'waiting' || (!!last && last.kind !== 'write');
    if (text && (notable || c.staffT <= 0)) { this.say(c, text, 3.6); c.staffT = 12; } // pas plus d'une bulle « je modifie… » toutes les 12 s
  }

  private ensureStaff(instant: boolean) {
    const L = this.layout;
    if (L.staff.reception && !this.byId.has(STAFF_IDS.reception)) this.addStaff('reception', instant);
    if (L.staff.tech && !this.byId.has(STAFF_IDS.tech)) this.addStaff('tech', instant);
  }
  private addStaff(k: ExtraKind, instant: boolean, idOverride?: string, name?: string) {
    const id = idOverride ?? STAFF_IDS[k];
    const agent: OfficeAgentModel = { id, name: name ?? STAFF_LABEL[k], department: '', sprite: 0, state: 'idle', waitKind: null, activity: null, toolKind: null, runId: null, errorClass: null, since: '', effects: [], origin: { seq: 0, type: 'staff', run_id: null, ts: '' } };
    const c = this.makeChar(agent);
    c.extra = k; c.spawnInstant = instant; c.pers = { ...DEFAULT_PERSONALITY, energy: 0.3 };
    this.byId.set(id, c); this.chars.push(c);
  }
  /** Agent d'entretien : présent en soirée (heure de Paris) si la vie sociale est active ; entre et sort par l'entrée. */
  private cleanerShift() {
    const evening = this.social && !this.clock.calm && this.clock.hour >= 19 && this.clock.hour < 23; // pas de ménage le week-end
    const c = this.byId.get(STAFF_IDS.cleaner);
    if (evening && !c) this.addStaff('cleaner', false);
    else if (!evening && c && !c.leaving) { c.leaving = true; c.exitT = 0; c.bubble = ''; this.byId.delete(c.id); if (!c.placed) c.alpha = 0; else this.setGoal(c, G.EXIT, 9999); }
  }

  // ───────────── orchestrateur : sorties de la régie ─────────────

  setOrchSignals(s: OrchSignals) { this.orchSig = s; }
  /** Une exécution vient d'être lancée pour cet agent (événement réel) : l'orchestrateur ira le voir après l'envoi de la fiche. */
  orchVisit(agentId: string) {
    if (!this.layout.deskByAgent.has(agentId)) return;
    this.orchVisits.push({ agentId, at: this.time + 1.6 });
    if (this.orchVisits.length > 2) this.orchVisits.shift();
  }
  /** Vrai quand l'orchestrateur n'est pas à sa régie (le dessin fixe est alors masqué, le personnage marche). */
  orchAway(): boolean { const c = this.byId.get(STAFF_IDS.orch); return !!c && c.placed && c.visible && !c.leaving; }
  /** Case libre la plus proche de (col,row), sur le même étage. */
  private freeNear(col: number, row: number): Tile | null {
    const L = this.layout, lv = levelOfRow(L, row);
    for (let r = 0; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const cc = col + dx, rr = row + dy;
      if (cc < 0 || rr < 0 || cc >= L.cols || rr >= L.rows || levelOfRow(L, rr) !== lv) continue;
      const i = this.idx(cc, rr);
      if (L.walkable[i] && !this.occ[i] && L.cost[i] <= 1) return { col: cc, row: rr };
    }
    return null;
  }
  private orchShift(dt: number) {
    const L = this.layout, s = this.orchSig, c = this.byId.get(STAFF_IDS.orch);
    if (c) return; // la sortie en cours est menée par orchTick
    this.orchCool -= dt;
    if (this.orchCool > 0) return;
    const home = this.freeNear(Math.floor(L.control.postX / TILE), Math.floor(L.control.postY / TILE) + 1);
    if (!home) return;
    while (this.orchVisits.length && !L.deskByAgent.has(this.orchVisits[0].agentId)) this.orchVisits.shift();
    let trip: OrchTrip | null = null, dest: Tile | null = null, anim: Anim = 'stand', dir: number = Dir.UP;
    const mk = (kind: OrchTrip['kind'], agentId: string | null, stay: number, cap: number): OrchTrip => ({ kind, agentId, phase: 0, t: stay, cap, home });
    const desk = s.alertAgent ? L.deskByAgent.get(s.alertAgent) : undefined;
    if (desk) { // une exécution a échoué : il va voir le poste de l'agent
      dest = this.freeNear(desk.stand.col, desk.stand.row); anim = 'look'; dir = Dir.UP;
      trip = mk('alert', s.alertAgent, 6, 20);
    } else if (s.approvals > 0) { // une approbation attend : il passe en salle d'attente
      const sp = L.spots.filter((q) => (q.kind === 'wait' || q.kind === 'bench' || q.kind === 'water') && L.rooms[q.room].kind === 'approval');
      const q = sp.length ? sp[Math.floor(this.time * 7) % sp.length] : null;
      if (q) { dest = this.freeNear(q.approach.col, q.approach.row); anim = 'wait'; trip = mk('approval', null, 5, 120); }
    } else if (this.orchVisits.length && this.time >= this.orchVisits[0].at) { // fiche déposée : il va voir l'agent démarrer
      const v = this.orchVisits.shift()!, d = L.deskByAgent.get(v.agentId);
      if (d) { dest = this.freeNear(d.stand.col, d.stand.row); anim = 'look'; trip = mk('visit', v.agentId, 3.5, 12); }
    } else if (this.social && !this.clock.calm && s.quiet) { // calme plat : petite ronde
      const kinds = ['coffee', 'vending', 'water', 'shelf', 'window', 'reading'];
      const sp = L.spots.filter((q) => !q.sit && kinds.includes(q.kind) && levelOfRow(L, q.approach.row) === levelOfRow(L, home.row));
      const fr = L.staff.rackFronts.filter((f) => levelOfRow(L, f.tile.row) === levelOfRow(L, home.row));
      const n = sp.length + fr.length;
      if (n) {
        const k = Math.floor(this.time * 13) % n;
        dest = k < sp.length ? this.freeNear(sp[k].approach.col, sp[k].approach.row) : this.freeNear(fr[k - sp.length].tile.col, fr[k - sp.length].tile.row);
        trip = mk('stroll', null, 5 + (Math.floor(this.time * 3) % 5), 20);
      }
    }
    if (!trip || !dest) { this.orchCool = trip ? 10 : 0.5; return; }
    this.addStaff('orch', true);
    const o = this.byId.get(STAFF_IDS.orch)!;
    o.orch = trip; o.spawnInstant = false;
    this.placeAt(o, tileCx(home.col), tileCy(home.row));
    o.present = true; o.visible = true; o.alpha = 1; o.dir = Dir.UP;
    this.goStaff(o, dest, dir, anim, 700000 + (o.uid & 0xffff));
  }
  private orchTick(c: Char, dt: number) {
    const o = c.orch, L = this.layout;
    if (!o) return;
    if (o.phase === 0) { if (c.arrived) { o.phase = 1; } return; }
    if (o.phase === 1) {
      o.t -= dt; o.cap -= dt;
      const s = this.orchSig;
      if (o.kind === 'approval' && s.approvals > 0 && o.cap > 0) o.t = Math.max(o.t, 2);
      if (o.kind === 'alert' && s.alertAgent === o.agentId && o.cap > 0) o.t = Math.max(o.t, 1);
      if (o.t > 0) return;
      o.phase = 2;
      this.goStaff(c, o.home, Dir.UP, 'stand', 710000 + (c.uid & 0xffff));
      return;
    }
    if (!c.arrived) return;
    // de retour à la régie : le personnage disparaît, le dessin fixe reprend sa place
    c.leaving = true; c.present = false; c.alpha = 0; c.visible = false; c.orch = null;
    this.byId.delete(c.id); this.release(c); this.releaseSpot(c);
    this.orchCool = o.kind === 'stroll' ? 80 + (Math.floor(this.time * 11) % 80) : 4;
    void L;
  }

  private goStaff(c: Char, t: Tile, dir: number, anim: Anim, key: number) {
    if (c.goalKey === key && c.goal === G.TILE) return;
    this.releaseSpot(c);
    c.goal = G.TILE; c.goalKey = key; c.arrived = false; c.atDesk = false;
    c.gTile = t; c.gx = tileCx(t.col); c.gy = tileCy(t.row); c.gdir = dir; c.gsit = false; c.ganim = anim;
    this.requestPath(c);
  }
  private staffTick(c: Char, dt: number) {
    if (c.extra === 'dev') { this.devTick(c, dt); return; }
    if (c.extra === 'courier') { this.courierTick(c, dt); return; }
    if (c.extra === 'orch') { this.orchTick(c, dt); return; }
    const L = this.layout, info = this.staffInfo;
    c.staffT -= dt;
    if (c.extra === 'reception') {
      const post = L.staff.reception; if (!post) return;
      // petite tâche du hall (vie sociale seulement) ; une livraison réelle qui arrive la ramène aussitôt à la banque d'accueil
      const lobbyBusy = this.couriers.length > 0 || this.chars.some((p) => p.extra === 'courier' && p.visible);
      if (c.errand >= 0) {
        const e = this.receptionErrands()[c.errand];
        if (!e || !this.social || lobbyBusy) c.errand = -1;
        else {
          this.goStaff(c, e.tile, e.dir, e.anim, 560000 + c.errand);
          if (c.arrived) {
            if (!c.errandSaid) { c.errandSaid = true; if (!c.bubble && rnd(c.rng) < 0.6) this.say(c, e.line, 3); }
            c.errandT -= dt;
            if (c.errandT <= 0) c.errand = -1;
          }
          return;
        }
      }
      this.goStaff(c, post.tile, post.dir, 'stand', 500000);
      if (!this.social || !c.arrived) return;
      c.errandCool -= dt;
      if (c.errandCool <= 0 && !c.bubble && !lobbyBusy) {
        const list = this.receptionErrands();
        c.errandCool = 70 + rnd(c.rng) * 90;
        if (list.length) { c.errand = Math.floor(rnd(c.rng) * list.length) % list.length; c.errandT = 4 + rnd(c.rng) * 6; c.errandSaid = false; return; }
      }
      c.greetT -= dt;
      if (c.greetT <= 0) { c.greetT = 0.5; this.receptionGreet(c); }
      if (c.staffT <= 0 && !c.bubble) {
        const facts = receptionFacts(info, this.clock);
        this.say(c, facts[c.staffIdx++ % facts.length], 4.6);
        c.staffT = 28 + rnd(c.rng) * 40;
      }
    } else if (c.extra === 'tech') {
      const post = L.staff.tech; if (!post) return;
      const alert = techAlert(info), fronts = L.staff.rackFronts;
      if (alert && alert.kind === 'limit' && L.staff.limitsSpot) { // limite d'usage proche : il lit l'écran des limites
        const sp = L.staff.limitsSpot;
        c.actHops = 0;
        this.goStaff(c, sp.tile, sp.dir, 'stand', 515000);
        if (c.arrived && c.staffAlert !== alert.text) { c.staffAlert = alert.text; if (this.social) this.say(c, alert.text, 5); }
        return;
      }
      if (alert && fronts.length) {
        const furn = alert.kind === 'provider' ? L.staff.netRack : alert.kind === 'system' ? fronts[fronts.length - 1].furn : L.staff.gaugeRack;
        const fr = fronts.find((f) => f.furn === furn) ?? fronts[0];
        c.actHops = 0;
        this.goStaff(c, fr.tile, fr.dir, 'use', 510000 + fr.furn);
        if (c.arrived && c.staffAlert !== alert.kind) { c.staffAlert = alert.kind; if (this.social) this.say(c, alert.text, 5); }
        return;
      }
      c.staffAlert = '';
      if (c.actHops > 0) { // ronde calme entre les baies
        if (!c.arrived) return;
        c.actT -= dt;
        if (c.actT > 0) return;
        c.actHops--;
        if (c.actHops > 0 && fronts.length) { const fr = fronts[Math.floor(rnd(c.rng) * fronts.length) % fronts.length]; c.actT = 4 + rnd(c.rng) * 5; this.goStaff(c, fr.tile, fr.dir, 'use', 530000 + fr.furn); }
        return;
      }
      this.goStaff(c, post.tile, post.dir, 'stand', 520000);
      if (this.social && c.arrived && c.staffT <= 0 && fronts.length) {
        c.staffT = 60 + rnd(c.rng) * 80; c.actHops = 2 + Math.floor(rnd(c.rng) * 2); c.actT = 4 + rnd(c.rng) * 5;
        const fr = fronts[Math.floor(rnd(c.rng) * fronts.length) % fronts.length], up = L.staff.floorRack;
        if (up && rnd(c.rng) < 0.3) { c.actHops = 1; c.actT = 6 + rnd(c.rng) * 6; this.goStaff(c, up.tile, up.dir, 'use', 535000); } // baie réseau du 1er
        else this.goStaff(c, fr.tile, fr.dir, 'use', 530000 + fr.furn);
        if (rnd(c.rng) < 0.5) { const r = techRemarks(info); this.say(c, r[c.staffIdx++ % r.length], 3.6); }
      }
    } else if (c.extra === 'cleaner') {
      const T = L.strollTiles;
      if (!T.length) return;
      if (c.goal !== G.TILE || (c.arrived && (c.actT -= dt) <= 0)) {
        const t = T[Math.floor(rnd(c.rng) * T.length) % T.length];
        c.actT = 3 + rnd(c.rng) * 5;
        this.goStaff(c, t, Math.floor(rnd(c.rng) * 4), 'stand', 540000 + t.row * L.cols + t.col);
      }
    }
  }
  private receptionGreet(c: Char) {
    if (c.bubble) return;
    const L = this.layout, lobbyRoom = L.roomAt[this.idx(L.staff.reception!.tile.col, L.staff.reception!.tile.row)];
    for (const p of this.chars) {
      if (p.extra || !p.visible || p.mode !== Mode.WALK || p.leaving) continue;
      if (L.roomAt[this.idx(Math.floor(p.x / TILE), Math.floor(p.y / TILE))] !== lobbyRoom) continue;
      if ((this.greetCool.get(p.id) ?? 0) > this.time || Math.hypot(p.x - c.x, p.y - c.y) > TILE * 6) continue;
      this.greetCool.set(p.id, this.time + 240);
      this.say(c, receptionGreeting(p.agent.name, this.clock, c.staffIdx++), 2.8);
      return;
    }
  }

  // ───────────── requêtes ─────────────

  /** Cadence d'images souhaitée : 60 en mouvement, 30 pour les animations d'état ou de conversation, 0 si tout est figé. */
  motionFps(nowMs: number): number {
    let fps = 0;
    for (let i = 0; i < this.chars.length; i++) {
      const c = this.chars[i];
      if (c.leaving || (c.visible && c.alpha < 1) || (!c.visible && c.alpha > 0.01)) return 60;
      if (!c.visible) continue;
      if (c.mode === Mode.WALK) return 60;
      if (c.bubble) { fps = Math.max(fps, 30); continue; }
      const a = c.anim;
      if (a === 'type' || a === 'terminal' || a === 'read' || a === 'web' || a === 'alarm' || a === 'hand' || a === 'cheer' || a === 'wait' || a === 'quota') fps = Math.max(fps, 30);
      else if (this.decor) fps = Math.max(fps, 15);
      const ef = c.agent.effects;
      for (let k = 0; k < ef.length; k++) if (ef[k].until > nowMs) return 60;
    }
    return fps;
  }

  /** Personnage visible sous le point (px monde), le plus proche du spectateur en priorité. */
  charAt(px: number, py: number): Char | null {
    let best: Char | null = null;
    for (let i = 0; i < this.chars.length; i++) {
      const c = this.chars[i];
      if (!c.visible || c.alpha < 0.3 || c.leaving) continue;
      const top = c.mode === Mode.SIT ? 24 : 28;
      if (px >= c.x - 7.5 && px <= c.x + 7.5 && py >= c.y - top && py <= c.y + 7 && (!best || c.y > best.y)) best = c;
    }
    return best;
  }

  /** Poste de travail sous le point (bureau, écran, caisson) : renvoie l'identifiant de l'agent. */
  deskAt(px: number, py: number): string | null {
    for (const d of this.layout.desks) {
      if (px >= d.col * TILE && px <= (d.col + 4) * TILE && py >= d.row * TILE - 26 && py <= (d.row + 1) * TILE + 2) return d.agentId;
    }
    return null;
  }

  /** Bulles sociales visibles (pour les tests et l'accessibilité). */
  bubbles(): { id: string; text: string }[] { return this.chars.filter((c) => c.bubble && this.time <= c.bubbleUntil).map((c) => ({ id: c.id, text: c.bubble })); }
}
