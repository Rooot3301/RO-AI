// Panneau personnage du Virtual Office (clic sur un personnage ou son bureau).
// Données réelles uniquement (agent, exécutions, planifications, flux SSE) ; la fiche d'identité est décorative.
// Tout contenu venant des agents ou des fiches est affiché comme texte.
import './panel/panel.css';
import { Fragment, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.ts';
import type { Agent, AgentProfile, Run, Schedule } from '../../api/types.ts';
import type { EventLite, OfficeAgentModel } from '../state/model.ts';
import { AGENT_STATE_LABEL, ERROR_CLASS_HINT, ERROR_CLASS_LABEL, RUN_STATUS_LABEL, TOOL_KIND_LABEL, TRIGGER_LABEL } from '../../lib/labels.ts';
import { formatCountdown, formatDateTime, formatDuration, formatNumber, formatPercent, formatTokens } from '../../lib/format.ts';
import { formatAgo, formatClock } from './format.ts';
import { Portrait } from './Portrait.tsx';
import { ApprovalCard } from './Approvals.tsx';
import { Tag } from '../../components/ui/primitives';
import { useAgentProfile } from './panel/useAgentProfile.ts';
import { GenerationBox, ProfileEditor } from './panel/ProfileEditor.tsx';
import { InstructionComposer, MissionDialog } from './panel/Actions.tsx';
import { ChatPane } from './panel/ChatPane.tsx';
import { computeRunStats, firstLine, modelLabel, nextMission, providerLabel } from './panel/inspectorLogic.ts';
import { LIST_LABEL, PERSONALITY_KEYS, PERSONALITY_LABEL, PERSONALITY_NOTE, SOURCE_HINT, SOURCE_LABEL } from './panel/profileForm.ts';

interface Props {
  agent: OfficeAgentModel; seq: number; clockOffsetMs: number; recent: EventLite[]; now: number; onClose: () => void;
  /** Fiche d'identité connue du bureau (snapshot) ; chargée si absente. */
  profile?: AgentProfile | null;
  /** Caméra du bureau en train de suivre ce personnage. */
  following?: boolean;
  onFollow?: (on: boolean) => void;
  /** Appelé après chaque enregistrement / réinitialisation / génération terminée (mise à jour immédiate du bureau). */
  onProfileSaved?: (p: AgentProfile) => void;
  /** Onglet ouvert à l'affichage (par ex. « Discuter » depuis la salle de réunion). */
  initialTab?: Tab;
  /** Journal de la vie intérieure (jours récents, généré à partir des faits réels). */
  journal?: readonly { day: string; text: string }[];
}

export type Tab = 'overview' | 'chat' | 'profile' | 'activity' | 'custom';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Aperçu' }, { id: 'chat', label: 'Discuter' }, { id: 'profile', label: 'Fiche' }, { id: 'activity', label: 'Activité' }, { id: 'custom', label: 'Apparence' },
];
const STATS_RUNS = 50;

function fmtDay(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="cp-section">
      <h3 className="cp-h">{title}{right && <span className="cp-h__right">{right}</span>}</h3>
      {children}
    </section>
  );
}

