// Recherche de chemin A* sur grille 8-connexe (sans couper les angles), tas binaire et tampons réutilisés :
// aucune allocation par appel. Coût par case (sièges et emplacements plus chers : on les contourne), cases à éviter
// temporairement (personnages immobiles) et plafond d'expansions pour borner le temps de calcul.
import type { Tile } from './plan.ts';

export interface Grid { cols: number; rows: number; walkable: Uint8Array; cost?: Uint8Array }

const ORTHO = 10, DIAG = 14;
const DX = [0, 0, -1, 1, -1, 1, -1, 1];
const DY = [-1, 1, 0, 0, -1, -1, 1, 1];

export class PathFinder {
  readonly cols: number;
  readonly rows: number;
  private readonly walkable: Uint8Array;
  private readonly cost: Uint8Array | null;
  private readonly g: Float32Array;
  private readonly f: Float32Array;
  private readonly parent: Int32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private readonly avoid: Uint32Array;
  private readonly heap: Int32Array;
  private readonly pos: Int32Array;
  private heapN = 0;
  private stamp = 0;
  /** Nombre d'expansions de la dernière recherche (mesure). */
  lastExpanded = 0;

  constructor(grid: Grid) {
    this.cols = grid.cols; this.rows = grid.rows; this.walkable = grid.walkable; this.cost = grid.cost ?? null;
    const n = this.cols * this.rows;
    this.g = new Float32Array(n); this.f = new Float32Array(n); this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n); this.closed = new Uint32Array(n); this.avoid = new Uint32Array(n);
    this.heap = new Int32Array(n); this.pos = new Int32Array(n);
  }

  private push(i: number) {
    let k = this.heapN++;
    const { heap, pos, f } = this;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (f[heap[p]] <= f[i]) break;
      heap[k] = heap[p]; pos[heap[k]] = k; k = p;
    }
    heap[k] = i; pos[i] = k;
  }
  private decrease(i: number) {
    const { heap, pos, f } = this;
    let k = pos[i];
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (f[heap[p]] <= f[i]) break;
      heap[k] = heap[p]; pos[heap[k]] = k; k = p;
    }
    heap[k] = i; pos[i] = k;
  }
  private pop(): number {
    const { heap, pos, f } = this;
    const top = heap[0];
    const last = heap[--this.heapN];
    let k = 0;
    const n = this.heapN;
    while (true) {
      const l = 2 * k + 1;
      if (l >= n) break;
      const r = l + 1;
      const c = r < n && f[heap[r]] < f[heap[l]] ? r : l;
      if (f[heap[c]] >= f[last]) break;
      heap[k] = heap[c]; pos[heap[k]] = k; k = c;
    }
    if (n > 0) { heap[k] = last; pos[last] = k; }
    return top;
  }

  /**
   * Écrit le chemin (départ exclu, arrivée incluse) dans outCols/outRows. Retourne sa longueur, 0 si départ = arrivée,
   * -1 si inaccessible. `avoid` : indices de cases à éviter (fortement pénalisées, pas interdites).
   */
  find(sc: number, sr: number, ec: number, er: number, outCols: Int16Array, outRows: Int16Array, avoid?: ArrayLike<number> | null, avoidN = 0, maxExpand = 20000): number {
    const { cols, rows, walkable, cost, g, f, parent, seen, closed } = this;
    if (sc < 0 || sr < 0 || sc >= cols || sr >= rows || ec < 0 || er < 0 || ec >= cols || er >= rows) return -1;
    if (sc === ec && sr === er) return 0;
    const end = er * cols + ec;
    if (!walkable[end]) return -1;
    const stamp = ++this.stamp;
    if (avoid) for (let k = 0; k < avoidN; k++) { const a = avoid[k]; if (a >= 0 && a < this.avoid.length) this.avoid[a] = stamp; }
    const start = sr * cols + sc;
    this.heapN = 0;
    g[start] = 0; f[start] = this.h(sc, sr, ec, er); parent[start] = -1; seen[start] = stamp;
    this.push(start);
    let expanded = 0, found = false;
    while (this.heapN > 0) {
      const cur = this.pop();
      if (cur === end) { found = true; break; }
      if (closed[cur] === stamp) continue;
      closed[cur] = stamp;
      if (++expanded > maxExpand) break;
      const cc = cur % cols, cr = (cur - cc) / cols;
      for (let d = 0; d < 8; d++) {
        const nc = cc + DX[d], nr = cr + DY[d];
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const ni = nr * cols + nc;
        if (!walkable[ni] || closed[ni] === stamp) continue;
        if (d >= 4 && (!walkable[cr * cols + nc] || !walkable[nr * cols + cc])) continue; // pas d'angle coupé
        let step = d >= 4 ? DIAG : ORTHO;
        if (cost) step *= cost[ni] || 1;
        if (this.avoid[ni] === stamp && ni !== end) step += 400;
        const ng = g[cur] + step;
        if (seen[ni] === stamp && ng >= g[ni]) continue;
        g[ni] = ng; f[ni] = ng + this.h(nc, nr, ec, er); parent[ni] = cur;
        if (seen[ni] === stamp && closed[ni] !== stamp) this.decrease(ni);
        else { seen[ni] = stamp; this.push(ni); }
      }
    }
    this.lastExpanded = expanded;
    if (!found) return -1;
    let len = 0;
    for (let i = end; i !== start; i = parent[i]) len++;
    if (len > outCols.length) return -1;
    let k = len;
    for (let i = end; i !== start; i = parent[i]) { k--; outCols[k] = i % cols; outRows[k] = (i - (i % cols)) / cols; }
    return len;
  }

  private h(c: number, r: number, ec: number, er: number): number {
    const dx = Math.abs(c - ec), dy = Math.abs(r - er);
    return ORTHO * (dx + dy) + (DIAG - 2 * ORTHO) * Math.min(dx, dy);
  }

  /** Version pratique (allocation) pour les tests et les outils. */
  findTiles(from: Tile, to: Tile): Tile[] | null {
    const oc = new Int16Array(this.cols * this.rows), or = new Int16Array(this.cols * this.rows);
    const n = this.find(from.col, from.row, to.col, to.row, oc, or, null, 0, 1e9);
    if (n < 0) return null;
    return Array.from({ length: n }, (_, i) => ({ col: oc[i], row: or[i] }));
  }
}

