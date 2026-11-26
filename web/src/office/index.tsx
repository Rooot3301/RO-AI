// Virtual Office de RO·AI : siège d'entreprise illustré (vectoriel), dont tout ce qui prétend être réel vient de l'API
// (snapshot + flux SSE). La vie sociale (promenades, café, bavardages) est une simulation locale, décorative et désactivable.
import './ui/office.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { APPROVALS_ID, FLOOR_ID, LIBRARY_ID, LIMITS_ID, MAILBOX_ID, MEETING_ID, OfficeCanvas, PLANNING_ID, SERVER_ID } from './ui/OfficeCanvas.tsx';
import { FEED_ID, LibraryPanel, MeetingPanel } from './ui/RoomPanels.tsx';
import { FeedPanel } from './ui/FeedPanel.tsx';
import { useSociety } from './state/useSociety.ts';
import { PlanningPanel } from './ui/BoardPanels.tsx';
import { ApprovalRoomPanel } from './ui/Approvals.tsx';
import { useBoards } from './state/useBoards.ts';
import { useMailbox } from './state/useMailbox.ts';
import { limitAlert, limitViews, planningSummary } from './state/boards.ts';
import { DevPanel, ReceptionPanel, ServerPanel } from './ui/StaffPanels.tsx';
import { useDevTeam } from './state/useDevTeam.ts';
import { devActionText, devSessionOf, isDevId, DEV_STATE_FR } from './state/devteam.ts';
import { useSystem } from './state/useSystem.ts';
import { EMPTY_STAFF_INFO, STAFF_IDS, isStaffId } from './engine/staff.ts';
import type { StaffInfo } from './engine/staff.ts';
import { parisTime } from './engine/daylight.ts';
import type { EditHooks, HoverInfo } from './ui/OfficeCanvas.tsx';
import { Inspector } from './ui/Inspector.tsx';
import { OrchestratorInspector } from './ui/OrchestratorInspector.tsx';
import { EditorPanel } from './ui/EditorPanel.tsx';
import { ORCH_ID } from './state/orchestrator.ts';
import { AgentList } from './ui/AgentList.tsx';
import { Legend } from './ui/Legend.tsx';
import { formatAgo } from './ui/format.ts';
import { fitPlan, planKey } from './layout/plan.ts';
import type { LayoutOverrides, PlanInput } from './layout/plan.ts';
import { EMPTY_OVERRIDES, hideFurniture, moveFurniture, parseLayoutDoc, rotateFurniture, showFurniture, toLayoutDoc } from './layout/editor.ts';
import { countByState } from './state/model.ts';
import { useOfficeFeed } from './state/useOfficeFeed.ts';
import { useStory } from './state/useStory.ts';
import { loadPrefs, savePrefs } from './state/prefs.ts';
import type { OfficePrefs, ThemePref } from './state/prefs.ts';
import { STATE_LABEL_FR, TOOL_KIND_LABEL_FR } from './state/visual.ts';
import type { AgentProfile, AgentState } from '../api/types.ts';
import { api } from '../api/client.ts';
import { MAX_ZOOM_DELTA, MIN_ZOOM_DELTA } from './engine/camera.ts';

const STATES: AgentState[] = ['working', 'waiting', 'error', 'idle', 'disabled'];
const CONNECTION_FR = { connecting: 'Connexion…', live: 'En direct', reconnecting: 'Reconnexion…' } as const;
const SHORT: Record<AgentState, string> = { working: 'Travail', waiting: 'Attente', error: 'Erreur', idle: 'Repos', disabled: 'Absents' };
const THEME_NEXT: Record<ThemePref, ThemePref> = { auto: 'day', day: 'night', night: 'auto' };
const INSPECTOR_W = 380;
const LEVEL_FR = ['RDC', '1er'] as const;
const LEVEL_LONG = ['rez-de-chaussée', '1er étage'] as const;
const PLACE_TIP: Readonly<Record<string, readonly [string, string]>> = {
  [SERVER_ID]: ['Salle serveur · ro-ai', 'Le serveur qui héberge RO·AI : cliquer pour ses mesures réelles'],
  [LIMITS_ID]: ['Limites d’usage', 'Claude et Codex : fenêtres et remises à zéro réelles'],
  [PLANNING_ID]: ['Planning du jour', 'Missions planifiées aujourd’hui et compte à rebours'],
  [APPROVALS_ID]: ['Salle d’attente', 'Demandes à approuver : cliquer pour décider'],
  [LIBRARY_ID]: ['Bibliothèque', 'Archives des rapports réels : cliquer pour les lire'],
  [MEETING_ID]: ['Salle de réunion', 'Conversations en cours avec toi (Chat, Discord)'],
};

