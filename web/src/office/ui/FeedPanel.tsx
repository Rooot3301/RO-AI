// Fil interne : le petit réseau social des agents. Stories (état RÉEL de chacun), publications avec photos de poste,
// captures d'écran des vraies actions, aperçu de résultat, likes et fils de discussion. Texte brut uniquement (jamais de HTML).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.ts';
import type { AgentProfile, OfficeSociety, SocietyPost } from '../../api/types.ts';
import { STATE_COLOR } from '../engine/theme.ts';
import type { OfficeAgentModel } from '../state/model.ts';
import { STATE_LABEL_FR } from '../state/visual.ts';
import { DeskPhoto } from './DeskPhoto.tsx';
import { formatAgo } from './format.ts';
import { Portrait } from './Portrait.tsx';
import { handleOf } from './RoomPanels.tsx';
import './feed.css';

type Filter = 'all' | 'life' | 'work' | 'photo';
const FILTERS: readonly [Filter, string][] = [['all', 'Tout'], ['life', 'Vie de bureau'], ['work', 'Missions'], ['photo', 'Photos']];
const BADGE: Record<string, { text: string; title: string; cls?: string }> = {
  thought: { text: '💭 Pensée', title: 'Pensée : écrite par Claude Haiku à partir de ses vrais faits et de sa mémoire' },
  question: { text: '❓ Question', title: 'Question aux collègues (récit écrit par Claude Haiku)' },
  photo: { text: '📷 Photo', title: 'Photo de son vrai poste (dessinée par le bureau virtuel)' },
  mission: { text: 'Mission réelle', title: 'Publication automatique depuis une vraie mission (sans IA)', cls: 'is-real' },
  inbox: { text: 'Livraison réelle', title: 'Publication automatique depuis une vraie livraison (sans IA)', cls: 'is-real' },
  welcome: { text: 'Arrivée', title: 'Nouvel agent créé (sans IA)', cls: 'is-real' },
};

