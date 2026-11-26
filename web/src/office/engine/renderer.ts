// Rendu Canvas 2D en résolution appareil. Deux couches pré-rendues (sol, volumes) ; à chaque image, les volumes sont
// redessinés par sous-image et intercalés avec les personnages, chaises, portes (tri en profondeur), puis éclairage
// (jour/nuit à l'heure réelle de Paris), effets réels (états, fiches de l'orchestrateur) et étiquettes en pixels écran.
// Aucune allocation notable par image : tableaux de tri, caches de styles et de textes réutilisés.
import type { Layout } from '../layout/plan.ts';
import { TILE, isExtRow, levelOfRow, levelOfY } from '../layout/plan.ts';
import type { AgentProfile, OfficeBoards, SystemInfo } from '../../api/types.ts';
import type { ExtraKind } from './staff.ts';
import { EFFECT_TTL_MS } from '../state/model.ts';
import type { Effect } from '../state/model.ts';
import type { ScreenMode } from '../state/visual.ts';
import { drawAvatar, drawOrchestrator, styleFor, ORCH_STYLE } from './avatar.ts';
import type { AvatarParams, AvatarPose, AvatarStyle, OrchArm } from './avatar.ts';
import { PROP_DESK, PROP_FURN, PROP_WALL, bakeScale, bakeStatic, roomTag } from './baker.ts';
import type { BakeResult } from './baker.ts';
import type { View } from './camera.ts';
import { ACCENTS, NIGHT_VEIL, STATE_COLOR, UI } from './theme.ts';
import { FONT_FAMILY, clamp01, drawIcon, easeOutCubic, fillRR, hash2, rr } from './draw.ts';
import type { Ctx, IconName } from './draw.ts';
import { BAKE_PAD, buildGlow, buildShadow, buildSun, buildVeil } from './lighting.ts';
import { Mode } from './sim.ts';
import type { Char, OfficeWorld } from './sim.ts';
import { ORCH_ID, FLIGHT_MS } from '../state/orchestrator.ts';
import { LAND_MS } from './conductor.ts';
import type { Conductor } from './conductor.ts';
import { consoleGeom } from './console.ts';
import { EMPTY_STORY } from '../state/story.ts';
import type { OfficeCalendar } from './calendar.ts';
import { parisDate } from './calendar.ts';
import { CAR_COLORS, StreetLife } from './street.ts';
import { screenTarget } from '../state/screenText.ts';
import type { ToolKind } from '../../api/types.ts';
import type { StreetClock } from './street.ts';
import { AVATARS, HAIRS, SKINS } from './avatar.ts';
import { PROVIDER_FR, countdown, hhmm, limitViews, planningSummary } from '../state/boards.ts';
import type { StoryData } from '../state/story.ts';
import { DEFAULT_LOOK, SEASON_DECOR, deskScreens, wallFace } from './props.ts';
import { FURNITURE } from '../layout/furniture.ts';
import type { DeskLook } from './props.ts';

export interface RenderUi { hoverId: string | null; selectedId: string | null; showNames: boolean; editKey?: string | null; editOk?: boolean; ghost?: { col: number; row: number; w: number; h: number; ok: boolean } | null }

const ERROR_ICON = { auth_expired: 'auth_expired', rate_limited: 'rate_limited', denied: 'denied', timeout: 'timeout', transient: 'transient', failed: 'failed' } as const;
const SCREEN_GLOW: Record<ScreenMode, string> = { off: '', standby: '', read: '#f5a742', code: '#4ccaa1', terminal: '#4ccaa1', web: '#6fb0f2', mcp: '#a58be0', generic: '#f5a742', error: '#f26d5d', quota: '#e6c04c' };
const KIND_ICON: Partial<Record<ScreenMode, { icon: IconName; color: string }>> = {
  read: { icon: 'read', color: UI.amber }, code: { icon: 'code', color: UI.ok }, terminal: { icon: 'code', color: UI.ok }, web: { icon: 'web', color: UI.info }, mcp: { icon: 'plug', color: UI.plug },
};
const D_CHAR = 0, D_CHAIR = 1, D_CHAIRBACK = 2, D_DOOR = 3, D_ORCH = 4;

/** Échelle à partir de laquelle la bulle d'activité devient l'écran agrandi du poste. */
const FEED_ZOOM = 2.6;

