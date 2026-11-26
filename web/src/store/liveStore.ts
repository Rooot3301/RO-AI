// Magasin « en direct » : un seul état partagé par toute l'application, alimenté par
//  - un chargement initial (agents, fournisseurs, exécutions, queue d'événements),
//  - le flux SSE (un événement = au plus un rafraîchissement ciblé),
//  - un échantillonnage léger de /api/system (aucun événement ne porte ces mesures).
import { api, ApiError } from '../api/client';
import type { Agent, Control, Provider, RoEvent, Run, SystemInfo } from '../api/types';
import type { StreamStatus } from '../api/events';
import { reduceControl } from '../lib/control';
import { loadEventTail, mergeEvents } from '../lib/events';
import { isRunLifecycleEvent, mergeRuns, pushSample, upsertRun } from '../lib/runs';

export const RING_SIZE = 800;
const SYSTEM_PERIOD_MS = 5000;
const HISTORY = 60;

export interface LiveState {
  ready: boolean;
  loadError: string | null;
  conn: StreamStatus;
  lastSeq: number;
  system: SystemInfo | null;
  systemError: string | null;
  history: { cpu: number[]; mem: number[] };
  providers: Provider[] | null;
  agents: Agent[] | null;
  runs: Run[] | null;
  events: RoEvent[];
  control: Control | null;
}

const initial: LiveState = {
  ready: false, loadError: null, conn: 'connecting', lastSeq: 0, system: null, systemError: null,
  history: { cpu: [], mem: [] }, providers: null, agents: null, runs: null, events: [], control: null,
};

type Listener = () => void;
type EventListener = (e: RoEvent) => void;

export class LiveStore {
  private state: LiveState = initial;
  private listeners = new Set<Listener>();
  private eventListeners = new Set<EventListener>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private runInflight = new Set<string>();
  private sysTimer: ReturnType<typeof setInterval> | undefined;
  private started = false;
  private dead = false;
  private gen = 0;
  private onUnauthorized: () => void;

  constructor(onUnauthorized: () => void) { this.onUnauthorized = onUnauthorized; }

  getSnapshot = (): LiveState => this.state;
  subscribe = (l: Listener) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  /** Abonnement bas niveau aux événements bruts (journal d'exécution, etc.). */
  onEvent = (l: EventListener) => { this.eventListeners.add(l); return () => { this.eventListeners.delete(l); }; };