function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

export default function OfficeView() {
  const { model, connection, error, reload } = useOfficeFeed();
  const story = useStory(model);
  const [prefs, setPrefs] = useState<OfficePrefs>(loadPrefs);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Agent dont le panneau doit s'ouvrir sur l'onglet « Discuter » (depuis la salle de réunion). */
  const [chatFor, setChatFor] = useState<string | null>(null);
  const [followId, setFollowId] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [daylight, setDaylight] = useState(1);
  const [levelCounts, setLevelCounts] = useState<number[] | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const now = useNow(1000);

  const update = useCallback((patch: Partial<OfficePrefs>) => setPrefs((p) => { const n = { ...p, ...patch }; savePrefs(n); return n; }), []);

  // Fiches d'identité : celles du snapshot, complétées par les enregistrements locaux (affichage immédiat).
  const [localProfiles, setLocalProfiles] = useState<Record<string, AgentProfile>>({});
  useEffect(() => { setLocalProfiles({}); }, [model.profiles]);
  const profiles = useMemo(() => ({ ...model.profiles, ...localProfiles }), [model.profiles, localProfiles]);
  const onProfileSaved = useCallback((p: AgentProfile) => setLocalProfiles((cur) => {
    const prev = cur[p.agent_id] ?? model.profiles[p.agent_id];
    if (prev?.updated_at && p.updated_at && prev.updated_at > p.updated_at) return cur; // fiche plus ancienne : ignorée
    return { ...cur, [p.agent_id]: p };
  }), [model.profiles]);

  // Agencement personnalisé (éditeur) : chargé une fois ; modifié localement puis enregistré à la demande.
  const [saved, setSaved] = useState<LayoutOverrides>(EMPTY_OVERRIDES);
  const [draft, setDraft] = useState<LayoutOverrides | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editMsg, setEditMsg] = useState<{ text: string; err: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { let alive = true; api.officeLayout().then((r) => { if (alive) setSaved(parseLayoutDoc(r.layout)); }).catch(() => { /* agencement par défaut */ }); return () => { alive = false; }; }, []);
  const overrides = draft ?? saved;
  const editing = draft !== null;

  const planAgents = useMemo(() => model.agents.map((a) => ({ id: a.id, department: a.department, rank: a.rank })), [model.agents]);
  const key = planKey({ departments: model.departments, agents: planAgents }) + '#' + JSON.stringify(overrides.furniture);
  // La forme du plan s'adapte aux proportions de la zone au moment où sa composition change (pas au redimensionnement).
  const layout = useMemo(() => {
    const r = stageRef.current?.getBoundingClientRect();
    const aspect = r && r.width > 50 && r.height > 50 ? r.width / r.height : 1.6;
    return fitPlan({ departments: model.departments, agents: planAgents, overrides }, aspect);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const planInput: PlanInput = { departments: model.departments, agents: planAgents, overrides, wings: layout.wings };

  const counts = useMemo(() => countByState(model.agents), [model.agents]);
  const approvalsWaiting = useMemo(() => model.agents.filter((a) => a.state === 'waiting' && a.waitKind === 'approval').length, [model.agents]);
  const selected = model.agents.find((a) => a.id === selectedId) ?? null;
  const placeSel = selectedId === SERVER_ID || selectedId === LIMITS_ID || selectedId === PLANNING_ID || selectedId === APPROVALS_ID || selectedId === LIBRARY_ID || selectedId === MEETING_ID || selectedId === MAILBOX_ID || selectedId === FEED_ID || isStaffId(selectedId) || isDevId(selectedId); // lieu, tableau ou personnel figurant (pas un agent)
  useEffect(() => { if (selectedId && selectedId !== ORCH_ID && !placeSel && model.loaded && !selected) setSelectedId(null); }, [selectedId, selected, model.loaded, placeSel]);

  // Salle serveur : mesures réelles (60 s pour l'ambiance, 7 s panneau ouvert, rien quand l'onglet est masqué)
  const serverOpen = selectedId === SERVER_ID || selectedId === LIMITS_ID || selectedId === STAFF_IDS.tech;
  const sys = useSystem(model.loaded, serverOpen);
  // Tableaux réels : planning du jour (hall) et limites d'usage (salle serveur)
  const boardsState = useBoards(model.loaded, model.lastEvent?.type ?? null, model.lastEvent?.seq ?? 0);
  const boards = boardsState.boards;
  // boîte aux lettres : rapports arrivés depuis la dernière visite de la bibliothèque ; un clic sur la boîte l'ouvre
  const devteam = useDevTeam(model.loaded);
  const { society, reload: reloadSociety } = useSociety(model.loaded, model.lastEvent?.type ?? null, model.lastEvent?.seq ?? 0);
  // publications du fil pas encore vues dans ce navigateur (pastille du bouton « Fil ») ; ouvrir le fil les marque comme vues
  const [feedSeen, setFeedSeen] = useState<string>(() => { try { return localStorage.getItem('roai.office.feed.seen.v1') ?? ''; } catch { return ''; } });
  const feedLatest = society?.posts[0]?.at ?? '';
  const feedUnread = feedSeen ? (society?.posts.filter((p) => p.at > feedSeen).length ?? 0) : 0;
  useEffect(() => {
    if (!feedLatest || (selectedId !== FEED_ID && feedSeen)) return;
    if (feedLatest !== feedSeen) { setFeedSeen(feedLatest); try { localStorage.setItem('roai.office.feed.seen.v1', feedLatest); } catch { /* stockage indisponible */ } }
  }, [selectedId, feedLatest, feedSeen]);
  const agentNameOf = useCallback((id: string) => model.agents.find((x) => x.id === id)?.name ?? null, [model.agents]);
  const mailbox = useMailbox(model.loaded, model.lastEvent?.type ?? null, model.lastEvent?.seq ?? 0);
  useEffect(() => { if (selectedId === MAILBOX_ID) setSelectedId(LIBRARY_ID); else if (selectedId === LIBRARY_ID) mailbox.markRead(); }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  const minute = Math.floor(now / 60_000);
  // archives : relues quand une mission se termine avec succès (le panneau Bibliothèque est ouvert)
  const [archiveRev, setArchiveRev] = useState(0);
  useEffect(() => { if (model.lastEvent?.type === 'run.succeeded' && selectedId === LIBRARY_ID) setArchiveRev((n) => n + 1); }, [model.lastEvent?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  // Faits réels transmis au personnel figurant (aucune requête supplémentaire : données déjà chargées)
  const staffInfo = useMemo<StaffInfo>(() => {
    if (!model.loaded) return EMPTY_STAFF_INFO;
    const names = new Map(model.agents.map((a) => [a.id, a.name]));
    let next: StaffInfo['next'] = null;
    for (const [id, st] of Object.entries(story.agents)) if (st.next && names.has(id) && (!next || Date.parse(st.next.at) < Date.parse(next.at))) next = { agent: names.get(id)!, at: st.next.at };
    const plan = planningSummary(boards?.planning);
    const firstUp = plan?.upcoming.find((i) => i.status === 'upcoming' && i.agent_enabled);
    if (firstUp) next = { agent: firstUp.agent_name, at: firstUp.at };
    const nowMs = minute * 60_000;
    const lim = limitAlert(boards?.limits, nowMs);
    const lv = limitViews(boards?.limits, nowMs);
    const usage = [...lv.claude, ...lv.codex].filter((l) => l.pct !== null).map((l) => ({ provider: l.provider, label: l.label, pct: l.pct! }));
    const providerDown = Object.entries(model.orch.providers).find(([, st]) => st === 'logged_out')?.[0] ?? null;
    const sysErr = model.agents.find((a) => a.state === 'error' && (a.errorClass === 'timeout' || a.errorClass === 'transient'));
    return {
      loaded: true, working: counts.working, errors: counts.error,
      approvals: model.agents.filter((a) => a.state === 'waiting' && a.waitKind === 'approval').length,
      queued: model.agents.filter((a) => a.state === 'waiting' && a.waitKind !== 'approval').length,
      next, memPct: sys.info?.mem.percent ?? null, diskPct: sys.info?.disk.percent ?? null, cpuPct: sys.info?.cpu_percent ?? null,
      providerDown, sysError: sysErr ? sysErr.name : null,
      today: plan ? { total: plan.total, done: plan.done, failed: plan.failed, paused: plan.paused } : null,
      limit: lim && lim.level !== 'ok' ? { provider: lim.provider, label: lim.label, level: lim.level, pct: lim.pct, resetsAt: lim.resetsAt } : null,
      usage, paused: model.control.paused,
    };
  }, [model.loaded, model.agents, model.orch.providers, story.agents, sys.info, boards, minute, model.control.paused]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (followId && followId !== ORCH_ID && model.loaded && !model.agents.some((a) => a.id === followId)) setFollowId(null); }, [followId, model.agents, model.loaded]);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.().catch(() => { /* refusé par le navigateur */ });
  };

  // ── éditeur ──
  const applyEdit = (r: ReturnType<typeof moveFurniture>, ok: string) => {
    if (r.ok) { setDraft(r.overrides); setEditMsg({ text: ok, err: false }); }
    else setEditMsg({ text: `Refusé : ${r.reason}.`, err: true });
  };
  const edit: EditHooks | null = editing ? {
    selectedKey: editKey,
    onPick: (k) => { setEditKey(k); setEditMsg(null); },
    onDrop: (k, col, row) => applyEdit(moveFurniture(planInput, layout, k, col, row), 'Meuble déplacé.'),
  } : null;
  const startEdit = () => { setDraft(saved); setEditKey(null); setEditMsg(null); setSelectedId(null); setFollowId(null); };
  const cancelEdit = () => { setDraft(null); setEditKey(null); setEditMsg(null); };
  const saveEdit = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const empty = Object.keys(draft.furniture).length === 0;
      const r = await api.saveOfficeLayout(empty ? null : toLayoutDoc(draft));
      setSaved(parseLayoutDoc(r.layout)); setDraft(null); setEditKey(null); setEditMsg(null);
    } catch (e) { setEditMsg({ text: `Enregistrement impossible : ${e instanceof Error ? e.message : 'erreur'}`, err: true }); }
    finally { setSaving(false); }
  };

  const hovered = hover ? model.agents.find((a) => a.id === hover.id) ?? null : null;
  const hoverOrch = hover?.id === ORCH_ID;
  const last = model.lastEvent;
  const lastAgent = last?.agent_id ? model.agents.find((a) => a.id === last.agent_id)?.name : null;
  const serverNow = now + model.clockOffsetMs;
  const themeLabel = prefs.theme === 'auto' ? `Auto · ${daylight > 0.5 ? 'jour' : 'nuit'}` : prefs.theme === 'day' ? 'Jour' : 'Nuit';
  const panelOpen = !editing && (!!selected || selectedId === ORCH_ID || placeSel);
  const pt = parisTime(now);
  const staffClock = { hour: pt.hour, minute: pt.minute, weekday: pt.weekday, month: pt.month, daylight: daylight };

  return (
    <div ref={rootRef} className="office-root">
      <div className="office-toolbar" role="toolbar" aria-label="Indicateurs et commandes du bureau">
        <ul className="office-counters" aria-label="Agents par état">
          {STATES.map((s) => (
            <li key={s} className="office-counter" title={STATE_LABEL_FR[s]}>
              {s === 'waiting' && approvalsWaiting > 0 && !editing ? (
                <button type="button" className="office-counter__btn" onClick={() => setSelectedId(APPROVALS_ID)} title="Ouvrir la salle d’attente des approbations">
                  <span className={`office-dot office-dot--${s}`} aria-hidden="true" /><b>{counts[s]}</b><span>{SHORT[s]}</span>
                </button>
              ) : (<><span className={`office-dot office-dot--${s}`} aria-hidden="true" /><b>{counts[s]}</b><span>{SHORT[s]}</span></>)}
            </li>
          ))}
        </ul>
        <div className="office-status" role="status" aria-live="polite">
          <span className={`office-conn office-conn--${connection}`}><i aria-hidden="true" />{CONNECTION_FR[connection]}</span>
          <span className="office-lastevent" title={last ? last.summary : undefined}>
            {last ? <>Dernier événement : <b className="office-mono">{last.type}</b>{lastAgent ? ` · ${lastAgent}` : ''} · {formatAgo(serverNow - Date.parse(last.ts))}</> : 'Aucun événement reçu depuis l’ouverture'}
          </span>
        </div>
        <div className="office-controls">
          <span className="office-seg office-levels" role="group" aria-label="Étage affiché">
            {LEVEL_FR.map((t, i) => (
              <button key={t} type="button" className="office-btn" aria-pressed={prefs.level === i} onClick={() => { update({ level: i }); setFollowId(null); }}
                title={`Afficher le ${LEVEL_LONG[i]}${i === 0 ? ' (accueil, régie, approbations, réunion, bibliothèque, serveur)' : ' (open spaces des agents, salle de repos)'}${levelCounts ? ` · ${levelCounts[i]} agent${levelCounts[i] > 1 ? 's' : ''} présent${levelCounts[i] > 1 ? 's' : ''}` : ''}`}>
                {t}{levelCounts ? <span className="office-levels__n" aria-label={`${levelCounts[i]} présents`}>{levelCounts[i]}</span> : null}
              </button>
            ))}
          </span>
          <span className="office-sep" aria-hidden="true" />
          <span className="office-group" role="group" aria-label="Affichage">
            <button type="button" className={`office-btn office-theme office-theme--${daylight > 0.5 ? 'day' : 'night'}`} onClick={() => update({ theme: THEME_NEXT[prefs.theme] })} title="Éclairage : automatique (heure de Paris), jour ou nuit" aria-label={`Éclairage : ${themeLabel} (cliquer pour changer)`}><i aria-hidden="true" />{themeLabel}</button>
            <button type="button" className="office-btn office-toggle" onClick={() => update({ social: !prefs.social })} aria-pressed={prefs.social} title="Vie sociale simulée localement (promenades, café, discussions fictives)">Vie sociale</button>
            <button type="button" className="office-btn office-toggle" onClick={() => update({ decor: !prefs.decor })} aria-pressed={prefs.decor} title="Animations décoratives (vapeur, respiration, voyants d'ambiance)">Animations</button>
            <button type="button" className="office-btn office-toggle" onClick={() => update({ showNames: !prefs.showNames })} aria-pressed={prefs.showNames} title="Étiquettes de nom au-dessus des agents">Noms</button>
          </span>
          <span className="office-sep" aria-hidden="true" />
          <span className="office-group" role="group" aria-label="Panneaux">
            <button type="button" className="office-btn office-toggle" onClick={() => update({ listOpen: !prefs.listOpen })} aria-pressed={prefs.listOpen} title="Liste des agents par département">Liste</button>
            <button type="button" className="office-btn office-toggle" onClick={() => setSelectedId(selectedId === FEED_ID ? null : FEED_ID)} aria-pressed={selectedId === FEED_ID} title="Fil : le réseau social de l’équipe">
              Fil{feedUnread > 0 && selectedId !== FEED_ID ? <span className="office-unread" aria-label={`${feedUnread} nouvelles publications`}>{feedUnread > 9 ? '9+' : feedUnread}</span> : null}
            </button>
            <button type="button" className="office-btn office-toggle" onClick={() => (editing ? cancelEdit() : startEdit())} aria-pressed={editing} title="Déplacer ou masquer le mobilier décoratif">Aménager</button>
          </span>
          <span className="office-sep" aria-hidden="true" />
          <span className="office-seg" role="group" aria-label="Zoom">
            <button type="button" className="office-btn" onClick={() => update({ zoomDelta: Math.max(MIN_ZOOM_DELTA, prefs.zoomDelta - 1) })} aria-label="Dézoomer">−</button>
            <button type="button" className="office-btn" onClick={() => { update({ zoomDelta: 0 }); setFollowId(null); setFitSignal((n) => n + 1); }} aria-label="Ajuster à la fenêtre">Ajuster</button>
            <button type="button" className="office-btn" onClick={() => update({ zoomDelta: Math.min(MAX_ZOOM_DELTA, prefs.zoomDelta + 1) })} aria-label="Zoomer">+</button>
          </span>
          <button type="button" className="office-btn" onClick={toggleFullscreen} aria-pressed={fullscreen}>{fullscreen ? 'Quitter' : 'Plein écran'}</button>
        </div>
      </div>

      <div className="office-main">
        {prefs.listOpen && (
          <div className="office-side">
            <AgentList agents={model.agents} departments={model.departments} selectedId={selectedId} onSelect={(id) => { if (!editing) setSelectedId(id); }} />
          </div>
        )}
        <div className="office-stage" ref={stageRef}>
          <OfficeCanvas
            model={model} layout={layout} profiles={profiles} themePref={prefs.theme} social={prefs.social && !model.control.paused} decor={prefs.decor}
            showNames={prefs.showNames} zoomDelta={prefs.zoomDelta} paused={model.control.paused} mail={mailbox.count}
            onZoomDelta={(d) => update({ zoomDelta: d })} fitSignal={fitSignal} insetRight={panelOpen ? INSPECTOR_W : editing ? 300 : 0} connection={connection} story={story}
            selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setHover(null); if (followId && id !== followId) setFollowId(null); }} onHover={setHover}
            followId={followId} onFollowEnd={() => setFollowId(null)} edit={edit} onDaylight={setDaylight}
            system={sys.info} staffInfo={staffInfo} devteam={devteam} society={society} deliveries={model.deliveries} agentName={agentNameOf} boards={boards}
            level={prefs.level} onLevel={(lv) => update({ level: lv })} onLevelCounts={setLevelCounts}
          />
          {hoverOrch && hover && !editing && (
            <div className="office-tip" style={{ left: hover.x + 14, top: hover.y + 14 }} role="tooltip">
              <b>Orchestrateur</b>
              <span>Noyau de RO·AI · distribue les exécutions (pas un agent IA)</span>
            </div>
          )}
          {hover && !editing && hover.id === FLOOR_ID && (
            <div className="office-tip" style={{ left: hover.x + 14, top: hover.y + 14 }} role="tooltip">
              <b>Escalier · ascenseur</b>
              <span>Cliquer pour aller au {LEVEL_LONG[prefs.level === 0 ? 1 : 0]}</span>
            </div>
          )}
          {hover && !editing && hover.id === MAILBOX_ID && (
            <div className="office-tip" style={{ left: hover.x + 14, top: hover.y + 14 }} role="tooltip">
              <b>Boîte aux lettres</b>
              <span>{mailbox.count ? `${mailbox.count} nouveau${mailbox.count > 1 ? 'x' : ''} rapport${mailbox.count > 1 ? 's' : ''} depuis ta dernière visite` : 'Aucun nouveau rapport'} : cliquer pour ouvrir la bibliothèque</span>
            </div>
          )}
          {hover && !editing && isDevId(hover.id) && (() => {
            const d = (devteam ?? []).find((x) => x.id === devSessionOf(hover.id));
            const a = d?.actions[d.actions.length - 1];
            return (
              <div className="office-tip" style={{ left: hover.x + 14, top: hover.y + 14 }} role="tooltip">
                <b>{d?.label ?? 'Claude Code'}</b>
                <span>Session de développement de RO·AI · {DEV_STATE_FR[d?.state ?? 'ended']}</span>
                {a && d?.state !== 'idle' && <span>{devActionText(a)}</span>}
              </div>
            );
          })()}
          {hover && !editing && (PLACE_TIP[hover.id] || isStaffId(hover.id)) && (
            <div className="office-tip" style={{ left: hover.x + 14, top: hover.y + 14 }} role="tooltip">
              <b>{PLACE_TIP[hover.id]?.[0] ?? (hover.id === STAFF_IDS.reception ? 'Accueil' : hover.id === STAFF_IDS.tech ? 'Technicien' : 'Entretien')}</b>
              <span>{PLACE_TIP[hover.id]?.[1] ?? 'Personnel figurant (non piloté par l’IA)'}</span>
            </div>
          )}
          {hovered && hover && !editing && (
            <div className="office-tip" style={{ left: hover.x + 14, top: hover.y + 14 }} role="tooltip">
              <b>{profiles[hovered.id]?.display_name || hovered.name}</b>
              <span>{hovered.department} · {STATE_LABEL_FR[hovered.state]}</span>
              {hovered.state === 'working' && hovered.toolKind && <span>{TOOL_KIND_LABEL_FR[hovered.toolKind]}{hovered.activity ? ` : ${hovered.activity}` : ''}</span>}
            </div>
          )}
          {!model.loaded && !error && <div className="office-overlay-msg" role="status">Chargement du bureau…</div>}
          {error && !model.loaded && (
            <div className="office-overlay-msg" role="alert">
              <p>Impossible de charger le bureau : {error}</p>
              <button type="button" className="office-btn" onClick={reload}>Réessayer</button>
            </div>
          )}
          {error && model.loaded && <div className="office-banner" role="alert">Synchronisation impossible ({error}). L'affichage peut être périmé.</div>}
          {model.loaded && model.agents.length === 0 && (
            <div className="office-empty" role="status">
              <b>Le bureau est vide.</b>
              <span>Aucun agent n'existe pour l'instant. <Link to="/agents/new">Créer un agent</Link> pour le voir apparaître ici.</span>
            </div>
          )}
          {editing && draft && (
            <EditorPanel
              layout={layout} overrides={draft} selectedKey={editKey} message={editMsg} saving={saving}
              onRotate={(k) => applyEdit(rotateFurniture(planInput, layout, k), 'Meuble pivoté.')}
              onHide={(k) => { applyEdit(hideFurniture(planInput, layout, k), 'Meuble masqué.'); setEditKey(null); }}
              onShow={(k) => { setDraft(showFurniture(draft, k)); setEditMsg({ text: 'Meuble réaffiché à sa place d’origine.', err: false }); }}
              onReset={() => { setDraft(EMPTY_OVERRIDES); setEditKey(null); setEditMsg({ text: 'Agencement par défaut (à enregistrer).', err: false }); }}
              onSave={() => void saveEdit()} onCancel={cancelEdit}
            />
          )}
          {!editing && serverOpen && <ServerPanel system={sys.info} at={sys.at} error={sys.error} providers={model.orch.providers} now={now} onClose={() => setSelectedId(null)} boards={boards} focusLimits={selectedId === LIMITS_ID} />}
          {!editing && selectedId === PLANNING_ID && <PlanningPanel boards={boards} at={boardsState.at} error={boardsState.error} now={now} onClose={() => setSelectedId(null)} onPickAgent={(id) => setSelectedId(id)} />}
          {!editing && selectedId === APPROVALS_ID && <ApprovalRoomPanel onClose={() => setSelectedId(null)} onPick={(id) => setSelectedId(id)} />}
          {!editing && selectedId === LIBRARY_ID && <LibraryPanel refreshKey={archiveRev} now={serverNow} onClose={() => setSelectedId(null)} onPickAgent={(id) => setSelectedId(id)} />}
          {!editing && selectedId === MEETING_ID && <MeetingPanel agents={model.agents} now={now} onClose={() => setSelectedId(null)} onPickAgent={(id) => { setChatFor(null); setSelectedId(id); }} onOpenChat={(id) => { setChatFor(id); setSelectedId(id); }} />}
          {/* arrêt d'urgence : le bandeau global du Control Center (avec « Reprendre ») suffit ; le bureau le montre par l'éclairage et la régie */}
          {!editing && selectedId === FEED_ID && <FeedPanel society={society} agents={model.agents} profiles={profiles} now={serverNow} onClose={() => setSelectedId(null)} onPickAgent={(id) => setSelectedId(id)} onChanged={reloadSociety} />}
          {!editing && isDevId(selectedId) && <DevPanel session={(devteam ?? []).find((x) => x.id === devSessionOf(selectedId!)) ?? null} now={serverNow} onClose={() => setSelectedId(null)} />}
          {!editing && (selectedId === STAFF_IDS.reception || selectedId === STAFF_IDS.cleaner) && <ReceptionPanel info={staffInfo} clock={staffClock} kind={selectedId === STAFF_IDS.reception ? 'reception' : 'cleaner'} onClose={() => setSelectedId(null)} />}
          {!editing && selectedId === ORCH_ID && <OrchestratorInspector model={model} connection={connection} now={now} onClose={() => setSelectedId(null)} />}
          {!editing && selected && (
            <Inspector
              key={selected.id} agent={selected} seq={model.seq} clockOffsetMs={model.clockOffsetMs}
              recent={model.recent[selected.id] ?? []} now={now} onClose={() => { setSelectedId(null); setFollowId(null); setChatFor(null); }}
              initialTab={chatFor === selected.id ? 'chat' : undefined}
              journal={society?.memory[selected.id] ?? []}
              profile={profiles[selected.id] ?? null} following={followId === selected.id}
              onFollow={(on: boolean) => setFollowId(on ? selected.id : null)} onProfileSaved={onProfileSaved}
            />
          )}
          <Legend open={prefs.legendOpen} onToggle={() => update({ legendOpen: !prefs.legendOpen })} />
        </div>
      </div>
    </div>
  );
}
