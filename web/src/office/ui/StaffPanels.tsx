// Panneaux des lieux et du personnel figurant : « Serveur RO·AI » (données réelles de /api/system et des fournisseurs),
// accueil (faits réels calculés depuis les données du bureau). Lecture seule, aucune écriture.
import { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import type { DevSession, OfficeBoards, Provider, SystemInfo } from '../../api/types.ts';
import { DEV_STATE_FR, devActionText } from '../state/devteam.ts';
import { LimitsSection } from './BoardPanels.tsx';
import { DISK_ALERT, MEM_ALERT, receptionFacts } from '../engine/staff.ts';
import type { StaffInfo } from '../engine/staff.ts';
import type { SocialClock } from '../engine/social.ts';
import { formatAgo, formatDuration } from './format.ts';

const AUTH_FR: Record<string, string> = { logged_in: 'Connecté', logged_out: 'Déconnecté', unknown: 'Inconnu', not_installed: 'Non installé' };
const gib = (b: number) => `${(b / 1024 ** 3).toFixed(b >= 10 * 1024 ** 3 ? 0 : 1)} Gio`;

function Gauge({ label, pct, detail, alert }: { label: string; pct: number; detail: string; alert: boolean }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div className="office-gauge">
      <div className="office-gauge__row"><span>{label}</span><b className={alert ? 'is-err' : undefined}>{Math.round(p)} %</b></div>
      <div className="office-gauge__bar"><i style={{ width: `${p}%` }} className={alert ? 'is-alert' : p > 70 ? 'is-warn' : undefined} /></div>
      <span className="office-dim">{detail}</span>
    </div>
  );
}

export function ServerPanel({ system, at, error, providers, now, onClose, boards, focusLimits }: {
  system: SystemInfo | null; at: number; error: string | null; providers: Readonly<Record<string, string>>; now: number; onClose: () => void;
  boards: OfficeBoards | null; focusLimits?: boolean;
}) {
  useEffect(() => { if (focusLimits) requestAnimationFrame(() => document.getElementById('office-limits')?.scrollIntoView({ block: 'start' })); }, [focusLimits]);
  const [list, setList] = useState<Provider[] | null>(null);
  useEffect(() => { let alive = true; api.providers().then((p) => { if (alive) setList(p); }).catch(() => { /* facultatif */ }); return () => { alive = false; }; }, []);
  const s = system;
  const memAlert = !!s && s.mem.percent >= MEM_ALERT, diskAlert = !!s && s.disk.percent >= DISK_ALERT;
  const prov = (list ?? []).map((p) => ({ id: p.id, name: p.name, st: providers[p.id] ?? (p.installed ? p.auth.state : 'not_installed') }));
  const down = prov.filter((p) => p.st === 'logged_out');
  return (
    <aside className="office-inspector" aria-label="Serveur RO·AI">
      <header className="office-inspector__head">
        <span className="office-core-mark" aria-hidden="true"><i /></span>
        <div className="office-inspector__title">
          <h2>Serveur RO·AI</h2>
          <p>La salle serveur représente la machine qui héberge RO·AI (conteneur LXC Debian). Mesures réelles, actualisées toutes les 7 s tant que ce panneau est ouvert.</p>
          <span className="office-badge office-badge--working">Lecture seule</span>
        </div>
        <button type="button" className="office-iconbtn" onClick={onClose} aria-label="Fermer le panneau">×</button>
      </header>
      <div className="office-inspector__body">
        {error && <p className="is-err">Mesures indisponibles : {error}</p>}
        {!s && !error && <p className="office-dim">Chargement des mesures…</p>}
        {(memAlert || diskAlert || down.length > 0) && (
          <section><h3>Alertes</h3><ul className="office-events">
            {memAlert && <li className="is-err">Mémoire au-dessus de {MEM_ALERT} %</li>}
            {diskAlert && <li className="is-err">Disque au-dessus de {DISK_ALERT} %</li>}
            {down.map((p) => <li key={p.id} className="is-err">{p.name} déconnecté</li>)}
          </ul></section>
        )}
        {s && (
          <>
            <section>
              <h3>Ressources</h3>
              <Gauge label="Processeur" pct={s.cpu_percent} detail={`Charge ${s.load.map((l) => l.toFixed(2)).join(' · ')}`} alert={false} />
              <Gauge label="Mémoire" pct={s.mem.percent} detail={`${gib(s.mem.used)} utilisés sur ${gib(s.mem.total)} · ${gib(s.mem.available)} disponibles`} alert={memAlert} />
              {s.swap.total > 0 && <Gauge label="Échange (swap)" pct={s.swap.percent} detail={`${gib(s.swap.used)} sur ${gib(s.swap.total)}`} alert={false} />}
              <Gauge label="Disque" pct={s.disk.percent} detail={`${gib(s.disk.used)} utilisés sur ${gib(s.disk.total)}`} alert={diskAlert} />
              {s.ai_slice && <Gauge label="Tranche des agents IA" pct={s.ai_slice.mem_max ? (100 * s.ai_slice.mem_current) / s.ai_slice.mem_max : 0} detail={`${gib(s.ai_slice.mem_current)}${s.ai_slice.mem_max ? ` sur ${gib(s.ai_slice.mem_max)} (plafond)` : ' (sans plafond)'}`} alert={false} />}
            </section>
            <section>
              <h3>Activité</h3>
              <dl className="office-kv">
                <dt>Exécutions en cours</dt><dd>{s.agents_running}</dd>
                <dt>File d'attente</dt><dd>{s.queue_depth}</dd>
                <dt>Disponibilité</dt><dd>{formatDuration(s.uptime_s * 1000)}</dd>
                <dt>Mesuré</dt><dd>{at ? formatAgo(now - at) : '…'}</dd>
              </dl>
            </section>
          </>
        )}
        <section>
          <h3>Fournisseurs</h3>
          {!list && <p className="office-dim">Chargement…</p>}
          <ul className="office-events">
            {prov.map((p) => <li key={p.id}><span>{p.name}</span><span className={p.st === 'logged_in' ? 'is-ok' : p.st === 'logged_out' ? 'is-err' : 'office-dim'}>{AUTH_FR[p.st] ?? p.st}</span></li>)}
          </ul>
        </section>
        <LimitsSection boards={boards} now={now} />
        <p className="office-dim">Le technicien de la salle (figurant) se rend à la baie concernée, ou devant l’écran des limites, seulement quand une de ces alertes existe réellement.</p>
      </div>
    </aside>
  );
}