  private set(patch: Partial<LiveState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  async start() {
    if (this.started) return;
    this.started = true; this.dead = false;
    const g = ++this.gen;
    await this.loadAll(g);
    if (g !== this.gen) return;
    this.sampleSystem();
    this.sysTimer = setInterval(() => { if (document.visibilityState === 'visible') this.sampleSystem(); }, SYSTEM_PERIOD_MS);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  stop() {
    this.dead = true; this.started = false; this.gen++;
    if (this.sysTimer) clearInterval(this.sysTimer);
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  private onVisible = () => { if (document.visibilityState === 'visible') { this.sampleSystem(); this.refreshAll(); } };

  setConn = (conn: StreamStatus) => { if (conn !== this.state.conn) this.set({ conn }); };

  private fail(e: unknown): string {
    if (e instanceof ApiError && e.status === 401) { this.onUnauthorized(); return 'Session expirée.'; }
    return e instanceof Error ? e.message : String(e);
  }

  private async loadAll(g = this.gen) {
    const res = await Promise.allSettled([
      api.agents(), api.providers(), api.runs({ limit: 40 }), api.runs({ status: 'awaiting_approval', limit: 50 }),
      loadEventTail((since, limit) => api.events({ since, limit }), RING_SIZE, 500),
      api.control(),
    ]);
    if (g !== this.gen) return;
    const [agents, providers, recent, pending, tail, control] = res;
    const failed = res.slice(0, 5).find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    const patch: Partial<LiveState> = { ready: true, loadError: failed ? this.fail(failed.reason) : null };
    if (agents.status === 'fulfilled') patch.agents = agents.value;
    if (providers.status === 'fulfilled') patch.providers = providers.value;
    if (recent.status === 'fulfilled') patch.runs = mergeRuns(recent.value, pending.status === 'fulfilled' ? pending.value : [], 200);
    if (control.status === 'fulfilled') patch.control = control.value;
    if (tail.status === 'fulfilled') { patch.events = tail.value.events; patch.lastSeq = tail.value.lastSeq; }
    this.set(patch);
  }

  /** Rafraîchissement complet (retour d'onglet, resynchronisation du flux). */
  refreshAll = () => { this.refetchAgents(); this.refetchProviders(); this.refetchRuns(); this.refetchControl(); };
  putControl = (control: Control) => this.set({ control });
  refetchControl = () => this.debounce('control', 150, () => { api.control().then((control) => this.set({ control })).catch((e) => this.fail(e)); });
  retryLoad = () => { this.set({ loadError: null, ready: false }); void this.loadAll(); };

  private debounce(key: string, ms: number, fn: () => void) {
    if (this.timers.has(key)) return;
    this.timers.set(key, setTimeout(() => { this.timers.delete(key); if (!this.dead) fn(); }, ms));
  }

  refetchAgents = () => this.debounce('agents', 250, () => { api.agents().then((agents) => this.set({ agents })).catch((e) => this.fail(e)); });
  refetchProviders = () => this.debounce('providers', 400, () => { api.providers().then((providers) => this.set({ providers })).catch((e) => this.fail(e)); });
  refetchRuns = () => this.debounce('runs', 300, () => {
    Promise.all([api.runs({ limit: 40 }), api.runs({ status: 'awaiting_approval', limit: 50 })])
      .then(([recent, pending]) => this.set({ runs: mergeRuns(mergeRuns(this.state.runs ?? [], recent, 200), pending, 200) }))
      .catch((e) => this.fail(e));
  });

  /** Met à jour une exécution précise (retour d'une action ou rafraîchissement ciblé). */
  putRun = (run: Run) => this.set({ runs: upsertRun(this.state.runs ?? [], run, 200) });

  putProvider = (p: Provider) => this.set({ providers: (this.state.providers ?? []).some((x) => x.id === p.id) ? (this.state.providers ?? []).map((x) => (x.id === p.id ? p : x)) : [...(this.state.providers ?? []), p] });

  private refetchRun(id: string) {
    if (this.runInflight.has(id)) return;
    this.runInflight.add(id);
    setTimeout(() => {
      this.runInflight.delete(id);
      if (this.dead) return;
      api.run(id).then((r) => this.putRun(r)).catch((e) => { this.fail(e); });
    }, 150);
  }

  private sampleSystem() {
    api.system().then((system) => {
      if (this.dead) return;
      this.set({
        system, systemError: null,
        history: { cpu: pushSample(this.state.history.cpu, system.cpu_percent, HISTORY), mem: pushSample(this.state.history.mem, system.mem.percent, HISTORY) },
      });
    }).catch((e) => { this.set({ systemError: this.fail(e) }); });
  }

  /** Point d'entrée des événements SSE. */
  ingest = (e: RoEvent) => {
    const events = mergeEvents(this.state.events, [e], RING_SIZE);
    if (events !== this.state.events || e.seq > this.state.lastSeq) this.set({ events, lastSeq: Math.max(this.state.lastSeq, e.seq) });
    const t = e.type;
    if (t === 'system.emergency_stop' || t === 'system.resumed') {
      this.set({ control: reduceControl(this.state.control, e) });
      this.refetchRuns(); this.refetchAgents(); this.refetchControl();
    }
    if (t === 'system.resync') this.refreshAll();
    else if (t.startsWith('agent.')) this.refetchAgents();
    else if (t.startsWith('provider.') || t === 'run.rate_limit') this.refetchProviders();
    else if (t.startsWith('schedule.')) { /* les pages concernées s'abonnent elles-mêmes */ }
    if (t.startsWith('run.') && e.run_id && isRunLifecycleEvent(t)) {
      this.refetchRun(e.run_id);
      this.refetchAgents(); // l'état de l'agent (working / waiting / error) en dérive
    }
    for (const l of this.eventListeners) { try { l(e); } catch { /* un abonné défaillant ne doit pas bloquer les autres */ } }
  };
}
