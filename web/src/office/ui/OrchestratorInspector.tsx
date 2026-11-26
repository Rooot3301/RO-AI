// Tiroir d'inspection de l'orchestrateur (le noyau) : lecture seule, aucune action d'écriture.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.ts';
import type { Provider, Run, Schedule, SystemInfo } from '../../api/types.ts';
import type { OfficeModel } from '../state/model.ts';
import type { Connection } from '../state/useOfficeFeed.ts';
import { formatAgo, formatClock, formatDateTime, formatDuration } from './format.ts';

interface Core { health: { status: string; version: string; uptime_s: number } | null; system: SystemInfo | null; providers: Provider[] | null; schedules: Schedule[] | null; runs: Run[] | null }

const KIND_FR: Record<string, string> = {
  queued: 'Mise en file', dispatch: 'Lancement', approval: 'Approbation demandée', approved: 'Approuvée', rejected: 'Refusée', cancelled: 'Annulée',
  failed: 'Échec', schedule: 'Planification déclenchée', rate_limit: 'Limite de débit', provider: 'Fournisseur', resync: 'Resynchronisation',
};
const AUTH_FR: Record<string, string> = { logged_in: 'Connecté', logged_out: 'Déconnecté', unknown: 'Inconnu', not_installed: 'Non installé' };
const RUN_FR: Record<Run['status'], string> = { queued: 'En file', awaiting_approval: 'Approbation', running: 'En cours', succeeded: 'Réussie', failed: 'Échec', cancelled: 'Annulée' };

export function OrchestratorInspector({ model, connection, now, onClose }: { model: OfficeModel; connection: Connection; now: number; onClose: () => void }) {
  const [core, setCore] = useState<Core>({ health: null, system: null, providers: null, schedules: null, runs: null });
  const [err, setErr] = useState<string | null>(null);
  const evCount = model.orch.events.length;
  useEffect(() => {
    let off = false;
    const load = async () => {
      try {
        const [health, system, providers, schedules, running, queued, approval] = await Promise.all([
          api.health(), api.system(), api.providers(), api.schedules(),
          api.runs({ status: 'running', limit: 20 }), api.runs({ status: 'queued', limit: 20 }), api.runs({ status: 'awaiting_approval', limit: 20 }),
        ]);
        if (!off) { setCore({ health, system, providers, schedules, runs: [...approval, ...queued, ...running] }); setErr(null); }
      } catch (e) { if (!off) setErr(e instanceof Error ? e.message : 'Erreur'); }
    };
    void load();
    const id = setInterval(() => { void load(); }, 5000);
    return () => { off = true; clearInterval(id); };
  }, [evCount]);

  const names = useMemo(() => new Map(model.agents.map((a) => [a.id, a.name])), [model.agents]);
  const upcoming = useMemo(() => (core.schedules ?? []).filter((s) => s.enabled && s.next_run_at).sort((a, b) => Date.parse(a.next_run_at!) - Date.parse(b.next_run_at!)).slice(0, 5), [core.schedules]);
  const events = model.orch.events.slice(-10).reverse();
  const waiting = model.agents.filter((a) => a.state === 'waiting').length, working = model.agents.filter((a) => a.state === 'working').length;
  const serverNow = now + model.clockOffsetMs;

  return (
    <aside className="office-inspector" aria-label="Inspecteur : orchestrateur">
      <header className="office-inspector__head">
        <span className="office-core-mark" aria-hidden="true"><i /></span>
        <div className="office-inspector__title">
          <h2>Orchestrateur</h2>
          <p>Noyau de RO·AI — distribue les exécutions demandées (utilisateur, planification, API). Ce n'est pas un agent IA.</p>
          <span className="office-badge office-badge--working">Lecture seule</span>
        </div>
        <button type="button" className="office-iconbtn" onClick={onClose} aria-label="Fermer l'inspecteur">×</button>
      </header>
      <div className="office-inspector__body">
        {err && <p className="is-err">{err}</p>}
        <section>
          <h3>État du noyau</h3>
          <dl className="office-kv">
            <dt>Santé</dt><dd>{core.health ? (core.health.status === 'ok' ? 'En service' : core.health.status) : '…'}</dd>
            <dt>Disponibilité</dt><dd>{core.health ? formatDuration(core.health.uptime_s * 1000) : '…'}</dd>
            <dt>Version</dt><dd className="office-mono">{core.health?.version ?? '…'}</dd>
            <dt>Agents en cours</dt><dd>{core.system ? core.system.agents_running : working}</dd>
            <dt>File d'attente</dt><dd>{core.system ? core.system.queue_depth : waiting}</dd>
            <dt>Flux</dt><dd>{connection === 'live' ? 'En direct' : connection === 'reconnecting' ? 'Reconnexion…' : 'Connexion…'}</dd>
          </dl>
        </section>
        <section>
          <h3>Exécutions en file et en cours</h3>
          {!core.runs && <p className="office-dim">Chargement…</p>}
          {core.runs && core.runs.length === 0 && <p className="office-dim">Aucune exécution active.</p>}
          <ul className="office-runs">
            {(core.runs ?? []).map((r) => (
              <li key={r.id}><Link to={`/runs/${r.id}`}>
                <span className={`office-runstatus office-runstatus--${r.status}`}>{RUN_FR[r.status]}</span>
                <span>{r.agent_name}</span>
                <span className="office-dim">{formatAgo(serverNow - Date.parse(r.created_at))}</span>
              </Link></li>
            ))}
          </ul>
        </section>
        <section>
          <h3>Prochaines échéances</h3>
          {core.schedules && upcoming.length === 0 && <p className="office-dim">Aucune planification à venir.</p>}
          <ul className="office-events">
            {upcoming.map((s) => (
              <li key={s.id}>
                <span className="office-dim office-mono">{formatDateTime(s.next_run_at)}</span>
                <span>{s.name}</span>
                <span className="office-events__sum">{names.get(s.agent_id) ?? s.agent_id}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3>Fournisseurs</h3>
          <ul className="office-events">
            {(core.providers ?? []).map((p) => {
              const st = model.orch.providers[p.id] ?? (p.installed ? p.auth.state : 'not_installed');
              return (
                <li key={p.id}>
                  <span>{p.name}</span>
                  <span className={st === 'logged_in' ? 'is-ok' : st === 'logged_out' ? 'is-err' : 'office-dim'}>{AUTH_FR[st] ?? st}</span>
                  {p.limits && p.limits.status === 'limited' && <span className="is-err">Limite atteinte{p.limits.window ? ` (${p.limits.window})` : ''}</span>}
                </li>
              );
            })}
          </ul>
        </section>
        <section>
          <h3>Derniers événements d'orchestration</h3>
          {events.length === 0 && <p className="office-dim">Aucun événement depuis l'ouverture.</p>}
          <ul className="office-events">
            {events.map((e) => (
              <li key={e.seq}>
                <span className="office-dim office-mono">{formatClock(e.ts)}</span>
                <span className="office-mono office-events__type">{e.type}</span>
                <span className="office-events__sum">{KIND_FR[e.kind]}{e.agentId && names.get(e.agentId) ? ` · ${names.get(e.agentId)}` : ''}{e.detail ? ` · ${e.detail}` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <footer className="office-inspector__foot">
        <Link className="office-linkbtn" to="/runs">Toutes les exécutions</Link>
        <Link className="office-linkbtn" to="/schedules">Planifications</Link>
      </footer>
    </aside>
  );
}
