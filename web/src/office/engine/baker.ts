// Couches statiques pré-rendues à la résolution courante :
//  • « sol » : abords, sols de chaque pièce, ombres de contact, tapis, seuils, murs qui n'ont rien à masquer ;
//  • « volumes » : murs (avec décor mural), mobilier et postes de travail, dessinés une fois dans l'ordre de profondeur.
// Le rendu dynamique redessine chaque volume par sous-image, intercalé avec les personnages (tri par Y), pour que
// cloisons, écrans et dossiers masquent correctement ceux qui passent derrière. Régénéré uniquement quand le plan,
// les fiches (décor des bureaux), l'échelle (après stabilisation) ou la police changent.
import type { Layout, Room } from '../layout/plan.ts';
import { T, TILE, isExtRow, isExtWall, levelOfRow } from '../layout/plan.ts';
import { FURNITURE } from '../layout/furniture.ts';
import { C, DEPT_COLORS, FLOOR, UI } from './theme.ts';
import { FONT_FAMILY, fillRR, hash2, makeCanvas, rr } from './draw.ts';
import type { Ctx } from './draw.ts';
import { BAKE_PAD } from './lighting.ts';
import { DEFAULT_LOOK, EXT_Z, SEASON_DECOR, WALL_Z, drawDesk, drawFurniture, drawWallDecor, festiveWall, furnitureBox, wallFace } from './props.ts';
import type { DeskLook } from './props.ts';

export const PROP_WALL = 0, PROP_FURN = 1, PROP_DESK = 2;
export interface Prop { x: number; y: number; w: number; h: number; sortY: number; kind: number; ref: number; row: number }
/** Couches d'un étage : `oy` = haut de l'étage (pixels monde), les images couvrent [oy - BAKE_PAD, oy + hauteur + BAKE_PAD]. */
export interface BakeResult { base: HTMLCanvasElement; props: HTMLCanvasElement; scale: number; list: Prop[]; level: number; oy: number }

/** Plafond de pixels par couche (mémoire du navigateur). */
const MAX_DIM = 4096, MAX_PIXELS = 10_000_000;

export function bakeScale(layout: Layout, want: number): number {
  const W = layout.width + BAKE_PAD * 2, H = layout.floorRows * TILE + BAKE_PAD * 2; // un étage à la fois
  return Math.max(0.25, Math.min(want, MAX_DIM / W, MAX_DIM / H, Math.sqrt(MAX_PIXELS / (W * H))));
}

const wallish = (t: number) => t === T.WALL || t === T.WINDOW || t === T.GLASS;
const armish = (t: number) => wallish(t) || t === T.DOOR;