export function ReceptionPanel({ info, clock, kind, onClose }: { info: StaffInfo; clock: SocialClock; kind: 'reception' | 'cleaner'; onClose: () => void }) {
  const facts = kind === 'reception' ? receptionFacts(info, clock) : [];
  return (
    <aside className="office-inspector" aria-label={kind === 'reception' ? 'Accueil' : 'Entretien'}>
      <header className="office-inspector__head">
        <div className="office-inspector__title">
          <h2>{kind === 'reception' ? 'Accueil' : 'Agent d’entretien'}</h2>
          <p>{kind === 'reception' ? 'Personnel figurant, non piloté par l’IA. Les informations ci-dessous sont calculées depuis les données réelles du bureau.' : 'Personnel figurant présent en soirée, purement décoratif. Il ne représente aucune activité des agents.'}</p>
          <span className="office-badge">Personnel</span>
        </div>
        <button type="button" className="office-iconbtn" onClick={onClose} aria-label="Fermer le panneau">×</button>
      </header>
      {kind === 'reception' && (
        <div className="office-inspector__body">
          <section><h3>Informations</h3><ul className="office-events">{facts.map((f) => <li key={f}>{f}</li>)}</ul></section>
        </div>
      )}
    </aside>
  );
}

/** Session Claude Code qui développe RO·AI (hook local) : lecture seule, aucune commande vers la session. */
export function DevPanel({ session, now, onClose }: { session: DevSession | null; now: number; onClose: () => void }) {
  const st = session?.state ?? 'ended';
  const badge = st === 'working' ? 'office-badge--working' : st === 'waiting' ? 'office-badge--waiting' : 'office-badge--idle';
  const ago = (iso: string | null) => (iso ? formatAgo(Math.max(0, now - Date.parse(iso))) : '—');
  return (
    <aside className="office-inspector" aria-label="Session Claude Code">
      <header className="office-inspector__head">
        <div className="office-inspector__title">
          <h2>{session?.label ?? 'Session Claude Code'}</h2>
          <p>Une session Claude Code qui développe RO·AI sur ce serveur. Elle entre quand elle commence à travailler, s’installe en salle serveur et repart à la fin de son tour. Données réduites venant des hooks : jamais le contenu des fichiers, tes messages ni les commandes complètes. Lecture seule.</p>
          <span className={`office-badge ${badge}`}>{DEV_STATE_FR[st]}</span>
        </div>
        <button type="button" className="office-iconbtn" onClick={onClose} aria-label="Fermer le panneau">×</button>
      </header>
      <div className="office-inspector__body">
        {!session ? <p className="office-dim">Cette session est terminée ou n’a plus d’activité.</p> : (
          <>
            <section>
              <h3>Session</h3>
              <dl className="office-kv">
                <dt>Identifiant</dt><dd className="mono">{session.id}…</dd>
                <dt>Dossier</dt><dd className="mono">{session.project}</dd>
                <dt>Ouverte</dt><dd>{ago(session.since)}</dd>
                {session.turn_at && <><dt>Tour en cours</dt><dd>{st === 'idle' ? `terminé ${ago(session.last_at)}` : `depuis ${formatDuration(Math.max(0, now - Date.parse(session.turn_at)))}`}</dd></>}
                <dt>Dernière activité</dt><dd>{ago(session.last_at)}</dd>
              </dl>
            </section>
            <section>
              <h3>Dernières actions</h3>
              {session.actions.length === 0 ? <p className="office-dim">Aucune action depuis l’ouverture du suivi.</p> : (
                <ul className="office-events">
                  {session.actions.slice().reverse().map((a, i) => (
                    <li key={`${a.at}${i}`}><span className="office-dim">{ago(a.at)}</span><span className="untrusted">{devActionText(a)}</span></li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3>Depuis le début de la session</h3>
              <dl className="office-kv">
                <dt>Actions</dt><dd>{session.counts.tools}</dd>
                <dt>Fichiers modifiés</dt><dd>{session.counts.write}</dd>
                <dt>Tests lancés</dt><dd>{session.counts.test}</dd>
                <dt>Builds</dt><dd>{session.counts.build}</dd>
                <dt>Mises en production</dt><dd>{session.counts.deploy}</dd>
                <dt>Commits</dt><dd>{session.counts.commit}</dd>
              </dl>
              <p className="office-dim">Compteurs tenus en mémoire par RO·AI depuis son dernier redémarrage (rien dans le journal).</p>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
