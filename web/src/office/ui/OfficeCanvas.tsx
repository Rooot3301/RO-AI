// Hôte du canvas : boucle de rendu adaptative (pause complète quand l'onglet est masqué), caméra fluide (inertie, zoom
// au curseur, pincement, suivi d'un personnage), survol / clic sur un personnage ou son bureau, mode édition du mobilier.
import { useEffect, useRef, useState } from 'react';
import type { Layout } from '../layout/plan.ts';
import { TILE, levelOfRow, levelOfY, levelRect } from '../layout/plan.ts';
import { FURNITURE } from '../layout/furniture.ts';
import type { DeliveryFx, OfficeModel } from '../state/model.ts';
import type { AgentProfile, DevSession, OfficeBoards, OfficeSociety, SystemInfo } from '../../api/types.ts';
import type { StaffInfo } from '../engine/staff.ts';
import { STAFF_IDS } from '../engine/staff.ts';
import { clampCenter, clampZoom, deltaFromZoom, fitScale, MAX_ZOOM_DELTA, MIN_ZOOM_DELTA, stepCamera, toWorldX, toWorldY, viewForRect, zoomFromDelta } from '../engine/camera.ts';
import type { Camera, View } from '../engine/camera.ts';
import { OfficeRenderer } from '../engine/renderer.ts';
import { OfficeWorld } from '../engine/sim.ts';
import { FONT_FAMILY } from '../engine/draw.ts';
import { Conductor } from '../engine/conductor.ts';
import { consoleGeom } from '../engine/console.ts';
import { daylightAt, parisTime } from '../engine/daylight.ts';
import { officeCalendar } from '../engine/calendar.ts';
import { ORCH_ID } from '../state/orchestrator.ts';
import type { Connection } from '../state/useOfficeFeed.ts';
import type { StoryData } from '../state/story.ts';
import type { ThemePref } from '../state/prefs.ts';

export interface HoverInfo { id: string; x: number; y: number }
export interface EditHooks {
  selectedKey: string | null;
  onPick: (key: string | null) => void;
  /** Dépôt d'un meuble à la case (col,row) de son coin haut-gauche. */
  onDrop: (key: string, col: number, row: number) => void;
}
interface Props {
  model: OfficeModel; layout: Layout; profiles: Record<string, AgentProfile>;
  themePref: ThemePref; social: boolean; decor: boolean; showNames: boolean; zoomDelta: number;
  onZoomDelta: (d: number) => void; fitSignal: number;
  /** Largeur (px CSS) occupée par le tiroir d'inspection : la carte se recadre dans l'espace restant. */
  insetRight: number;
  connection: Connection;
  story: StoryData;
  selectedId: string | null; onSelect: (id: string | null) => void; onHover: (h: HoverInfo | null) => void;
  followId: string | null; onFollowEnd: () => void;
  edit: EditHooks | null;
  /** Indique l'éclairage courant à l'interface (« Jour », « Nuit »…). */
  onDaylight?: (d: number) => void;
  /** Mesures réelles du serveur et faits transmis au personnel figurant. */
  system: SystemInfo | null; staffInfo: StaffInfo;
  /** Sessions Claude Code qui développent RO·AI (salle serveur). */
  devteam?: readonly DevSession[] | null;
  /** Livraisons réelles fraîches (camionnette, livreur) et nom de l'agent destinataire. */
  deliveries?: readonly DeliveryFx[];
  /** Vie intérieure : dialogues générés du jour (le sim les utilise une fois chacun). */
  society?: OfficeSociety | null;
  agentName?: (id: string) => string | null;
  /** Tableaux réels : planning du jour (hall) et limites d'usage (salle serveur). */
  boards: OfficeBoards | null;
  /** Arrêt d'urgence réel en cours. */
  paused: boolean;
  /** Rapports réels non lus (boîte aux lettres de l'accueil). */
  mail: number;
  /** Étage affiché ; changement demandé par un clic sur l'escalier / l'ascenseur ou pour montrer l'agent choisi. */
  level: number; onLevel: (level: number) => void;
  /** Agents présents à chaque étage (rafraîchi au plus deux fois par seconde). */
  onLevelCounts?: (counts: number[]) => void;
}