/** Cases atteignables depuis `start` (BFS 4-connexe : la connexité ne dépend pas des diagonales). */
export function reachable(grid: Grid, start: Tile | readonly Tile[]): Uint8Array {
  const { cols, rows, walkable } = grid;
  const out = new Uint8Array(cols * rows);
  const q = new Int32Array(cols * rows);
  let head = 0, tail = 0;
  for (const t of Array.isArray(start) ? start : [start as Tile]) { // plusieurs départs : un par étage (relié par son palier)
    const s = t.row * cols + t.col;
    if (t.col < 0 || t.row < 0 || t.col >= cols || t.row >= rows || !walkable[s] || out[s]) continue;
    q[tail++] = s; out[s] = 1;
  }
  while (head < tail) {
    const cur = q[head++];
    const c = cur % cols, r = (cur - c) / cols;
    if (r > 0) { const n = cur - cols; if (!out[n] && walkable[n]) { out[n] = 1; q[tail++] = n; } }
    if (r < rows - 1) { const n = cur + cols; if (!out[n] && walkable[n]) { out[n] = 1; q[tail++] = n; } }
    if (c > 0) { const n = cur - 1; if (!out[n] && walkable[n]) { out[n] = 1; q[tail++] = n; } }
    if (c < cols - 1) { const n = cur + 1; if (!out[n] && walkable[n]) { out[n] = 1; q[tail++] = n; } }
  }
  return out;
}
