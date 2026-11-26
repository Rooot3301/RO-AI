// Rue devant le siège : ambiance pure (figurants), sans aucun lien avec les agents ni avec le travail réel.
// - Stationnement : chaque place a, pour chaque jour, une heure d'arrivée (7 h – 9 h 30) et de départ (16 h 30 – 19 h 30)
//   déterministes ; occupation forte en semaine, faible le week-end et les jours fériés ; quelques voitures de riverains.
// - Passants, vélos et circulation : plus nombreux en journée. Rien ne bouge quand les animations sont coupées.
import type { Street } from '../layout/plan.ts';
import { TILE } from '../layout/geom.ts';
import { hash2 } from './draw.ts';

export interface StreetClock { hour: number; minute: number; calm: boolean; /** Jour (AAAAMMJJ) : change les horaires de chaque place. */ day: number }
export type MoverKind = 'walk' | 'bike' | 'car';
export interface Mover { kind: MoverKind; x: number; y: number; vx: number; style: number; phase: number; color: number }
/** Camionnette de livraison (livraison RÉELLE reçue par RO·AI) : arrive, s'arrête devant l'entrée, repart. */
export interface Van { x: number; y: number; stopX: number; state: 'in' | 'stop' | 'out'; t: number; label: string }
export const VAN_STOP_S = 14;
export interface Parked { state: 'empty' | 'parked' | 'arriving' | 'leaving'; x: number; y: number; t: number; color: number; dir: 1 | -1 }

export const CAR_COLORS = ['#c7ccd3', '#2b2f36', '#8f2f2f', '#2f4f7a', '#e2e4e7', '#56606b', '#7a5a2f', '#3f6b4f'] as const;
const CAR_W = 30;

/** Minute de la journée où la place `i` est occupée : null si elle reste libre ce jour-là. */
export function spotSchedule(i: number, c: Pick<StreetClock, 'calm' | 'day'>): { arrive: number; leave: number } | null {
  if (hash2(i + 5, 7) < 0.14) return { arrive: 0, leave: 24 * 60 }; // voiture de riverain : toujours là
  if (hash2(i + 77, c.day % 9973) >= (c.calm ? 0.15 : 0.85)) return null;
  return { arrive: 7 * 60 + Math.floor(hash2(i, c.day % 9973) * 150), leave: 16 * 60 + 30 + Math.floor(hash2(i + 31, c.day % 9973) * 180) };
}
export function wantParked(i: number, c: StreetClock): boolean {
  const s = spotSchedule(i, c), m = c.hour * 60 + c.minute;
  return !!s && m >= s.arrive && m < s.leave;
}

export class StreetLife {
  readonly spots: Parked[];
  movers: Mover[] = [];
  vans: Van[] = [];
  private started = false;
  private tWalk = 2; private tCar = 4; private tBike = 9;
  private seed = 1;
  private readonly yLane: [number, number]; private readonly yPark: number; private readonly yWalk: [number, number];
  private readonly street: Street; private readonly width: number;

  constructor(street: Street, width: number) {
    this.street = street; this.width = width;
    this.yPark = street.parking * TILE + 9;
    this.yLane = [street.road * TILE + 9, (street.road + 1) * TILE + 9];
    this.yWalk = [street.sidewalk * TILE + 10, street.far * TILE + 8];
    this.spots = street.spots.map((c, i) => ({ state: 'empty', x: c * TILE + 24, y: this.yPark, t: 0, color: Math.floor(hash2(i, 3) * CAR_COLORS.length), dir: 1 }));
  }