/** Identifiant de la salle serveur (clic sur la salle ou une baie). */
export const SERVER_ID = '__server__';
/** Tableau du planning (hall), écran des limites (salle serveur), salle d'attente des approbations. */
export const PLANNING_ID = '__planning__';
export const LIMITS_ID = '__limits__';
export const APPROVALS_ID = '__approvals__';
/** Bibliothèque (archives des rapports) et salle de réunion (conversations réelles). */
export const LIBRARY_ID = '__library__';
export const MEETING_ID = '__meeting__';
/** Boîte aux lettres des rapports (accueil) : ouvre la bibliothèque. */
export const MAILBOX_ID = '__mailbox__';
/** Palier (escalier, ascenseur) : un clic change d'étage. */
export const FLOOR_ID = '__floor__';

const FOLLOW_ZOOM = 1.8;

export function OfficeCanvas(p: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = useRef<{ world: OfficeWorld; renderer: OfficeRenderer } | null>(null);
  const [ready, setReady] = useState(false);
  const props = useRef(p); props.current = p;
  const dirty = useRef(true);
  const rect0 = levelRect(p.layout, p.level);
  const cam = useRef<Camera>({ zoom: 1, cx: rect0.w / 2, cy: rect0.y + rect0.h / 2 });
  const tgt = useRef<Camera>({ zoom: 1, cx: rect0.w / 2, cy: rect0.y + rect0.h / 2 });
  const shownLevel = useRef(p.level);
  const asked = useRef<number | null>(null);
  const lastCounts = useRef('');
  const inset = useRef({ cur: 0, tgt: 0 });
  const viewRef = useRef<View>({ scale: 1, ox: 0, oy: 0, dpr: 1 });
  const hover = useRef<string | null>(null);
  const conductor = useRef(new Conductor());
  const ghost = useRef<{ col: number; row: number; w: number; h: number; ok: boolean } | null>(null);
  const lastMinute = useRef(-1);

  useEffect(() => {
    let cancelled = false;
    const renderer = new OfficeRenderer(canvasRef.current!);
    const world = new OfficeWorld(props.current.layout, { social: props.current.social, decor: props.current.decor });
    engine.current = { world, renderer };
    renderer.setLayout(props.current.layout); renderer.setProfiles(props.current.profiles); world.setProfiles(props.current.profiles);
    renderer.story = props.current.story; renderer.decor = props.current.decor; renderer.level = props.current.level;
    renderer.nameOf = (id) => props.current.model.agents.find((a) => a.id === id)?.name ?? null;
    setReady(true); dirty.current = true;
    document.fonts?.load(`700 12px ${FONT_FAMILY}`).then(() => { if (!cancelled) { renderer.invalidate(); dirty.current = true; } }).catch(() => { /* repli système */ });
    return () => { cancelled = true; engine.current = null; };
  }, []);

  useEffect(() => {
    const e = engine.current; if (!e || !ready) return;
    e.world.setLayout(p.layout); e.renderer.setLayout(p.layout);
    if (props.current.model.loaded) e.world.setAgents(props.current.model.agents);
    dirty.current = true;
  }, [p.layout, ready]);
  useEffect(() => {
    const e = engine.current; if (!e || !ready || !p.model.loaded) return;
    e.world.setAgents(p.model.agents); dirty.current = true;
  }, [p.model.agents, p.model.loaded, ready]);
  useEffect(() => { const e = engine.current; if (!e || !ready) return; e.renderer.setProfiles(p.profiles); e.world.setProfiles(p.profiles); dirty.current = true; }, [p.profiles, ready]);
  useEffect(() => { const e = engine.current; if (!e) return; e.world.setOptions({ social: p.social, decor: p.decor }); e.renderer.decor = p.decor; dirty.current = true; }, [p.social, p.decor, ready]);
  useEffect(() => { lastMinute.current = -1; dirty.current = true; }, [p.themePref]);
  useEffect(() => { const e = engine.current; if (!e || !p.devteam) return; e.world.setDevTeam(p.devteam); dirty.current = true; }, [p.devteam, ready]);
  useEffect(() => { const e = engine.current; if (!e || !p.society) return; e.world.setGeneratedDialogues(p.society.dialogues, p.society.day); }, [p.society, ready]);
  const seenPosts = useRef<Set<string> | null>(null);
  useEffect(() => { // nouvelle publication visible sur le fil : l'auteur l'annonce (pas au premier chargement)
    const e = engine.current; if (!e || !p.society) return;
    const first = !seenPosts.current; const seen = seenPosts.current ?? new Set<string>();
    for (const post of p.society.posts) {
      if (seen.has(post.id)) continue;
      seen.add(post.id);
      if (!first) e.world.announce(post.author, post.kind === 'thought' ? 'Une pensée pour le fil…' : 'Je poste sur le fil.');
    }
    seenPosts.current = seen; dirty.current = true;
  }, [p.society, ready]);
  const lastDelivery = useRef(0);
  useEffect(() => {
    const e = engine.current; if (!e || !p.deliveries) return;
    for (const d of p.deliveries) {
      if (d.seq <= lastDelivery.current) continue;
      lastDelivery.current = d.seq;
      e.renderer.deliver(d.source);
      e.world.deliver(d.seq, d.source, d.agentId ? props.current.agentName?.(d.agentId) ?? null : null);
    }
    dirty.current = true;
  }, [p.deliveries, ready]);
  useEffect(() => { const e = engine.current; if (!e) return; e.world.setStaffInfo(p.staffInfo); e.renderer.system = p.system; e.renderer.providerDown = p.staffInfo.providerDown; dirty.current = true; }, [p.staffInfo, p.system, ready]);
  useEffect(() => { dirty.current = true; }, [p.selectedId, p.showNames, p.connection, p.edit?.selectedKey]);
  useEffect(() => { if (engine.current) engine.current.renderer.story = p.story; dirty.current = true; }, [p.story, ready]);
  useEffect(() => { if (engine.current) engine.current.renderer.boards = p.boards; dirty.current = true; }, [p.boards, ready]);
  useEffect(() => { if (engine.current) engine.current.renderer.paused = p.paused; dirty.current = true; }, [p.paused, ready]);
  useEffect(() => { if (engine.current) engine.current.renderer.mail = p.mail; dirty.current = true; }, [p.mail, ready]);
  useEffect(() => { inset.current.tgt = p.insetRight; dirty.current = true; }, [p.insetRight]);
  // changement d'étage : même cadrage, une bande du monde plus haut ou plus bas
  useEffect(() => {
    const L = props.current.layout, lv = Math.max(0, Math.min(L.floors - 1, p.level));
    const dy = (lv - shownLevel.current) * L.floorRows * TILE;
    if (dy) { cam.current.cy += dy; tgt.current.cy += dy; if (saved.current) saved.current.cy += dy; }
    shownLevel.current = lv; asked.current = null;
    if (engine.current) engine.current.renderer.level = lv;
    hover.current = null; dirty.current = true;
  }, [p.level, ready]);
  // agent choisi (liste, flèches, panneau) à un autre étage : on y va
  useEffect(() => {
    const e = engine.current, id = p.selectedId; if (!e || !id) return;
    const L = props.current.layout, c = e.world.byId.get(id);
    const lv = c && c.visible ? levelOfY(L, c.xfer === 2 && c.xDest ? c.xDest.y : c.y) : L.deskByAgent.get(id) ? levelOfRow(L, L.deskByAgent.get(id)!.row) : id.startsWith('__') || id === ORCH_ID ? 0 : null;
    if (lv !== null && lv !== props.current.level) props.current.onLevel(lv);
  }, [p.selectedId, ready]);

  useEffect(() => {
    if (deltaFromZoom(tgt.current.zoom) !== p.zoomDelta) tgt.current.zoom = zoomFromDelta(p.zoomDelta);
    dirty.current = true;
  }, [p.zoomDelta]);
  useEffect(() => {
    if (p.fitSignal === 0) return;
    const r = levelRect(props.current.layout, shownLevel.current);
    tgt.current = { zoom: 1, cx: r.w / 2, cy: r.y + r.h / 2 }; dirty.current = true;
  }, [p.fitSignal]);
  // suivi : zoom rapproché tant qu'on suit, retour au cadrage précédent ensuite
  const saved = useRef<Camera | null>(null);
  useEffect(() => {
    if (p.followId) { if (!saved.current) saved.current = { ...tgt.current }; tgt.current.zoom = Math.max(tgt.current.zoom, FOLLOW_ZOOM); }
    else if (saved.current) { tgt.current = { ...saved.current }; saved.current = null; }
    dirty.current = true;
  }, [p.followId]);

  // boucle de rendu (arrêtée quand l'onglet est masqué)
  useEffect(() => {
    const wrap = wrapRef.current!;
    let raf = 0, last = 0, lastDraw = 0, hiddenAt = 0, lastCamMove = 0;
    let cssW = 1, cssH = 1;
    const measure = () => {
      const r = wrap.getBoundingClientRect();
      cssW = Math.max(1, r.width); cssH = Math.max(1, r.height); dirty.current = true;
      if (hover.current) { hover.current = null; props.current.onHover(null); }
    };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(wrap);
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const e = engine.current; if (!e || !e.renderer.ready) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      const wall = Date.now();
      const minute = Math.floor(wall / 60000);
      if (minute !== lastMinute.current) { // heure réelle de Paris : horloges, lumière, contexte des conversations
        lastMinute.current = minute; dirty.current = true;
        const pt = parisTime(wall), pref = props.current.themePref;
        const day = pref === 'day' ? 1 : pref === 'night' ? 0 : daylightAt(pt);
        e.renderer.daylight = day;
        const cal = officeCalendar(wall);
        e.world.setClock({ hour: pt.hour, minute: pt.minute, weekday: pt.weekday, month: pt.month, daylight: daylightAt(pt), calm: cal.calm });
        e.renderer.setCalendar(cal);
        props.current.onDaylight?.(day);
      }
      e.world.update(dt, wall);
      const fid = props.current.followId, Lf = props.current.layout;
      let fy: number | null = null;
      if (fid === ORCH_ID) {
        const g = consoleGeom(Lf.control), w = e.world.byId.get(ORCH_ID);
        if (w && e.world.orchAway() && w.xfer !== 2) { tgt.current.cx = w.x; tgt.current.cy = w.y - 10; fy = w.y; } // il est en balade : la caméra le suit
        else if (w && w.xfer === 2 && w.xDest) fy = w.xDest.y;
        else { tgt.current.cx = g.postX; tgt.current.cy = g.postY - 10; fy = g.postY; }
      }
      else if (fid) {
        const c = e.world.byId.get(fid);
        if (c && c.visible && c.xfer !== 2) { tgt.current.cx = c.x; tgt.current.cy = c.y - 10; fy = c.y; }
        else if (c && c.xfer === 2 && c.xDest) fy = c.xDest.y; // suivi pendant un changement d'étage : on passe à l'étage d'arrivée
        else { const d = Lf.deskByAgent.get(fid); if (d) { tgt.current.cx = d.seatX; tgt.current.cy = d.seatY - 10; fy = d.seatY; } }
      }
      if (fy !== null) { const fl = levelOfY(Lf, fy); if (fl !== shownLevel.current && asked.current !== fl) { asked.current = fl; props.current.onLevel(fl); } }
      if (props.current.onLevelCounts && Math.floor(now / 500) !== Math.floor((now - dt * 1000) / 500)) { // présents par étage
        const n = new Array(Lf.floors).fill(0);
        for (const c of e.world.chars) if (!c.extra && c.present && !c.leaving) n[levelOfY(Lf, c.xfer === 2 && c.xDest ? c.xDest.y : c.y)]++;
        const sig = n.join(','); if (sig !== lastCounts.current) { lastCounts.current = sig; props.current.onLevelCounts(n); }
      }
      const m = props.current.model, cd = conductor.current;
      cd.sync(m.orch.events);
      cd.update(wall, m.orch.events, m.agents, m.orch.providers, props.current.connection, dirty.current);
      e.world.setOrchSignals({ alertAgent: cd.visual.alert ? cd.visual.lookAgentId : null, approvals: cd.visual.approvals, quiet: cd.visual.ambient });
      for (const id of cd.takeDispatches()) e.world.orchVisit(id);
      const ins = inset.current;
      {
        const Lc = props.current.layout, dprc = window.devicePixelRatio || 1, rc = levelRect(Lc, shownLevel.current);
        const aw = Math.max(100, cssW * dprc - ins.cur * dprc), ah = cssH * dprc;
        const sc = fitScale(rc.w, rc.h, aw, ah) * tgt.current.zoom;
        tgt.current.cx = clampCenter(tgt.current.cx, rc.w, aw, sc); tgt.current.cy = rc.y + clampCenter(tgt.current.cy - rc.y, rc.h, ah, sc);
      }
      const camMoving = stepCamera(cam.current, tgt.current, dt);
      const insMoving = Math.abs(ins.tgt - ins.cur) > 0.3;
      ins.cur = insMoving ? ins.cur + (ins.tgt - ins.cur) * (1 - Math.exp(-10 * dt)) : ins.tgt;
      if (camMoving || insMoving) lastCamMove = now;
      const fps = (camMoving || insMoving || e.renderer.fading) ? 60 : Math.max(e.world.motionFps(wall), cd.fps(wall), props.current.decor ? 12 : 0, e.renderer.streetBusy ? 30 : 0);
      if (!dirty.current && (fps === 0 || now - lastDraw < 1000 / fps - 3)) return;
      dirty.current = false; lastDraw = now;
      const dpr = window.devicePixelRatio || 1;
      const devW = Math.round(cssW * dpr), devH = Math.round(cssH * dpr);
      e.renderer.resize(devW, devH);
      const L = props.current.layout;
      const areaW = Math.max(100, devW - ins.cur * dpr);
      const v = viewForRect(cam.current, levelRect(L, shownLevel.current), areaW, devH, dpr);
      viewRef.current = v;
      e.renderer.ensureStatic(v.scale, now - lastCamMove > 160);
      const ed = props.current.edit;
      e.renderer.render(e.world, v, wall, dt, { hoverId: hover.current, selectedId: props.current.selectedId, showNames: props.current.showNames, editKey: ed ? ed.selectedKey : undefined, ghost: ghost.current }, cd);
    };
    const start = () => { last = 0; raf = requestAnimationFrame(frame); };
    const onVis = () => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; hiddenAt = Date.now(); return; }
      const e = engine.current;
      // retour : on rattrape le temps écoulé en quelques pas (sans dessiner), puis on reprend
      if (e && hiddenAt && Date.now() - hiddenAt > 1500) { const n = Math.min(300, Math.round((Date.now() - hiddenAt) / 100)); for (let k = 0; k < n; k++) e.world.update(0.1, Date.now()); }
      hiddenAt = 0; dirty.current = true; lastMinute.current = -1; start();
    };
    document.addEventListener('visibilitychange', onVis);
    if (!document.hidden) start();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  // pointeur : survol, clic, panoramique avec inertie, pincement ; molette : zoom centré sur le curseur ; édition du mobilier
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ptrs = new Map<number, { x: number; y: number }>();
    let drag: { x: number; y: number; moved: boolean; t: number; vx: number; vy: number } | null = null;
    let carry: { key: string; dc: number; dr: number; w: number; h: number; room: number } | null = null;
    let pinch = 0;
    const dev = (ev: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect(), k = canvas.width / r.width;
      return { x: (ev.clientX - r.left) * k, y: (ev.clientY - r.top) * k };
    };
    const world = (ev: { clientX: number; clientY: number }) => { const d = dev(ev), v = viewRef.current; return { x: toWorldX(v, d.x), y: toWorldY(v, d.y) }; };
    const targetView = (): View => {
      const L = props.current.layout, dpr = window.devicePixelRatio || 1;
      return viewForRect(tgt.current, levelRect(L, shownLevel.current), Math.max(100, canvas.width - inset.current.tgt * dpr), canvas.height, dpr);
    };
    const userMoved = () => { if (props.current.followId) props.current.onFollowEnd(); };
    const zoomAt = (nz: number, px: number, py: number) => {
      const v = targetView(), L = props.current.layout;
      const wx = toWorldX(v, px), wy = toWorldY(v, py);
      const z = clampZoom(nz);
      const areaW = Math.max(100, canvas.width - inset.current.tgt * v.dpr);
      const rz = levelRect(L, shownLevel.current);
      const s = fitScale(rz.w, rz.h, areaW, canvas.height) * z;
      tgt.current = { zoom: z, cx: wx - (px - areaW / 2) / s, cy: wy - (py - canvas.height / 2) / s };
      dirty.current = true;
      const d = deltaFromZoom(z);
      if (d !== props.current.zoomDelta && d >= MIN_ZOOM_DELTA && d <= MAX_ZOOM_DELTA) props.current.onZoomDelta(d);
    };
    const hit = (ev: PointerEvent): string | null => {
      const e = engine.current; if (!e) return null;
      const w = world(ev);
      const L0 = props.current.layout, r0 = levelRect(L0, shownLevel.current);
      if (w.y < r0.y || w.y >= r0.y + r0.h) return null; // hors de l'étage affiché
      const g = consoleGeom(L0.control);
      if (Math.abs(w.x - g.postX) <= 9 && w.y >= g.postY - 28 && w.y <= g.postY + 9) return ORCH_ID;
      const c = e.world.charAt(w.x, w.y);
      if (c) return c.id;
      const desk = e.world.deskAt(w.x, w.y); // clic sur le bureau : sélectionne son occupant
      if (desk) return desk;
      const L = props.current.layout, col = Math.floor(w.x / TILE), row = Math.floor(w.y / TILE);
      for (const d of L.wallDecor) { // tableaux muraux interactifs (planning, limites) : clic sur leur façade
        if (d.kind !== 'planning') continue;
        if (w.x >= d.col * TILE && w.x <= (d.col + d.w) * TILE && w.y >= d.row * TILE - 5 && w.y <= d.row * TILE + 12) return PLANNING_ID;
      }
      const sb = L.furniture.find((q) => q.kind === 'status_board'); // écran des limites (volume dessiné au-dessus de l'emprise)
      if (sb && w.x >= sb.col * TILE && w.x <= (sb.col + sb.w) * TILE && w.y >= sb.row * TILE - 26 && w.y <= (sb.row + 1) * TILE) return LIMITS_ID;
      if (col < 0 || row < 0 || col >= L.cols || row >= L.rows) return null;
      if (L.furniture.some((q) => q.kind === 'mailbox' && col === q.col && row >= q.row - 1 && row <= q.row)) return MAILBOX_ID;
      const f = L.furniture.find((q) => q.kind === 'reception' && col >= q.col && col < q.col + q.w && row >= q.row - 1 && row <= q.row);
      if (f && L.staff.reception) return STAFF_IDS.reception; // banque d'accueil
      const r = L.roomAt[row * L.cols + col];
      if (r >= 0 && L.rooms[r].kind === 'server') return SERVER_ID; // salle serveur : panneau « Serveur RO·AI »
      if (r >= 0 && L.rooms[r].kind === 'approval') return APPROVALS_ID; // salle d'attente : demandes à approuver
      if (r >= 0 && L.rooms[r].kind === 'library') return LIBRARY_ID;   // bibliothèque : archives des rapports
      if (r >= 0 && L.rooms[r].kind === 'meeting') return MEETING_ID;   // salle de réunion : conversations
      if (r >= 0 && L.rooms[r].kind === 'landing') return FLOOR_ID;     // palier : escalier et ascenseur
      for (const d of L.wallDecor) if (d.kind === 'elevator' && w.x >= d.col * TILE && w.x <= (d.col + d.w) * TILE && w.y >= d.row * TILE - 14 && w.y <= (d.row + 1) * TILE) return FLOOR_ID;
      return null;
    };
    const furnAt = (ev: PointerEvent) => {
      // meuble sous le pointeur : emprise au sol ou volume dessiné (plante, étagère…), le plus en avant d'abord
      const w = world(ev), L = props.current.layout;
      let best = null as (typeof L.furniture)[number] | null, bestY = -1e9;
      for (const f of L.furniture) {
        if (!f.movable || levelOfRow(L, f.row) !== shownLevel.current) continue;
        const z = f.kind === 'rug' ? 0 : FURNITURE[f.kind].z;
        if (w.x < f.col * TILE || w.x > (f.col + f.w) * TILE || w.y < f.row * TILE - z || w.y > (f.row + f.h) * TILE) continue;
        const y = (f.row + f.h) * TILE - (f.kind === 'rug' ? 1000 : 0);
        if (y > bestY) { bestY = y; best = f; }
      }
      if (!best) return null;
      const col = Math.max(best.col, Math.min(best.col + best.w - 1, Math.floor(w.x / TILE)));
      const row = Math.max(best.row, Math.min(best.row + best.h - 1, Math.floor(w.y / TILE)));
      return { f: best, col, row };
    };
    const ghostAt = (ev: PointerEvent) => {
      if (!carry) return;
      const w = world(ev), L = props.current.layout;
      const col = Math.floor(w.x / TILE) - carry.dc, row = Math.floor(w.y / TILE) - carry.dr;
      let ok = true;
      const self = L.furniture.find((f) => f.key === carry!.key);
      for (let j = 0; j < carry.h && ok; j++) for (let i = 0; i < carry.w && ok; i++) {
        const c = col + i, r = row + j, k = r * L.cols + c;
        if (c < 0 || r < 0 || c >= L.cols || r >= L.rows || L.roomAt[k] !== carry.room || L.tiles[k] !== 2) ok = false;
        else if (L.blocked[k] && self && !(c >= self.col && c < self.col + self.w && r >= self.row && r < self.row + self.h) && self.blocks) ok = false;
      }
      ghost.current = { col, row, w: carry.w, h: carry.h, ok };
      dirty.current = true;
    };
    const onMove = (ev: PointerEvent) => {
      const prev = ptrs.get(ev.pointerId);
      if (prev) ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && dist > 0) { const m = dev({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }); userMoved(); zoomAt(tgt.current.zoom * (dist / pinch), m.x, m.y); cam.current = { ...tgt.current }; }
        pinch = dist; return;
      }
      if (carry && drag) { ghostAt(ev); return; }
      if (drag) {
        const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        if (drag.moved) {
          const k = canvas.width / canvas.getBoundingClientRect().width, s = viewRef.current.scale;
          const now = performance.now(), dtm = Math.max(1, now - drag.t);
          drag.vx = drag.vx * 0.6 + ((-dx * k) / s / dtm * 1000) * 0.4; drag.vy = drag.vy * 0.6 + ((-dy * k) / s / dtm * 1000) * 0.4;
          drag.t = now; drag.x = ev.clientX; drag.y = ev.clientY;
          userMoved();
          tgt.current.cx += (-dx * k) / s; tgt.current.cy += (-dy * k) / s; cam.current.cx = tgt.current.cx; cam.current.cy = tgt.current.cy;
          dirty.current = true; canvas.style.cursor = 'grabbing';
          if (hover.current) { hover.current = null; props.current.onHover(null); }
          return;
        }
      }
      if (props.current.edit) { const h = furnAt(ev); canvas.style.cursor = h ? 'move' : 'grab'; return; }
      const id = hit(ev);
      if (id !== hover.current) { hover.current = id; dirty.current = true; canvas.style.cursor = id ? 'pointer' : 'grab'; }
      props.current.onHover(id ? { id, x: ev.clientX, y: ev.clientY } : null);
    };
    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (ptrs.size === 2) { drag = null; carry = null; ghost.current = null; const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
      else {
        drag = { x: ev.clientX, y: ev.clientY, moved: false, t: performance.now(), vx: 0, vy: 0 };
        if (props.current.edit) {
          const h = furnAt(ev);
          if (h) { carry = { key: h.f.key, dc: h.col - h.f.col, dr: h.row - h.f.row, w: h.f.w, h: h.f.h, room: h.f.room }; props.current.edit.onPick(h.f.key); }
          else carry = null;
        }
      }
      canvas.setPointerCapture(ev.pointerId);
    };
    const onUp = (ev: PointerEvent) => {
      ptrs.delete(ev.pointerId); if (ptrs.size < 2) pinch = 0;
      if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
      const d = drag; drag = null; canvas.style.cursor = 'grab';
      if (carry) {
        const g = ghost.current, c = carry; carry = null; ghost.current = null; dirty.current = true;
        if (g && props.current.edit) { const f = props.current.layout.furniture.find((x) => x.key === c.key); if (f && (g.col !== f.col || g.row !== f.row)) props.current.edit.onDrop(c.key, g.col, g.row); }
        return;
      }
      if (!d) return;
      if (!d.moved) {
        if (props.current.edit) { props.current.edit.onPick(null); return; }
        const id = hit(ev);
        if (id === FLOOR_ID) { userMoved(); props.current.onLevel(shownLevel.current === 0 ? 1 : 0); return; } // escalier / ascenseur : l'autre étage
        props.current.onSelect(id); return;
      }
      tgt.current.cx += d.vx * 0.22; tgt.current.cy += d.vy * 0.22;
      dirty.current = true;
    };
    const onLeave = () => { if (hover.current) { hover.current = null; dirty.current = true; } props.current.onHover(null); };
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const d = dev(ev);
      userMoved();
      const unit = ev.deltaMode === 1 ? 16 : 1;
      zoomAt(tgt.current.zoom * Math.exp((-ev.deltaY * unit) * 0.0018), d.x, d.y);
    };
    canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp); canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp); canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  const onKey = (ev: React.KeyboardEvent) => {
    const ags = p.model.agents;
    if (ev.key === '+' || ev.key === '=') { p.onZoomDelta(Math.min(MAX_ZOOM_DELTA, p.zoomDelta + 1)); return; }
    if (ev.key === '-') { p.onZoomDelta(Math.max(MIN_ZOOM_DELTA, p.zoomDelta - 1)); return; }
    if (!ags.length || p.edit) return;
    const i = ags.findIndex((a) => a.id === p.selectedId);
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') { p.onSelect(ags[(i + 1 + ags.length) % ags.length].id); ev.preventDefault(); }
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') { p.onSelect(ags[(i - 1 + ags.length) % ags.length].id); ev.preventDefault(); }
    else if (ev.key === 'Escape') p.onSelect(null);
  };

  return (
    <div ref={wrapRef} className="office-canvas-wrap">
      <canvas
        ref={canvasRef} className="office-canvas" tabIndex={0} onKeyDown={onKey}
        aria-label="Siège virtuel. Flèches : parcourir les agents. Plus et moins : zoom. Échap : fermer le panneau. Un clic sur un personnage ou sur son bureau ouvre sa fiche. La liste des agents offre le même accès."
      />
    </div>
  );
}