export function Inspector({ agent, seq, clockOffsetMs, recent, now, onClose, profile: givenProfile, following, onFollow, onProfileSaved, initialTab, journal }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'overview');
  const [visited, setVisited] = useState<ReadonlySet<Tab>>(() => new Set<Tab>(['overview', initialTab ?? 'overview']));
  // conversation affichée dans l'onglet « Discuter » : celle en cours avec l'utilisateur (salle de réunion), sinon une nouvelle
  const [chatKey, setChatKey] = useState<string | null>(() => (agent.conv && (agent.conv.active || agent.conv.until > Date.now()) ? agent.conv.runId : null));
  const [full, setFull] = useState<Agent | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [runsErr, setRunsErr] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [current, setCurrent] = useState<Run | null>(null);
  const [backfill, setBackfill] = useState<EventLite[]>([]);
  const [editing, setEditing] = useState(false);
  const [mission, setMission] = useState(false);
  const [runsRev, setRunsRev] = useState(0);
  const tabsRef = useRef<HTMLDivElement>(null);

  const ctl = useAgentProfile(agent.id, givenProfile, onProfileSaved, full?.provider ?? null);
  const profile = ctl.profile;

  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollPos = useRef<Partial<Record<Tab, number>>>({});
  const open = (t: Tab) => {
    if (t === tab) return;
    // Chaque onglet garde sa propre position de défilement.
    if (bodyRef.current) scrollPos.current[tab] = bodyRef.current.scrollTop;
    setTab(t); setVisited((v) => (v.has(t) ? v : new Set([...v, t])));
    requestAnimationFrame(() => { if (bodyRef.current) bodyRef.current.scrollTop = scrollPos.current[t] ?? 0; });
  };
  const onTabKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.findIndex((t) => t.id === tab);
    const n = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id;
    open(n);
    requestAnimationFrame(() => tabsRef.current?.querySelector<HTMLElement>(`[data-tab="${n}"]`)?.focus());
  };

  // Agent complet (fournisseur, modèle, dernier modèle, prompt par défaut) : relu quand l'état change.
  useEffect(() => {
    let off = false;
    api.agent(agent.id).then((a) => { if (!off) setFull(a); }).catch(() => { /* l'état temps réel reste affiché */ });
    return () => { off = true; };
  }, [agent.id, agent.state, agent.runId]);

  // Exécutions récentes (statistiques, historique, conversation à poursuivre).
  useEffect(() => {
    let off = false;
    api.runs({ agent_id: agent.id, limit: STATS_RUNS }).then((r) => { if (!off) { setRuns(r); setRunsErr(null); } })
      .catch((e: unknown) => { if (!off) setRunsErr(e instanceof Error ? e.message : 'Erreur'); });
    return () => { off = true; };
  }, [agent.id, agent.state, agent.runId, agent.errorClass, runsRev]);

  useEffect(() => {
    let off = false;
    api.schedules().then((s) => { if (!off) setSchedules(s); }).catch(() => { if (!off) setSchedules([]); });
    return () => { off = true; };
  }, [agent.id, agent.state]);

  // Exécution en cours (prompt et heure de début réels).
  useEffect(() => {
    let off = false;
    setCurrent(null);
    if (!agent.runId || (agent.state !== 'working' && agent.state !== 'waiting')) return;
    api.run(agent.runId).then((r) => { if (!off) setCurrent(r); }).catch(() => { /* ignoré : l'état reste affiché */ });
    return () => { off = true; };
  }, [agent.id, agent.runId, agent.state]);

  // Événements antérieurs à l'ouverture (le flux live s'y ajoute).
  useEffect(() => {
    let off = false;
    setBackfill([]);
    api.events({ agent_id: agent.id, since: Math.max(0, seq - 1000), limit: 200 }).then((r) => {
      if (off) return;
      setBackfill(r.events.map((e) => {
        const p = (e.payload ?? {}) as Record<string, unknown>;
        return { seq: e.seq, ts: e.ts, type: e.type, run_id: e.run_id, summary: String(p.summary ?? p.text ?? p.name ?? '').slice(0, 160) };
      }));
    }).catch(() => { /* ignoré */ });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  const bumpRuns = useCallback(() => setRunsRev((n) => n + 1), []);

  const events = (() => {
    const m = new Map<number, EventLite>();
    for (const e of backfill) m.set(e.seq, e);
    for (const e of recent) m.set(e.seq, e);
    return [...m.values()].sort((a, b) => b.seq - a.seq).slice(0, 15);
  })();

  const serverNow = now + clockOffsetMs;
  const startedMs = current?.started_at ? Date.parse(current.started_at) : Date.parse(agent.since);
  const lastFail = runs?.find((r) => r.status === 'failed');
  const liveEffects = (agent.effects ?? []).filter((e) => e.until > now);
  const stats = runs ? computeRunStats(runs) : null;
  const next = schedules ? nextMission(agent.id, schedules) : null;
  const model = full ? modelLabel({ model: full.model ?? null, last_model: full.last_model ?? current?.model ?? runs?.find((r) => r.model)?.model ?? null }) : null;
  const displayName = profile?.display_name?.trim() || agent.name;
  const busy = agent.state === 'working' || agent.state === 'waiting';
  const enabled = full ? full.enabled : agent.state !== 'disabled';

  return (
    <aside className="cp" aria-label={`Personnage : ${displayName}`}>
      <header className="cp-head">
        <Portrait sprite={agent.sprite} size={56} appearance={profile?.appearance ?? null} />
        <div className="cp-head__title">
          <h2>{displayName}</h2>
          <p className="cp-head__role">{profile?.title || agent.department}</p>
          <p className="cp-head__meta">
            <span className={`cp-state cp-state--${agent.state}`}><i aria-hidden="true" />{AGENT_STATE_LABEL[agent.state]}</span>
            {displayName !== agent.name && <span className="faint" title="Nom de l’agent dans RO·AI">{agent.name}</span>}
          </p>
        </div>
        <button type="button" className="cp-close" onClick={onClose} aria-label="Fermer le panneau">×</button>
      </header>

      <div className="cp-toolbar" role="toolbar" aria-label="Actions sur l’agent">
        {onFollow && (
          <button type="button" className={`btn btn--sm${following ? ' btn--primary' : ''}`} aria-pressed={!!following} onClick={() => onFollow(!following)}
            title="La caméra du bureau suit ce personnage">{following ? 'Suivi actif' : 'Suivre'}</button>
        )}
        <button type="button" className="btn btn--sm" onClick={() => setMission(true)} disabled={!full}>Nouvelle mission</button>
        <button type="button" className={`btn btn--sm${tab === 'chat' ? ' btn--primary' : ''}`} onClick={() => open('chat')} title="Parler à l’agent ici, sans quitter le bureau">Discuter</button>
        <Link className="btn btn--sm" to={`/agents/${agent.id}`}>Configuration</Link>
      </div>

      <div className="cp-tabs" role="tablist" aria-label="Sections" ref={tabsRef} onKeyDown={onTabKey}>
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" data-tab={t.id} id={`cp-tab-${t.id}`} aria-controls={`cp-pane-${t.id}`} aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1}
            className={`cp-tab${tab === t.id ? ' is-on' : ''}`} onClick={() => open(t.id)}>{t.label}</button>
        ))}
      </div>

      <div className={`cp-body${tab === 'chat' ? ' cp-body--chat' : ''}`} ref={bodyRef}>
        {/* ---- Aperçu ---- */}
        <div role="tabpanel" id="cp-pane-overview" aria-labelledby="cp-tab-overview" hidden={tab !== 'overview'}>
          {current?.status === 'awaiting_approval' && (
            <section className="cp-section cp-approval" aria-live="polite">
              <h3 className="cp-h">Approbation requise</h3>
              <ApprovalCard run={current} onDone={() => setCurrent(null)} />
            </section>
          )}
          <Section title="État réel">
            <dl className="cp-kv">
              <dt>État</dt><dd><span className={`cp-state cp-state--${agent.state}`}><i aria-hidden="true" />{AGENT_STATE_LABEL[agent.state]}</span></dd>
              <dt>Depuis</dt><dd>{formatAgo(serverNow - Date.parse(agent.since))}</dd>
              {agent.state === 'error' && agent.errorClass && (<><dt>Erreur</dt><dd className="is-err" title={ERROR_CLASS_HINT[agent.errorClass]}>{ERROR_CLASS_LABEL[agent.errorClass]}</dd></>)}
              {agent.state !== 'error' && agent.errorClass && (<><dt>Dernier échec</dt><dd className="is-err" title={ERROR_CLASS_HINT[agent.errorClass]}>{ERROR_CLASS_LABEL[agent.errorClass]}</dd></>)}
              {liveEffects.map((e) => (<Fragment key={e.kind}><dt>Effet</dt><dd>{e.label} <span className="faint mono">({e.origin.type} #{e.origin.seq})</span></dd></Fragment>))}
              <dt>Cause visible</dt>
              <dd className="mono cp-small">{agent.origin.type}{agent.origin.seq ? ` #${agent.origin.seq}` : ''}{agent.origin.run_id ? ` · ${agent.origin.run_id}` : ''}</dd>
            </dl>
            {agent.errorClass && <p className="cp-small faint">{ERROR_CLASS_HINT[agent.errorClass]}</p>}
            {lastFail?.error_message && agent.errorClass && <p className="cp-errmsg untrusted">{lastFail.error_message.slice(0, 400)}</p>}
          </Section>

          <Section title="Mission actuelle">
            {busy ? (
              <dl className="cp-kv">
                <dt>Activité</dt><dd>{agent.activity ?? (agent.state === 'waiting' ? (agent.waitKind === 'approval' ? 'Attend une approbation' : 'En file d’attente') : 'Exécution en cours')}</dd>
                {agent.toolKind && (<><dt>Outil</dt><dd>{TOOL_KIND_LABEL[agent.toolKind]}</dd></>)}
                <dt>Durée</dt><dd>{formatDuration(serverNow - startedMs)}</dd>
                {current && (<><dt>Origine</dt><dd>{TRIGGER_LABEL[current.trigger] ?? current.trigger}</dd></>)}
                {current?.prompt && (<><dt>Demande</dt><dd className="untrusted cp-clamp" title={current.prompt.slice(0, 600)}>{current.prompt.slice(0, 600)}</dd></>)}
                {agent.runId && (<><dt>Exécution</dt><dd><Link to={`/runs/${agent.runId}`} className="mono">{agent.runId}</Link></dd></>)}
              </dl>
            ) : <p className="faint cp-small">Aucune mission en cours.</p>}
          </Section>

          <Section title="Prochaine mission planifiée" right={<Link to="/schedules" className="cp-small">Planifications</Link>}>
            {!schedules ? <p className="faint cp-small">Chargement…</p> : next ? (
              <dl className="cp-kv">
                <dt>Quand</dt><dd>{formatDateTime(next.at)} <span className="faint">· dans {formatCountdown(next.at, serverNow)}</span></dd>
                <dt>Planification</dt><dd className="untrusted">{next.name}</dd>
                {next.prompt && (<><dt>Demande</dt><dd className="untrusted cp-clamp">{firstLine(next.prompt, 200)}</dd></>)}
              </dl>
            ) : <p className="faint cp-small">Aucune planification active.</p>}
          </Section>

          <Section title="Instructions">
            <InstructionComposer agentId={agent.id} agentEnabled={enabled} runs={runs} onSent={bumpRuns} onOpenChat={(cid) => { setChatKey(cid); open('chat'); }} />
          </Section>

          <Section title="Intelligence artificielle">
            <dl className="cp-kv">
              <dt>Fournisseur</dt><dd>{full ? providerLabel(full.provider) : '…'}</dd>
              <dt>Modèle</dt><dd>{model ? <span className={model.isDefault ? 'mono faint' : 'mono'}>{model.text}</span> : '…'}</dd>
              {full?.provider === 'codex' && full.config?.reasoning_effort && (<><dt>Effort</dt><dd>{full.config.reasoning_effort}</dd></>)}
            </dl>
          </Section>

          <Section title="Identité" right={profile && <Tag tone={profile.source === 'generated' ? 'info' : profile.source === 'manual' ? 'ok' : 'neutral'} title={SOURCE_HINT[profile.source]}>{SOURCE_LABEL[profile.source]}</Tag>}>
            {!profile ? <p className="faint cp-small">{ctl.loadError ?? 'Chargement de la fiche…'}</p> : (
              <dl className="cp-kv">
                <dt>Nom affiché</dt><dd className="untrusted">{profile.display_name || '—'}</dd>
                <dt>Matricule</dt><dd className="mono">{profile.employee_id || '—'}</dd>
                <dt>Fonction</dt><dd className="untrusted">{profile.title || '—'}</dd>
                <dt>Département</dt><dd>{profile.department || agent.department}</dd>
                <dt>Recrutement</dt><dd>{profile.hired_at ? fmtDay(profile.hired_at) : '—'}</dd>
                <dt>Bureau</dt><dd className="mono">{profile.office || '—'}</dd>
              </dl>
            )}
          </Section>
        </div>

        {/* ---- Discuter ---- */}
        {visited.has('chat') && (
          <div role="tabpanel" id="cp-pane-chat" aria-labelledby="cp-tab-chat" hidden={tab !== 'chat'} className="cp-pane-chat">
            <ChatPane agentId={agent.id} convKey={chatKey} onConvKey={setChatKey} now={now + clockOffsetMs} />
          </div>
        )}

        {/* ---- Fiche ---- */}
        {visited.has('profile') && (
          <div role="tabpanel" id="cp-pane-profile" aria-labelledby="cp-tab-profile" hidden={tab !== 'profile'}>
            {editing ? (
              <ProfileEditor agentId={agent.id} sprite={agent.sprite} provider={full?.provider ?? null} ctl={ctl} parts={['identity', 'story', 'personality']}
                onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
            ) : !profile ? <p className="faint cp-small">{ctl.loadError ?? 'Chargement de la fiche…'}</p> : (
              <>
                <GenerationBox ctl={ctl} provider={full?.provider ?? null} compact />
                <Section title="Journal (vie intérieure)">
                  {journal && journal.length ? (
                    <ul className="cp-runs">{journal.slice().reverse().map((j) => <li key={j.day}><span className="faint">{fmtDay(j.day)}</span> <span className="untrusted">{j.text}</span></li>)}</ul>
                  ) : <p className="faint cp-small">Pas encore de journal : il s’écrit chaque matin à partir de ses missions réelles.</p>}
                </Section>
                <Section title="Histoire" right={<button type="button" className="btn btn--sm" onClick={() => setEditing(true)}>Modifier la fiche</button>}>
                  {profile.bio ? <p className="cp-bio untrusted">{profile.bio}</p> : <p className="faint cp-small">Pas encore de biographie.</p>}
                </Section>
                {(['traits', 'interests', 'habits', 'skills'] as const).map((k) => (
                  <Section key={k} title={LIST_LABEL[k]}>
                    {profile[k].length ? <ul className="cp-tags">{profile[k].map((t) => <li key={t} className="untrusted">{t}</li>)}</ul> : <p className="faint cp-small">—</p>}
                  </Section>
                ))}
                <Section title="Personnalité (vie simulée)">
                  <p className="cp-note">{PERSONALITY_NOTE}</p>
                  <ul className="cp-bars">
                    {PERSONALITY_KEYS.map((k) => (
                      <li key={k} title={PERSONALITY_LABEL[k].hint}>
                        <span>{PERSONALITY_LABEL[k].label}</span>
                        <span className="cp-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(profile.personality[k] * 100)} aria-label={PERSONALITY_LABEL[k].label}>
                          <i style={{ width: `${Math.round(profile.personality[k] * 100)}%` }} />
                        </span>
                        <span className="faint cp-small">{profile.personality[k] >= 0.5 ? PERSONALITY_LABEL[k].high : PERSONALITY_LABEL[k].low}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              </>
            )}
          </div>
        )}

        {/* ---- Activité ---- */}
        {visited.has('activity') && (
          <div role="tabpanel" id="cp-pane-activity" aria-labelledby="cp-tab-activity" hidden={tab !== 'activity'}>
            <Section title="Statistiques" right={stats && <span className="faint cp-small">{stats.count} dernière{stats.count > 1 ? 's' : ''} exécution{stats.count > 1 ? 's' : ''}</span>}>
              {runsErr && <p className="is-err cp-small">{runsErr}</p>}
              {!stats && !runsErr && <p className="faint cp-small">Chargement…</p>}
              {stats && (
                <div className="cp-stats">
                  <div><span>Exécutions</span><b>{formatNumber(stats.count)}</b><small>{stats.active ? `${stats.active} en cours` : `${stats.failed} échec${stats.failed > 1 ? 's' : ''}`}</small></div>
                  <div><span>Réussite</span><b>{stats.successRate == null ? '—' : formatPercent(stats.successRate * 100)}</b><small>{stats.succeeded} réussie{stats.succeeded > 1 ? 's' : ''}</small></div>
                  <div><span>Durée moyenne</span><b>{formatDuration(stats.avgDurationMs)}</b><small>exécutions terminées</small></div>
                  <div><span>Jetons</span><b>{formatTokens(stats.inputTokens + stats.outputTokens)}</b><small>{formatTokens(stats.inputTokens)} entrée · {formatTokens(stats.outputTokens)} sortie</small></div>
                  <div><span>Série en cours</span><b>{stats.streak}</b><small>réussite{stats.streak > 1 ? 's' : ''} d’affilée</small></div>
                  <div><span>Dernière réussite</span><b className="cp-stats__small">{stats.lastSuccessAt ? formatAgo(serverNow - Date.parse(stats.lastSuccessAt)) : '—'}</b><small>{stats.lastFailureAt ? `dernier échec ${formatAgo(serverNow - Date.parse(stats.lastFailureAt))}` : 'aucun échec'}</small></div>
                </div>
              )}
            </Section>

            <Section title="Historique" right={<Link to={`/runs?agent_id=${encodeURIComponent(agent.id)}`} className="cp-small">Toutes les exécutions</Link>}>
              {runs && runs.length === 0 && <p className="faint cp-small">Aucune exécution.</p>}
              {runs && runs.length > 0 && (
                <ul className="cp-runs">
                  {runs.slice(0, 10).map((r) => (
                    <li key={r.id}>
                      <Link to={`/runs/${r.id}`}>
                        <span className={`cp-runstatus cp-runstatus--${r.status}`}>{RUN_STATUS_LABEL[r.status]}</span>
                        <span className="faint">{formatDateTime(r.created_at)}</span>
                        <span className="faint">{r.duration_ms != null ? formatDuration(r.duration_ms) : r.status === 'running' ? 'en cours' : '—'}</span>
                        {r.error_class && <span className="is-err">{ERROR_CLASS_LABEL[r.error_class]}</span>}
                        {r.prompt && <span className="cp-runs__prompt untrusted">{TRIGGER_LABEL[r.trigger] ?? r.trigger} · {firstLine(r.prompt, 90)}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Derniers événements" right={<Link to="/logs" className="cp-small">Journal</Link>}>
              {events.length === 0 && <p className="faint cp-small">Aucun événement récent.</p>}
              <ul className="cp-events">
                {events.map((e) => (
                  <li key={e.seq}>
                    <span className="faint mono">{formatClock(e.ts)}</span>
                    {e.run_id ? <Link to={`/runs/${e.run_id}`} className="mono cp-events__type">{e.type}</Link> : <span className="mono cp-events__type">{e.type}</span>}
                    {e.summary && <span className="cp-events__sum untrusted">{e.summary}</span>}
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        )}

        {/* ---- Personnaliser ---- */}
        {visited.has('custom') && (
          <div role="tabpanel" id="cp-pane-custom" aria-labelledby="cp-tab-custom" hidden={tab !== 'custom'}>
            <p className="cp-note cp-note--top">Apparence du personnage et aménagement de son poste dans le bureau. Purement décoratif : le travail de l’agent n’est pas affecté.</p>
            <ProfileEditor agentId={agent.id} sprite={agent.sprite} provider={full?.provider ?? null} ctl={ctl} parts={['appearance', 'decor']}
              showGeneration={false} showReset={false} saveLabel="Appliquer" />
          </div>
        )}
      </div>

      {mission && full && <MissionDialog agent={full} onClose={() => setMission(false)} onLaunched={bumpRuns} />}
    </aside>
  );
}