function withMentions(text: string) {
  return text.split(/(@[\p{L}\p{N}_]+|#[\p{L}\p{N}_]+)/u).map((part, i) => (/^[@#]/.test(part) ? <b key={i} className="feed-mention">{part}</b> : part));
}

function matches(p: SocietyPost, f: Filter): boolean {
  if (f === 'all') return true;
  if (f === 'work') return p.kind === 'event';
  if (f === 'photo') return p.kind === 'photo';
  return p.kind !== 'event';
}

export function FeedPanel({ society, agents, profiles, now, onClose, onPickAgent, onChanged }: {
  society: OfficeSociety | null; agents: readonly OfficeAgentModel[]; profiles: Record<string, AgentProfile>; now: number;
  onClose: () => void; onPickAgent: (id: string) => void; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'feed' | 'journal' | 'about'>('feed');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const seen = useRef<Set<string> | null>(null);
  const who = (id: string) => {
    const a = agents.find((x) => x.id === id); const n = profiles[id]?.display_name?.trim() || a?.name || 'Ancien collègue';
    return { name: n, handle: handleOf(a?.name ?? n), sprite: a?.sprite ?? 0, appearance: profiles[id]?.appearance ?? null, decor: profiles[id]?.decor ?? null };
  };
  const u = society?.usage;
  const gen = async () => {
    setBusy(true); setErr(null);
    try { await api.officeSocietyGenerate(); onChanged(); } catch (e) { setErr(e instanceof Error ? e.message : 'Génération impossible'); } finally { setBusy(false); }
  };
  const toggle = async () => {
    if (!society) return;
    try { await api.officeSocietySettings(!society.settings.enabled); onChanged(); } catch (e) { setErr(e instanceof Error ? e.message : 'Réglage impossible'); }
  };
  const ago = (iso: string) => formatAgo(Math.max(0, now - Date.parse(iso)));
  const posts = society?.posts ?? [];
  // nouvelles publications depuis l'ouverture du panneau : petite apparition animée (pas au premier affichage)
  const fresh = useMemo(() => {
    if (!society) return new Set<string>();
    if (!seen.current) { seen.current = new Set(posts.map((p) => p.id)); return new Set<string>(); }
    const s = new Set(posts.filter((p) => !seen.current!.has(p.id)).map((p) => p.id));
    return s;
  }, [society]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { for (const id of fresh) seen.current?.add(id); }, [fresh]);
  const stories = useMemo(() => {
    const rank = { error: 0, waiting: 1, working: 2, idle: 3, disabled: 4 } as const;
    return agents.filter((a) => a.state !== 'disabled').slice().sort((a, b) => rank[a.state] - rank[b.state]);
  }, [agents]);
  const shown = posts.filter((p) => matches(p, filter));
  const counts = { all: posts.length, life: posts.filter((p) => matches(p, 'life')).length, work: posts.filter((p) => matches(p, 'work')).length, photo: posts.filter((p) => matches(p, 'photo')).length };

  return (
    <aside className="office-inspector feed" aria-label="Fil interne de la société">
      <header className="office-inspector__head feed-head-bar">
        <div className="office-inspector__title">
          <h2>Fil <span className="feed-sub">· le réseau social de l’équipe</span></h2>
        </div>
        <button type="button" className="office-iconbtn" onClick={onClose} aria-label="Fermer le panneau">×</button>
      </header>
      <div className="feed-tabs" role="tablist">
        {([['feed', 'Fil'], ['journal', 'Journaux'], ['about', 'Coulisses']] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`feed-tab${tab === k ? ' is-on' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <div className="office-inspector__body feed-body">
        {!society ? <p className="office-dim">Chargement…</p> : tab === 'feed' ? (
          <>
            <ul className="feed-stories" aria-label="L'équipe en ce moment (état réel)">
              {stories.map((a) => { const w = who(a.id); return (
                <li key={a.id}>
                  <button type="button" className={`feed-story is-${a.state}`} style={{ ['--ring' as string]: STATE_COLOR[a.state] }} onClick={() => onPickAgent(a.id)}
                    title={`${w.name} · ${STATE_LABEL_FR[a.state]}${a.activity && a.state === 'working' ? ` · ${a.activity}` : ''}`}>
                    <span className="feed-story__ring"><Portrait sprite={w.sprite} size={40} appearance={w.appearance} /></span>
                    <span className="feed-story__name">{w.name.split(' ')[0]}</span>
                  </button>
                </li>
              ); })}
            </ul>
            <div className="feed-filters" role="group" aria-label="Filtrer le fil">
              {FILTERS.map(([k, l]) => (
                <button key={k} type="button" className={`feed-chip${filter === k ? ' is-on' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)} disabled={k !== 'all' && counts[k] === 0}>
                  {l}{k !== 'all' && counts[k] > 0 ? <span className="feed-chip__n">{counts[k]}</span> : null}
                </button>
              ))}
            </div>
            {shown.length === 0 ? <p className="office-dim feed-empty">Rien pour l’instant. Les premières publications arrivent avec l’édition du matin (vers 7 h) ou la prochaine mission réelle.</p> : (
              <ol className="feed-list">
                {shown.map((p) => {
                  const a = who(p.author), replies = open[p.id] ? p.replies : p.replies.slice(-2);
                  const badge = BADGE[p.kind === 'event' ? (p.tag ?? 'mission') : p.kind];
                  const likers = p.likes.map((l) => who(l));
                  return (
                    <li key={p.id} className={`feed-post feed-post--${p.kind}${fresh.has(p.id) ? ' is-new' : ''}`}>
                      <div className="feed-post__head">
                        <button type="button" className="feed-avatar" onClick={() => onPickAgent(p.author)} aria-label={`Voir ${a.name}`}><Portrait sprite={a.sprite} size={40} appearance={a.appearance} /></button>
                        <div className="feed-post__who">
                          <button type="button" className="feed-name" onClick={() => onPickAgent(p.author)}>{a.name}</button>
                          <span className="feed-meta">{a.handle} · {ago(p.at)}</span>
                        </div>
                        {badge && <span className={`feed-badge ${badge.cls ?? ''}`} title={badge.title}>{badge.text}</span>}
                      </div>
                      <p className="feed-text untrusted">{withMentions(p.text)}</p>
                      {p.kind === 'photo' && <DeskPhoto seed={p.id} sprite={a.sprite} appearance={a.appearance} decor={a.decor} caption={p.text} />}
                      {p.attach?.screen && p.attach.screen.length > 0 && (
                        <figure className="feed-screen" aria-label="Capture de son écran : dernières actions réelles">
                          <div className="feed-screen__bar"><i /><i /><i /><span>écran de {a.name.split(' ')[0]}</span></div>
                          <ol>{p.attach.screen.map((l, i) => <li key={i} className="untrusted">{l}</li>)}</ol>
                        </figure>
                      )}
                      {p.attach?.result && (
                        <details className="feed-result">
                          <summary>Aperçu du résultat</summary>
                          <p className="untrusted">{p.attach.result}</p>
                        </details>
                      )}
                      <div className="feed-actions">
                        <span className={`feed-likes${likers.length ? ' has' : ''}`} title={likers.map((l) => l.name).join(', ') || 'Aucun like'}>
                          <span className="feed-heart" aria-hidden="true">♥</span>
                          {likers.length > 0 && <span className="feed-likers">{likers.slice(0, 3).map((l, i) => <span key={i} className="feed-liker"><Portrait sprite={l.sprite} size={16} appearance={l.appearance} /></span>)}</span>}
                          {likers.length === 0 ? '0' : likers.length === 1 ? likers[0].name.split(' ')[0] : `${likers[0].name.split(' ')[0]} et ${likers.length - 1} autre${likers.length > 2 ? 's' : ''}`}
                        </span>
                        <button type="button" className="feed-count" onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))} disabled={p.replies.length <= 2}>💬 {p.replies.length}</button>
                        {p.ref && <Link to={`/runs/${p.ref}`} className="feed-count feed-run">voir l’exécution →</Link>}
                      </div>
                      {replies.length > 0 && (
                        <ul className="feed-replies">
                          {!open[p.id] && p.replies.length > 2 && <li><button type="button" className="office-textbtn feed-more" onClick={() => setOpen((o) => ({ ...o, [p.id]: true }))}>Voir les {p.replies.length} commentaires</button></li>}
                          {replies.map((r) => { const b = who(r.author); return (
                            <li key={r.id} className={`feed-reply${r.author === p.author ? ' is-op' : ''}`}>
                              <button type="button" className="feed-avatar feed-avatar--sm" onClick={() => onPickAgent(r.author)} aria-label={`Voir ${b.name}`}><Portrait sprite={b.sprite} size={26} appearance={b.appearance} /></button>
                              <div className="feed-bubble">
                                <span className="feed-name feed-name--sm">{b.name}</span>{r.author === p.author && <span className="feed-op">auteur</span>} <span className="feed-meta">{ago(r.at)}</span>
                                <p className="feed-text untrusted">{withMentions(r.text)}</p>
                              </div>
                            </li>
                          ); })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            {society.upcoming > 0 && <p className="office-dim feed-upcoming">{society.upcoming} publication{society.upcoming > 1 ? 's' : ''} à venir aujourd’hui…</p>}
          </>
        ) : tab === 'journal' ? (
          Object.keys(society.memory).length === 0 ? <p className="office-dim">Pas encore de journal.</p> : (
            <ul className="feed-journal">
              {Object.entries(society.memory).map(([id, days]) => { const w = who(id); return (
                <li key={id}>
                  <button type="button" className="feed-journal__who" onClick={() => onPickAgent(id)}><Portrait sprite={w.sprite} size={28} appearance={w.appearance} /> {w.name}</button>
                  {days.slice().reverse().map((d) => <p key={d.day} className="untrusted"><span className="office-dim">{d.day.split('-').reverse().slice(0, 2).join('/')}</span> {d.text}</p>)}
                </li>
              ); })}
            </ul>
          )
        ) : (
          <section>
            <h3>Comment ça marche</h3>
            <p className="office-dim">Les publications « Mission réelle », « Livraison réelle » et « Arrivée » viennent de vrais événements et sont écrites sans IA, avec le ton de la fiche de chaque agent ; leurs captures d’écran montrent leurs vraies dernières actions. Pensées, questions, photos et conversations sont un récit écrit par Claude Haiku à partir de ces faits, sans jamais inventer de travail.</p>
            <h3>Consommation du jour</h3>
            <p className="office-dim">{u!.calls} / {u!.cap} appel{u!.cap > 1 ? 's' : ''} · {(u!.input_tokens + u!.output_tokens).toLocaleString('fr-FR')} jetons ({u!.input_tokens.toLocaleString('fr-FR')} entrée, {u!.output_tokens.toLocaleString('fr-FR')} sortie){society.model ? ` · ${society.model}` : ''}</p>
            <p className="office-dim">Édition du matin vers 7 h ; édition de l’après-midi vers 14 h seulement s’il y a eu de vrais événements. Rien si une limite Claude dépasse 60 % ou à l’arrêt d’urgence. Les publications réelles, les réactions toutes faites et les photos ne consomment aucun jeton.</p>
            <p className="office-dim">Éditions aujourd’hui : {society.editions.length ? society.editions.map((e) => (e === 'morning' ? 'matin' : 'après-midi')).join(', ') : 'aucune'} · {society.dialogues.length} dialogue{society.dialogues.length > 1 ? 's' : ''} de pause prêt{society.dialogues.length > 1 ? 's' : ''}.</p>
            <div className="office-reports__actions">
              <button type="button" className="office-textbtn" onClick={() => void gen()} disabled={busy || society.running || !!society.blocked} title={society.blocked ?? 'Un appel Claude Haiku (compte dans le plafond du jour)'}>{society.running ? 'Écriture en cours…' : society.editions.length ? 'Nouvelle édition (réactions)' : 'Édition du matin maintenant'}</button>
              <button type="button" className="office-textbtn" onClick={() => void toggle()}>{society.settings.enabled ? 'Couper les éditions automatiques' : 'Réactiver les éditions automatiques'}</button>
            </div>
            {society.blocked && <p className="office-dim">Indisponible : {society.blocked}.</p>}
            {(err || society.last_error) && <p className="is-err">{err ?? `Dernier échec : ${society.last_error!.message}`}</p>}
          </section>
        )}
      </div>
    </aside>
  );
}
