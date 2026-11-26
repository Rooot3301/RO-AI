// Panneaux des tableaux du bureau : planning du jour (hall) et limites d'usage (salle serveur). Lecture seule :
// données de GET /api/office/boards (planifications, exécutions, signaux de limite des clients officiels).
import { Link } from 'react-router-dom';
import type { OfficeBoards, PlanningItem } from '../../api/types.ts';
import { PLANNING_STATUS_FR, PROVIDER_FR, countdown, hhmm, isPendingItem, limitViews, planningSummary, whenLabel } from '../state/boards.ts';
import type { LimitView, ProviderKey } from '../state/boards.ts';
import { formatAgo } from './format.ts';

const STATUS_CLS: Partial<Record<PlanningItem['status'], string>> = {
  succeeded: 'is-ok', failed: 'is-err', missed: 'is-warn', cancelled: 'office-dim', running: 'is-ok', awaiting_approval: 'is-info', queued: 'is-info',
};

let dayFmt: Intl.DateTimeFormat | null = null;
function dayLabel(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  dayFmt ??= new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' });
  return dayFmt.format(new Date(t));
}

export function PlanningPanel({ boards, at, error, now, onClose, onPickAgent }: {
  boards: OfficeBoards | null; at: number; error: string | null; now: number; onClose: () => void; onPickAgent: (id: string) => void;
}) {
  const p = boards?.planning ?? null, s = planningSummary(p);
  const next = s?.upcoming.find((i) => i.status === 'upcoming') ?? null;
  return (
    <aside className="office-inspector" aria-label="Planning du jour">
      <header className="office-inspector__head">
        <div className="office-inspector__title">
          <h2>Planning du jour</h2>
          <p>{p ? `${dayLabel(p.date + 'T12:00:00Z')} · heure de Paris. ` : ''}Missions réellement planifiées (planifications actives) et sort des exécutions qu’elles ont lancées.</p>
          {s && <span className="office-badge">{s.total ? `${s.done}/${s.total} terminée${s.done > 1 ? 's' : ''}` : 'Rien de prévu'}</span>}
        </div>
        <button type="button" className="office-iconbtn" onClick={onClose} aria-label="Fermer le panneau">×</button>
      </header>
      <div className="office-inspector__body">
        {error && !p && <p className="is-err">Planning indisponible : {error}</p>}
        {!p && !error && <p className="office-dim">Chargement…</p>}
        {s?.paused && <p className="office-alert">Arrêt d’urgence actif : les planifications ne lancent rien tant que la reprise n’est pas faite.</p>}
        {next && (
          <section className="office-next">
            <span className="office-dim">Prochaine mission</span>
            <b className="office-next__time">{hhmm(next.at)}</b>
            <span>{next.agent_name} · <span className="untrusted">{next.name}</span></span>
            <span className="office-next__left">{next.agent_enabled ? `dans ${countdown(next.at, now)}` : 'agent désactivé : ne sera pas lancée'}</span>
          </section>
        )}
        {p && (
          <section>
            <h3>Aujourd’hui</h3>
            {p.items.length === 0 ? <p className="office-dim">Aucune mission planifiée aujourd’hui.</p> : (
              <ol className="office-plan">
                {p.items.map((i) => (
                  <li key={`${i.schedule_id}-${i.at}-${i.run_id ?? ''}`} className={isPendingItem(i) ? 'is-pending' : undefined}>
                    <span className="office-plan__time">{hhmm(i.at)}</span>
                    <span className="office-plan__what">
                      <button type="button" className="office-textbtn" onClick={() => onPickAgent(i.agent_id)}>{i.agent_name}</button>
                      <span className="untrusted office-dim">{i.name}{i.off_schedule ? ' · hors horaire' : ''}</span>
                    </span>
                    <span className={`office-plan__st ${STATUS_CLS[i.status] ?? ''}`}>
                      {i.run_id ? <Link to={`/runs/${i.run_id}`}>{PLANNING_STATUS_FR[i.status]}</Link>
                        : i.status === 'upcoming' && !i.agent_enabled ? 'Agent désactivé' : PLANNING_STATUS_FR[i.status]}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {p.truncated && <p className="office-dim">Liste abrégée (planification très fréquente).</p>}
            {s?.later && <p className="office-dim">Plus rien aujourd’hui. Ensuite : {s.later.agent_name}, {dayLabel(s.later.at)} à {hhmm(s.later.at)}.</p>}
          </section>
        )}
        <p className="office-dim">« Non lancée » : l’horaire est passé sans exécution (arrêt d’urgence, agent désactivé ou noyau arrêté à ce moment-là). {at ? `Actualisé ${formatAgo(Date.now() - at)}.` : ''}</p>
        <div className="office-actions"><Link className="office-linkbtn" to="/schedules">Gérer les planifications</Link></div>
      </div>
    </aside>
  );
}

function LimitRow({ l, now }: { l: LimitView; now: number }) {
  const pct = l.pct, cls = l.level === 'limited' ? 'is-alert' : l.level === 'warning' || (pct ?? 0) >= 80 ? 'is-warn' : undefined;
  return (
    <div className="office-gauge">
      <div className="office-gauge__row">
        <span>Fenêtre {l.label}</span>
        <b className={l.level === 'limited' ? 'is-err' : undefined}>
          {l.reset ? 'Remise à zéro' : pct !== null ? `${Math.round(pct)} %` : l.level === 'limited' ? 'Atteinte' : l.level === 'warning' ? 'Proche' : 'OK'}
        </b>
      </div>
      <div className="office-gauge__bar">{pct !== null ? <i style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} className={cls} /> : <i style={{ width: '100%', opacity: 0.25 }} className={cls} />}</div>
      <span className="office-dim">
        {l.reset ? 'La fenêtre est repartie de zéro ; la consommation sera relevée à la prochaine exécution.'
          : l.resetsAt ? `Remise à zéro ${whenLabel(l.resetsAt, now)} (dans ${countdown(l.resetsAt, now)})` : 'Heure de remise à zéro inconnue'}
        {pct === null && !l.reset ? ' · pourcentage non communiqué par le client' : ''}
      </span>
    </div>
  );
}

/** Section « Limites d'usage » : ce que les clients officiels ont réellement signalé lors des dernières exécutions. */
export function LimitsSection({ boards, now }: { boards: OfficeBoards | null; now: number }) {
  const v = limitViews(boards?.limits, now);
  return (
    <section id="office-limits">
      <h3>Limites d’usage des abonnements</h3>
      {!boards && <p className="office-dim">Chargement…</p>}
      {boards && (['claude', 'codex'] as ProviderKey[]).map((p) => (
        <div key={p} className="office-limit">
          <b>{PROVIDER_FR[p]}</b>
          {v[p].length ? v[p].map((l) => <LimitRow key={l.window} l={l} now={now} />) : <p className="office-dim">Aucun signal reçu pour l’instant (il arrive avec la prochaine exécution).</p>}
        </div>
      ))}
      <p className="office-dim">Relevé à chaque exécution : Claude indique l’état de ses fenêtres, Codex le pourcentage utilisé. Aucun appel supplémentaire n’est fait pour les mesurer.</p>
    </section>
  );
}
