import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { Agent, CodexModel, Domain } from '../api/types';
import { Banner, Button, Empty, LoadError, Panel, Skeleton, Tag } from '../components/ui/primitives';
import { AgentBadges, AgentStateText, RunStatusTag } from '../components/ui/domain';
import { Field, Seg, Switch } from '../components/ui/forms';
import { ConfirmDialog } from '../components/ui/Modal';
import { Rel } from '../components/ui/Time';
import { IconPlay, IconTrash } from '../components/ui/icons';
import { useResource } from '../hooks/useResource';
import { useLaunch } from '../hooks/useLaunch';
import { useDocumentTitle } from '../hooks/useNow';
import { usePaused } from '../hooks/useControl';
import { STOP_BLOCKED_TEXT } from '../lib/control';
import { useEventListener, useLive, useLiveStore } from '../store/LiveProvider';
import { useToast } from '../store/toast';
import {
  agentToForm, agentToInput, CLAUDE_MODEL_SUGGESTIONS, codexModelInfo, effortChoices, EFFORT_LABEL, CLAUDE_TOOL_SUGGESTIONS, DEFAULT_MAX_RUNTIME_S, emptyForm, formToInput, hasWebhookInText, validateForm, type AgentForm, type FormErrors,
} from '../lib/agentForm';
import { formatSeconds, formatDuration } from '../lib/format';
import { ToolsEditor } from './agent/ToolsEditor';
import { McpEditor } from './agent/McpEditor';
import { DomainsEditor } from './agent/DomainsEditor';
import { WebhookField } from './agent/WebhookField';
import { UnrestrictedDialog } from './agent/UnrestrictedDialog';
import { SpritePicker } from './agent/SpritePicker';
import { generationErrorMessage } from '../office/ui/panel/profileForm';
import './AgentEdit.css';

// Fiche d'identité (Bureau virtuel) : chargée à la demande, elle embarque le dessin des portraits.
const IdentityPanel = lazy(() => import('./agent/IdentityPanel'));

export default function AgentEditPage() {
  const { id } = useParams();
  const isNew = !id;
  const res = useResource<Agent | null>(() => (id ? api.agent(id) : Promise.resolve(null)), [id]);
  useDocumentTitle(isNew ? 'Nouvel agent' : res.data?.name ?? 'Agent');
  if (!isNew && res.loading && !res.data) return <div className="page"><Panel><Skeleton rows={8} /></Panel></div>;
  if (!isNew && res.status === 404) return <div className="page"><div className="panel"><Empty title="Agent introuvable" actions={<Link to="/agents"><Button size="sm">Retour aux agents</Button></Link>}>Cet agent n’existe pas ou a été supprimé.</Empty></div></div>;
  if (!isNew && res.error && !res.data) return <div className="page"><LoadError message={res.error} onRetry={res.reload} /></div>;
  return <AgentEditor key={id ?? 'new'} agent={res.data ?? null} onSaved={(a) => res.setData(a)} />;
}

