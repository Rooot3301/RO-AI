// Animation de l'orchestrateur : vols de fiches (file d'animations espacées), état visuel dérivé des événements réels.
import type { OfficeAgentModel, OrchEvent } from '../state/model.ts';
import { FLIGHT_MS, deriveOrchVisual, planFlights } from '../state/orchestrator.ts';
import type { Flight, FlightState, OrchVisual } from '../state/orchestrator.ts';
import type { Layout } from '../layout/plan.ts';
import type { Connection } from '../state/useOfficeFeed.ts';

/** Délai pendant lequel une arrivée de fiche (onde au bureau) reste visible. */
export const LAND_MS = 420;

export class Conductor {
  flights: Flight[] = [];
  private fstate: FlightState = { lastSeq: 0, lastStart: 0 };
  private primed = false;
  visual: OrchVisual;
  /** États d'authentification connus des fournisseurs (pour les écrans de la régie). */
  providers: Readonly<Record<string, string>> = {};
  private visualAt = -1e9;
  private newDisp: string[] = [];

  constructor() {
    this.visual = deriveOrchVisual([], [], {}, 'live', 0, false);
  }

  /** Intègre les nouveaux événements (une seule fois chacun) ; les événements antérieurs au premier appel ne s'animent pas. */
  sync(events: readonly OrchEvent[]) {
    if (!this.primed) { this.fstate = { lastSeq: events.length ? events[events.length - 1].seq : 0, lastStart: 0 }; this.primed = true; return; }
    const r = planFlights(events, this.fstate);
    this.fstate = r.state;
    for (const f of r.added) { this.flights.push(f); if (f.kind === 'dispatch' && f.agentId) this.newDisp.push(f.agentId); }
  }

  /** Agents dont une exécution vient d'être lancée (événements réels) : l'orchestrateur ira les voir. Vidé à chaque appel. */
  takeDispatches(): string[] { const d = this.newDisp; this.newDisp = []; return d; }

  /** Retire les vols terminés ; recalcule l'état visuel au plus tous les 100 ms (ou à la demande). */
  update(now: number, events: readonly OrchEvent[], agents: readonly OfficeAgentModel[], providers: Readonly<Record<string, string>>, conn: Connection, force: boolean) {
    if (this.flights.length) this.flights = this.flights.filter((f) => now < f.start + FLIGHT_MS + LAND_MS);
    if (!force && now - this.visualAt < 100) return;
    this.visualAt = now; this.providers = providers;
    this.visual = deriveOrchVisual(events, agents, providers, conn, now, this.flying(now));
  }

  flying(now: number): boolean {
    for (const f of this.flights) if (now >= f.start - 150 && now < f.start + FLIGHT_MS * 0.6) return true;
    return false;
  }

  /** Cible visée par le geste (pixel monde) : bureau du vol en cours ou de l'agent en erreur. */
  aimAt(layout: Layout, now: number): { x: number; y: number } | null {
    for (const f of this.flights) {
      if (now >= f.start - 150 && now < f.start + FLIGHT_MS * 0.6) {
        const d = f.agentId ? layout.deskByAgent.get(f.agentId) : null;
        if (d) return { x: d.col * 16 + 24, y: d.row * 16 - 6 };
      }
    }
    const id = this.visual.lookAgentId, d = id ? layout.deskByAgent.get(id) : null;
    return d ? { x: d.col * 16 + 24, y: d.row * 16 - 6 } : null;
  }

  /** Vrai si quelque chose bouge (pour la cadence de rendu) : 60 en vol, 30 pour un état actif, 20 pour l'ambiance. */
  fps(now: number): number {
    if (this.flights.length) return 60;
    const v = this.visual;
    if (v.bell || v.stop || v.alert || v.hourglass || v.resync || v.pose === 'clipboard' || v.pose === 'pick') return 30;
    if (v.running > 0 || v.queueDepth > 0) return 30;
    void now;
    return v.ambient ? 20 : 0;
  }
}