export function bakeStatic(L: Layout, wantScale: number, looks: ReadonlyMap<string, DeskLook>, level = 0): BakeResult {
  const scale = bakeScale(L, wantScale);
  const FH = L.floorRows * TILE, oy = level * FH, r0 = level * L.floorRows, r1 = r0 + L.floorRows;
  const W = (L.width + BAKE_PAD * 2) * scale, H = (FH + BAKE_PAD * 2) * scale;
  const base = makeCanvas(W, H), props = makeCanvas(W, H);
  for (const c of [base.ctx, props.ctx]) { c.scale(scale, scale); c.translate(BAKE_PAD, BAKE_PAD - oy); }
  const b = base.ctx;
  const B0 = L.building, A0 = L.annex;
  const B = { ...B0, y: B0.y + r0 }, A = { ...A0, y: A0.y + r0 }; // bâtiment et cage de cet étage
  const tileAt = (c: number, r: number) => (c < 0 || r < 0 || c >= L.cols || r >= L.rows ? T.VOID : L.tiles[r * L.cols + c]);
  const ext = (c: number, r: number) => isExtWall(L, c, r);
  const extH = (c: number, r: number) => isExtRow(L, c, r);
  const mine = (row: number) => row >= r0 - 1 && row < r1 + 1;
  const ground = level === 0;

  // ── abords : pelouse, allées, parvis (rez-de-chaussée) ; à l'étage, le dehors reste transparent (vue plongeante) ──
  if (ground) {
  b.fillStyle = C.ground; b.fillRect(-BAKE_PAD, oy - BAKE_PAD, L.width + BAKE_PAD * 2, FH + BAKE_PAD * 2);
  for (let i = 0; i < 900; i++) { b.fillStyle = hash2(i, 3) < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'; b.fillRect(hash2(i, 1) * L.width, oy + hash2(i, 2) * FH, 1.4, 1.4); }
  // trottoir le long de la façade et parvis
  const fy = (B.y + B.h) * TILE;
  b.fillStyle = C.paving; b.fillRect(B.x * TILE - 10, fy, B.w * TILE + 20, 12);
  b.fillStyle = C.curb; b.fillRect(B.x * TILE - 10, fy + 12, B.w * TILE + 20, 1.5);
  b.fillStyle = C.paving; b.fillRect(B.x * TILE - 10, B.y * TILE - 12, B.w * TILE + 20, 12);
  for (let r = r0; r < r1; r++) for (let c = 0; c < L.cols; c++) if (L.tiles[r * L.cols + c] === T.OUT) { b.fillStyle = (c + r) % 2 ? '#cbc5b9' : '#c4beb2'; b.fillRect(c * TILE, r * TILE, TILE, TILE); }
  b.strokeStyle = C.pavingLine; b.lineWidth = 0.6;
  b.beginPath();
  for (let x = B.x * TILE - 10; x < (B.x + B.w) * TILE + 10; x += 16) { b.moveTo(x, fy); b.lineTo(x, fy + 12); }
  b.stroke();
  // rue : trottoir (lampadaires), stationnement, chaussée à deux voies, trottoir d'en face, passage piéton devant le parvis
  {
    const S = L.street, X1 = L.width + BAKE_PAD, X0 = -BAKE_PAD;
    const yS = S.sidewalk * TILE, yP = S.parking * TILE, yR = S.road * TILE, yF = S.far * TILE;
    b.fillStyle = C.paving; b.fillRect(X0, yS, X1 - X0, TILE);
    b.strokeStyle = C.pavingLine; b.lineWidth = 0.5; b.beginPath(); for (let x = 0; x < L.width; x += 16) { b.moveTo(x, yS); b.lineTo(x, yS + TILE); } b.stroke();
    b.fillStyle = C.curb; b.fillRect(X0, yP - 1.2, X1 - X0, 1.6);
    b.fillStyle = '#5a5e65'; b.fillRect(X0, yP + 0.4, X1 - X0, TILE - 0.4);
    b.fillStyle = '#4a4e55'; b.fillRect(X0, yR, X1 - X0, TILE * 2);
    for (let i = 0; i < 260; i++) { b.fillStyle = hash2(i, 11) < 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)'; b.fillRect(hash2(i, 12) * L.width, yP + hash2(i, 13) * TILE * 3, 1.2, 1.2); }
    b.fillStyle = 'rgba(240,236,224,0.75)';
    for (const c of S.spots) { b.fillRect(c * TILE, yP + 2, 0.8, TILE - 3); b.fillRect((c + 3) * TILE - 0.8, yP + 2, 0.8, TILE - 3); }
    b.fillRect(X0, yR + 0.4, X1 - X0, 0.6);
    for (let x = 4; x < L.width; x += 22) b.fillRect(x, yR + TILE - 0.4, 11, 0.8);
    b.fillRect(X0, yF - 1, X1 - X0, 0.6);
    for (let x = S.cross.a * TILE + 3; x < S.cross.b * TILE - 2; x += 6) b.fillRect(x, yP + 1, 3, TILE * 3 - 2);
    b.fillStyle = C.curb; b.fillRect(X0, yF, X1 - X0, 1.6);
    b.fillStyle = C.paving; b.fillRect(X0, yF + 1.6, X1 - X0, TILE - 1.6);
    b.fillStyle = '#5f7a4e'; b.fillRect(X0, yF + TILE - 3.5, X1 - X0, 3.5);
    for (let x = 0; x < L.width; x += 7) { b.fillStyle = hash2(x, 21) < 0.5 ? '#6d8a58' : '#557046'; b.beginPath(); b.arc(x + 3, yF + TILE - 3.5, 2.6, Math.PI, 0); b.fill(); }
  }
  }
  // ombre portée du bâtiment et de la cage d'escalier (plus large et plus diffuse à l'étage : on est en hauteur)
  b.save(); b.shadowColor = ground ? 'rgba(10,14,20,0.45)' : 'rgba(5,8,14,0.6)'; b.shadowBlur = (ground ? 14 : 26) * scale; b.shadowOffsetY = (ground ? 5 : 14) * scale; b.shadowOffsetX = (ground ? 2 : 6) * scale;
  b.fillStyle = '#3a3e45'; b.fillRect(B.x * TILE + 3, B.y * TILE + 3, B.w * TILE - 6, B.h * TILE - 6); b.fillRect(A.x * TILE + 3, A.y * TILE + 3, A.w * TILE - 6, A.h * TILE - 6); b.restore();

  // ── sols : chaque pièce déborde d'une demi-case sous ses murs ──
  const order = L.rooms.filter((r) => r.level === level).sort((p, q) => (p.kind === 'corridor' ? 0 : 1) - (q.kind === 'corridor' ? 0 : 1));
  for (const room of order) floor(b, room);
  // seuils de porte
  for (const d of L.doors) {
    if (L.rooms[d.room].level !== level) continue;
    const room = L.rooms[d.room];
    b.save(); b.beginPath(); b.rect(d.col * TILE, d.row * TILE, d.w * TILE, d.h * TILE); b.clip();
    floor(b, room, true);
    b.restore();
    if (d.kind !== 'open') { fillRR(b, d.kind === 'entrance' ? '#8e949c' : '#b9b2a6', d.col * TILE + 1, d.row * TILE + 6, d.w * TILE - 2, 4, 1); }
    if (d.kind === 'entrance') { fillRR(b, '#5b5f66', d.col * TILE + 2, (d.row + 1) * TILE + 1, d.w * TILE - 4, 9, 1.5); b.fillStyle = 'rgba(255,255,255,0.08)'; for (let i = 0; i < 6; i++) b.fillRect(d.col * TILE + 4 + i * 4.4, (d.row + 1) * TILE + 2, 0.6, 7); }
  }
  // occlusion ambiante sous les faces de murs horizontaux
  for (let r = r0; r < r1; r++) for (let c = 0; c < L.cols; c++) {
    const t = tileAt(c, r);
    if (!wallish(t)) continue;
    const below = tileAt(c, r + 1);
    if (below === T.FLOOR || below === T.DOOR) {
      const y0 = r * TILE + (ext(c, r) ? 13 : 11);
      const g = b.createLinearGradient(0, y0, 0, y0 + 9); g.addColorStop(0, 'rgba(30,25,20,0.26)'); g.addColorStop(1, 'rgba(30,25,20,0)');
      b.fillStyle = g; b.fillRect(c * TILE, y0, TILE, 9);
    }
    for (const s of [-1, 1]) {
      const side = tileAt(c + s, r);
      if (side === T.FLOOR && wallish(tileAt(c, r + 1))) { // ombre le long d'un mur vertical
        const x0 = c * TILE + 8 + s * (ext(c, r) ? 5 : 3);
        const g = b.createLinearGradient(x0, 0, x0 + s * 6, 0); g.addColorStop(0, 'rgba(30,25,20,0.16)'); g.addColorStop(1, 'rgba(30,25,20,0)');
        b.fillStyle = g; b.fillRect(Math.min(x0, x0 + s * 6), r * TILE, 6, TILE);
      }
    }
  }
  // tapis et escaliers (au sol : on marche dessus), puis ombres de contact du mobilier et des postes
  const furn = L.furniture.filter((f) => mine(f.row)), desks = L.desks.filter((d) => mine(d.row));
  for (const f of furn) if (f.kind === 'rug' || f.kind === 'stairs') drawFurniture(b, f);
  b.save(); b.fillStyle = 'rgba(25,22,18,0.22)'; b.shadowColor = 'rgba(25,22,18,0.35)'; b.shadowBlur = 4 * scale; b.shadowOffsetY = 1.5 * scale;
  for (const f of furn) {
    if (!f.blocks || f.kind === 'tree' || f.kind === 'bush' || f.kind === 'stairs') continue;
    rr(b, f.col * TILE + 2, f.row * TILE + 3.5, f.w * TILE - 3, f.h * TILE - 3, 3); b.fill();
  }
  for (const d of desks) { rr(b, d.col * TILE + 2, d.row * TILE + 4, 45, 11, 2); b.fill(); rr(b, d.col * TILE + 50, d.row * TILE + 6, 12, 9, 2); b.fill(); }
  b.restore();
  for (const f of furn) if (f.kind === 'tree' || f.kind === 'bush') { b.fillStyle = 'rgba(20,30,15,0.28)'; b.beginPath(); b.ellipse((f.col + f.w / 2) * TILE + 3, (f.row + f.h) * TILE - 2, f.w * 8, f.h * 3.5, 0, 0, 7); b.fill(); }
  // marquage au sol du hall
  const lobby = L.rooms.find((r) => r.kind === 'lobby');
  if (lobby && ground) { b.fillStyle = 'rgba(245,167,66,0.55)'; b.fillRect(L.entrance.col * TILE, L.entrance.row * TILE - 2, L.entrance.w * TILE, 1.2); }

  // ── murs : ceux sans rien à masquer vont au sol, les autres deviennent des volumes triés ──
  const list: Prop[] = [];
  const decorByRow = new Map<number, typeof L.wallDecor>();
  for (const w of L.wallDecor) { if (levelOfRow(L, w.row) !== level) continue; const a = decorByRow.get(w.row) ?? []; a.push(w); decorByRow.set(w.row, a); }
  const sortedWall = (c: number, r: number) => { const up = tileAt(c, r - 1); return up === T.FLOOR || up === T.DOOR || up === T.OUT; };
  for (let r = r0; r < r1; r++) {
    let c = 0;
    while (c < L.cols) {
      if (!wallish(tileAt(c, r)) || !sortedWall(c, r)) { if (wallish(tileAt(c, r))) wallTile(b, c, r); c++; continue; }
      const c0 = c;
      while (c < L.cols && wallish(tileAt(c, r)) && sortedWall(c, r)) c++;
      const e = extH(c0, r);
      list.push({ x: c0 * TILE - 2, y: r * TILE - (e ? EXT_Z : WALL_Z) - 6, w: (c - c0) * TILE + 4, h: TILE + (e ? EXT_Z : WALL_Z) + 8, sortY: r * TILE + (e ? 13 : 11), kind: PROP_WALL, ref: c0, row: r });
    }
  }
  L.furniture.forEach((f, i) => {
    if (f.kind === 'rug' || f.kind === 'stairs' || levelOfRow(L, f.row) !== level) return;
    const bx = furnitureBox(f);
    list.push({ x: bx.x, y: bx.y, w: bx.w, h: bx.h, sortY: bx.sortY, kind: PROP_FURN, ref: i, row: f.row });
  });
  L.desks.forEach((d, i) => levelOfRow(L, d.row) === level && list.push({ x: d.col * TILE - 2, y: d.row * TILE - 26, w: 4 * TILE + 4, h: TILE + 30, sortY: d.row * TILE + 15, kind: PROP_DESK, ref: i, row: d.row }));
  list.sort((p, q) => p.sortY - q.sortY || p.kind - q.kind);

  const p = props.ctx;
  // décor de saison : sapins de l'entrée du hall (Noël), guirlande ou drapeaux sur le mur du fond du hall
  const hall = ground ? L.rooms.find((r) => r.kind === 'lobby') : undefined;
  const fest = SEASON_DECOR.cal.festive;
  SEASON_DECOR.xmasPlants = new Set(fest === 'xmas' && hall ? L.furniture.filter((f) => f.kind === 'plant_tall' && f.room === hall.id && f.row === hall.y + hall.h - 1).map((f) => f.key) : []);
  for (const it of list) {
    if (it.kind === PROP_WALL) {
      let c = it.ref;
      while (c < L.cols && wallish(tileAt(c, it.row)) && sortedWall(c, it.row)) { wallTile(p, c, it.row); c++; }
      if (fest && hall && it.row === hall.y - 1) {
        const a = Math.max(it.ref, hall.x), e = Math.min(c, hall.x + hall.w);
        if (e - a >= 2) festiveWall(p, a * TILE + 2, e * TILE - 2, wallFace(it.row, false).faceTop + 0.5, fest);
      }
      for (const w of decorByRow.get(it.row) ?? []) if (w.col >= it.ref && w.col < c) drawWallDecor(p, w, extH(w.col, w.row));
    } else if (it.kind === PROP_FURN) drawFurniture(p, L.furniture[it.ref]);
    else { const d = L.desks[it.ref]; drawDesk(p, d, looks.get(d.agentId) ?? DEFAULT_LOOK); }
  }
  // décor mural des murs restés au sol (rangée du haut)
  for (const [row, ws] of decorByRow) for (const w of ws) if (!sortedWall(w.col, row)) drawWallDecor(b, w, extH(w.col, row));
  return { base: base.canvas, props: props.canvas, scale, list, level, oy };

  // ───────── murs (tuile par tuile, bras de jonction vers les voisins) ─────────
  function wallTile(ctx: Ctx, c: number, r: number) {
    const t = tileAt(c, r), e = ext(c, r), glass = t === T.GLASS;
    const th = glass ? 1.6 : e ? 5 : 3, Z = e ? EXT_Z : WALL_Z;
    const cx = c * TILE + 8, cy = r * TILE + 8;
    const n = armish(tileAt(c, r - 1)), s = armish(tileAt(c, r + 1)), w = armish(tileAt(c - 1, r)), ea = armish(tileAt(c + 1, r));
    const rects: [number, number, number, number][] = [[cx - th, cy - th, th * 2, th * 2]];
    if (n) rects.push([cx - th, r * TILE, th * 2, 8]);
    if (s) rects.push([cx - th, cy, th * 2, 8 + 0.01]);
    if (w) rects.push([c * TILE, cy - th, 8, th * 2]);
    if (ea) rects.push([cx, cy - th, 8, th * 2]);
    const faceY0 = cy + th - Z, faceY1 = cy + th;
    const faceCol = e ? C.extFace : C.wallFace;
    const segs: [number, number][] = [];
    if (w) segs.push([c * TILE, cx - th]);
    if (!s) segs.push([cx - th, cx + th]);
    if (ea) segs.push([cx + th, (c + 1) * TILE]);
    if (glass) {
      // cloison vitrée : rail bas, verre translucide, montants, lisse haute
      for (const [a, z] of segs) {
        ctx.fillStyle = C.glass; ctx.fillRect(a, faceY0, z - a, Z);
        ctx.fillStyle = C.glassHi; ctx.fillRect(a, faceY0 + 1.2, z - a, 0.6);
        ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.moveTo(a + 2, faceY1 - 1); ctx.lineTo(a + 6, faceY0 + 1); ctx.lineTo(a + 8, faceY0 + 1); ctx.lineTo(a + 4, faceY1 - 1); ctx.closePath(); ctx.fill();
        ctx.fillStyle = C.frame; ctx.fillRect(a, faceY1 - 1.6, z - a, 1.6);
      }
      ctx.fillStyle = '#8b929c';
      for (const [x, y, ww, hh] of rects) ctx.fillRect(x, y - Z, ww, hh);
      if (!w || !ea) { ctx.fillStyle = C.frame; ctx.fillRect(cx - 1, faceY0, 2, Z); }
      return;
    }
    // faces (côté sud visible) : plinthe, fenêtres dans la face des murs extérieurs horizontaux
    for (const [a, z] of segs) {
      ctx.fillStyle = faceCol; ctx.fillRect(a, faceY0, z - a, Z);
      ctx.fillStyle = 'rgba(0,0,0,0.05)'; ctx.fillRect(a, faceY0, z - a, 1.2);
      ctx.fillStyle = e ? '#b8b0a3' : C.baseboard; ctx.fillRect(a, faceY1 - 1.8, z - a, 1.8);
      if (t === T.WINDOW) {
        ctx.fillStyle = '#5d646e'; ctx.fillRect(a, faceY0 + 2, z - a, Z - 5);
        ctx.fillStyle = r === B.y ? '#9fc1d6' : '#7f9fb4'; ctx.fillRect(a + 0.8, faceY0 + 2.8, z - a - 1.6, Z - 6.6);
        ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.moveTo(a + 1, faceY1 - 4); ctx.lineTo(a + 5, faceY0 + 3); ctx.lineTo(a + 7.5, faceY0 + 3); ctx.lineTo(a + 3.5, faceY1 - 4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#5d646e'; ctx.fillRect(c * TILE + 7.5, faceY0 + 2, 1, Z - 5);
        ctx.fillStyle = '#e8e3da'; ctx.fillRect(a, faceY1 - 3.4, z - a, 1.2);
      }
    }
    // dessus (coupe du mur) : graphite, liseré clair
    ctx.fillStyle = e ? C.extCap : C.wallCap;
    for (const [x, y, ww, hh] of rects) ctx.fillRect(x, y - Z, ww, hh);
    if (t === T.WINDOW && (s || n) && !w && !ea) { // fenêtre dans un mur vertical : vitrage vu de dessus
      ctx.fillStyle = '#9fc1d6'; ctx.fillRect(cx - th + 1.6, r * TILE - Z, th * 2 - 3.2, TILE);
      ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(cx - 0.4, r * TILE - Z, 0.8, TILE);
    } else if (t === T.WINDOW) { ctx.fillStyle = '#c9d6de'; ctx.fillRect(Math.max(c * TILE, cx - 8), cy - th - Z + 1.4, TILE, 1); }
    ctx.fillStyle = e ? C.extCapHi : C.wallCapHi;
    if (!n) ctx.fillRect(cx - th, cy - th - Z, th * 2, 0.8);
    if (w) ctx.fillRect(c * TILE, cy - th - Z, 8 - th, 0.8);
    if (ea) ctx.fillRect(cx + th, cy - th - Z, 8 - th, 0.8);
  }

  function floor(ctx: Ctx, room: Room, clipOnly = false) {
    const x = room.x * TILE - (clipOnly ? 0 : 8), y = room.y * TILE - (clipOnly ? 0 : 8), w = room.w * TILE + (clipOnly ? 0 : 16), h = room.h * TILE + (clipOnly ? 0 : 16);
    const X = clipOnly ? -1e4 : x, Y = clipOnly ? -1e4 : y, Wd = clipOnly ? 2e4 : w, Hd = clipOnly ? 2e4 : h;
    const k = room.floor, P = FLOOR[k];
    let a: string = P.a, bcol: string = P.b;
    if (room.kind === 'department') { const dc = DEPT_COLORS[room.tint % DEPT_COLORS.length]; a = dc.a; bcol = dc.b; }
    if (room.kind === 'meeting') { a = '#9ea7b2'; bcol = '#99a2ad'; }
    ctx.save(); ctx.beginPath(); ctx.rect(X, Y, Wd, Hd); ctx.clip();
    ctx.fillStyle = a; ctx.fillRect(X, Y, Wd, Hd);
    const x0 = clipOnly ? room.x * TILE - 8 : x, y0 = clipOnly ? room.y * TILE - 8 : y, w0 = clipOnly ? room.w * TILE + 16 : w, h0 = clipOnly ? room.h * TILE + 16 : h;
    switch (k) {
      case 'carpet': case 'dark': {
        for (let j = 0; j * 32 < h0; j++) for (let i = 0; i * 32 < w0; i++) if ((i + j) % 2) { ctx.fillStyle = bcol; ctx.fillRect(x0 + i * 32, y0 + j * 32, 32, 32); }
        ctx.fillStyle = P.line; for (let i = 0; i < (w0 * h0) / 14; i++) ctx.fillRect(x0 + hash2(i, room.id, 1) * w0, y0 + hash2(i, room.id, 2) * h0, 0.8, 0.8);
        if (room.kind === 'department') { ctx.fillStyle = DEPT_COLORS[room.tint % DEPT_COLORS.length].accent; ctx.globalAlpha = 0.5; ctx.fillRect(room.x * TILE, (room.corridorSide === 'bottom' ? room.y + room.h : room.y) * TILE - (room.corridorSide === 'bottom' ? 2 : 0), room.w * TILE, 2); ctx.globalAlpha = 1; }
        if (k === 'dark') { ctx.fillStyle = 'rgba(245,167,66,0.6)'; ctx.fillRect(room.x * TILE + 6, (room.y + room.h) * TILE - 6, room.w * TILE - 12, 1); }
        break;
      }
      case 'wood': {
        const plank = 5.3;
        for (let py = y0, i = 0; py < y0 + h0; py += plank, i++) {
          ctx.fillStyle = hash2(i, room.id, 9) < 0.5 ? a : bcol; ctx.fillRect(x0, py, w0, plank);
          ctx.fillStyle = P.line; ctx.fillRect(x0, py, w0, 0.5);
          for (let jx = x0 + hash2(i, 3, room.id) * 40; jx < x0 + w0; jx += 38 + hash2(i, jx | 0, 5) * 14) ctx.fillRect(jx, py, 0.5, plank);
        }
        break;
      }
      case 'stone': case 'tiles': case 'terrazzo': case 'vinyl': case 'raised': {
        const s = k === 'stone' ? 32 : k === 'raised' ? 16 : k === 'vinyl' ? 32 : 16;
        if (k === 'stone') for (let j = 0; j * s < h0; j++) for (let i = 0; i * s < w0; i++) { ctx.fillStyle = hash2(i, j, room.id) < 0.5 ? a : bcol; ctx.fillRect(x0 + i * s, y0 + j * s, s, s); }
        if (k === 'terrazzo' || k === 'vinyl') for (let i = 0; i < (w0 * h0) / (k === 'terrazzo' ? 10 : 22); i++) { ctx.fillStyle = k === 'terrazzo' ? ['rgba(120,100,80,0.25)', 'rgba(255,255,255,0.4)', 'rgba(80,90,100,0.2)'][i % 3] : 'rgba(90,90,100,0.07)'; ctx.fillRect(x0 + hash2(i, room.id, 4) * w0, y0 + hash2(i, room.id, 5) * h0, 1, 1); }
        // joints : uniquement dans l'emprise exacte de la pièce (pas de double trait sous les murs mitoyens)
        const ix = room.x * TILE, iy = room.y * TILE, iw = room.w * TILE, ih = room.h * TILE;
        ctx.strokeStyle = P.line; ctx.lineWidth = k === 'raised' ? 0.7 : 0.5;
        ctx.beginPath();
        for (let gx = Math.ceil(ix / s) * s; gx < ix + iw; gx += s) { ctx.moveTo(gx, iy); ctx.lineTo(gx, iy + ih); }
        for (let gy = Math.ceil(iy / s) * s; gy < iy + ih; gy += s) { ctx.moveTo(ix, gy); ctx.lineTo(ix + iw, gy); }
        ctx.stroke();
        if (k === 'raised') { ctx.fillStyle = 'rgba(40,50,60,0.18)'; for (let gy = y0 - (y0 % 16); gy < y0 + h0; gy += 16) for (let gx = x0 - (x0 % 16); gx < x0 + w0; gx += 16) for (let q = 0; q < 4; q++) ctx.fillRect(gx + 4 + (q % 2) * 8, gy + 4 + (q >> 1) * 8, 0.8, 0.8); }
        if (k === 'vinyl' && room.kind === 'corridor' && room.band === 'C') { ctx.fillStyle = 'rgba(245,167,66,0.18)'; ctx.fillRect(room.x * TILE + 4, (room.y + room.h / 2) * TILE - 0.4, room.w * TILE - 8, 0.8); }
        break;
      }
    }
    ctx.restore();
  }
}

/** Nom de pièce : petite plaque lisible, dessinée en pixels écran par le rendu. */
export function roomTag(room: Room): { text: string; accent: string } | null {
  if (room.kind === 'corridor' || room.kind === 'nook') return null;
  const accent = room.kind === 'department' ? DEPT_COLORS[room.tint % DEPT_COLORS.length].accent : room.kind === 'control' || room.kind === 'lobby' ? UI.amber : room.kind === 'approval' ? UI.info : room.kind === 'meeting' ? '#8590a2' : room.kind === 'server' ? UI.ok : '#c9a676';
  return { text: room.label, accent };
}
export { FONT_FAMILY, FURNITURE };