export class OfficeRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: Ctx;
  private layout: Layout | null = null;
  private bake: BakeResult | null = null;
  /** Pré-rendus par étage (l'étage affiché, et le rez-de-chaussée vu en dessous depuis l'étage). */
  private bakes: (BakeResult | null)[] = [];
  /** Étage affiché (0 = rez-de-chaussée). */
  level = 0;
  /** Ouverture lissée des portes de l'ascenseur, par étage. */
  private liftOpen: number[] = [0, 0];
  /** Débuts des tronçons de mur par rangée (pour dessiner le contenu d'un décor mural après le dernier tronçon qui le recouvre). */
  private segStarts: { of: BakeResult | null; rows: Map<number, number[]> } = { of: null, rows: new Map() };
  private veil: HTMLCanvasElement | null = null;
  private sun: HTMLCanvasElement | null = null;
  private lightScale = 0;
  private glows = new Map<string, HTMLCanvasElement>();
  private shadow: HTMLCanvasElement;
  private styles = new Map<string, { sig: string; style: AvatarStyle }>();
  private looks = new Map<string, DeskLook>();
  private looksSig = '';
  private profiles: Record<string, AgentProfile> = {};
  private textW = new Map<string, number>();
  private clipped = new Map<string, string>();
  private placed = new Float32Array(512);
  private nPlaced = 0;
  private t0 = Date.now();
  private doorOpen: Float32Array = new Float32Array(0);
  private absentSign = false;
  private lampT = 0;
  /** Mesures réelles du serveur (GET /api/system), null si inconnues. */
  system: SystemInfo | null = null;
  /** Fournisseur à l'authentification en défaut (réel), sinon null. */
  providerDown: string | null = null;
  /** Tableaux réels (planning du jour, limites d'usage), null tant qu'ils ne sont pas chargés. */
  boards: OfficeBoards | null = null;
  private labelBlock: Uint8Array = new Uint8Array(0);
  private spotSort: Float32Array = new Float32Array(0);
  // tri des éléments dynamiques
  private dKind = new Uint8Array(512); private dRef = new Int32Array(512); private dY = new Float32Array(512); private dN = 0;
  private dOrder = new Int32Array(512);
  private clockMin = -1; private clockH = 0; private clockM = 0;
  /** Luminosité du jour 0..1 (1 = plein jour) : fixée par l'hôte (heure de Paris ou préférence). */
  daylight = 1;
  private shownDay = 1;
  /** Vrai tant que la transition d'éclairage n'est pas terminée. */
  fading = false;
  /** Animations décoratives (vapeur, voyants d'ambiance…). */
  decor = true;
  story: StoryData = EMPTY_STORY;
  nameOf: ((id: string) => string | null) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.shadow = buildShadow();
  }

  setLayout(layout: Layout) {
    this.layout = layout; this.dropBakes(); this.veil = null; this.sun = null; this.liftOpen = new Array(layout.floors).fill(0);
    this.street = new StreetLife(layout.street, layout.width);
    this.nearAc = new Set();
    const acs = layout.furniture.filter((f) => f.kind === 'ac_unit');
    layout.furniture.forEach((f, i) => { if ((f.kind === 'plant' || f.kind === 'plant_tall') && acs.some((a) => Math.abs(a.col - f.col) <= 4 && Math.abs(a.row - f.row) <= 4)) this.nearAc.add(i); });
    this.doorOpen = new Float32Array(layout.doors.length);
    // cases à éviter pour les étiquettes : murs, postes (cloison, écrans), meubles hauts
    const lb = new Uint8Array(layout.cols * layout.rows);
    for (let i = 0; i < lb.length; i++) { const t = layout.tiles[i]; if (t === 1 || t === 4 || t === 5) lb[i] = 1; }
    layout.desks.forEach((d, k) => { for (let r = d.row - 1; r <= d.row; r++) for (let c = d.col; c < d.col + 4; c++) if (r >= 0) lb[r * layout.cols + c] = 2 + k; });
    for (const f of layout.furniture) {
      if (!f.blocks || f.kind === 'rug') continue;
      const up = Math.floor(FURNITURE[f.kind].z / TILE);
      for (let r = f.row - up; r < f.row + f.h; r++) for (let c = f.col; c < f.col + f.w; c++) if (r >= 0 && c >= 0 && c < layout.cols) lb[r * layout.cols + c] = lb[r * layout.cols + c] || 1;
    }
    this.labelBlock = lb;
    this.spotSort = new Float32Array(layout.spots.length);
    const byKey = new Map(layout.furniture.map((f) => [f.key, f]));
    layout.spots.forEach((s, i) => { const f = s.furn ? byKey.get(s.furn) : null; this.spotSort[i] = f ? (f.row + f.h) * TILE - 1 + (s.dir === 1 ? -0.5 : 0.5) : 0; });
  }

  /** Fiches d'identité : apparence des personnages et décor des bureaux (re-cuisson si le décor change). */
  setProfiles(p: Record<string, AgentProfile>) {
    this.profiles = p;
    const sig = Object.keys(p).sort().map((k) => { const d = p[k].decor; return `${k}:${d?.theme}:${d?.color}:${(d?.items ?? []).join('.')}`; }).join('|');
    if (sig !== this.looksSig) {
      this.looksSig = sig; this.looks.clear();
      for (const [k, v] of Object.entries(p)) if (v?.decor) this.looks.set(k, { theme: v.decor.theme, items: v.decor.items ?? [], color: v.decor.color ?? 0 });
      this.dropBakes();
    }
  }
  private styleOf(c: Char): AvatarStyle {
    if (c.extra === 'dev') { let e = this.styles.get(c.id); if (!e) { e = { sig: 'dev', style: devStyle(c.id) }; this.styles.set(c.id, e); } return e.style; }
    if (c.extra) return STAFF_STYLE[c.extra];
    const app = this.profiles[c.id]?.appearance ?? null;
    const sig = app ? `${app.skin}.${app.hair}.${app.hair_style}.${app.outfit}.${app.accessory}` : `s${c.agent.sprite}`;
    let e = this.styles.get(c.id);
    if (!e || e.sig !== sig) { e = { sig, style: styleFor(app, c.agent.sprite) }; this.styles.set(c.id, e); }
    return e.style;
  }

  /** Force la régénération du décor (police chargée, etc.). */
  invalidate() { this.dropBakes(); this.textW.clear(); }
  private dropBakes() { this.bake = null; this.bakes = []; }

  /** Saison et fêtes (heure de Paris) : un changement refait le pré-rendu (arbres, sapins, guirlande). */
  setCalendar(cal: OfficeCalendar) {
    this.calm = cal.calm;
    const cur = SEASON_DECOR.cal;
    if (cur.season === cal.season && cur.festive === cal.festive) return;
    SEASON_DECOR.cal = { season: cal.season, festive: cal.festive };
    this.dropBakes();
  }
  /** Arrêt d'urgence réel : voile rouge tamisé, régie « SUSPENDU ». */
  paused = false;
  /** Rapports réels arrivés depuis la dernière visite de la bibliothèque (boîte aux lettres de l'accueil). */
  mail = 0;
  private calm = false;
  private street: StreetLife | null = null;
  private streetClock: StreetClock = { hour: 12, minute: 0, calm: false, day: 0 };
  /** Vrai si la rue est animée (cadence d'images). */
  /** Livraison réelle : la camionnette vient devant l'entrée. */
  deliver(label: string) { this.street?.deliver(label); }
  get streetBusy(): boolean { return !!this.street && this.decor && this.street.busy; }
  get ready(): boolean { return !!this.layout; }

  resize(w: number, h: number) {
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  /** Prépare les couches statiques à la résolution voulue. Pendant un mouvement de caméra, on garde l'existante. */
  ensureStatic(wantScale: number, settled: boolean) {
    const L = this.layout; if (!L) return;
    // l'échelle cible est plafonnée (mémoire) : on compare à la cible plafonnée pour ne jamais re-cuire en boucle
    const stale = (b: BakeResult | null | undefined) => !b || (settled && Math.abs(Math.log(bakeScale(L, wantScale) / b.scale)) > 0.12);
    const lv = Math.max(0, Math.min(L.floors - 1, this.level));
    if (stale(this.bakes[lv])) this.bakes[lv] = bakeStatic(L, wantScale, this.looks, lv);
    if (lv > 0 && stale(this.bakes[0])) this.bakes[0] = bakeStatic(L, wantScale, this.looks, 0); // le RDC vu d'en haut
    this.bake = this.bakes[lv]!;
    const ls = Math.min(this.bake.scale, 1.5);
    if (!this.veil || this.lightScale !== ls) { this.veil = buildVeil(L, ls); this.sun = buildSun(L, ls); this.lightScale = ls; }
  }

  private glow(color: string): HTMLCanvasElement {
    let g = this.glows.get(color);
    if (!g) { g = buildGlow(color); this.glows.set(color, g); }
    return g;
  }
  private tw(ctx: Ctx, font: string, text: string): number {
    const k = font + text;
    let w = this.textW.get(k);
    if (w === undefined) { ctx.font = font; w = ctx.measureText(text).width; this.textW.set(k, w); if (this.textW.size > 800) this.textW.clear(); }
    return w;
  }
  private clip(text: string, max: number): string {
    if (text.length <= max) return text;
    const k = max + '|' + text;
    let s = this.clipped.get(k);
    if (s === undefined) { s = text.slice(0, max - 1) + '…'; this.clipped.set(k, s); if (this.clipped.size > 400) this.clipped.clear(); }
    return s;
  }

  render(world: OfficeWorld, view: View, nowMs: number, dt: number, ui: RenderUi, cond: Conductor) {
    const ctx = this.ctx, L = this.layout, bake = this.bake;
    if (!L || !bake) return;
    const t = (nowMs - this.t0) / 1000;
    const dd = this.daylight - this.shownDay;
    this.fading = Math.abs(dd) > 0.003;
    this.shownDay = this.fading ? this.shownDay + dd * (1 - Math.exp(-3 * dt)) : this.daylight;
    const night = 1 - this.shownDay;
    if (Math.floor(nowMs / 60000) !== this.clockMin) {
      this.clockMin = Math.floor(nowMs / 60000);
      const d = new Date(nowMs);
      try { const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(d); this.clockH = Number(p.find((x) => x.type === 'hour')?.value ?? d.getHours()) % 12; this.clockM = Number(p.find((x) => x.type === 'minute')?.value ?? d.getMinutes()); }
      catch { this.clockH = d.getHours() % 12; this.clockM = d.getMinutes(); }
      this.clockH += this.clockM / 60;
      const pd = parisDate(nowMs);
      let hh = 12; try { hh = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false }).format(new Date(nowMs))) % 24; } catch { /* heure locale */ }
      this.streetClock = { hour: hh, minute: this.clockM, calm: this.calm, day: pd.y * 10000 + pd.m * 100 + pd.d };
    }
    if (this.street) this.street.update(Math.min(dt, 0.1), this.streetClock, this.decor);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#15171b'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);
    // couches pré-rendues à l'échelle d'affichage (rapport ≈ 1) : un filtrage bilinéaire suffit et coûte 3 à 4 fois moins
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low';
    // partie visible du monde (on ne traite que ces pixels : zoom fluide même sans accélération graphique)
    // étage affiché : seule sa bande du monde est dessinée (découpe), l'autre étage n'apparaît jamais
    const lv = bake.level, FH = L.floorRows * TILE, fy0 = bake.oy;
    const vx0 = Math.max(-BAKE_PAD, -view.ox / view.scale - 2), vy0 = Math.max(fy0 - BAKE_PAD, -view.oy / view.scale - 2);
    const vx1 = Math.min(L.width + BAKE_PAD, (this.canvas.width - view.ox) / view.scale + 2), vy1 = Math.min(fy0 + FH + BAKE_PAD, (this.canvas.height - view.oy) / view.scale + 2);
    /** Copie la partie visible d'une image (origine `imgOy` en monde), décalée de `shift` (vue du dessous). */
    const blitPart = (img: HTMLCanvasElement, k: number, imgOy = 0, shift = 0) => {
      if (vx1 <= vx0 || vy1 <= vy0) return;
      ctx.drawImage(img, (vx0 + BAKE_PAD) * k, (vy0 - shift - imgOy + BAKE_PAD) * k, (vx1 - vx0) * k, (vy1 - vy0) * k, vx0, vy0, vx1 - vx0, vy1 - vy0);
    };
    ctx.save(); ctx.beginPath(); ctx.rect(-BAKE_PAD, fy0 - BAKE_PAD, L.width + BAKE_PAD * 2, FH + BAKE_PAD * 2); ctx.clip();
    const under = lv > 0 ? this.bakes[0] : null;
    if (under) { // depuis l'étage : la rue et les abords en contrebas, assombris
      blitPart(under.base, under.scale, under.oy, fy0); blitPart(under.props, under.scale, under.oy, fy0);
      ctx.save(); ctx.translate(0, fy0); this.drawStreet(ctx, night); ctx.restore();
      ctx.fillStyle = `rgba(12,16,24,${0.42 + 0.2 * night})`; ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
    }
    blitPart(bake.base, bake.scale, bake.oy);
    // ascenseur sur un mur « au sol » (rien au-dessus, cas du palier en façade) : sa partie animée est dessinée ici
    for (const w of L.wallDecor) {
      if (w.kind !== 'elevator' || levelOfRow(L, w.row) !== lv) continue;
      const up = L.tiles[(w.row - 1) * L.cols + w.col];
      if (up === 2 || up === 3 || up === 6) continue; // mur trié : dessiné avec son volume
      const gf = wallFace(w.row, isExtRow(L, w.col, w.row));
      this.elevator(ctx, world, lv, w.col * TILE, w.w * TILE, gf.faceTop + 2, gf.faceBottom - gf.faceTop - 5);
    }
    for (let k = 0; k < this.liftOpen.length; k++) this.liftOpen[k] += ((world.lift.open[k] ?? 0) > world.time ? 1 - this.liftOpen[k] : -this.liftOpen[k]) * Math.min(1, dt * 6);

    // portes : ouverture quand quelqu'un approche
    for (let i = 0; i < L.doors.length; i++) {
      const d = L.doors[i];
      if (d.kind === 'open' || levelOfRow(L, d.row) !== lv) continue;
      const dx = (d.col + d.w / 2) * TILE, dy = (d.row + 0.5) * TILE;
      let near = false;
      for (const c of world.chars) if (c.visible && Math.abs(c.x - dx) < 22 + d.w * 6 && Math.abs(c.y - dy) < 26) { near = true; break; }
      const tg = near ? 1 : 0;
      this.doorOpen[i] += (tg - this.doorOpen[i]) * Math.min(1, dt * 7);
    }

    // éléments dynamiques triés : personnages, chaises des postes, portes, orchestrateur
    this.dN = 0;
    const push = (k: number, ref: number, y: number) => { if (this.dN >= this.dKind.length) return; this.dKind[this.dN] = k; this.dRef[this.dN] = ref; this.dY[this.dN] = y; this.dN++; };
    for (let i = 0; i < world.chars.length; i++) {
      const c = world.chars[i];
      if (c.alpha <= 0.01 || !c.visible || levelOfY(L, c.y) !== lv) continue;
      let y = c.y + 7;
      if (c.mode === Mode.SIT && c.gSpot >= 0 && c.arrived) y = this.spotSort[c.gSpot] || y;
      push(D_CHAR, i, y);
    }
    for (let i = 0; i < L.desks.length; i++) {
      const d = L.desks[i], c = world.byId.get(d.agentId);
      if (levelOfRow(L, d.row) !== lv) continue;
      const occupied = !!c && c.visible && c.atDesk && c.mode === Mode.SIT;
      push(D_CHAIR, i, d.seatY + 7 - 0.2);
      if (occupied) push(D_CHAIRBACK, i, d.seatY + 7 + 0.3);
    }
    for (let i = 0; i < L.doors.length; i++) if (L.doors[i].kind !== 'open' && levelOfRow(L, L.doors[i].row) === lv) push(D_DOOR, i, L.doors[i].row * TILE + (L.doors[i].kind === 'entrance' ? 13.1 : 11.1));
    const g = consoleGeom(L.control);
    if (levelOfY(L, g.postY) === lv) push(D_ORCH, 0, g.postY + 7);
    // tri par insertion (ordre presque stable d'une image à l'autre)
    const ord = this.dOrder;
    for (let i = 0; i < this.dN; i++) { let j = i; const y = this.dY[i]; while (j > 0 && this.dY[ord[j - 1]] > y) { ord[j] = ord[j - 1]; j--; } ord[j] = i; }

    // fusion avec les volumes pré-triés
    const list = bake.list, s = bake.scale;
    let pi = 0;
    for (let di = 0; di <= this.dN; di++) {
      const y = di < this.dN ? this.dY[ord[di]] : Infinity;
      while (pi < list.length && list[pi].sortY <= y) {
        const p = list[pi++];
        if (p.x > vx1 || p.y > vy1 || p.x + p.w < vx0 || p.y + p.h < vy0) continue; // hors champ
        ctx.drawImage(bake.props, (p.x + BAKE_PAD) * s, (p.y - fy0 + BAKE_PAD) * s, p.w * s, p.h * s, p.x, p.y, p.w, p.h);
        if (p.kind === PROP_DESK) this.deskDynamic(ctx, world, L.desks[p.ref].agentId, p.ref, t);
        else if (p.kind === PROP_FURN) this.furnDynamic(ctx, world, cond, p.ref, t);
        else if (p.kind === PROP_WALL) this.wallDynamic(ctx, world, cond, p.ref, p.row, t);
      }
      if (di === this.dN) break;
      const k = ord[di], kind = this.dKind[k], ref = this.dRef[k];
      if (kind === D_CHAR) { const c = world.chars[ref]; if (c.x < vx0 - 20 || c.x > vx1 + 20 || c.y < vy0 - 10 || c.y > vy1 + 40) continue; this.ground(ctx, c, t, ui, nowMs); this.avatar(ctx, c, t, nowMs); }
      else if (kind === D_CHAIR) this.chair(ctx, world, ref, false);
      else if (kind === D_CHAIRBACK) this.chair(ctx, world, ref, true);
      else if (kind === D_DOOR) this.door(ctx, ref);
      else if (kind === D_ORCH) { if (!world.orchAway()) this.orchestrator(ctx, world, cond, t, nowMs, ui); }
    }

    if (lv === 0) this.drawStreet(ctx, night);

    // lumière : soleil (jour), voile de nuit, halos additifs (écrans, lampadaires, fenêtres éclairées)
    if (this.sun && this.shownDay > 0.05) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.22 * this.shownDay; blitPart(this.sun, this.lightScale); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
    if (this.veil && night > 0.003) { ctx.globalAlpha = NIGHT_VEIL * night; blitPart(this.veil, this.lightScale); ctx.globalAlpha = 1; }
    ctx.globalCompositeOperation = 'lighter';
    const glowK = 0.18 + 0.5 * night;
    for (let i = 0; i < L.desks.length; i++) {
      const d = L.desks[i], c = world.byId.get(d.agentId);
      if (!c || c.vis.disabled || !c.present || levelOfRow(L, d.row) !== lv) continue;
      const col = SCREEN_GLOW[c.vis.screen];
      if (col) { ctx.globalAlpha = glowK * (c.vis.screen === 'error' ? 0.6 + 0.4 * Math.sin(t * 5) : 1); ctx.drawImage(this.glow(col), d.col * TILE + 24 - 22, d.row * TILE - 20, 44, 36); }
      if (c.vis.alarm && !c.vis.quota) { ctx.globalAlpha = 0.16 + 0.16 * (0.5 + 0.5 * Math.sin(t * 4)); ctx.drawImage(this.glow('#f26d5d'), d.col * TILE, d.row * TILE - 26, 48, 60); }
    }
    if (night > 0.2) {
      ctx.globalAlpha = (night - 0.2) * 0.5;
      for (const f of L.furniture) if (f.kind === 'floorlamp' && levelOfRow(L, f.row) === lv) ctx.drawImage(this.glow('#ffcf8a'), f.col * TILE - 22, f.row * TILE - 44, 60, 60);
      // lampadaires de la rue et phares des voitures en mouvement
      ctx.globalAlpha = (night - 0.2) * (lv ? 0.35 : 0.7);
      for (const lp of L.street.lamps) ctx.drawImage(this.glow('#ffd9a0'), lp.col * TILE - 22, lp.row * TILE - 44 + fy0, 70, 70);
      if (this.street && lv === 0) {
        ctx.globalAlpha = (night - 0.2) * 0.55;
        for (const m of this.street.movers) if (m.kind === 'car') ctx.drawImage(this.glow('#fff1c4'), m.x + (m.vx > 0 ? 8 : -34) , m.y - 10, 26, 20);
      }
      ctx.globalAlpha = (night - 0.2) * 0.35;
      // fenêtres de la façade sud vues de l'extérieur : intérieur éclairé
      ctx.globalAlpha = (night - 0.2) * 0.35;
      const B = L.building, r = B.y + B.h - 1 + lv * L.floorRows;
      for (let c = B.x; c < B.x + B.w; c++) if (L.tiles[r * L.cols + c] === 5) ctx.drawImage(this.glow('#ffd59a'), c * TILE - 6, r * TILE - 14, 28, 28);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (this.paused) this.emergencyVeil(ctx, L, t, vx0, vy0, vx1, vy1, lv === levelOfY(L, consoleGeom(L.control).postY));

    // fiches en vol et badges de la régie, effets réels au-dessus des personnages / postes
    this.flights(ctx, world, cond, nowMs, lv);
    if (lv === levelOfY(L, g.postY)) this.consoleBadges(ctx, world, cond, t);
    for (let i = 0; i < world.chars.length; i++) { const c = world.chars[i]; if (c.visible && c.alpha > 0.05 && levelOfY(L, c.y) === lv) this.overlays(ctx, world, c, t, nowMs); }
    for (let i = 0; i < L.desks.length; i++) { const d = L.desks[i], c = world.byId.get(d.agentId); if (c && levelOfRow(L, d.row) === lv) this.deskFx(ctx, d.col * TILE, d.row * TILE, c, t); }
    if (ui.ghost) { // éditeur : emplacement visé
      const gh = ui.ghost;
      ctx.fillStyle = gh.ok ? 'rgba(76,202,161,0.25)' : 'rgba(242,109,93,0.28)'; ctx.strokeStyle = gh.ok ? UI.ok : UI.err; ctx.lineWidth = 1;
      rr(ctx, gh.col * TILE + 0.5, gh.row * TILE + 0.5, gh.w * TILE - 1, gh.h * TILE - 1, 2); ctx.fill(); ctx.stroke();
    }
    if (ui.editKey !== undefined) this.editOverlay(ctx, L, ui.editKey ?? null, view.scale / view.dpr);
    ctx.restore();

    // étiquettes en pixels écran (taille constante, texte net)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.roomLabels(ctx, L, view, lv);
    this.labels(ctx, world, view, ui, nowMs, cond, lv);
  }

  // ───────────── mode édition ─────────────

  private editOverlay(ctx: Ctx, L: Layout, key: string | null, k: number) {
    for (const f of L.furniture) {
      if (!f.movable) continue;
      const sel = f.key === key;
      ctx.lineWidth = (sel ? 2 : 1.2) / k;
      ctx.strokeStyle = sel ? UI.amber : 'rgba(245,167,66,0.7)'; ctx.setLineDash(sel ? [] : [3 / k, 3 / k]);
      ctx.fillStyle = sel ? 'rgba(245,167,66,0.22)' : 'rgba(245,167,66,0.10)'; rr(ctx, f.col * TILE + 1, f.row * TILE + 1, f.w * TILE - 2, f.h * TILE - 2, 2); ctx.fill();
      rr(ctx, f.col * TILE + 1, f.row * TILE + 1, f.w * TILE - 2, f.h * TILE - 2, 2); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // ───────────── éléments dynamiques ─────────────

  private chair(ctx: Ctx, world: OfficeWorld, i: number, backOnly: boolean) {
    const L = world.layout, d = L.desks[i], c = world.byId.get(d.agentId);
    const occupied = !!c && c.visible && c.atDesk && c.mode === Mode.SIT;
    const look = this.looks.get(d.agentId) ?? DEFAULT_LOOK;
    const acc = ACCENTS[((look.color % ACCENTS.length) + ACCENTS.length) % ACCENTS.length];
    const x = d.seatX, y = d.seatY + (occupied ? 2 : -3);
    const fabric = '#3c414b', hi = '#4e5561';
    if (!backOnly) {
      ctx.fillStyle = 'rgba(20,20,25,0.25)'; ctx.beginPath(); ctx.ellipse(x, y + 6, 7, 2.4, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = '#2a2e35'; ctx.lineWidth = 1.1; ctx.beginPath();
      for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2 + 0.3; ctx.moveTo(x, y + 4.5); ctx.lineTo(x + Math.cos(a) * 5.5, y + 5 + Math.sin(a) * 2); }
      ctx.stroke();
      ctx.fillStyle = '#2a2e35'; ctx.fillRect(x - 0.6, y + 1, 1.2, 4);
      fillRR(ctx, fabric, x - 6, y - 3, 12, 6, 2.6); fillRR(ctx, hi, x - 5, y - 2.6, 10, 3.6, 2);
      if (occupied) return;
    }
    // agent absent (désactivé) : panneau « ABSENT » accroché à la chaise rangée, sous le bureau (ne masque rien)
    const absent = !c || c.vis.disabled;
    if (absent && !backOnly) this.absentSign = true;
    // dossier (vu de derrière) : masque seulement le bas du dos quand quelqu'un est assis
    const by = occupied ? y - 8 : y - 13;
    fillRR(ctx, '#2f333a', x - 0.8, by + 6, 1.6, 4, 0.6);
    fillRR(ctx, fabric, x - 5.5, by, 11, occupied ? 7.5 : 10, 2.6);
    fillRR(ctx, hi, x - 4.6, by + 0.8, 9.2, 1.6, 0.8);
    ctx.fillStyle = acc; ctx.globalAlpha = 0.7; ctx.fillRect(x - 3.5, by + (occupied ? 5.6 : 8), 7, 0.9); ctx.globalAlpha = 1;
    if (this.absentSign) {
      this.absentSign = false;
      const sy = y + 1.5;
      ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 0.4; ctx.beginPath(); ctx.moveTo(x - 4, by + 1); ctx.lineTo(x - 6, sy); ctx.moveTo(x + 4, by + 1); ctx.lineTo(x + 6, sy); ctx.stroke();
      fillRR(ctx, 'rgba(0,0,0,0.2)', x - 9.6, sy + 0.6, 19.2, 6.6, 1);
      fillRR(ctx, '#f3eee4', x - 10, sy, 20, 6.4, 1); fillRR(ctx, '#8590a2', x - 10, sy, 2, 6.4, 1);
      ctx.fillStyle = '#4b5563'; ctx.font = `700 3.5px ${FONT_FAMILY}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillText('ABSENT', x + 1, sy + 3.3, 16); ctx.textAlign = 'start';
    }
  }

  private door(ctx: Ctx, i: number) {
    const L = this.layout!, d = L.doors[i], o = this.doorOpen[i];
    const ext = d.kind === 'entrance';
    const g = wallFace(d.row, ext);
    const x0 = d.col * TILE, W = d.w * TILE, Z = g.faceBottom - g.faceTop;
    const leafW = (W / 2) * (1 - 0.82 * o);
    const glass = d.kind !== 'wood';
    for (const side of [0, 1]) {
      const lx = side === 0 ? x0 : x0 + W - leafW;
      if (glass) {
        ctx.fillStyle = ext ? 'rgba(170,205,222,0.55)' : 'rgba(196,222,232,0.5)'; ctx.fillRect(lx, g.faceTop, leafW, Z);
        ctx.strokeStyle = ext ? '#4f565f' : '#7b828c'; ctx.lineWidth = 0.8; ctx.strokeRect(lx + 0.4, g.faceTop + 0.4, leafW - 0.8, Z - 0.8);
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(lx + 1.5, g.faceTop + 1.5, 0.8, Z - 3);
        if (ext && leafW > 4) { ctx.fillStyle = UI.amber; ctx.fillRect(lx + 1, g.faceTop + Z * 0.55, leafW - 2, 0.9); }
      } else {
        fillRR(ctx, '#b08e61', lx, g.faceTop, leafW, Z, 0.6);
        ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(lx + 1, g.faceTop + 1.5, Math.max(0, leafW - 2), 0.5);
        if (leafW > 3) { ctx.fillStyle = '#d9d4cc'; ctx.fillRect(side === 0 ? lx + leafW - 2 : lx + 1, g.faceTop + Z * 0.5, 1, 2); }
      }
    }
    // linteau
    ctx.fillStyle = ext ? '#383c43' : '#4a4f58'; ctx.fillRect(x0 - 1, g.capTop + (ext ? 2 : 3), W + 2, 2);
  }

  private deskDynamic(ctx: Ctx, world: OfficeWorld, id: string, di: number, t: number) {
    const L = world.layout, d = L.desks[di], c = world.byId.get(id);
    const look = this.looks.get(id) ?? DEFAULT_LOOK;
    const scr = deskScreens(d, look);
    const disabled = !c || c.vis.disabled;
    for (let k = 0; k < scr.length; k++) {
      const s = scr[k];
      let mode: ScreenMode = disabled ? 'off' : c!.vis.screen;
      if (!disabled && mode === 'off' && c!.present && c!.atDesk) mode = 'standby';
      if (!s.main && (mode === 'standby' || mode === 'quota' || mode === 'error')) mode = mode === 'standby' ? 'off' : mode;
      this.screen(ctx, s.x, s.y, s.w, s.h, mode, t + k * 1.7, !s.main);
      if (s.main && !disabled && c!.agent.state === 'working' && c!.atDesk && c!.agent.actions?.length) this.actionFeed(ctx, s, c!.agent.actions, c!.agent.toolKind);
    }
    // plaque nominative et jalons réels (histoire)
    const st = this.story.agents[id];
    const prov = st?.provider === 'claude' ? UI.amber : st?.provider === 'codex' ? UI.info : '#9aa3b5';
    fillRR(ctx, '#fbfbfd', d.col * TILE + 18, d.row * TILE + 9.2, 12, 2.8, 0.8); fillRR(ctx, prov, d.col * TILE + 18, d.row * TILE + 9.2, 1.8, 2.8, 0.8);
    if (st && st.milestones.includes(1)) { ctx.fillStyle = '#e9b949'; star(ctx, d.col * TILE + 32.5, d.row * TILE + 10.6, 1.3); }
    if (st && st.next) { ctx.save(); ctx.translate(d.col * TILE + 5.2, d.row * TILE + 8.4); ctx.rotate(-0.12); fillRR(ctx, '#ffe58a', -2.2, -2.2, 4.4, 4.4, 0.4); ctx.fillStyle = '#f26d5d'; ctx.fillRect(-2.2, -2.2, 4.4, 0.8); ctx.restore(); }
    // livraisons reçues pas encore traitées : colis posé au coin du bureau (avec le nombre s'il y en a plusieurs)
    const nIn = c?.agent.inbox ?? 0;
    if (nIn > 0) {
      this.parcel(ctx, d.col * TILE + 39, d.row * TILE + 0.5, 8, 6);
      if (nIn > 1) { fillRR(ctx, UI.amber, d.col * TILE + 44.5, d.row * TILE - 2.5, 5, 4, 1.5); ctx.font = `700 3px ${FONT_FAMILY}`; ctx.fillStyle = '#1b1305'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(Math.min(9, nIn)), d.col * TILE + 47, d.row * TILE - 0.4); ctx.textAlign = 'start'; }
    }
  }

  /** Ascenseur : l'indicateur montre l'étage de la cabine (▲ / ▼ pendant le trajet), les portes s'ouvrent quand quelqu'un
   * entre ou sort (cabine éclairée). Piloté par la simulation (personnages et figurants). */
  private elevator(ctx: Ctx, world: OfficeWorld, level: number, x: number, W: number, top: number, H: number) {
    const lift = world.lift, moving = lift.moveUntil > 0;
    ctx.font = `700 1.8px ${FONT_FAMILY}`; ctx.fillStyle = moving ? '#ffd88a' : '#f5c26b'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(moving ? (lift.target > lift.level ? '▲' : '▼') : lift.level === 0 ? 'RDC' : String(lift.level), x + W / 2, top - 0.2); ctx.textAlign = 'start';
    // voyant d'appel : allumé tant que la cabine vient vers cet étage
    if (moving && lift.target === level) { ctx.fillStyle = '#ffd88a'; ctx.beginPath(); ctx.arc(x + W - 2.5, top + H / 2 + 0.5, 0.55, 0, 7); ctx.fill(); }
    const open = easeOutCubic(clamp01(this.liftOpen[level] ?? 0));
    if (open > 0.02) {
      const gap = (W - 6) / 2 * open;
      ctx.fillStyle = '#e9dcc0'; ctx.fillRect(x + W / 2 - gap, top + 1.6, gap * 2, H + 0.4);
      ctx.fillStyle = 'rgba(255,240,205,0.9)'; ctx.fillRect(x + W / 2 - gap, top + 1.6, gap * 2, 1.2);
      ctx.fillStyle = 'rgba(90,80,60,0.35)'; ctx.fillRect(x + W / 2 - gap, top + H - 1, gap * 2, 2);
      ctx.fillStyle = '#aab1ba'; ctx.fillRect(x + W / 2 - gap - 0.5, top + 1.6, 0.5, H + 0.4); ctx.fillRect(x + W / 2 + gap, top + 1.6, 0.5, H + 0.4);
    }
  }

  /** Boîte aux lettres de l'accueil : un courrier par rapport réel arrivé depuis la dernière visite de la bibliothèque. */
  private mailbox(ctx: Ctx, x: number, y: number, t: number) {
    const n = Math.min(4, this.mail);
    for (let k = 0; k < n; k++) { fillRR(ctx, k % 2 ? '#f4efe3' : '#fbf8f1', x + 4.5 + k * 0.9, y - 4.6 - k * 0.6, 6, 2.6, 0.3); ctx.fillStyle = '#c9b48a'; ctx.fillRect(x + 4.5 + k * 0.9, y - 4.6 - k * 0.6, 6, 0.4); }
    // drapeau levé s'il y a du courrier
    ctx.fillStyle = '#5a5f66'; ctx.fillRect(x + 13.2, n ? y - 8 : y - 2, 0.7, n ? 8 : 3);
    if (n) { const w = this.decor ? Math.sin(t * 3) * 0.4 : 0; ctx.fillStyle = '#e0453a'; ctx.beginPath(); ctx.moveTo(x + 13.9, y - 8); ctx.lineTo(x + 17 + w, y - 7); ctx.lineTo(x + 13.9, y - 5.6); ctx.closePath(); ctx.fill(); }
  }

  /** Petites animations de décor (coupées avec « Animations ») : plantes sous la clim, souffle de la clim,
   * voyants doux (imprimante, fontaine, distributeur, borne), bulles de la fontaine. */
  private ambientFx(ctx: Ctx, f: Layout['furniture'][number], i: number, t: number) {
    const x = f.col * TILE, y = f.row * TILE;
    switch (f.kind) {
      case 'ac_unit': {
        ctx.strokeStyle = 'rgba(200,225,245,0.5)'; ctx.lineWidth = 0.5;
        for (let k = 0; k < 3; k++) {
          const p = (t * 0.5 + k / 3) % 1; ctx.globalAlpha = (1 - p) * 0.7;
          ctx.beginPath(); const yy = y + 12 + p * 10;
          for (let s = 0; s <= 8; s++) { const xx = x + 4 + s * 3; const dy = Math.sin(s * 1.3 + t * 3 + k) * 0.8; if (s) ctx.lineTo(xx, yy + dy); else ctx.moveTo(xx, yy + dy); }
          ctx.stroke();
        }
        ctx.globalAlpha = 1; break;
      }
      case 'plant': case 'plant_tall': {
        if (!this.nearAc.has(i)) break;
        const tall = f.kind === 'plant_tall', cx = x + 8, cy = tall ? y - 8 : y + 2, r = tall ? 9.5 : 7.5;
        for (let k = 0; k < 3; k++) {
          const a = -1.9 + k * 1.1 + Math.sin(t * 2.4 + k * 1.7 + i) * 0.22;
          ctx.fillStyle = k % 2 ? '#78ad7f' : '#5f9a68';
          ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * r * 0.75, cy + Math.sin(a) * r * 0.6, r * 0.34, r * 0.16, a, 0, 7); ctx.fill();
        }
        break;
      }
      case 'printer': { const on = Math.sin(t * 1.6 + i) > 0.2; ctx.fillStyle = on ? '#4ccaa1' : '#25695a'; ctx.beginPath(); ctx.arc(x + 12, y - 4, 0.6, 0, 7); ctx.fill(); break; }
      case 'water_cooler': {
        ctx.fillStyle = Math.sin(t * 0.9 + i) > 0 ? '#6fb0f2' : '#3d6a96'; ctx.beginPath(); ctx.arc(x + 8, y - 1, 0.5, 0, 7); ctx.fill();
        const p = (t * 0.35 + i * 0.13) % 1; if (p < 0.5) { ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.beginPath(); ctx.arc(x + 7.4 + Math.sin(p * 12) * 0.5, y - 9 - p * 8, 0.45, 0, 7); ctx.fill(); }
        break;
      }
      case 'vending': { ctx.globalAlpha = 0.25 + 0.2 * (0.5 + 0.5 * Math.sin(t * 1.3 + i)); ctx.fillStyle = '#ffe9b0'; ctx.fillRect(x + 3, y - 24, 18, 2); ctx.globalAlpha = 1; break; }
      case 'kiosk': if (f.variant !== 1) { const p = (t * 0.4 + i * 0.3) % 1; ctx.fillStyle = 'rgba(245,167,66,0.55)'; ctx.fillRect(x + 5, y - 12 + p * 6, 6 * (1 - p), 0.5); } break;
      default: break;
    }
  }
  /** Plantes situées près d'une clim (indices de mobilier). */
  private nearAc: Set<number> = new Set();

  /** Rue : voitures garées ou en manœuvre, circulation, vélos, passants (figurants, ambiance). */
  private drawStreet(ctx: Ctx, night: number) {
    const S = this.street; if (!S) return;
    for (const s of S.spots) if (s.state !== 'empty') this.car(ctx, s.x, s.y, CAR_COLORS[s.color], s.state === 'parked' ? (s.x % 2 ? 1 : -1) : s.dir, night, s.state !== 'parked');
    for (const v of S.vans) this.van(ctx, v.x, v.y, v.state === 'stop', night);
    for (const m of S.movers) {
      if (m.kind === 'car') this.car(ctx, m.x, m.y, CAR_COLORS[m.color], m.vx > 0 ? 1 : -1, night, true);
      else if (m.kind === 'bike') this.bike(ctx, m.x, m.y, m.vx > 0 ? 1 : -1, m.phase, AVATARS[m.style % AVATARS.length], CAR_COLORS[m.color]);
      else {
        const P = this.streetP; P.pose = 'walk'; P.dir = m.vx > 0 ? 2 : 3; P.phase = m.phase; P.hands = 0; P.breath = 0; P.hold = 0; P.talking = false; P.mood = 0;
        ctx.save(); ctx.translate(m.x, m.y + 7); ctx.scale(0.92, 0.92); drawAvatar(ctx, AVATARS[m.style % AVATARS.length], P); ctx.restore();
      }
    }
  }
  private streetP: AvatarParams = { pose: 'walk', dir: 2, phase: 0, hands: 0, breath: 0 };
  private car(ctx: Ctx, x: number, y: number, color: string, dir: number, night: number, moving: boolean) {
    const w = 28, h = 11, x0 = x - w / 2, y0 = y - h / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(x, y + h / 2 + 0.5, w / 2 + 1, 2.4, 0, 0, 7); ctx.fill();
    fillRR(ctx, color, x0, y0 - 2, w, h + 2, 3.4);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x0 + 1, y0 + h - 3, w - 2, 1.6);
    fillRR(ctx, '#26323d', x0 + (dir > 0 ? 9 : 7), y0 - 0.6, 12, h - 3.4, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x0 + (dir > 0 ? 10 : 8), y0, 4, h - 5);
    ctx.fillStyle = '#16181c';
    for (const wx of [x0 + 5, x0 + w - 5]) { ctx.beginPath(); ctx.ellipse(wx, y0 + h, 2.6, 1.4, 0, 0, 7); ctx.fill(); }
    const fx = dir > 0 ? x0 + w - 1.2 : x0 + 0.2, bx = dir > 0 ? x0 + 0.2 : x0 + w - 1.2;
    ctx.fillStyle = night > 0.4 && moving ? '#fff4c8' : '#e8e2c8'; ctx.fillRect(fx, y0 + 1, 1, 2.4); ctx.fillRect(fx, y0 + h - 4.4, 1, 2.4);
    ctx.fillStyle = night > 0.4 ? '#ff4a3d' : '#b33a32'; ctx.fillRect(bx, y0 + 1, 1, 2); ctx.fillRect(bx, y0 + h - 4, 1, 2);
  }
  /** Camionnette de livraison (blanche, bande orange, « LIVRAISON ») ; feux de détresse à l'arrêt. */
  private van(ctx: Ctx, x: number, y: number, stopped: boolean, night: number) {
    const w = 36, h = 13, x0 = x - w / 2, y0 = y - h / 2 - 1;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(x, y + h / 2 + 0.5, w / 2 + 1, 2.6, 0, 0, 7); ctx.fill();
    fillRR(ctx, '#eef0f2', x0, y0 - 4, w - 9, h + 4, 2.2);                 // caisse
    fillRR(ctx, '#e3e6ea', x0 + w - 11, y0 - 1, 11, h + 1, 3);              // cabine (vers la droite)
    fillRR(ctx, '#26323d', x0 + w - 8, y0, 6, h - 4, 1.6);                  // pare-brise
    ctx.fillStyle = UI.amber; ctx.fillRect(x0, y0 + 2.5, w - 9, 1.6);
    ctx.font = `700 3.2px ${FONT_FAMILY}`; ctx.fillStyle = '#4b5563'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('LIVRAISON', x0 + (w - 9) / 2, y0 - 1); ctx.textAlign = 'start';
    ctx.fillStyle = '#16181c';
    for (const wx of [x0 + 6, x0 + w - 6]) { ctx.beginPath(); ctx.ellipse(wx, y0 + h + 1, 2.8, 1.5, 0, 0, 7); ctx.fill(); }
    const blink = stopped && (this.decor ? Math.floor(Date.now() / 450) % 2 === 0 : true);
    ctx.fillStyle = blink ? '#ffb347' : night > 0.4 && !stopped ? '#fff4c8' : '#e8e2c8';
    ctx.fillRect(x0 + w - 1.2, y0 + 1, 1, 2.4); ctx.fillRect(x0 + w - 1.2, y0 + h - 4, 1, 2.4);
    ctx.fillStyle = blink ? '#ffb347' : night > 0.4 ? '#ff4a3d' : '#b33a32'; ctx.fillRect(x0 + 0.2, y0 - 2, 1, 2.2); ctx.fillRect(x0 + 0.2, y0 + h - 3, 1, 2.2);
  }
  private bike(ctx: Ctx, x: number, y: number, dir: number, phase: number, style: AvatarStyle, color: string) {
    ctx.strokeStyle = '#2b2f36'; ctx.lineWidth = 0.7;
    for (const wx of [x - 5, x + 5]) { ctx.beginPath(); ctx.arc(wx, y + 4, 3, 0, 7); ctx.stroke(); }
    ctx.strokeStyle = color; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(x - 5, y + 4); ctx.lineTo(x - 1, y - 1); ctx.lineTo(x + 4, y - 1); ctx.lineTo(x + 5, y + 4); ctx.moveTo(x - 1, y - 1); ctx.lineTo(x + 1, y + 4); ctx.stroke();
    const P = this.streetP; P.pose = 'walk'; P.dir = dir > 0 ? 2 : 3; P.phase = phase; P.hands = 0; P.breath = 0; P.hold = 0; P.talking = false; P.mood = 0;
    ctx.save(); ctx.translate(x, y + 1); ctx.scale(0.85, 0.85); drawAvatar(ctx, style, P); ctx.restore();
  }

  /** Arrêt d'urgence réel : éclairage rouge tamisé sur tout le bâtiment, gyrophare et bandeau « SUSPENDU » sur la régie. */
  private emergencyVeil(ctx: Ctx, L: Layout, t: number, x0: number, y0: number, x1: number, y1: number, withConsole: boolean) {
    const pulse = this.decor ? 0.5 + 0.5 * Math.sin(t * 2.2) : 0.5;
    ctx.fillStyle = `rgba(70,6,8,${0.26 + 0.05 * pulse})`; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    if (!withConsole) return;
    const g = consoleGeom(L.control), m = g.center;
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.25 + 0.35 * pulse;
    ctx.drawImage(this.glow('#ff3b30'), m.x + m.w / 2 - 60, m.y - 50, 120, 110);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    const bw = Math.max(46, m.w + 8), bx = m.x + m.w / 2 - bw / 2, by = m.y - 15;
    fillRR(ctx, '#2a0b0b', bx, by, bw, 9.5, 1.6); ctx.strokeStyle = '#f26d5d'; ctx.lineWidth = 0.6; rr(ctx, bx, by, bw, 9.5, 1.6); ctx.stroke();
    ctx.font = `800 4.2px ${FONT_FAMILY}`; ctx.fillStyle = '#ffd9d4'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('SUSPENDU', bx + bw / 2, by + 3.6); ctx.font = `600 2px ${FONT_FAMILY}`; ctx.fillStyle = '#f2a39a';
    ctx.fillText('ARRÊT D’URGENCE · AUCUN LANCEMENT', bx + bw / 2, by + 7.4, bw - 4); ctx.textAlign = 'start';
    ctx.fillStyle = pulse > 0.5 ? '#ff4d40' : '#8a2a24'; ctx.beginPath(); ctx.arc(bx + 4, by + 3.6, 1.6, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(bx + bw - 4, by + 3.6, 1.6, 0, 7); ctx.fill();
  }

  /** Barre de titre de l'écran : la cible réelle de la dernière action (fichier, site, commande) ; l'animation de
   * l'activité reste visible dessous. Lisible en zoomant ; texte brut, rien n'est interprété. */
  private actionFeed(ctx: Ctx, s: { x: number; y: number; w: number; h: number }, actions: readonly string[], kind: ToolKind | null) {
    const title = screenTarget(kind, actions[actions.length - 1]);
    if (!title) return;
    const bh = Math.max(1.6, s.h * 0.3);
    ctx.save(); rr(ctx, s.x, s.y, s.w, s.h, 0.8); ctx.clip();
    ctx.fillStyle = kind === 'web' ? '#e9edf2' : kind === 'read' ? '#e7dfcc' : '#1f2630'; ctx.fillRect(s.x, s.y, s.w, bh);
    const dot = kind === 'web' ? '#6fb0f2' : kind === 'exec' ? '#4ccaa1' : kind === 'write' ? '#f5a742' : '#9aa3b5';
    ctx.fillStyle = dot; ctx.beginPath(); ctx.arc(s.x + 0.9, s.y + bh / 2, Math.min(0.45, bh * 0.25), 0, 7); ctx.fill();
    ctx.font = `600 ${Math.min(1.25, bh * 0.72)}px ${FONT_FAMILY}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'start';
    ctx.fillStyle = kind === 'web' || kind === 'read' ? '#27303b' : '#e6edf3';
    ctx.fillText(title, s.x + 1.7, s.y + bh / 2 + 0.05);
    ctx.restore();
  }

  private screen(ctx: Ctx, x: number, y: number, w: number, h: number, mode: ScreenMode, t: number, secondary: boolean) {
    if (mode === 'off') return;
    ctx.save(); rr(ctx, x, y, w, h, 0.8); ctx.clip();
    switch (mode) {
      case 'standby': { ctx.fillStyle = '#161a20'; ctx.fillRect(x, y, w, h); { ctx.fillStyle = 'rgba(245,167,66,0.35)'; const p = this.decor ? (t * 0.15) % 1 : 0.5; ctx.beginPath(); ctx.arc(x + 2 + p * (w - 4), y + h / 2 + Math.sin(p * 6.28) * (h / 4), 0.7, 0, 7); ctx.fill(); } break; }
      case 'code': case 'terminal': {
        const term = mode === 'terminal';
        ctx.fillStyle = term ? '#0b1310' : '#151a22'; ctx.fillRect(x, y, w, h);
        const k = Math.floor(t * (term ? 2.6 : 1.4)), f = (t * (term ? 2.6 : 1.4)) % 1;
        for (let r = 0; r < 7; r++) {
          const idx = k - r;
          ctx.fillStyle = term ? (hash2(idx, 4) < 0.2 ? '#e6c04c' : '#4ccaa1') : (hash2(idx, 4) < 0.25 ? '#f5a742' : hash2(idx, 6) < 0.4 ? '#6fb0f2' : '#c9ced8');
          ctx.fillRect(x + 1 + (term ? 0 : (hash2(idx, 5) < 0.4 ? 1.5 : 0)), y + h - 1.6 - (r + f) * 1.5, 2 + hash2(idx, 3) * (w - 5), 0.7);
        }
        if (term && Math.sin(t * 6) > 0) { ctx.fillStyle = '#4ccaa1'; ctx.fillRect(x + 1, y + h - 1.6, 1.2, 0.8); }
        break;
      }
      case 'read': {
        ctx.fillStyle = '#f4efe3'; ctx.fillRect(x, y, w, h);
        const sc = (t * 0.8) % 1.8;
        ctx.fillStyle = '#9a8f78';
        for (let r = -1; r < 7; r++) ctx.fillRect(x + 1.4, y + 1.2 + r * 1.8 - sc, 4 + hash2(r + Math.floor(t * 0.45), 9) * (w - 6), 0.7);
        break;
      }
      case 'web': {
        ctx.fillStyle = '#eef3f9'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#6fb0f2'; ctx.fillRect(x, y, w, 1.8);
        ctx.fillStyle = '#c5d8ef'; ctx.fillRect(x + 1, y + 3, w * 0.4, h - 5); ctx.fillRect(x + w * 0.48, y + 3, w * 0.45, 1.2); ctx.fillRect(x + w * 0.48, y + 5.4, w * 0.35, 1.2);
        ctx.fillStyle = '#2f7fd6'; ctx.fillRect(x, y + h - 0.8, ((t * 0.6) % 1) * w, 0.8);
        break;
      }
      case 'mcp': {
        ctx.fillStyle = '#231d3d'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#a58be0'; ctx.beginPath(); ctx.arc(x + 2.4, y + h / 2, 1.3, 0, 7); ctx.arc(x + w - 2.4, y + h / 2, 1.3, 0, 7); ctx.fill();
        ctx.fillStyle = '#4a3f7a'; ctx.fillRect(x + 3.6, y + h / 2 - 0.4, w - 7.2, 0.8);
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + 3.6 + ((t * 0.9) % 1) * (w - 7.2), y + h / 2, 0.8, 0, 7); ctx.fill();
        break;
      }
      case 'error': {
        ctx.fillStyle = Math.sin(t * 5) > 0 ? '#5e1b16' : '#3a100d'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#f26d5d'; ctx.fillRect(x + w / 2 - 0.6, y + 1.6, 1.2, h - 5); ctx.fillRect(x + w / 2 - 0.6, y + h - 2.6, 1.2, 1.2);
        break;
      }
      case 'quota': {
        ctx.fillStyle = '#2a2414'; ctx.fillRect(x, y, w, h);
        drawIcon(ctx, 'rate_limited', x + w / 2, y + h / 2, Math.min(w, h) * 0.8, UI.warn);
        break;
      }
      default: { // generic
        ctx.fillStyle = '#211b12'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = UI.amber;
        for (let k = 0; k < 3; k++) { ctx.globalAlpha = 0.35 + 0.65 * clamp01(Math.sin(t * 4 - k * 0.9) * 0.5 + 0.5); ctx.beginPath(); ctx.arc(x + w / 2 - 3 + k * 3, y + h / 2, 0.9, 0, 7); ctx.fill(); }
        ctx.globalAlpha = 1;
      }
    }
    if (secondary) { ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x, y, w, h); }
    ctx.restore();
  }

  private furnDynamic(ctx: Ctx, world: OfficeWorld, cond: Conductor, i: number, t: number) {
    this.lampT = t;
    const f = world.layout.furniture[i];
    if (f.kind === 'mailbox') { this.mailbox(ctx, f.col * TILE, f.row * TILE, t); return; }
    if (this.decor) this.ambientFx(ctx, f, i, t);
    if (f.kind === 'rack') {
      // voyants : plus nombreux et plus vifs quand des exécutions tournent réellement ou que le processeur travaille
      const running = cond.visual.running, sys = this.system, L = world.layout;
      const busy = Math.min(1, Math.max(running / 3, sys ? sys.cpu_percent / 100 : 0));
      const x = f.col * TILE, y = f.row * TILE;
      if (i === L.staff.gaugeRack && sys) { this.rackGauges(ctx, x, y, sys.mem.percent, sys.disk.percent); return; }
      if (i === L.staff.netRack && this.providerDown) this.rackLamp(ctx, x, y, UI.err);
      for (let r = 0; r < 7; r++) for (let k = 0; k < 2; k++) {
        const seed = hash2(f.col * 7 + k, f.row * 13 + r, 3);
        const rate = 0.4 + busy * 6 + seed * 1.5;
        const on = busy > 0.05 ? Math.sin(t * rate + seed * 40) > 0.1 - busy * 0.6 : seed < 0.45 || (this.decor && Math.sin(t * 0.5 + seed * 30) > 0.92);
        ctx.fillStyle = on ? (seed < 0.08 ? UI.amber : running > 0 && seed > 0.85 ? UI.info : UI.ok) : 'rgba(80,90,100,0.6)';
        ctx.fillRect(x + 4 + k * 3.2, y - 5.3 + r * 2.6, 1.6, 1);
      }
    } else if (f.kind === 'kiosk' && f.variant === 1) { // poste de supervision : petites courbes réelles (processeur, mémoire)
      const sys = this.system; if (!sys) return;
      const x = f.col * TILE + 2.5, y = f.row * TILE - 16;
      ctx.fillStyle = UI.ok; ctx.fillRect(x + 1.5, y + 9 - 7 * sys.cpu_percent / 100, 2.6, 7 * sys.cpu_percent / 100);
      ctx.fillStyle = sys.mem.percent >= 85 ? UI.err : UI.info; ctx.fillRect(x + 5.5, y + 9 - 7 * sys.mem.percent / 100, 2.6, 7 * sys.mem.percent / 100);
    } else if (f.kind === 'coffee_machine' && this.decor) {
      const x = f.col * TILE + 8, y = f.row * TILE - 22;
      for (let k = 0; k < 3; k++) {
        const p = (t * 0.45 + k / 3 + f.col * 0.13) % 1;
        ctx.globalAlpha = (1 - p) * 0.35; ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(x - 1 + Math.sin(p * 7 + k * 2) * 1.2, y - p * 8, 0.7 + p * 1.4, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (f.kind === 'console') this.consoleDynamic(ctx, world, cond, t);
    else if (f.kind === 'status_board') this.limitsBoard(ctx, f.col * TILE, f.w * TILE, f.row * TILE);
  }

  /** Jauges réelles mémoire (M) et disque (D) sur la façade d'une baie ; voyant d'alerte au-dessus si un seuil est dépassé. */
  private rackGauges(ctx: Ctx, x: number, y: number, mem: number, disk: number) {
    const bar = (bx: number, pct: number, lim: number) => {
      const p = Math.max(0, Math.min(100, pct)) / 100;
      fillRR(ctx, '#0f1216', bx, y - 5.8, 3.4, 15.4, 0.6);
      ctx.fillStyle = pct >= lim ? UI.err : pct >= lim - 15 ? UI.warn : UI.ok;
      ctx.fillRect(bx + 0.5, y + 9.1 - 14.4 * p, 2.4, 14.4 * p);
    };
    bar(x + 3.6, mem, 85); bar(x + 8.6, disk, 90);
    ctx.fillStyle = '#9aa3ae'; ctx.font = `700 2.4px ${FONT_FAMILY}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText('M', x + 5.3, y + 11.6); ctx.fillText('D', x + 10.3, y + 11.6); ctx.textAlign = 'start';
    if (mem >= 85 || disk >= 90) this.rackLamp(ctx, x, y, UI.warn);
  }
  private rackLamp(ctx: Ctx, x: number, y: number, color: string) {
    const on = Math.sin(this.lampT * 3) > -0.3;
    fillRR(ctx, '#2a2e35', x + 5.5, y - 14, 5, 2, 0.8);
    ctx.fillStyle = on ? color : 'rgba(120,120,120,0.6)'; ctx.beginPath(); ctx.arc(x + 8, y - 14, 1.9, Math.PI, 0); ctx.fill();
  }

  /** Dernier tronçon de mur (rangée `row`) qui commence avant la fin du décor : c'est après lui qu'on dessine son contenu,
   * sinon le tronçon suivant (image pré-calculée) recouvre la partie droite du tableau. */
  private lastSegFor(row: number, endCol: number): number {
    const b = this.bake;
    if (this.segStarts.of !== b) {
      const rows = new Map<number, number[]>();
      for (const p of b?.list ?? []) if (p.kind === PROP_WALL) { const a = rows.get(p.row) ?? []; a.push(p.ref); rows.set(p.row, a); }
      this.segStarts = { of: b, rows };
    }
    let best = -1;
    for (const s of this.segStarts.rows.get(row) ?? []) if (s <= endCol && s > best) best = s;
    return best;
  }

  private wallDynamic(ctx: Ctx, world: OfficeWorld, cond: Conductor, c0: number, row: number, _t: number) {
    const L = world.layout;
    for (const w of L.wallDecor) {
      if (w.row !== row || this.lastSegFor(row, w.col + w.w) !== c0) continue;
      const ext = isExtRow(L, w.col, row);
      const g = wallFace(row, ext), top = g.faceTop + 2, H = g.faceBottom - g.faceTop - 5;
      if (w.kind === 'clock') {
        const cx = w.col * TILE + 8, cy = top + H / 2;
        const ah = (this.clockH / 12) * Math.PI * 2 - Math.PI / 2, am = (this.clockM / 60) * Math.PI * 2 - Math.PI / 2;
        ctx.strokeStyle = '#2c3038'; ctx.lineCap = 'round';
        ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ah) * 2.2, cy + Math.sin(ah) * 2.2); ctx.stroke();
        ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(am) * 3.3, cy + Math.sin(am) * 3.3); ctx.stroke();
        if (this.decor) { // trotteuse (heure réelle)
          const as = ((Date.now() / 1000) % 60) / 60 * Math.PI * 2 - Math.PI / 2;
          ctx.strokeStyle = '#d0453a'; ctx.lineWidth = 0.25; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(as) * 3.6, cy + Math.sin(as) * 3.6); ctx.stroke();
        }
      } else if (w.kind === 'elevator') this.elevator(ctx, world, levelOfRow(L, row), w.col * TILE, w.w * TILE, top, H);
      else if (w.kind === 'whiteboard' && w.text) {
        const rep = this.story.boards[w.text];
        const x = w.col * TILE + 4, W = w.w * TILE - 8;
        ctx.textBaseline = 'middle'; ctx.textAlign = 'start';
        ctx.font = `700 2.6px ${FONT_FAMILY}`; ctx.fillStyle = '#5b6472'; ctx.fillText(w.text.toUpperCase(), x + 1, top + 2.2, W - 2);
        if (rep) { ctx.font = `600 2.6px ${FONT_FAMILY}`; ctx.fillStyle = '#2c3345'; ctx.fillText(rep.title, x + 1, top + 5.8, W - 2); ctx.fillStyle = UI.amber; ctx.fillRect(x + 1, top + 3.8, 4, 0.5); }
        else { ctx.fillStyle = 'rgba(120,130,150,0.35)'; ctx.fillRect(x + 1, top + 5.6, 10, 0.6); }
      } else if (w.kind === 'planning') this.planningBoard(ctx, w.col * TILE, w.w * TILE, top);
      else if (w.kind === 'tv' && L.rooms[w.room]?.kind === 'meeting') {
        let n = 0, via: string | null = null;
        for (const c of world.chars) if (c.vis.talk && c.present) { n++; via = via && via !== c.vis.talk ? 'mixte' : c.vis.talk; }
        const x = w.col * TILE + w.w * TILE / 2;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `600 ${n ? 2.8 : 3.4}px ${FONT_FAMILY}`; ctx.fillStyle = n ? '#f5c26b' : '#9aa3ae';
        ctx.fillText(n ? `CONVERSATION${n > 1 ? `S · ${n}` : ''}` : 'Salle disponible', x, top + H / 2 - (n ? 1.3 : 0), w.w * TILE - 10);
        if (n) { ctx.font = `500 2.2px ${FONT_FAMILY}`; ctx.fillStyle = '#c9cfd6'; ctx.fillText(via === 'discord' ? 'via Discord' : via === 'chat' ? 'via la page Chat' : 'Chat et Discord', x, top + H / 2 + 2.2, w.w * TILE - 10); }
        ctx.textAlign = 'start';
      }
      else if (w.kind === 'screen') {
        // file d'approbation réelle : un carré bleu par demande en attente
        const n = cond.visual.approvals, x = w.col * TILE + 5, W = w.w * TILE - 10;
        ctx.font = `600 2.6px ${FONT_FAMILY}`; ctx.fillStyle = '#9aa3ae'; ctx.textBaseline = 'middle'; ctx.fillText('APPROBATIONS', x, top + 2.4, W);
        for (let i = 0; i < Math.min(8, n); i++) { ctx.fillStyle = UI.info; ctx.fillRect(x + i * 4, top + 4.8, 3, 3); }
        if (!n) { ctx.fillStyle = 'rgba(154,163,174,0.5)'; ctx.fillRect(x, top + 6, 10, 0.6); }
      }
    }
  }

  /** Tableau du hall : prochaines missions planifiées réelles (heure de Paris) et compte à rebours de la première. */
  private planningBoard(ctx: Ctx, x0: number, W0: number, top: number) {
    const x = x0 + 4, W = W0 - 8, now = Date.now();
    const s = planningSummary(this.boards?.planning);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'start';
    ctx.font = `700 2.2px ${FONT_FAMILY}`; ctx.fillStyle = UI.amber; ctx.fillText('PLANNING DU JOUR', x, top + 0.6, W * 0.62);
    if (!s) { ctx.fillStyle = 'rgba(200,205,212,0.35)'; ctx.fillRect(x, top + 4, W * 0.5, 0.6); return; }
    ctx.textAlign = 'right'; ctx.fillStyle = '#7f8894'; ctx.font = `600 2px ${FONT_FAMILY}`;
    ctx.fillText(s.total ? `${s.done}/${s.total} faites` : '', x + W, top + 0.6); ctx.textAlign = 'start';
    const rows = s.upcoming.slice(0, 2);
    if (s.paused) { ctx.font = `700 2.2px ${FONT_FAMILY}`; ctx.fillStyle = UI.err; ctx.fillText('ARRÊT D’URGENCE · SUSPENDU', x, top + 4.2, W); }
    else if (!rows.length) {
      ctx.font = `600 2.2px ${FONT_FAMILY}`; ctx.fillStyle = '#aeb5bf';
      ctx.fillText(s.later ? `Rien d’autre aujourd’hui · ensuite ${hhmm(s.later.at)}` : 'Aucune mission planifiée', x, top + 4.2, W);
    }
    rows.forEach((it, i) => {
      const y = top + 3.9 + i * 3.1, live = it.status === 'running';
      ctx.font = `700 2.3px ${FONT_FAMILY}`; ctx.fillStyle = live ? UI.ok : '#f2c46b'; ctx.fillText(hhmm(it.at), x, y, 9);
      ctx.font = `600 2.2px ${FONT_FAMILY}`; ctx.fillStyle = it.agent_enabled ? '#dfe3e8' : '#7f8894';
      ctx.fillText(it.agent_name, x + 7.4, y, W - 7.4 - 10);
      ctx.textAlign = 'right'; ctx.fillStyle = live ? UI.ok : it.status === 'awaiting_approval' ? UI.info : '#9aa3ae';
      ctx.fillText(live ? 'en cours' : it.status === 'awaiting_approval' ? 'approbation' : !it.agent_enabled ? 'agent off' : countdown(it.at, now), x + W, y);
      ctx.textAlign = 'start';
    });
  }

  /** Écran sur pied de la salle serveur : limites d'usage réelles par fournisseur (barre = pourcentage connu,
   * trait fin = statut sans pourcentage, vide = aucun signal reçu). */
  private limitsBoard(ctx: Ctx, x0: number, W0: number, y: number) {
    const x = x0 + 3.6, W = W0 - 7.2, top = y - 22.6, v = limitViews(this.boards?.limits, Date.now());
    ctx.textBaseline = 'middle'; ctx.textAlign = 'start';
    ctx.font = `700 2.2px ${FONT_FAMILY}`; ctx.fillStyle = '#7fb5e8'; ctx.fillText('LIMITES D’USAGE', x, top + 1.4, W);
    ctx.font = `600 1.7px ${FONT_FAMILY}`; ctx.fillStyle = '#5d6672'; ctx.textAlign = 'right';
    ctx.fillText('5 h', x + 15.6, top + 4.6); ctx.fillText('7 j', x + W, top + 4.6); ctx.textAlign = 'start';
    (['claude', 'codex'] as const).forEach((p, i) => {
      const yy = top + 8.4 + i * 4.8, wins = v[p];
      ctx.font = `600 2.2px ${FONT_FAMILY}`; ctx.fillStyle = '#c9cfd6'; ctx.fillText(PROVIDER_FR[p], x, yy, 9);
      const slots = [wins.find((l) => l.window === 'five_hour'), wins.find((l) => l.window.startsWith('seven_day'))];
      slots.forEach((l, k) => {
        const gx = x + 9.4 + k * 8.4, gw = 6.6;
        ctx.fillStyle = '#1f242b'; ctx.fillRect(gx, yy - 1.1, gw, 2.2);
        if (!l) return;
        ctx.fillStyle = l.level === 'limited' ? UI.err : l.level === 'warning' || (l.pct ?? 0) >= 80 ? UI.warn : UI.ok;
        if (l.pct !== null) ctx.fillRect(gx, yy - 1.1, gw * Math.max(0.04, Math.min(1, l.pct / 100)), 2.2);
        else { ctx.globalAlpha = 0.6; ctx.fillRect(gx, yy - 0.3, gw, 0.6); ctx.globalAlpha = 1; }
      });
    });
  }

  private plateFx(ctx: Ctx, x: number, y: number, r: number, color: string, icon: IconName, pop: number) {
    const k = 0.55 + 0.45 * easeOutCubic(pop);
    ctx.save(); ctx.translate(x, y); ctx.scale(k, k); ctx.globalAlpha *= clamp01(pop * 2);
    ctx.fillStyle = 'rgba(24,27,34,0.94)'; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
    drawIcon(ctx, icon, 0, 0, r * 1.25, color);
    ctx.restore();
  }

  /** Effets propres au poste : alarme, quota, rappel d'erreur antérieure, outil en cours. */
  private deskFx(ctx: Ctx, x: number, y: number, c: Char, t: number) {
    const v = c.vis;
    if (v.alarm && !v.quota) {
      const p = 0.5 + 0.5 * Math.sin(t * 4);
      fillRR(ctx, '#7b3029', x + 41, y - 3.6, 5, 2.4, 1);
      ctx.fillStyle = p > 0.5 ? '#f26d5d' : '#c0463a'; ctx.beginPath(); ctx.arc(x + 43.5, y - 3.6, 2.2, Math.PI, 0); ctx.fill();
      this.plateFx(ctx, x + 24, y - 32 - 0.8 * p, 6.2 + 0.5 * p, '#f26d5d', ERROR_ICON[v.alarm], 1);
    } else if (v.quota) this.plateFx(ctx, x + 24, y - 32 - Math.sin(t * 2) * 0.6, 6.2, UI.warn, 'rate_limited', 1);
    else if (v.errorBadge) this.plateFx(ctx, x + 6, y - 10, 3.4, '#f26d5d', ERROR_ICON[v.errorBadge], 1);
    const k = v.disabled ? undefined : KIND_ICON[v.screen];
    if (k && c.agent.state === 'working') {
      const bx = x + 44, by = y - 10;
      ctx.fillStyle = k.color;
      for (let i = 0; i < 3; i++) { const f = ((t * 0.9 + i / 3) % 1); ctx.globalAlpha = (1 - f) * 0.9; ctx.beginPath(); ctx.arc(bx - 3 - f * 6, by, 0.7, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1;
      this.plateFx(ctx, bx + 1.2, by, 3.6, k.color, k.icon, 1);
    }
  }

  // ───────────── régie de l'orchestrateur ─────────────

  private card(ctx: Ctx, x: number, y: number, rot: number, k: number, tint = '#f6f7fa') {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(k, k);
    fillRR(ctx, tint, -2.8, -3.8, 5.6, 7.6, 1); fillRR(ctx, UI.amber, -2.8, -3.8, 5.6, 1.9, 1);
    ctx.fillStyle = '#9aa3b5'; ctx.fillRect(-1.8, -0.8, 3.6, 0.55); ctx.fillRect(-1.8, 0.7, 2.6, 0.55);
    ctx.restore();
  }

  private consoleDynamic(ctx: Ctx, world: OfficeWorld, cond: Conductor, t: number) {
    const L = world.layout, g = consoleGeom(L.control), v = cond.visual;
    const m = g.center;
    ctx.save(); rr(ctx, m.x + 1.4, m.y + 1.4, m.w - 2.8, m.h - 2.8, 2); ctx.clip();
    ctx.fillStyle = '#0f1318'; ctx.fillRect(m.x, m.y, m.w, m.h);
    for (let i = 0; i < 10; i++) { ctx.fillStyle = i < v.queueDepth ? UI.amber : 'rgba(255,255,255,0.07)'; ctx.fillRect(m.x + 4 + i * 4.5, m.y + 5, 3.4, 7); }
    for (let i = 0; i < Math.min(12, v.running); i++) { ctx.fillStyle = UI.ok; ctx.beginPath(); ctx.arc(m.x + 6 + i * 4, m.y + 17.4, 1.2, 0, 7); ctx.fill(); }
    for (let i = 0; i < Math.min(6, v.approvals); i++) { ctx.fillStyle = UI.info; ctx.fillRect(m.x + m.w - 7 - i * 4, m.y + 15.6, 2.8, 3.6); }
    if (v.running > 0) { ctx.fillStyle = 'rgba(245,167,66,0.14)'; ctx.fillRect(m.x, m.y + 2 + ((t * 8) % (m.h - 4)), m.w, 1.2); }
    ctx.restore();
    this.providerScreen(ctx, g.left, 'claude', cond, t);
    this.providerScreen(ctx, g.right, 'codex', cond, t);
    const depth = Math.min(14, v.queueDepth);
    for (let i = 0; i < depth; i++) { fillRR(ctx, '#f6f7fa', g.pile.x + (i % 2) * 0.4, g.pile.y + g.pile.h - 3 - i * 1.15, g.pile.w - 0.4, 1.6, 0.6); fillRR(ctx, UI.amber, g.pile.x + (i % 2) * 0.4, g.pile.y + g.pile.h - 3 - i * 1.15, 1.6, 1.6, 0.6); }
    for (let i = 0; i < Math.min(6, v.approvals); i++) { fillRR(ctx, '#e8f1fc', g.tray.x + (i % 2) * 0.4, g.tray.y + g.tray.h - 3 - i * 1.15, g.tray.w - 0.4, 1.6, 0.6); fillRR(ctx, UI.info, g.tray.x + (i % 2) * 0.4, g.tray.y + g.tray.h - 3 - i * 1.15, 1.6, 1.6, 0.6); }
    if (v.bell) {
      const sh = Math.sin(t * 60) * 0.5;
      ctx.strokeStyle = UI.amber; ctx.lineWidth = 0.8; ctx.lineCap = 'round';
      for (let k = 0; k < 2; k++) { ctx.globalAlpha = 0.9 - k * 0.35; ctx.beginPath(); ctx.arc(g.clock.x + sh, g.clock.y, 5.4 + k * 2.4 + ((t * 5) % 1) * 1.2, -0.9, 0.9); ctx.stroke(); ctx.beginPath(); ctx.arc(g.clock.x + sh, g.clock.y, 5.4 + k * 2.4 + ((t * 5) % 1) * 1.2, Math.PI - 0.9, Math.PI + 0.9); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
  }

  private providerScreen(ctx: Ctx, m: { x: number; y: number; w: number; h: number }, id: string, cond: Conductor, t: number) {
    const st = cond.providers[id], bad = cond.visual.providerAlert[id];
    ctx.save(); rr(ctx, m.x + 1.2, m.y + 1.2, m.w - 2.4, m.h - 2.4, 2); ctx.clip();
    ctx.fillStyle = bad ? '#2c1311' : '#0f1318'; ctx.fillRect(m.x, m.y, m.w, m.h);
    const cx = m.x + m.w / 2 - 3, cy = m.y + m.h / 2;
    if (id === 'claude') { ctx.strokeStyle = '#f5a742'; ctx.lineWidth = 1.1; ctx.lineCap = 'round'; ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + t * 0.15; ctx.moveTo(cx + Math.cos(a) * 1.4, cy + Math.sin(a) * 1.4); ctx.lineTo(cx + Math.cos(a) * 5.2, cy + Math.sin(a) * 5.2); } ctx.stroke(); }
    else drawIcon(ctx, 'code', cx, cy, 11, '#6fb0f2');
    ctx.fillStyle = bad ? UI.err : st === 'logged_in' ? UI.ok : 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.arc(m.x + m.w - 5, m.y + m.h - 5, 1.7, 0, 7); ctx.fill();
    ctx.restore();
  }

  private consoleBadges(ctx: Ctx, world: OfficeWorld, cond: Conductor, t: number) {
    const g = consoleGeom(world.layout.control), v = cond.visual;
    if (v.hourglass) this.plateFx(ctx, g.hourglass.x, g.hourglass.y - 6 - Math.sin(t * 3) * 0.6, 5.4, UI.warn, 'rate_limited', 1);
    if (v.providerAlert.claude) this.plateFx(ctx, g.left.x + g.left.w / 2, g.left.y - 6, 4.6, UI.err, 'failed', 1);
    if (v.providerAlert.codex) this.plateFx(ctx, g.right.x + g.right.w / 2, g.right.y - 6, 4.6, UI.err, 'failed', 1);
  }

  /** Fiches en vol : arc de la régie au poste (ou à la corbeille), traînée, onde à l'arrivée. Événements réels uniquement. */
  private flights(ctx: Ctx, world: OfficeWorld, cond: Conductor, now: number, lv: number) {
    const L = world.layout, g = consoleGeom(L.control), gl = levelOfY(L, g.postY);
    for (const f of cond.flights) {
      const p = (now - f.start) / FLIGHT_MS;
      if (p < 0) continue;
      const d = f.agentId ? L.deskByAgent.get(f.agentId) : undefined;
      if (f.kind === 'dispatch' && d) {
        // poste à un autre étage que la régie : vue de la régie, la fiche file vers l'ascenseur ; vue de l'étage, elle en sort
        const dl = levelOfRow(L, d.row), liftAt = (l: number) => L.portals.find((q) => q.level === l && q.kind === 'lift');
        if (lv !== gl && lv !== dl) continue;
        const from = lv === gl ? null : liftAt(lv), to = lv === dl ? null : liftAt(lv);
        const x0 = from ? from.x : g.pile.x + g.pile.w / 2, y0 = from ? from.y + 4 : g.pile.y - 2;
        const x1 = to ? to.x : d.col * TILE + 24, y1 = to ? to.y + 4 : d.row * TILE - 6;
        const cx = (x0 + x1) / 2, cy = Math.min(y0, y1) - 40;
        if (p <= 1) {
          for (let k = 5; k >= 0; k--) {
            const q = Math.max(0, easeInOut(p) - k * 0.035), u = 1 - q;
            ctx.globalAlpha = (1 - k / 6) * 0.5; ctx.fillStyle = UI.amber; ctx.beginPath(); ctx.arc(u * u * x0 + 2 * u * q * cx + q * q * x1, u * u * y0 + 2 * u * q * cy + q * q * y1, 1.7 - k * 0.2, 0, 7); ctx.fill();
          }
          const e = easeInOut(p), u = 1 - e;
          const bx = u * u * x0 + 2 * u * e * cx + e * e * x1, by = u * u * y0 + 2 * u * e * cy + e * e * y1;
          const dx = 2 * u * (cx - x0) + 2 * e * (x1 - cx);
          ctx.globalAlpha = 1; this.card(ctx, bx, by, Math.atan2(0.4, dx) * 0.6 + Math.sin(p * 9) * 0.12, 1 + Math.sin(p * Math.PI) * 0.25);
        } else {
          const lp = (now - f.start - FLIGHT_MS) / LAND_MS;
          ctx.globalAlpha = (1 - lp) * 0.8; ctx.strokeStyle = UI.amber; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(x1, y1, 3 + lp * 12, 0, 7); ctx.stroke();
        }
      } else if (f.kind === 'reject' && p <= 1) {
        const x0 = g.tray.x + g.tray.w / 2, y0 = g.tray.y, x1 = g.bin.x + g.bin.w / 2, y1 = g.bin.y + 2;
        const e = easeInOut(p), x = x0 + (x1 - x0) * e, y = y0 + (y1 - y0) * e - Math.sin(e * Math.PI) * 9;
        ctx.globalAlpha = 1 - clamp01((p - 0.8) * 5);
        this.card(ctx, x, y, e * 7, 1 - e * 0.55, '#f1c2bc');
      }
    }
    ctx.globalAlpha = 1;
  }

  private orchestrator(ctx: Ctx, world: OfficeWorld, cond: Conductor, t: number, now: number, ui: RenderUi) {
    const L = world.layout, g = consoleGeom(L.control), v = cond.visual;
    const fy = g.postY + 7, sel = ui.selectedId === ORCH_ID, hov = ui.hoverId === ORCH_ID;
    ctx.drawImage(this.shadow, g.postX - 11, fy - 4, 22, 8);
    const busy = v.pose !== 'watch' || v.queueDepth > 0 || v.running > 0;
    ctx.strokeStyle = sel || hov ? '#ffffff' : UI.amber; ctx.lineWidth = sel ? 1.5 : 1;
    ctx.globalAlpha = sel ? 0.9 : hov ? 0.6 : busy ? 0.3 + 0.35 * (0.5 + 0.5 * Math.sin(t * 3)) : 0.28;
    const r = busy ? 10 + (0.5 + 0.5 * Math.sin(t * 3)) : 10;
    ctx.beginPath(); ctx.ellipse(g.postX, fy, r, r * 0.42, 0, 0, 7); ctx.stroke();
    ctx.globalAlpha = 1;
    let arm: OrchArm = 'rest', aim = -Math.PI / 2, headDir = 1, scan = 0;
    const target = cond.aimAt(L, now);
    switch (v.pose) {
      case 'point': arm = 'point'; if (target) aim = Math.max(-Math.PI + 0.25, Math.min(-0.25, Math.atan2(target.y - (fy - 16), target.x - (g.postX + 5)))); break;
      case 'pick': arm = 'pick'; break;
      case 'clipboard': arm = 'clip'; break;
      case 'stop': arm = 'stop'; break;
      case 'go': arm = 'go'; break;
      case 'look': if (target) headDir = Math.abs(target.x - g.postX) < 28 ? 1 : target.x < g.postX ? 3 : 2; break;
      default: if (v.ambient && this.decor) scan = Math.sin(t * 0.7);
    }
    if (v.pose === 'point' && target) headDir = Math.abs(target.x - g.postX) < 28 ? 1 : target.x < g.postX ? 3 : 2;
    ctx.save(); ctx.translate(g.postX + (v.pose === 'watch' ? scan * 0.5 : 0), fy);
    drawOrchestrator(ctx, { arm, aim, headDir, t, scan });
    ctx.restore();
    const hx = g.postX, hy = fy - 36;
    if (v.pose === 'clipboard') this.qBubble(ctx, hx + 11, hy, '?', UI.amber);
    if (v.alert) this.qBubble(ctx, hx + 11, hy, '!', UI.err);
    if (v.stop) this.plateFx(ctx, hx + 12, hy, 5.4, UI.err, 'failed', 1);
    if (v.bell) this.plateFx(ctx, hx + 12, hy, 5.4, UI.amber, 'hand', 1);
  }

  private qBubble(ctx: Ctx, x: number, y: number, ch: string, color: string) {
    ctx.fillStyle = 'rgba(24,27,34,0.94)'; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 0.9; ctx.stroke();
    ctx.fillStyle = color; ctx.font = `700 6.6px ${FONT_FAMILY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ch, x, y + 0.4); ctx.textAlign = 'start';
  }

  // ───────────── personnages ─────────────

  private ground(ctx: Ctx, c: Char, t: number, ui: RenderUi, nowMs: number) {
    const fy = c.y + 7, a = c.alpha;
    if (c.mode !== Mode.SIT) { ctx.globalAlpha = a * 0.9; ctx.drawImage(this.shadow, c.x - 8.5, fy - 3, 17, 6); }
    const st = c.agent.state, sel = ui.selectedId === c.id, hov = ui.hoverId === c.id;
    if ((sel || hov) && c.mode !== Mode.SIT) {
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = sel ? 1.3 : 1; ctx.globalAlpha = a * (sel ? 0.9 : 0.55);
      ctx.beginPath(); ctx.ellipse(c.x, fy, 8.4, 3.5, 0, 0, 7); ctx.stroke();
      if (sel) { ctx.globalAlpha = a * 0.6; ctx.strokeStyle = UI.amber; ctx.beginPath(); ctx.ellipse(c.x, fy, 11, 4.6, 0, 0, 7); ctx.stroke(); }
    } else if ((st === 'waiting' || st === 'error') && c.mode !== Mode.SIT) {
      const pulse = 0.5 + 0.5 * Math.sin(t * (st === 'error' ? 5 : 3));
      ctx.strokeStyle = STATE_COLOR[st]; ctx.lineWidth = 1; ctx.globalAlpha = a * (0.3 + 0.4 * pulse);
      ctx.beginPath(); ctx.ellipse(c.x, fy, 8.6, 3.6, 0, 0, 7); ctx.stroke();
    }
    const ef = c.agent.effects;
    for (let i = 0; i < ef.length; i++) {
      const e = ef[i];
      if (e.kind !== 'success' || e.until <= nowMs) continue;
      const p = 1 - (e.until - nowMs) / EFFECT_TTL_MS.success;
      ctx.globalAlpha = a * (1 - p) * 0.8; ctx.strokeStyle = UI.ok; ctx.lineWidth = 1.2;
      const rad = 6 + easeOutCubic(p) * 20;
      ctx.beginPath(); ctx.ellipse(c.x, fy, rad, rad * 0.42, 0, 0, 7); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private avatar(ctx: Ctx, c: Char, t: number, nowMs: number) {
    const style = this.styleOf(c);
    let pose: AvatarPose = 'stand', hands = 0, hold = 0, dir = c.dir;
    const a = c.anim;
    if (c.mode === Mode.WALK) pose = 'walk';
    else if (c.mode === Mode.SIT) {
      if (c.atDesk) { pose = 'sit-back'; hands = a === 'type' ? 1 : a === 'read' ? 2 : a === 'web' ? 3 : a === 'terminal' ? 4 : a === 'alarm' ? 5 : a === 'quota' ? 6 : 0; }
      else if (dir === 1) { pose = 'sit-back'; hands = 0; }
      else if (dir === 0) { pose = 'sit-front'; hold = a === 'hand' ? 3 : a === 'book' ? 2 : 0; }
      else { pose = 'sit-side'; hold = a === 'book' ? 2 : 0; }
    } else {
      switch (a) {
        case 'cheer': pose = 'cheer'; break;
        case 'hand': pose = 'hand'; break;
        case 'wait': pose = 'cross'; break;
        case 'use': pose = c.extra === 'tech' || c.extra === 'dev' ? 'reach' : 'cup'; break;
        case 'drink': pose = 'cup'; break;
        case 'browse': pose = (Math.floor((c.clock + c.uid) / 3) % 2) ? 'reach' : 'book'; break;
        case 'look': pose = 'behind'; break;
        default: pose = c.speaking ? 'talk' : 'stand';
      }
    }
    P.pose = pose; P.dir = dir; P.hands = hands; P.hold = hold;
    P.phase = pose === 'walk' ? c.phase : pose === 'cheer' ? (nowMs % 100000) / 1000 * 5 : c.clock;
    P.breath = (pose === 'stand' || pose === 'sit-back' || pose === 'sit-front' || pose === 'behind') && this.decor ? 0.5 + 0.5 * Math.sin(c.clock * 1.9) : 0;
    const st = this.story.agents[c.id];
    P.mood = st ? (st.mood === 'serene' ? 1 : st.mood === 'worried' ? -1 : 0) : 0;
    P.talking = c.speaking && !!c.bubble;
    ctx.save();
    ctx.globalAlpha = c.alpha;
    const sitLift = c.mode === Mode.SIT ? (c.atDesk ? 6 : 4) : 0;
    ctx.translate(c.x + (a === 'alarm' && c.mode !== Mode.SIT ? Math.sin(t * 34) * 0.35 : 0), c.y + 7 - sitLift);
    if (c.extra === 'cleaner' && c.mode !== Mode.SIT) this.cart(ctx, c.dir);
    drawAvatar(ctx, style, P);
    if (c.extra === 'courier' && c.staffIdx === 0 && c.dir !== 1) this.parcel(ctx, -4.5, -12.5, 9, 6.5); // colis porté devant lui
    if (c.extra && c.extra !== 'orch' && pose !== 'sit-back' && c.dir !== 1) { // badge « Personnel » porté sur la poitrine
      const bx = c.dir === 2 ? 1 : c.dir === 3 ? -3 : -3.6;
      fillRR(ctx, '#f4f6f8', bx, -13.6, 2.8, 3.4, 0.5); ctx.fillStyle = c.extra === 'dev' ? '#d97757' : '#4f7cac'; ctx.fillRect(bx, -13.6, 2.8, 1);
    }
    ctx.restore();
  }

  /** Colis en carton (livraison réelle). */
  private parcel(ctx: Ctx, x: number, y: number, w: number, h: number) {
    fillRR(ctx, '#c79a62', x, y, w, h, 0.8); ctx.fillStyle = '#a97f4c'; ctx.fillRect(x, y, w, 1.2);
    ctx.fillStyle = '#e8d3a8'; ctx.fillRect(x + w / 2 - 0.6, y, 1.2, h);
    ctx.fillStyle = '#f4f1ea'; ctx.fillRect(x + w - 3.6, y + h - 2.8, 2.6, 1.8);
  }
  /** Chariot de l'agent d'entretien, à côté de lui. */
  private cart(ctx: Ctx, dir: number) {
    const ox = dir === 3 ? -14 : 8, oy = -1;
    ctx.fillStyle = 'rgba(20,20,25,0.25)'; ctx.beginPath(); ctx.ellipse(ox + 4, oy + 1, 5.5, 1.6, 0, 0, 7); ctx.fill();
    fillRR(ctx, '#7f8a96', ox, oy - 9, 8, 9, 1.2); fillRR(ctx, '#5d6874', ox + 0.6, oy - 3, 6.8, 2.6, 0.8);
    fillRR(ctx, '#e6c04c', ox + 1.2, oy - 12, 3, 3.4, 0.8); fillRR(ctx, '#6fb0f2', ox + 4.6, oy - 11, 2.4, 2.4, 0.6);
    ctx.fillStyle = '#2b2f36'; ctx.beginPath(); ctx.arc(ox + 1.5, oy, 0.9, 0, 7); ctx.arc(ox + 6.5, oy, 0.9, 0, 7); ctx.fill();
  }

  /** Badges d'état et d'effets réels, au-dessus de la tête (ou du poste pour un agent assis à son bureau). */
  private overlays(ctx: Ctx, world: OfficeWorld, c: Char, t: number, nowMs: number) {
    const L = world.layout, v = c.vis, desk = L.deskByAgent.get(c.id);
    const atDesk = c.atDesk && !!desk;
    const ax = atDesk ? desk!.col * TILE + 24 : c.x;
    const ay = atDesk ? desk!.row * TILE - 32 : c.y - 26;
    const ef = c.agent.effects;
    let count = 0;
    if (v.pose === 'hand' || v.pose === 'wait') count++;
    if (v.success) count++;
    for (let i = 0; i < ef.length; i++) if (ef[i].until > nowMs && ef[i].kind !== 'success' && !(v.quota && ef[i].kind === 'rate_limit')) count++;
    if (!count) return;
    let x = ax - (count - 1) * 7.2 + (atDesk && (v.alarm || v.quota) ? 14 : 0);
    ctx.globalAlpha = c.alpha;
    if (v.pose === 'hand') { this.plateFx(ctx, x, ay - Math.abs(Math.sin(t * 3)) * 1.2, 5.6, UI.info, 'hand', 1); x += 14.4; }
    else if (v.pose === 'wait') { this.plateFx(ctx, x, ay, 5.6, UI.info, 'dots', 1); x += 14.4; }
    if (v.success) { this.plateFx(ctx, x, ay - 1, 5.8, UI.ok, 'success', easeOutCubic((nowMs - successStart(ef, nowMs)) / 350)); x += 14.4; }
    for (let i = 0; i < ef.length; i++) {
      const e = ef[i];
      if (e.until <= nowMs || e.kind === 'success' || (v.quota && e.kind === 'rate_limit')) continue;
      const pop = (nowMs - (e.until - EFFECT_TTL_MS[e.kind])) / 280;
      if (e.kind === 'denied') this.plateFx(ctx, x, ay, 5.6, UI.amber, 'denied', pop);
      else if (e.kind === 'rate_limit') this.plateFx(ctx, x, ay, 5.6, UI.warn, 'rate_limited', pop);
      else this.plateFx(ctx, x, ay, 5.6, UI.warn, 'retry', pop);
      x += 14.4;
    }
    ctx.globalAlpha = 1;
  }

  // ───────────── étiquettes (espace écran) ─────────────

  private pill(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string, stroke: string) {
    rr(ctx, x, y, w, h, h / 2); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
  }
  private overlaps(x: number, y: number, w: number, h: number): boolean {
    for (let i = 0; i < this.nPlaced; i += 4) {
      const p = this.placed;
      if (x < p[i] + p[i + 2] && x + w > p[i] && y < p[i + 1] + p[i + 3] && y + h > p[i + 1]) return true;
    }
    return false;
  }
  private reserve(x: number, y: number, w: number, h: number) {
    if (this.nPlaced < this.placed.length - 4) { this.placed[this.nPlaced++] = x; this.placed[this.nPlaced++] = y; this.placed[this.nPlaced++] = w; this.placed[this.nPlaced++] = h; }
  }

  private roomLabels(ctx: Ctx, L: Layout, view: View, lv: number) {
    const s = view.scale, dpr = view.dpr;
    this.nPlaced = 0;
    if (s < 0.9 * dpr) return;
    const font = `600 ${9.5 * dpr}px ${FONT_FAMILY}`;
    ctx.font = font; ctx.textBaseline = 'middle';
    for (const room of L.rooms) {
      const tag = roomTag(room); if (!tag || !room.corridorSide || room.level !== lv) continue;
      // plaque de porte côté couloir : jamais sur le mobilier ni sur un mur ; texte raccourci si la pièce est étroite
      const h = 15 * dpr, maxW = room.w * TILE * s - 6 * dpr;
      let text = tag.text.toUpperCase(), w = this.tw(ctx, font, text) + 18 * dpr;
      while (w > maxW && text.length > 4) { text = text.slice(0, -2) + '…'; w = this.tw(ctx, font, text) + 18 * dpr; }
      if (w > maxW) continue;
      const below = room.corridorSide === 'bottom'; // pièce au nord du couloir : plaque juste sous son mur, dans le couloir
      const wallRow = below ? room.y + room.h : room.y - 1;
      const wy = below ? (wallRow + 1) * TILE + 1.5 : wallRow * TILE - 10.5;
      const sx = view.ox + (room.x * TILE + 3) * s, sy = view.oy + wy * s - (below ? 0 : h);
      ctx.globalAlpha = 0.86;
      rr(ctx, sx, sy, w, h, 3 * dpr); ctx.fillStyle = 'rgba(28,31,37,0.82)'; ctx.fill();
      ctx.fillStyle = tag.accent; ctx.fillRect(sx + 5 * dpr, sy + 4 * dpr, 2 * dpr, h - 8 * dpr);
      ctx.fillStyle = '#e4e6ea'; ctx.fillText(text, sx + 11 * dpr, sy + h / 2 + 0.5 * dpr);
      ctx.globalAlpha = 1;
      this.reserve(sx, sy, w, h);
    }
  }

  /** Nombre de cases « encombrées » (murs, postes, meubles hauts) sous un rectangle écran. */
  private clutter(view: View, sx: number, sy: number, w: number, h: number, own: number): number {
    const L = this.layout!, s = view.scale;
    const c0 = Math.floor((sx - view.ox) / s / TILE), c1 = Math.floor((sx + w - view.ox) / s / TILE);
    const r0 = Math.floor((sy - view.oy) / s / TILE), r1 = Math.floor(((sy + h - view.oy) / s + 15) / TILE); // marge : les volumes du dessous montent au-dessus de leur case
    let n = 0;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      if (c < 0 || r < 0 || c >= L.cols || r >= L.rows) { n++; continue; }
      const v = this.labelBlock[r * L.cols + c];
      if (v && v !== own) n++;
    }
    return n;
  }

  /** Écran agrandi du poste (repère écran, lisible) : les 3 dernières actions réelles, la plus récente en clair. */
  private feedCard(ctx: Ctx, view: View, desk: { col: number; row: number }, c: Char, font: string, small: string) {
    const dpr = view.dpr, s = view.scale, lines = (c.agent.actions ?? []).slice(-3).map((l) => this.clip(l, 52));
    ctx.font = font;
    let tw = 0; for (const l of lines) tw = Math.max(tw, this.tw(ctx, font, l));
    const lh = 16 * dpr, w = Math.min(340 * dpr, tw + 34 * dpr), h = lines.length * lh + 22 * dpr;
    const sx = view.ox + (desk.col * TILE + 24) * s, sy = view.oy + (desk.row * TILE - 24) * s;
    const bx = sx - w / 2; let by = sy - h - 6 * dpr;
    for (let k = 0; k < 3 && this.overlaps(bx, by, w, h); k++) by -= 12 * dpr;
    this.reserve(bx, by, w, h);
    ctx.globalAlpha = Math.min(1, c.alpha * 1.2);
    rr(ctx, bx, by, w, h, 7 * dpr); ctx.fillStyle = 'rgba(14,18,23,0.96)'; ctx.fill(); ctx.strokeStyle = 'rgba(76,202,161,0.6)'; ctx.lineWidth = dpr; ctx.stroke();
    ctx.fillStyle = 'rgba(14,18,23,0.96)'; ctx.beginPath(); ctx.moveTo(sx - 5 * dpr, by + h - 0.5); ctx.lineTo(sx, by + h + 6 * dpr); ctx.lineTo(sx + 5 * dpr, by + h - 0.5); ctx.closePath(); ctx.fill();
    ctx.font = small; ctx.fillStyle = '#6fa58f'; ctx.fillText('ÉCRAN DU POSTE · ACTIONS RÉELLES', bx + 10 * dpr, by + 10 * dpr);
    lines.forEach((l, i) => {
      const last = i === lines.length - 1, y = by + 20 * dpr + i * lh + lh / 2 - 2 * dpr;
      ctx.font = font; ctx.fillStyle = last ? UI.ok : '#56606b'; ctx.fillText('›', bx + 10 * dpr, y);
      ctx.fillStyle = last ? '#eef3f1' : '#8d96a1'; ctx.fillText(l, bx + 22 * dpr, y);
    });
    ctx.globalAlpha = 1;
  }

  private labels(ctx: Ctx, world: OfficeWorld, view: View, ui: RenderUi, nowMs: number, cond: Conductor, lv: number) {
    const L = world.layout, dpr = view.dpr, s = view.scale;
    const here = (c: Char) => levelOfY(L, c.y) === lv;
    const nameFont = `600 ${10.5 * dpr}px ${FONT_FAMILY}`, smallFont = `600 ${8.5 * dpr}px ${FONT_FAMILY}`, bubFont = `500 ${11.5 * dpr}px ${FONT_FAMILY}`, socFont = `italic 400 ${11 * dpr}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'start';
    // bulles d'activité RÉELLE (agents au travail) : sombres, point ambre
    for (const c of world.chars) {
      if (!c.visible || c.agent.state !== 'working' || !c.agent.activity || !here(c)) continue;
      const sel = ui.selectedId === c.id || ui.hoverId === c.id;
      const desk = L.deskByAgent.get(c.id), atDesk = c.atDesk && !!desk;
      // zoom rapproché : la bulle devient l'écran agrandi du poste (3 dernières actions réelles)
      if (atDesk && s >= FEED_ZOOM && c.agent.actions && c.agent.actions.length > 0) { this.feedCard(ctx, view, desk!, c, bubFont, smallFont); continue; }
      const text = this.clip(c.agent.activity, sel ? 56 : 24);
      const w = this.tw(ctx, bubFont, text) + 18 * dpr, h = 21 * dpr;
      const wx = atDesk ? desk!.col * TILE + 24 : c.x, wy = atDesk ? desk!.row * TILE - 26 : c.y - 27;
      const sx = view.ox + wx * s, sy = view.oy + wy * s;
      let by = sy - h - 6 * dpr; const bx = sx - w / 2;
      for (let k = 0; k < 4 && this.overlaps(bx, by, w, h); k++) by -= h + 4 * dpr;
      this.reserve(bx, by, w, h);
      ctx.globalAlpha = Math.min(1, c.alpha * 1.2);
      this.pill(ctx, bx, by, w, h, 'rgba(24,27,34,0.94)', 'rgba(245,167,66,0.55)');
      ctx.fillStyle = 'rgba(24,27,34,0.94)'; ctx.beginPath(); ctx.moveTo(sx - 4 * dpr, by + h - 0.5); ctx.lineTo(sx, by + h + 5 * dpr); ctx.lineTo(sx + 4 * dpr, by + h - 0.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = UI.amber; ctx.beginPath(); ctx.arc(bx + 9 * dpr, by + h / 2, 2.2 * dpr, 0, 7); ctx.fill();
      ctx.font = bubFont; ctx.fillStyle = '#e9ebef'; ctx.fillText(text, bx + 15 * dpr, by + h / 2 + 0.5 * dpr);
    }
    // quota atteint : mention explicite
    for (const c of world.chars) {
      if (!c.visible || !c.vis.quota) continue;
      const desk = L.deskByAgent.get(c.id); if (!desk || levelOfRow(L, desk.row) !== lv) continue;
      const text = 'Quota atteint', w = this.tw(ctx, bubFont, text) + 20 * dpr, h = 20 * dpr;
      const sx = view.ox + (desk.col * TILE + 24) * s - w / 2, sy = view.oy + (desk.row * TILE - 42) * s - h;
      if (this.overlaps(sx, sy, w, h)) continue;
      this.reserve(sx, sy, w, h);
      this.pill(ctx, sx, sy, w, h, 'rgba(36,31,18,0.95)', 'rgba(230,192,76,0.8)');
      ctx.font = bubFont; ctx.fillStyle = '#f3e3b0'; ctx.fillText(text, sx + 10 * dpr, sy + h / 2 + 0.5 * dpr);
    }
    // bulles FICTIVES de la vie sociale : claires, discrètes, en italique gris (jamais confondues avec le réel)
    if (s >= 1.1 * dpr) for (const c of world.chars) {
      if (!c.visible || !c.bubble || c.alpha < 0.5 || !here(c)) continue;
      const text = this.clip(c.bubble, 44);
      const w = this.tw(ctx, socFont, text) + 16 * dpr, h = 19 * dpr;
      const sx = view.ox + c.x * s, sy = view.oy + (c.y - (c.mode === Mode.SIT ? 26 : 30)) * s;
      let by = sy - h; const bx = sx - w / 2;
      for (let k = 0; k < 2 && this.overlaps(bx, by, w, h); k++) by -= h + 3 * dpr;
      this.reserve(bx, by, w, h);
      ctx.globalAlpha = 0.9 * c.alpha;
      rr(ctx, bx, by, w, h, 6 * dpr); ctx.fillStyle = 'rgba(246,244,240,0.92)'; ctx.fill();
      ctx.strokeStyle = 'rgba(120,125,135,0.35)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = 'rgba(246,244,240,0.92)'; ctx.beginPath(); ctx.moveTo(sx - 3 * dpr, by + h - 0.5); ctx.lineTo(sx - 1 * dpr, by + h + 4 * dpr); ctx.lineTo(sx + 2 * dpr, by + h - 0.5); ctx.closePath(); ctx.fill();
      ctx.font = socFont; ctx.fillStyle = '#6b7280'; ctx.fillText(text, bx + 8 * dpr, by + h / 2 + 0.5 * dpr);
      ctx.globalAlpha = 1;
    }
    // pastilles de nom : sélection / survol d'abord, puis les autres si la place est libre
    ctx.font = nameFont;
    for (let pass = 0; pass < 2; pass++) {
      for (const c of world.chars) {
        const sel = ui.selectedId === c.id, hov = ui.hoverId === c.id;
        if ((pass === 0) !== (sel || hov)) continue;
        const st = c.agent.state;
        if (!(ui.showNames || sel || hov || (st !== 'idle' && st !== 'disabled')) || c.leaving) continue;
        const desk = L.deskByAgent.get(c.id);
        let wx = c.x, wy = c.y + 7, alpha = Math.min(1, c.alpha * 1.3), top = c.mode === Mode.SIT ? 26 : 30;
        if (!c.visible || c.alpha < 0.05) { // absent : le panneau « ABSENT » suffit ; le nom seulement au survol ou à la sélection
          if (!desk || !(sel || hov) || c.xfer === 2 || levelOfRow(L, desk.row) !== lv) continue;
          wx = desk.seatX; wy = desk.seatY + 8; top = 18; alpha = 0.85;
        } else if (!here(c)) continue;
        const name = c.extra === 'dev' || c.extra === 'orch' ? c.agent.name : c.extra ? `${c.agent.name} · personnel` : this.clip(c.agent.name, 28);
        // positions candidates : sous les pieds, à droite, à gauche, au-dessus, puis décalées d'un cran vers le bas ou le haut
        // (deux voisins proches : les étiquettes s'empilent au lieu de se chevaucher) ; d'abord en taille normale, puis compacte
        const px = view.ox + wx * s, py = view.oy + wy * s, gap = 3 * dpr;
        let bx = 0, by = 0, best = 1e9, h = 16.5 * dpr, w = 0, compact = false;
        for (let size = 0; size < 2 && best > 0; size++) {
          const hh = (size ? 12.5 : 16.5) * dpr, ww = this.tw(ctx, size ? smallFont : nameFont, name) + (size ? 16 : 22) * dpr, step = hh + 2 * dpr;
          for (let k = 0; k < 8; k++) {
            const cx = k === 1 || k === 5 ? px + 8 * s : k === 2 || k === 6 ? px - 8 * s - ww : px - ww / 2;
            const cy = k === 0 ? py + gap : k === 3 ? py - top * s - hh - gap : k === 4 ? py + gap + step : k === 7 ? py - top * s - hh - gap - step
              : k === 5 || k === 6 ? py - 9 * s - hh / 2 + step : py - 9 * s - hh / 2;
            const n = this.clutter(view, cx, cy, ww, hh, -1) + (this.overlaps(cx, cy, ww, hh) ? 50 : 0) + (k >= 4 ? 1 : 0);
            if (n < best) { best = n; bx = cx; by = cy; h = hh; w = ww; compact = size === 1; }
            if (n === 0) break;
          }
        }
        const important = sel || hov || (st !== 'idle' && st !== 'disabled');
        if (best > 0 && !important) continue; // nom d'un agent au repos : seulement s'il y a la place
        // figurant (personnel, session Claude Code) dont l'étiquette chevaucherait encore une autre : son badge suffit
        if (best >= 50 && c.extra && !(sel || hov)) continue;
        const sx = Math.round(bx), sy = Math.round(by); // texte net : aligné sur les pixels de l'écran
        if (pass === 1 && this.overlaps(sx, sy, w, h) && !important) continue;
        this.reserve(sx, sy, w, h);
        ctx.globalAlpha = alpha;
        this.pill(ctx, sx, sy, w, h, sel ? 'rgba(245,167,66,0.96)' : 'rgba(24,27,34,0.8)', sel ? 'rgba(255,255,255,0)' : 'rgba(255,255,255,0.08)');
        ctx.fillStyle = sel ? '#1b1305' : c.extra === 'dev' ? (st === 'waiting' ? STATE_COLOR.waiting : '#d97757') : c.extra ? '#8fb3d9' : STATE_COLOR[st]; ctx.beginPath(); ctx.arc(sx + (compact ? 6.5 : 8.5) * dpr, sy + h / 2, (compact ? 2 : 2.4) * dpr, 0, 7); ctx.fill();
        ctx.font = compact ? smallFont : nameFont; ctx.fillStyle = sel ? '#1b1305' : st === 'disabled' ? '#8590a2' : '#cfd4de';
        ctx.fillText(name, sx + (compact ? 11.5 : 15) * dpr, sy + h / 2 + 0.5 * dpr);
      }
    }
    // orchestrateur et indicateur de reconnexion
    const g = consoleGeom(L.control), ov = cond.visual, orchHere = levelOfY(L, g.postY) === lv && !world.orchAway();
    const sel = ui.selectedId === ORCH_ID, hov = ui.hoverId === ORCH_ID;
    if ((sel || hov) && orchHere) {
      const name = 'Orchestrateur', h = 19 * dpr, w = this.tw(ctx, nameFont, name) + 30 * dpr;
      const sx = view.ox + g.postX * s - w / 2, sy = view.oy + (g.postY + 12) * s;
      ctx.globalAlpha = 1;
      this.pill(ctx, sx, sy, w, h, sel ? 'rgba(245,167,66,0.96)' : 'rgba(24,27,34,0.92)', sel ? 'rgba(255,255,255,0)' : 'rgba(245,167,66,0.75)');
      ctx.fillStyle = sel ? '#1b1305' : UI.amber; ctx.beginPath(); ctx.moveTo(sx + 10 * dpr, sy + h / 2 - 3.6 * dpr); ctx.lineTo(sx + 13.6 * dpr, sy + h / 2); ctx.lineTo(sx + 10 * dpr, sy + h / 2 + 3.6 * dpr); ctx.lineTo(sx + 6.4 * dpr, sy + h / 2); ctx.closePath(); ctx.fill();
      ctx.font = nameFont; ctx.fillStyle = sel ? '#1b1305' : '#e9ebef'; ctx.fillText(name, sx + 20 * dpr, sy + h / 2 + 0.5 * dpr);
    }
    if (ov.resync && orchHere) {
      const text = 'Reconnexion…', w = this.tw(ctx, bubFont, text) + 24 * dpr, h = 21 * dpr;
      const sx = view.ox + (g.x + g.w / 2) * s - w / 2, sy = view.oy + (g.y - 24) * s - h;
      this.pill(ctx, sx, sy, w, h, 'rgba(24,27,34,0.94)', 'rgba(230,192,76,0.7)');
      ctx.fillStyle = UI.warn; ctx.beginPath(); ctx.arc(sx + 11 * dpr, sy + h / 2, 3 * dpr * (0.7 + 0.3 * Math.sin(nowMs / 150)), 0, 7); ctx.fill();
      ctx.font = bubFont; ctx.fillStyle = '#e9ebef'; ctx.fillText(text, sx + 19 * dpr, sy + h / 2 + 0.5 * dpr);
    }
    ctx.globalAlpha = 1;
    this.nPlaced = 0;
  }
}

function successStart(ef: readonly Effect[], now: number): number {
  for (let i = 0; i < ef.length; i++) if (ef[i].kind === 'success') return ef[i].until - EFFECT_TTL_MS.success;
  return now;
}
function star(ctx: Ctx, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, rad = k % 2 ? r * 0.45 : r; ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); }
  ctx.closePath(); ctx.fill();
}
const easeInOut = (p: number) => { const q = Math.min(1, Math.max(0, p)); return q < 0.5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2; };
/** Tenues du personnel figurant : distinctes des agents (veste d'accueil, tenue de technicien, blouse d'entretien). */
const STAFF_STYLE: Record<ExtraKind, AvatarStyle> = {
  orch: ORCH_STYLE,
  reception: { skin: '#e2b392', skinShade: '#c99877', hair: '#3d2b22', hairShade: '#2c1f18', hairStyle: 2, top: '#33465f', topShade: '#283a50', pants: '#2a2f3a', shoes: '#16181d', detail: 2, trim: '#f5a742', accessory: 'headset' },
  tech: { skin: '#b9845c', skinShade: '#9c6b46', hair: '#211c1f', hairShade: '#151214', hairStyle: 5, top: '#55606c', topShade: '#454f5a', pants: '#2f3540', shoes: '#1c1f25', detail: 3, trim: '#c9d3dc', accessory: 'glasses' },
  cleaner: { skin: '#d6a179', skinShade: '#bd875f', hair: '#c9c6c0', hairShade: '#aeaaa3', hairStyle: 0, top: '#6f9a96', topShade: '#5d8581', pants: '#3f4a52', shoes: '#22262b', detail: 0, trim: '#d8e6e4', accessory: 'none' },
  // session Claude Code : sweat à capuche sombre, liseré orange Claude (visage et coiffure varient selon la session)
  courier: { skin: '#c99a73', skinShade: '#ae7f59', hair: '#2c2420', hairShade: '#1e1916', hairStyle: 0, top: '#9a5b2e', topShade: '#7f4a24', pants: '#3b3f46', shoes: '#1a1c20', detail: 1, trim: '#f2c14e', accessory: 'cap' },
  dev: { skin: '#e2b392', skinShade: '#c99877', hair: '#3d2b22', hairShade: '#2c1f18', hairStyle: 1, top: '#2e2a28', topShade: '#24201f', pants: '#30343c', shoes: '#16181d', detail: 3, trim: '#d97757', accessory: 'headset' },
};
/** Style d'un technicien Claude Code : même tenue, visage et coiffure propres à la session (stables). */
function devStyle(id: string): AvatarStyle {
  let h = 2166136261; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  const [skin, skinShade] = SKINS[h % SKINS.length], [hair, hairShade] = HAIRS[(h >>> 4) % HAIRS.length];
  return { ...STAFF_STYLE.dev, skin, skinShade, hair, hairShade, hairStyle: (h >>> 8) % 6, accessory: (h >>> 12) % 3 === 0 ? 'glasses' : 'headset' };
}
const P: AvatarParams = { pose: 'stand', dir: 0, phase: 0, hands: 0, breath: 0, mood: 0, talking: false, hold: 0 };
