// Panneaux des pièces devenues utiles : bibliothèque (archives des rapports réels) et salle de réunion (conversations
// réelles avec l'utilisateur). Lecture seule ; les textes viennent des agents et sont affichés comme texte brut.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.ts';
import type { OfficeReport } from '../../api/types.ts';
import type { OfficeAgentModel } from '../state/model.ts';
import { formatAgo } from './format.ts';
import { whenLabel } from '../state/boards.ts';

const VIA_FR = { chat: 'page Chat', discord: 'Discord (/parler)' } as const;

export function LibraryPanel({ refreshKey, now, onClose, onPickAgent }: { refreshKey: number; now: number; onClose: () => void; onPickAgent: (id: string) => void }) {
  const [reports, setReports] = useState<OfficeReport[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [agent, setAgent] = useState<string>('');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.officeArchive(60).then((r) => { if (alive) { setReports(r.reports); setErr(null); } }).catch((e) => { if (alive) setErr(e instanceof Error ? e.message : 'indisponible'); });
    return () => { alive = false; };
  }, [refreshKey]);
  const agents = reports ? [...new Map(reports.map((r) => [r.agent_id, r.agent_name])).entries()] : [];
  const shown = (reports ?? []).filter((r) => !agent || r.agent_id === agent);
  return (
    <aside className="office-inspector" aria-label="Bibliothèque : archives des rapports">
      <header className="office-inspector__head">
        <div className="office-inspector__title">
          <h2>Bibliothèque</h2>
          <p>Archives des rapports : les derniers résultats réels des missions réussies (hors conversations). Quand une mission se termine avec un résultat, l’agent vient le ranger ici.</p>
          <span className="office-badge">{reports ? `${reports.length} rapport${reports.length > 1 ? 's' : ''}` : '…'}</span>
        </div>
        <button type="button" className="office-iconbtn" onClick={onClose} aria-label="Fermer le panneau">×</button>
      </header>
      <div className="office-inspector__body">
        {err && <p className="is-err">Archives indisponibles : {err}</p>}
        {!reports && !err && <p className="office-dim">Chargement…</p>}
        {reports && reports.length === 0 && <p className="office-dim">Aucun rapport pour l’instant. Le premier arrivera avec la prochaine mission réussie.</p>}
        {agents.length > 1 && (
          <label className="office-filter">Agent
            <select value={agent} onChange={(e) => setAgent(e.target.value)}>
              <option value="">Tous</option>
              {agents.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
        )}
        <ol className="office-reports">
          {shown.map((r) => (
            <li key={r.run_id}>
              <div className="office-reports__top">
                <button type="button" className="office-textbtn" onClick={() => onPickAgent(r.agent_id)}>{r.agent_name}</button>
                <span className="office-dim">{r.scheduled ? 'Planifiée' : 'Manuelle'} · {whenLabel(r.finished_at, now)} ({formatAgo(now - Date.parse(r.finished_at))})</span>
              </div>
              {r.title && <b className="office-reports__title untrusted">{r.title}</b>}
              <p className={`office-reports__text untrusted${open === r.run_id ? ' is-open' : ''}`}>{r.preview}{r.chars > r.preview.length ? '…' : ''}</p>
              <div className="office-reports__actions">
                <button type="button" className="office-textbtn" onClick={() => setOpen((o) => (o === r.run_id ? null : r.run_id))}>{open === r.run_id ? 'Réduire' : 'Déplier'}</button>
                <Link to={`/runs/${r.run_id}`} className="office-textbtn">Rapport complet ({r.chars < 1000 ? `${r.chars} caractères` : `${(r.chars / 1000).toFixed(r.chars < 10_000 ? 1 : 0).replace('.', ',')} k caractères`})</Link>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}

export function MeetingPanel({ agents, now, onClose, onPickAgent, onOpenChat }: { agents: readonly OfficeAgentModel[]; now: number; onClose: () => void; onPickAgent: (id: string) => void; /** Ouvre la conversation dans le panneau du personnage. */ onOpenChat?: (id: string) => void }) {
  const talking = agents.filter((a) => a.conv && (a.conv.active || a.conv.until > now));
  return (
    <aside className="office-inspector" aria-label="Salle de réunion : conversations">
      <header className="office-inspector__head">
        <div className="office-inspector__title">
          <h2>Salle de réunion</h2>
          <p>Les agents avec qui tu discutes (page Chat ou /parler sur Discord) s’y installent pendant l’échange, et y restent 5 minutes après leur dernière réponse. Aucune réunion entre agents n’est simulée.</p>
          <span className={`office-badge${talking.length ? ' office-badge--working' : ''}`}>{talking.length ? `${talking.length} conversation${talking.length > 1 ? 's' : ''}` : 'Salle disponible'}</span>
        </div>
        <button type="button" className="office-iconbtn" onClick={onClose} aria-label="Fermer le panneau">×</button>
      </header>
      <div className="office-inspector__body">
        {talking.length === 0 && <p className="office-dim">Personne en conversation. Clique sur un agent puis « Discuter », ou écris-lui avec /parler sur Discord : il viendra s’asseoir ici.</p>}
        <ul className="office-events">
          {talking.map((a) => (
            <li key={a.id}>
              <button type="button" className="office-textbtn" onClick={() => onPickAgent(a.id)}>{a.name}</button>
              <span className="office-dim">{VIA_FR[a.conv!.via]} · {a.conv!.active ? (a.state === 'working' ? 'répond en ce moment' : 'message reçu, en attente') : `dernière réponse ${formatAgo(now - Date.parse(a.conv!.lastAt))}`}</span>
              <span className="office-events__sum">{onOpenChat ? <button type="button" className="office-textbtn" onClick={() => onOpenChat(a.id)}>Ouvrir la conversation</button> : <Link to={`/agents/${a.id}/chat`}>Ouvrir la conversation</Link>}</span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

export const FEED_ID = '__feed__';

/** Pseudo affiché d'un agent (@nom_en_minuscules). */
export function handleOf(name: string): string {
  return '@' + name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
}