function AgentEditor({ agent, onSaved }: { agent: Agent | null; onSaved: (a: Agent) => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const store = useLiveStore();
  const live = useLive((s) => s.agents);
  const liveState = agent ? live?.find((a) => a.id === agent.id)?.state ?? agent.state : null;
  const initial = useMemo(() => (agent ? agentToForm(agent) : emptyForm()), [agent]);
  const [form, setForm] = useState<AgentForm>(initial);
  const [baseline, setBaseline] = useState(() => JSON.stringify(withoutKeys(initial)));
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmFree, setConfirmFree] = useState(false);
  const [confirmAuto, setConfirmAuto] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [coreDomain, setCoreDomain] = useState<Domain | null>(null);
  const location = useLocation();
  const [offerProfile, setOfferProfile] = useState(() => !!agent && !!(location.state as { created?: boolean } | null)?.created);
  const [identityOpen, setIdentityOpen] = useState(0);
  const dismissOffer = () => { setOfferProfile(false); nav(location.pathname, { replace: true, state: null }); };
  useEffect(() => { api.health().then((h) => { if (h.domain === 'perso' || h.domain === 'pro') { setCoreDomain(h.domain); if (!agent) { setForm((f) => ({ ...f, domain: h.domain as Domain })); setBaseline((b) => JSON.stringify({ ...JSON.parse(b), domain: h.domain })); } } }).catch(() => undefined); }, [agent]);
  const dirty = JSON.stringify(withoutKeys(form)) !== baseline;
  const set = <K extends keyof AgentForm>(k: K, v: AgentForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => { if (submitted) setErrors(validateForm(form)); }, [form, submitted]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const departments = useMemo(() => [...new Set((live ?? []).map((a) => a.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')), [live]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true); setServerError(null);
    const errs = validateForm(form);
    setErrors(errs);
    if (Object.keys(errs).length) {
      requestAnimationFrame(() => (formRef.current?.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus());
      return;
    }
    setSaving(true);
    try {
      const input = formToInput(form);
      const saved = agent ? await api.updateAgent(agent.id, input) : await api.createAgent(input);
      store.refetchAgents();
      toast.push('ok', agent ? 'Agent enregistré.' : `Agent « ${saved.name} » créé.`);
      const f = agentToForm(saved);
      setBaseline(JSON.stringify(withoutKeys(f))); setForm(f); setSubmitted(false);
      if (agent) onSaved(saved); else nav(`/agents/${saved.id}`, { replace: true, state: { created: true } });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Enregistrement impossible.');
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!agent) return;
    setDeleting(true);
    try { await api.deleteAgent(agent.id); store.refetchAgents(); toast.push('ok', `Agent « ${agent.name} » supprimé.`); setBaseline(JSON.stringify(withoutKeys(form))); nav('/agents', { replace: true }); }
    catch (err) { toast.push('err', err instanceof Error ? err.message : 'Suppression impossible.'); setDeleting(false); setConfirmDelete(false); }
  };

  const toggleEnabled = async (enabled: boolean) => {
    if (!agent) return;
    try { const saved = await api.updateAgent(agent.id, agentToInput(agent, { enabled })); store.refetchAgents(); onSaved(saved); setForm((f) => ({ ...f, enabled })); setBaseline((b) => JSON.stringify({ ...JSON.parse(b), enabled })); toast.push('ok', enabled ? 'Agent activé.' : 'Agent désactivé.'); }
    catch (err) { toast.push('err', err instanceof Error ? err.message : 'Modification impossible.'); }
  };

  const errList = Object.entries(errors);
  const runtime = Number(form.max_runtime_s);
  const isClaude = form.provider === 'claude';
  const [codexModels, setCodexModels] = useState<CodexModel[]>([]);
  useEffect(() => { if (!isClaude && codexModels.length === 0) api.codexModels().then((r) => setCodexModels(r.models)).catch(() => undefined); }, [isClaude, codexModels.length]);
  const cmInfo = codexModelInfo(codexModels, form.model, agent?.last_model);
  const efforts = effortChoices(cmInfo.model);
  const effortInvalid = !!form.reasoning_effort && !!cmInfo.model && !efforts.includes(form.reasoning_effort);

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__titles">
          <div className="micro page__crumb"><Link to="/agents">Agents</Link> / {agent ? agent.slug : 'nouveau'}</div>
          <h1 className="page__title">{agent ? agent.name : 'Nouvel agent'}{agent && liveState && <span style={{ fontSize: 13, fontFamily: 'var(--font-ui)', fontWeight: 400 }}><AgentStateText state={liveState} /></span>}{agent && <AgentBadges config={form.unrestricted || (form.network_domains.length > 0) ? { unrestricted: form.unrestricted, autonomous: form.unrestricted && form.autonomous, network_domains: form.network_domains } : agent.config} />}</h1>
          <p className="page__sub">{agent ? 'Configuration complète de l’agent. Les changements s’appliquent aux prochaines exécutions.' : 'Définissez le moteur, la mission et les garde-fous de ce nouvel agent.'}</p>
        </div>
        <div className="page__actions">
          {agent && <Link to={`/agents/${agent.id}/chat`}><Button>Parler</Button></Link>}
          {dirty && <Tag tone="amber">Modifications non enregistrées</Tag>}
          <Button onClick={() => nav('/agents')}>{dirty ? 'Abandonner' : 'Retour'}</Button>
          <Button type="submit" form="agent-form" variant="primary" busy={saving}>{agent ? 'Enregistrer' : 'Créer l’agent'}</Button>
        </div>
      </div>

      {offerProfile && agent && <ProfileOffer agent={agent} onDismiss={dismissOffer} onCustomize={() => { setIdentityOpen((n) => n + 1); dismissOffer(); }} />}
      {serverError && <div style={{ marginBottom: 16 }}><Banner tone="err" title="Le serveur a refusé la configuration">{serverError}</Banner></div>}
      {submitted && errList.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="err" title={`${errList.length} champ(s) à corriger`}>
            <ul style={{ margin: 0, paddingLeft: 16, listStyle: 'disc' }}>{errList.map(([k, m]) => <li key={k}>{m}</li>)}</ul>
          </Banner>
        </div>
      )}

      <div className="agedit">
        <form id="agent-form" ref={formRef} onSubmit={save} noValidate className="agedit__form">
          <Panel title="Identité" id="f-identity">
            <div className="form-grid">
              <Field label="Nom" required error={errors.name}><input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={140} autoFocus={!agent} /></Field>
              <Field label="Identifiant (slug)" hint={agent ? 'Utilisé dans les URL et les journaux.' : 'Facultatif : généré à partir du nom si vide.'} error={errors.slug}><input className="input input--mono" value={form.slug} onChange={(e) => set('slug', e.target.value)} placeholder="veille-techno" spellCheck={false} /></Field>
              <Field label="Description" className="span-2"><input className="input" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Ce que fait cet agent, en une phrase" /></Field>
              <Field label="Département" required hint="Regroupe les agents, notamment dans le Bureau virtuel." error={errors.department}>
                <input className="input" list="dept-list" value={form.department} onChange={(e) => set('department', e.target.value)} />
              </Field>
              <datalist id="dept-list">{departments.map((d) => <option key={d} value={d} />)}</datalist>
              <div className="field"><span className="field__label" id="dom-l">Domaine</span><Seg name="domain" label="Domaine" value={form.domain} onChange={(v) => set('domain', v)} options={[{ value: 'perso', label: 'Perso' }, { value: 'pro', label: 'Pro' }]} /><div className="field__hint">Étiquette d'organisation : les agents pro et perso utilisent les mêmes comptes fournisseurs.{coreDomain ? ` Par défaut : « ${coreDomain} ».` : ''}</div></div>
              <div className="field span-2"><span className="field__label">Avatar</span><SpritePicker value={form.sprite} onChange={(n) => set('sprite', n)} /><div className="field__hint">Profil affiché dans le Bureau virtuel (aperçu schématique).</div></div>
            </div>
          </Panel>

          <Panel title="Moteur" id="f-engine">
            <div className="form-grid">
              <div className="field"><span className="field__label">Fournisseur</span><Seg name="provider" label="Fournisseur" value={form.provider} onChange={(v) => set('provider', v)} options={[{ value: 'claude', label: 'Claude' }, { value: 'codex', label: 'Codex' }]} /><div className="field__hint">Client officiel piloté via l’abonnement connecté (voir « Fournisseurs »).</div></div>
              <Field label="Modèle" hint={agent?.last_model
                ? <>Dernière exécution : <span className="mono">{agent.last_model}</span>. Laissez vide pour suivre le modèle par défaut du fournisseur.</>
                : 'Laissez vide pour le modèle par défaut du fournisseur. Le modèle réellement utilisé s’affichera après la première exécution.'}>
                <input className="input input--mono" list={isClaude ? 'model-list' : 'codex-model-list'} value={form.model} onChange={(e) => set('model', e.target.value)}
                  placeholder={agent?.last_model && !agent.model ? `par défaut (${agent.last_model})` : 'par défaut'} spellCheck={false} />
              </Field>
              {isClaude && <datalist id="model-list">{CLAUDE_MODEL_SUGGESTIONS.map((m) => <option key={m} value={m} />)}</datalist>}
              {!isClaude && <datalist id="codex-model-list">{codexModels.map((m) => <option key={m.slug} value={m.slug}>{`${m.name} — ${m.description}`}</option>)}</datalist>}
              {!isClaude && (
                <Field label="Effort de raisonnement" error={effortInvalid ? `${cmInfo.model?.slug} n’accepte pas ce niveau` : undefined}
                  hint={<>Plus l’effort est élevé, plus le modèle réfléchit et plus il consomme de quota.{cmInfo.model && <> <span className="mono">{cmInfo.model.slug}</span>{cmInfo.isDefault ? ' (défaut)' : ''} : {cmInfo.model.description}</>}</>}>
                  <select className="select" value={form.reasoning_effort} onChange={(e) => set('reasoning_effort', e.target.value as typeof form.reasoning_effort)} aria-label="Effort de raisonnement">
                    <option value="">{cmInfo.model?.default_effort ? `Par défaut (${EFFORT_LABEL[cmInfo.model.default_effort].toLowerCase()})` : 'Par défaut'}</option>
                    {efforts.map((e) => <option key={e} value={e}>{EFFORT_LABEL[e]}</option>)}
                    {effortInvalid && <option value={form.reasoning_effort}>{EFFORT_LABEL[form.reasoning_effort as keyof typeof EFFORT_LABEL]} (non pris en charge)</option>}
                  </select>
                </Field>
              )}
            </div>
          </Panel>

          <Panel title="Mission et prompt" id="f-mission">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {hasWebhookInText(form.mission, form.default_prompt) && <Banner tone="warn" title="Adresse de webhook détectée">La mission contient une adresse de webhook : retirez-la et utilisez le champ dédié (section « Exécution »). Elle serait envoyée au fournisseur d’IA.</Banner>}
              <Field label="Mission" required hint="Consignes permanentes : ajoutées au système à chaque exécution (rôle, ton, limites)." error={errors.mission}><textarea className="textarea" rows={7} value={form.mission} onChange={(e) => set('mission', e.target.value)} /></Field>
              <Field label="Prompt par défaut" hint="Utilisé quand une exécution est lancée sans prompt explicite (planification, API)."><textarea className="textarea" rows={4} value={form.default_prompt} onChange={(e) => set('default_prompt', e.target.value)} /></Field>
            </div>
          </Panel>

          <Panel title="Permissions" id="f-perms">
            {isClaude ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Field label="Mode de permissions" hint={{ dontAsk: 'Aucune question posée : tout outil hors de la liste autorisée est refusé.', acceptEdits: 'Les modifications de fichiers sont acceptées automatiquement ; les autres outils suivent la liste autorisée.', plan: 'Lecture seule : l’agent propose un plan sans rien exécuter.' }[form.permission_mode]}>
                  <select className="select" value={form.permission_mode} onChange={(e) => set('permission_mode', e.target.value as AgentForm['permission_mode'])}>
                    <option value="dontAsk">dontAsk — refuser ce qui n’est pas autorisé</option>
                    <option value="acceptEdits">acceptEdits — accepter les éditions</option>
                    <option value="plan">plan — planifier sans agir</option>
                  </select>
                </Field>
                <div className="field"><span className="field__label">Outils autorisés</span>
                  <ToolsEditor value={form.allowed_tools} onChange={(v) => set('allowed_tools', v)} suggestions={CLAUDE_TOOL_SUGGESTIONS} error={errors.allowed_tools} />
                  <div className="field__hint">Noms d’outils ou motifs, ex. <code>Read</code>, <code>WebFetch</code>, <code>Bash(git status *)</code>.</div>
                </div>
                <div className="field"><span className="field__label">Mode léger</span>
                  <Switch checked={form.lean} onChange={(v) => set('lean', v)}>Économiser les jetons</Switch>
                  <div className="field__hint">La mission remplace les longues consignes système de Claude Code et seuls les outils autorisés sont chargés : environ 15 fois moins de jetons par message. Idéal pour un agent de texte (relecture, rédaction) ; à éviter pour un agent qui enchaîne beaucoup d’outils.</div>
                </div>
                {form.lean && (
                  <Field label="Fichier mémoire" hint="Fichier de son dossier de travail (ex. style.md) joint à ses consignes à chaque message. Pour le mettre à jour, l’agent renvoie un bloc <<<MEMOIRE … MEMOIRE>>> que RO·AI enregistre (16 Kio au plus)." error={errors.memory_file}>
                    <input className="input input--mono" value={form.memory_file} placeholder="style.md" onChange={(e) => set('memory_file', e.target.value)} />
                  </Field>
                )}
              </div>
            ) : (
              <div className="field"><span className="field__label">Bac à sable</span>
                <Seg name="sandbox" label="Bac à sable" value={form.sandbox} onChange={(v) => set('sandbox', v)} options={[{ value: 'read-only', label: 'Lecture seule' }, { value: 'workspace-write', label: 'Écriture dans l’espace de travail' }]} />
                <div className="field__hint">{form.sandbox === 'read-only' ? 'Codex peut lire mais ne modifie aucun fichier.' : 'Codex peut écrire dans l’espace de travail de l’agent, pas ailleurs.'}</div>
                <div className="field" style={{ marginTop: 14 }}><span className="field__label">Recherche web</span>
                  <Switch checked={form.web_search} onChange={(v) => set('web_search', v)}>Autoriser la recherche web</Switch>
                  <div className="field__hint">Pour une veille : Codex cherche et cite ses sources via l’outil de recherche d’OpenAI. Les commandes shell de l’agent restent sans accès au réseau.</div>
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Réseau et autonomie" id="f-net">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div className="field"><span className="field__label">Domaines autorisés</span>
                <DomainsEditor value={form.network_domains} onChange={(v) => set('network_domains', v)} error={errors.network_domains} />
                <div className="field__hint">Le bac à sable reste actif : l’agent peut joindre uniquement ces domaines. Sans domaine, aucun accès réseau. Claude : l’outil Bash est ajouté automatiquement s’il manque (toujours sandboxé). Codex : le bac à sable passe en écriture dans l’espace de travail (nécessaire au réseau). La recherche web de Codex reste indépendante.</div>
              </div>
              <div className="field freemode"><span className="field__label">Mode libre</span>
                <Switch danger checked={form.unrestricted} onChange={(v) => { if (v) setConfirmFree(true); else { set('unrestricted', false); set('autonomous', false); } }}>Mode libre (dernier recours)</Switch>
                <div className="field__hint">{form.unrestricted ? (form.autonomous ? 'Actif en mode autonome : aucun bac à sable ni restriction d’outils, et aucune approbation.' : 'Actif : aucun bac à sable ni restriction d’outils. Approbation humaine obligatoire avant chaque lancement.') : 'Retire le bac à sable et les restrictions d’outils. À n’utiliser qu’en dernier recours : une confirmation détaillée est demandée.'}</div>
                {form.unrestricted && <Banner tone="err" title="Mode libre actif">Le mode permissions, les outils autorisés, le bac à sable et les domaines ci-dessus ne s’appliquent plus. L’agent peut atteindre tout ce que l’utilisateur système <code>agent</code> peut atteindre.</Banner>}
                {form.unrestricted && (
                  <div className="field">
                    <Switch danger checked={form.autonomous} onChange={(v) => { if (v) setConfirmAuto(true); else { set('autonomous', false); set('require_approval', true); } }}>Mode autonome : lancer sans approbation</Switch>
                    <div className="field__hint">{form.autonomous ? 'Les lancements (manuels, planifiés, conversations, Discord) partent sans attendre votre accord.' : 'Désactivé : chaque lancement attend votre approbation.'}</div>
                  </div>
                )}
              </div>
            </div>
          </Panel>

          <Panel title="Exécution" id="f-exec">
            <div className="form-grid">
              <Field label="Durée maximale (secondes)" hint={`Défaut : ${DEFAULT_MAX_RUNTIME_S} s (${formatSeconds(DEFAULT_MAX_RUNTIME_S)}).${Number.isInteger(runtime) && runtime > 0 ? ` Soit ${formatSeconds(runtime)}.` : ''}`} error={errors.max_runtime_s}>
                <input className="input input--mono" inputMode="numeric" value={form.max_runtime_s} onChange={(e) => set('max_runtime_s', e.target.value.replace(/[^\d.]/g, ''))} placeholder={String(DEFAULT_MAX_RUNTIME_S)} />
              </Field>
              <div className="field"><span className="field__label">Approbation</span><Switch checked={form.require_approval || (form.unrestricted && !form.autonomous)} disabled={form.unrestricted && !form.autonomous} onChange={(v) => set('require_approval', v)}>Exiger une approbation avant chaque lancement</Switch><div className="field__hint">{form.unrestricted && !form.autonomous ? 'Imposée par le mode libre : activez le mode autonome (section « Réseau et autonomie ») pour la retirer.' : 'L’exécution reste « en attente d’approbation » jusqu’à validation humaine.'}</div></div>
              <div className="field span-2"><span className="field__label">Rapport Discord</span><Switch checked={form.discord_report} onChange={(v) => set('discord_report', v)}>Envoyer le rapport complet sur Discord à la fin</Switch><div className="field__hint">RO·AI envoie lui-même le résultat de chaque exécution réussie (webhook ou bot, voir Paramètres) : l’agent n’a pas à le faire et ne doit pas recevoir l’adresse du webhook dans sa mission.</div></div>
              <div className="field span-2"><span className="field__label">Résumé Discord</span><Switch checked={form.discord_brief} onChange={(v) => set('discord_brief', v)}>Envoyer seulement le résumé qu’il marque</Switch><div className="field__hint">Si sa réponse se termine par un bloc <code>{'<<<DISCORD'}</code> … <code>{'DISCORD>>>'}</code>, RO·AI le retire du rapport et l’envoie seul sur Discord, avec le lien vers le rapport complet (1 800 caractères au plus). Sans bloc, rien n’est envoyé : précisez dans sa mission quand l’écrire. Aucun appel IA de plus.</div></div>
              {(form.discord_report || form.discord_brief) && (<>
                <div className="field span-2"><span className="field__label">Format Discord</span>
                  <select className="select" value={form.discord_style} onChange={(e) => set('discord_style', e.target.value as 'embed' | 'text' | 'both')}>
                    <option value="embed">Embed (carte colorée avec titre et lien)</option>
                    <option value="text">Classique (message texte normal)</option>
                    <option value="both">Les deux (pour comparer)</option>
                  </select>
                  <div className="field__hint">S’applique aux envois par webhook. Sans webhook, le bot RO·AI envoie toujours des embeds.</div>
                </div>
                <div className="field span-2"><span className="field__label">Salon public</span>
                  <Switch checked={form.discord_public} onChange={(v) => set('discord_public', v)}>Publier comme un message public</Switch>
                  <div className="field__hint">Pour un salon ouvert à la communauté : la première ligne du rapport sert de titre, sans lien vers RO·AI, sans signature RO·AI ; le nom et l’avatar sont ceux du webhook (réglés dans Discord).</div>
                </div>
              </>)}
              
              <WebhookField agent={agent} />
              <div className="field span-2"><span className="field__label">État</span><Switch checked={form.enabled} onChange={(v) => set('enabled', v)}>Agent actif</Switch><div className="field__hint">Un agent désactivé ne peut être ni lancé ni planifié.</div></div>
            </div>
          </Panel>

          <Panel title="Serveurs MCP" id="f-mcp" meta={<span className="num">{form.mcp.length}</span>}>
            <McpEditor rows={form.mcp} onChange={(r) => set('mcp', r)} errors={errors} />
          </Panel>
        </form>

        <aside className="agedit__side">
          {agent && <LaunchPanel agent={agent} dirty={dirty} />}
          {agent && <AgentRuns agentId={agent.id} />}
          {agent && <Suspense fallback={<Panel title="Fiche d’identité"><Skeleton rows={3} /></Panel>}><IdentityPanel agent={agent} openSignal={identityOpen} /></Suspense>}
          {agent && (
            <Panel title="Activation" id="s-enable">
              <Switch checked={agent.enabled} onChange={(v) => void toggleEnabled(v)}>{agent.enabled ? 'Agent actif' : 'Agent désactivé'}</Switch>
              <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>Appliqué immédiatement, sans toucher aux autres champs du formulaire.</p>
            </Panel>
          )}
          {agent && (
            <Panel title="Zone sensible" id="s-danger" tone="err">
              <p className="dim" style={{ fontSize: 12.5, marginBottom: 10 }}>La suppression est définitive. L’historique des exécutions et des planifications associées peut être supprimé avec l’agent.</p>
              <Button variant="danger" onClick={() => setConfirmDelete(true)}><IconTrash />Supprimer l’agent</Button>
            </Panel>
          )}
          {!agent && <Panel title="Avant de commencer"><p className="dim" style={{ fontSize: 12.5 }}>Après la création, vous pourrez lancer l’agent avec un prompt libre, consulter ses exécutions et le planifier depuis « Planifications ».</p></Panel>}
        </aside>
      </div>

      {confirmAuto && (
        <ConfirmDialog title="Activer le mode autonome" danger confirmLabel="Lancer sans approbation" onCancel={() => setConfirmAuto(false)}
          onConfirm={() => { set('autonomous', true); set('require_approval', false); setConfirmAuto(false); }}>
          <p>En mode libre, l’approbation est le <strong>dernier garde-fou</strong> : sans elle, l’agent agit sans bac à sable <strong>dès qu’il est lancé</strong>, y compris par une planification ou un message Discord.</p>
          <p>Une page web piégée pourrait alors lui faire exécuter des actions sans que vous les voyiez passer. Restent actifs : pas de root, limites de mémoire et de durée, secrets de RO·AI inaccessibles, arrêt d’urgence.</p>
          <p>L’activation est enregistrée dans le journal.</p>
        </ConfirmDialog>
      )}
      {confirmFree && <UnrestrictedDialog onCancel={() => setConfirmFree(false)} onConfirm={() => { set('unrestricted', true); set('require_approval', true); setConfirmFree(false); }} />}
      {confirmDelete && agent && (
        <ConfirmDialog title="Supprimer l’agent" danger confirmLabel="Supprimer définitivement" busy={deleting} onCancel={() => setConfirmDelete(false)} onConfirm={() => void remove()}>
          Vous allez supprimer <strong>{agent.name}</strong>. Cette action est irréversible.
        </ConfirmDialog>
      )}
    </div>
  );
}

/** Après la création : proposition facultative et non bloquante de générer la fiche d'identité (jamais automatique). */
function ProfileOffer({ agent, onDismiss, onCustomize }: { agent: Agent; onDismiss: () => void; onCustomize: () => void }) {
  const paused = usePaused();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generate = async () => {
    setBusy(true); setError(null);
    try {
      await api.generateAgentProfile(agent.id, false);
      toast.push('info', 'Génération de la fiche lancée : elle apparaîtra dans « Fiche d’identité » dès qu’elle sera prête.');
      onDismiss();
    } catch (e) {
      setError(generationErrorMessage(e instanceof ApiError ? e.status : undefined, e instanceof Error ? e.message : ''));
    } finally { setBusy(false); }
  };
  const provider = agent.provider === 'codex' ? 'Codex' : 'Claude';
  return (
    <div style={{ marginBottom: 16 }}>
      <Banner tone="info" title="Donner une identité à cet agent ? (facultatif)" actions={
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button size="sm" variant="primary" busy={busy} disabled={paused} title={paused ? STOP_BLOCKED_TEXT : undefined} onClick={() => void generate()}>Générer la fiche avec l’IA</Button>
          <Button size="sm" onClick={onCustomize} disabled={busy}>Personnaliser à la main</Button>
          <Button size="sm" variant="ghost" onClick={onDismiss} disabled={busy}>Plus tard</Button>
        </div>
      }>
        Dans le Bureau virtuel, chaque agent a une fiche décorative (nom affiché, fonction, histoire, apparence, bureau). Une fiche par défaut existe déjà ;
        {' '}{provider} peut en rédiger une plus vivante, une seule fois, pour quelques milliers de jetons de l’abonnement. Elle n’est jamais transmise à l’agent.
        {paused && <><br />{STOP_BLOCKED_TEXT}</>}
        {error && <><br /><span style={{ color: 'var(--err-text)' }}>{error}</span></>}
      </Banner>
    </div>
  );
}

function withoutKeys(f: AgentForm) { return { ...f, mcp: f.mcp.map(({ key: _k, ...r }) => r) }; }

function LaunchPanel({ agent, dirty }: { agent: Agent; dirty: boolean }) {
  const { launch, busy, error } = useLaunch();
  const paused = usePaused();
  const [prompt, setPrompt] = useState('');
  return (
    <Panel title="Lancer" id="s-launch">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Field label="Prompt libre" hint={agent.default_prompt ? 'Vide : le prompt par défaut est utilisé.' : 'Aucun prompt par défaut : saisissez la demande.'}>
          <textarea className="textarea" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void launch(agent.id, prompt); }} />
        </Field>
        {dirty && <Banner tone="warn">Les modifications non enregistrées ne sont pas prises en compte.</Banner>}
        {!agent.enabled && <Banner tone="warn">Agent désactivé.</Banner>}
        {paused && <Banner tone="err">{STOP_BLOCKED_TEXT}</Banner>}
        {error && <Banner tone="err">{error}</Banner>}
        <Button variant="primary" busy={busy} disabled={!agent.enabled || paused} title={paused ? STOP_BLOCKED_TEXT : undefined} onClick={() => void launch(agent.id, prompt)}><IconPlay />Lancer</Button>
      </div>
    </Panel>
  );
}

function AgentRuns({ agentId }: { agentId: string }) {
  const res = useResource(() => api.runs({ agent_id: agentId, limit: 8 }), [agentId]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEventListener((e) => {
    if (e.agent_id !== agentId || !e.type.startsWith('run.')) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(res.reload, 500);
  });
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <Panel title="Dernières exécutions" id="s-runs" flush meta={<Link to={`/runs?agent_id=${agentId}`}>Tout voir</Link>}>
      {res.loading && !res.data ? <Skeleton rows={3} />
        : res.error && !res.data ? <div style={{ padding: 12 }}><LoadError message={res.error} onRetry={res.reload} /></div>
        : !res.data || res.data.length === 0 ? <Empty title="Aucune exécution" glyph={false}>Cet agent n’a pas encore été lancé.</Empty>
        : (
          <ul className="miniruns">
            {res.data.map((r) => (
              <li key={r.id}>
                <Link to={`/runs/${r.id}`} className="minirun">
                  <RunStatusTag status={r.status} />
                  <span className="dim"><Rel iso={r.created_at} /></span>
                  <span className="num dim minirun__dur">{r.status === 'running' ? 'en cours' : formatDuration(r.duration_ms)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
    </Panel>
  );
}