  private rnd() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }

  /** Vrai si quelque chose bouge (cadence d'images). */
  get busy(): boolean { return this.movers.length > 0 || this.vans.length > 0 || this.spots.some((s) => s.state === 'arriving' || s.state === 'leaving'); }

  /** Livraison réelle : une camionnette vient s'arrêter devant l'entrée (au plus 3 à la fois). */
  deliver(label: string) {
    if (this.vans.length >= 3) return;
    const stopX = (this.street.cross.b + 1) * TILE + 20 + this.vans.length * 36;
    this.vans.push({ x: -40, y: this.yLane[0], stopX, state: 'in', t: 0, label });
  }
  private updateVans(dt: number, animate: boolean) {
    for (const v of this.vans) {
      if (!animate && v.state === 'in') { v.x = v.stopX; v.state = 'stop'; }
      if (v.state === 'in') { v.x = Math.min(v.stopX, v.x + dt * Math.max(16, Math.min(70, (v.stopX - v.x) * 1.2))); if (v.x >= v.stopX - 0.5) { v.x = v.stopX; v.state = 'stop'; } }
      else if (v.state === 'stop') { v.t += dt; if (v.t >= VAN_STOP_S) v.state = 'out'; }
      else v.x += dt * (animate ? Math.min(75, 12 + v.t * 6) : 1e6);
      if (v.state === 'out') v.t += dt;
    }
    this.vans = this.vans.filter((v) => v.x < this.width + 60);
  }

  update(dt: number, c: StreetClock, animate: boolean) {
    this.updateVans(dt, animate);
    // stationnement selon l'horaire (sans animation au premier passage ou si les animations sont coupées)
    this.spots.forEach((s, i) => {
      const want = wantParked(i, c);
      if (!this.started || !animate) {
        if (s.state === 'arriving' || s.state === 'leaving' || (want ? s.state !== 'parked' : s.state !== 'empty')) { s.state = want ? 'parked' : 'empty'; s.x = this.street.spots[i] * TILE + 24; s.y = this.yPark; }
        return;
      }
      if (want && s.state === 'empty') { s.state = 'arriving'; s.x = -CAR_W; s.y = this.yLane[0]; s.t = 0; s.dir = 1; s.color = Math.floor(this.rnd() * CAR_COLORS.length); }
      else if (!want && s.state === 'parked') { s.state = 'leaving'; s.t = 0; s.dir = 1; }
      const tx = this.street.spots[i] * TILE + 24;
      if (s.state === 'arriving') {
        if (s.x < tx - 0.5) s.x = Math.min(tx, s.x + dt * Math.max(18, Math.min(80, (tx - s.x) * 1.4)));
        else { s.t += dt; s.y = this.yLane[0] + (this.yPark - this.yLane[0]) * Math.min(1, s.t / 1.4); if (s.t >= 1.4) { s.state = 'parked'; s.y = this.yPark; } }
      } else if (s.state === 'leaving') {
        s.t += dt;
        if (s.t < 1.4) s.y = this.yPark + (this.yLane[0] - this.yPark) * (s.t / 1.4);
        else { s.y = this.yLane[0]; s.x += dt * Math.min(80, 15 + (s.t - 1.4) * 40); if (s.x > this.width + CAR_W) { s.state = 'empty'; s.x = tx; s.y = this.yPark; } }
      }
    });
    this.started = true;
    if (!animate) { this.movers = []; return; }
    // passants, vélos, circulation : plus d'animation en journée, un peu moins le week-end
    const day = c.hour >= 7 && c.hour < 21, k = (day ? 1 : 0.25) * (c.calm ? 0.65 : 1);
    this.tWalk -= dt * k; this.tCar -= dt * k; this.tBike -= dt * k * (day ? 1 : 0.3);
    if (this.tWalk <= 0 && this.movers.length < 14) {
      this.tWalk = 3 + this.rnd() * 7;
      const right = this.rnd() < 0.5, far = this.rnd() < 0.35;
      this.movers.push({ kind: 'walk', x: right ? -10 : this.width + 10, y: this.yWalk[far ? 1 : 0] + (this.rnd() - 0.5) * 3, vx: (right ? 1 : -1) * (13 + this.rnd() * 7), style: Math.floor(this.rnd() * 1000), phase: 0, color: 0 });
    }
    if (this.tCar <= 0) {
      this.tCar = 6 + this.rnd() * 12;
      const right = this.rnd() < 0.5;
      this.movers.push({ kind: 'car', x: right ? -CAR_W : this.width + CAR_W, y: this.yLane[right ? 0 : 1], vx: (right ? 1 : -1) * (55 + this.rnd() * 30), style: 0, phase: 0, color: Math.floor(this.rnd() * CAR_COLORS.length) });
    }
    if (this.tBike <= 0) {
      this.tBike = 12 + this.rnd() * 20;
      const right = this.rnd() < 0.5;
      this.movers.push({ kind: 'bike', x: right ? -12 : this.width + 12, y: this.yLane[right ? 0 : 1] + (right ? -4 : 4), vx: (right ? 1 : -1) * (32 + this.rnd() * 10), style: Math.floor(this.rnd() * 1000), phase: 0, color: Math.floor(this.rnd() * CAR_COLORS.length) });
    }
    for (const m of this.movers) { m.x += m.vx * dt; m.phase += Math.abs(m.vx) * dt * (m.kind === 'walk' ? 0.42 : 0.3); }
    // une voiture ralentit derrière une autre (pas de collision)
    for (const m of this.movers) if (m.kind === 'car') for (const o of this.movers) if (o !== m && o.y === m.y && Math.sign(o.vx) === Math.sign(m.vx) && (o.x - m.x) * Math.sign(m.vx) > 0 && Math.abs(o.x - m.x) < CAR_W + 8) m.x -= m.vx * dt * 0.6;
    this.movers = this.movers.filter((m) => m.x > -60 && m.x < this.width + 60);
  }
}
