// Éditeur de fiche d'identité (réutilisable : panneau du bureau, page de configuration de l'agent).
// Tout contenu de fiche est affiché et édité comme du texte brut.
import './panel.css';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '../../../api/client';
import type { Accessory, AgentProfile, Appearance, Decor, DecorTheme, Personality, ProviderId } from '../../../api/types';
import { Banner, Button, Tag } from '../../../components/ui/primitives';
import { Field } from '../../../components/ui/forms';
import { ConfirmDialog } from '../../../components/ui/Modal';
import { usePaused } from '../../../hooks/useControl';
import { useToast } from '../../../store/toast';
import { formatDateTime, formatNumber } from '../../../lib/format';
import { PROVIDER_LABEL } from '../../../lib/labels';
import { Portrait } from '../Portrait.tsx';
import { Overlay } from './Overlay.tsx';
import type { ProfileController } from './useAgentProfile.ts';
import {
  ACCESSORIES, ACCESSORY_LABEL, ALL_ITEMS, ALL_PARTS, APPEARANCE_LABEL, APPEARANCE_RANGE, DECOR_ACCENT_LABEL, DECOR_ACCENT_SWATCHES, ITEM_LABEL, LIMITS, LIST_LABEL,
  PERSONALITY_KEYS, PERSONALITY_LABEL, PERSONALITY_NOTE, SOURCE_HINT, SOURCE_LABEL, THEMES, THEME_ITEMS, THEME_LABEL,
  addListItems, formToInput, generationTokens, listLimits, mergeParts, profileInput, profileToForm, suggestedItems, toggleItem, validateProfileForm,
  type ListKey, type ProfileErrors, type ProfileForm, type ProfilePart,
} from './profileForm.ts';

const provName = (p: ProviderId | null | undefined) => (p ? PROVIDER_LABEL[p] ?? p : 'le fournisseur de l’agent');

// --- Génération IA (facultative, unique, jamais automatique) ---------------------------------------------------
export function GenerationBox({ ctl, provider, dirty, compact }: { ctl: ProfileController; provider: ProviderId | null; dirty?: boolean; compact?: boolean }) {
  const paused = usePaused();
  const toast = useToast();
  const [confirm, setConfirm] = useState<null | 'first' | 'again'>(null);
  const [busy, setBusy] = useState(false);
  const p = ctl.profile;
  if (!p) return null;
  const running = ctl.gen.phase === 'running' || p.generating;
  const already = p.source === 'generated';
  const usedProvider = p.generation?.provider ?? provider;
  const tok = generationTokens(p.generation);
  const go = async (force: boolean) => {
    setBusy(true);
    const ok = await ctl.generate(force);
    setBusy(false); setConfirm(null);
    if (ok) toast.push('info', 'Génération de la fiche lancée : elle s’affichera dès qu’elle sera prête.');
  };
  const doneTok = ctl.gen.phase === 'done' ? (ctl.gen.inputTokens ?? 0) + (ctl.gen.outputTokens ?? 0) : null;
  return (
    <div className={`cp-gen${compact ? ' cp-gen--compact' : ''}`} aria-live="polite">
      <div className="cp-gen__row">
        <div className="cp-gen__text">
          <b>Générer la fiche avec l’IA</b>
          <span className="faint">
            {already
              ? <>Générée le {formatDateTime(p.generated_at)} par {provName(p.generation?.provider)}{p.generation?.model ? <> · <span className="mono">{p.generation.model}</span></> : null}
                {tok.total != null && <> · {formatNumber(tok.total)} jetons ({formatNumber(tok.input)} en entrée, {formatNumber(tok.output)} en sortie)</>}.</>
              : <>Facultatif et unique : {provName(provider)} rédige une fiche cohérente avec la mission (quelques milliers de jetons de l’abonnement). Rien n’est jamais généré automatiquement.</>}
          </span>
        </div>
        {!already && (
          <Button size="sm" variant="primary" busy={busy} disabled={running || paused} title={paused ? 'Arrêt d’urgence actif' : undefined} onClick={() => setConfirm('first')}>
            {running ? 'Génération en cours…' : 'Générer la fiche avec l’IA'}
          </Button>
        )}
        {already && (
          <Button size="sm" busy={busy} disabled={running || paused} onClick={() => setConfirm('again')}>{running ? 'Génération en cours…' : 'Régénérer…'}</Button>
        )}
      </div>
      {running && <div className="cp-gen__status"><span className="spinner" aria-hidden="true" /> Génération en cours via {provName(ctl.gen.provider ?? usedProvider)}… La fiche se mettra à jour toute seule.</div>}
      {paused && !running && <div className="cp-gen__status faint">Arrêt d’urgence actif : génération indisponible jusqu’à la reprise.</div>}
      {ctl.requestError && <Banner tone="err" title="Génération refusée">{ctl.requestError}</Banner>}
      {ctl.gen.phase === 'failed' && (
        <Banner tone="err" title="La génération a échoué" actions={<Button size="sm" variant="ghost" onClick={ctl.clearGen}>Fermer</Button>}>
          {provName(ctl.gen.provider)} n’a pas produit de fiche exploitable ; la fiche actuelle est conservée.
          {ctl.gen.error && <><br /><span className="faint">Détail : </span><span className="untrusted">{ctl.gen.error}</span></>}
        </Banner>
      )}
      {ctl.gen.phase === 'done' && (
        <Banner tone="ok" title="Fiche générée" actions={<Button size="sm" variant="ghost" onClick={ctl.clearGen}>Fermer</Button>}>
          Par {provName(ctl.gen.provider)}{ctl.gen.model ? ` (${ctl.gen.model})` : ''}{doneTok ? ` · ${formatNumber(doneTok)} jetons consommés` : ''}. Vous pouvez la retoucher à la main.
        </Banner>
      )}
      {confirm && (
        <Overlay>
          <ConfirmDialog title={confirm === 'again' ? 'Régénérer la fiche d’identité' : 'Générer la fiche d’identité'} confirmLabel={confirm === 'again' ? 'Régénérer' : 'Générer'}
            busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void go(confirm === 'again')}>
            <p>{provName(provider)} va rédiger une fiche (nom affiché, fonction, histoire, apparence, bureau) à partir du nom, du département et de la mission de l’agent.</p>
            <p>Cela consomme <strong>un peu de quota d’abonnement</strong> (quelques milliers de jetons), une seule fois, sans outil ni accès au système.</p>
            {confirm === 'again' && <p><strong>La fiche actuelle sera remplacée</strong>, y compris vos retouches manuelles.</p>}
            {dirty && <p>Vos modifications non enregistrées seront perdues quand la nouvelle fiche arrivera.</p>}
          </ConfirmDialog>
        </Overlay>
      )}
    </div>
  );
}

// --- Champs -------------------------------------------------------------------------------------------------------
function ListEditor({ k, value, onChange, error }: { k: ListKey; value: string[]; onChange: (v: string[]) => void; error?: string }) {
  const [draft, setDraft] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const id = useId();
  const { max, len } = listLimits(k);
  const add = () => {
    if (!draft.trim()) return;
    const r = addListItems(value, draft, k);
    onChange(r.list); setMsg(r.rejected); if (!r.rejected) setDraft('');
  };
  return (
    <div className="field cp-list">
      <label className="field__label" htmlFor={id}><span>{LIST_LABEL[k]}</span><span className="cp-count">{value.length}/{max}</span></label>
      {value.length > 0 && (
        <ul className="chips" aria-label={LIST_LABEL[k]}>
          {value.map((t) => <li key={t} className="chip cp-chip"><span>{t}</span><button type="button" aria-label={`Retirer ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>×</button></li>)}
        </ul>
      )}
      {value.length < max && (
        <div className="cp-list__add">
          <input id={id} className="input" value={draft} maxLength={len * 3} placeholder={`Ajouter (${len} car. max)…`} aria-invalid={error ? true : undefined}
            onChange={(e) => { setDraft(e.target.value); setMsg(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <Button size="sm" onClick={add} disabled={!draft.trim()}>Ajouter</Button>
        </div>
      )}
      {(error || msg) && <div className="field__err" role="alert">{error ?? msg}</div>}
    </div>
  );
}

function Counter({ v, max }: { v: string; max: number }) {
  const n = v.trim().length;
  return <span className={`cp-count${n > max ? ' is-err' : ''}`}>{n}/{max}</span>;
}

export function PersonalitySliders({ value, onChange }: { value: Personality; onChange: (v: Personality) => void }) {
  return (
    <div className="cp-sliders">
      <p className="cp-note">{PERSONALITY_NOTE}</p>
      {PERSONALITY_KEYS.map((k) => {
        const L = PERSONALITY_LABEL[k];
        const pct = Math.round(value[k] * 100);
        return (
          <label key={k} className="cp-slider" title={L.hint}>
            <span className="cp-slider__head"><b>{L.label}</b><span className="faint">{L.hint}</span></span>
            <span className="cp-slider__row">
              <span className="cp-slider__end">{L.low}</span>
              <input type="range" min={0} max={100} step={5} value={pct} aria-valuetext={`${pct} %`} onChange={(e) => onChange({ ...value, [k]: Number(e.target.value) / 100 })} />
              <span className="cp-slider__end">{L.high}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

const APP_KEYS = ['skin', 'hair', 'hair_style', 'outfit'] as const;
export function AppearancePicker({ value, onChange, sprite }: { value: Appearance; onChange: (v: Appearance) => void; sprite: number }) {
  const name = useId();
  return (
    <div className="cp-appear">
      <div className="cp-appear__preview" aria-label="Aperçu">
        <Portrait sprite={sprite} size={96} appearance={value} />
        <span className="faint">Aperçu en direct</span>
      </div>
      <div className="cp-appear__groups">
        {APP_KEYS.map((k) => (
          <fieldset key={k} className="cp-opts">
            <legend>{APPEARANCE_LABEL[k]}</legend>
            <div className="cp-opts__grid">
              {Array.from({ length: APPEARANCE_RANGE[k] }, (_, i) => (
                <label key={i} className="cp-opt" title={`${APPEARANCE_LABEL[k]} ${i + 1}`}>
                  <input type="radio" name={`${name}-${k}`} checked={value[k] === i} onChange={() => onChange({ ...value, [k]: i })} aria-label={`${APPEARANCE_LABEL[k]} ${i + 1}`} />
                  <span className="cp-opt__face"><Portrait sprite={sprite} size={30} appearance={{ ...value, [k]: i }} /></span>
                  <span className="cp-opt__n" aria-hidden="true">{i + 1}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <fieldset className="cp-opts">
          <legend>Accessoire</legend>
          <div className="cp-opts__grid">
            {ACCESSORIES.map((a: Accessory) => (
              <label key={a} className="cp-opt cp-opt--wide" title={ACCESSORY_LABEL[a]}>
                <input type="radio" name={`${name}-acc`} checked={value.accessory === a} onChange={() => onChange({ ...value, accessory: a })} />
                <span className="cp-opt__face"><Portrait sprite={sprite} size={30} appearance={{ ...value, accessory: a }} /></span>
                <span className="cp-opt__n">{ACCESSORY_LABEL[a]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </div>
  );
}

export function DecorPicker({ value, onChange, error }: { value: Decor; onChange: (v: Decor) => void; error?: string }) {
  const name = useId();
  const sugg = suggestedItems(value.theme, value.items);
  const others = ALL_ITEMS.filter((i) => !THEME_ITEMS[value.theme].includes(i));
  const full = value.items.length >= LIMITS.decorItems;
  const itemBtn = (i: (typeof ALL_ITEMS)[number]) => {
    const on = value.items.includes(i);
    return (
      <button key={i} type="button" className={`cp-item${on ? ' is-on' : ''}`} aria-pressed={on} disabled={!on && full}
        onClick={() => onChange({ ...value, items: toggleItem(value.items, i) })} title={on ? 'Retirer du bureau' : 'Ajouter au bureau'}>
        {on ? <>{ITEM_LABEL[i]}<span className="cp-item__x" aria-hidden="true">×</span></> : <>+ {ITEM_LABEL[i]}</>}</button>
    );
  };
  return (
    <div className="cp-decor">
      <Field label="Thème du bureau" hint="Le thème oriente l’ambiance du poste et les objets suggérés.">
        <select className="select" value={value.theme} onChange={(e) => onChange({ ...value, theme: e.target.value as DecorTheme })}>
          {THEMES.map((t) => <option key={t} value={t}>{THEME_LABEL[t]}</option>)}
        </select>
      </Field>
      <div className="field">
        <span className="field__label"><span>Objets sur le bureau</span><span className="cp-count">{value.items.length}/{LIMITS.decorItems}</span></span>
        {value.items.length > 0
          ? <div className="cp-items">{value.items.map(itemBtn)}</div>
          : <p className="faint cp-small">Aucun objet : le bureau reste dépouillé.</p>}
        {sugg.length > 0 && (<>
          <span className="micro cp-sub">Suggestions du thème « {THEME_LABEL[value.theme]} »</span>
          <div className="cp-items">{sugg.map(itemBtn)}</div>
        </>)}
        <details className="cp-more">
          <summary>Autres objets ({others.filter((i) => !value.items.includes(i)).length})</summary>
          <div className="cp-items">{others.filter((i) => !value.items.includes(i)).map(itemBtn)}</div>
        </details>
        {full && <div className="field__hint">Maximum atteint : retirez un objet pour en ajouter un autre.</div>}
        {error && <div className="field__err" role="alert">{error}</div>}
      </div>
      <fieldset className="cp-opts">
        <legend>Couleur d’accent</legend>
        <div className="cp-swatches">
          {DECOR_ACCENT_SWATCHES.map((c, i) => (
            <label key={i} className="cp-swatch" title={DECOR_ACCENT_LABEL[i]}>
              <input type="radio" name={`${name}-col`} checked={value.color === i} onChange={() => onChange({ ...value, color: i })} aria-label={DECOR_ACCENT_LABEL[i]} />
              <span style={{ background: c }} />
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

// --- Éditeur ------------------------------------------------------------------------------------------------------
export interface ProfileEditorProps {
  agentId: string; sprite: number; provider: ProviderId | null; ctl: ProfileController;
  /** Parties éditées ici (les autres sont conservées telles quelles à l'enregistrement). */
  parts?: readonly ProfilePart[];
  showGeneration?: boolean; showReset?: boolean;
  /** Appelé après enregistrement/réinitialisation (ex. fermer un dialogue). */
  onDone?: (p: AgentProfile) => void;
  onCancel?: () => void;
  saveLabel?: string;
}

export function ProfileEditor({ agentId, sprite, provider, ctl, parts = ALL_PARTS, showGeneration = true, showReset = true, onDone, onCancel, saveLabel }: ProfileEditorProps) {
  const toast = useToast();
  const profile = ctl.profile;
  const [form, setForm] = useState<ProfileForm | null>(() => (profile ? profileToForm(profile) : null));
  const [base, setBase] = useState<AgentProfile | null>(profile);
  const [stale, setStale] = useState(false);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const has = (p: ProfilePart) => parts.includes(p);

  const dirty = useMemo(() => {
    if (!form || !base) return false;
    return JSON.stringify(mergeParts(base, formToInput(form), parts)) !== JSON.stringify(profileInput(base));
  }, [form, base, parts]);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Nouvelle version de la fiche (génération, autre onglet, autre éditeur) : resynchronise si aucun brouillon, sinon le signale.
  useEffect(() => {
    if (!profile || profile === base) return;
    if (!base || !dirtyRef.current) { setForm(profileToForm(profile)); setBase(profile); setStale(false); }
    else if (JSON.stringify(mergeParts(profile, profileInput(profile), parts)) !== JSON.stringify(mergeParts(profile, profileInput(base), parts))) setStale(true);
    else setBase(profile);
  }, [profile, base, parts]);

  useEffect(() => { if (submitted && form) setErrors(validateProfileForm(form, parts)); }, [form, submitted, parts]);

  if (!profile || !form) return ctl.loadError ? <Banner tone="err" title="Fiche indisponible">{ctl.loadError}</Banner> : <p className="faint">Chargement de la fiche…</p>;

  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const save = async () => {
    setSubmitted(true); setServerError(null);
    const errs = validateProfileForm(form, parts);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const saved = await api.saveAgentProfile(agentId, mergeParts(profile, formToInput(form), parts));
      ctl.apply(saved);
      setForm(profileToForm(saved)); setBase(saved); setStale(false); setSubmitted(false);
      toast.push('ok', 'Fiche d’identité enregistrée.');
      onDone?.(saved);
    } catch (e) { setServerError(e instanceof Error ? e.message : 'Enregistrement impossible.'); }
    finally { setSaving(false); }
  };
  const reset = async () => {
    setSaving(true); setServerError(null);
    try {
      await api.resetAgentProfile(agentId);
      const p = await ctl.reload();
      if (p) { setForm(profileToForm(p)); setBase(p); setStale(false); onDone?.(p); }
      toast.push('ok', 'Fiche réinitialisée : retour à la fiche par défaut.');
      setConfirmReset(false);
    } catch (e) { setServerError(e instanceof Error ? e.message : 'Réinitialisation impossible.'); setConfirmReset(false); }
    finally { setSaving(false); }
  };
  const discard = () => { setForm(profileToForm(profile)); setBase(profile); setStale(false); setSubmitted(false); setErrors({}); };

  return (
    <div className="cp-editor">
      {showGeneration && <GenerationBox ctl={ctl} provider={provider} dirty={dirty} />}
      <div className="cp-editor__src">
        <Tag tone={profile.source === 'generated' ? 'info' : profile.source === 'manual' ? 'ok' : 'neutral'}>{SOURCE_LABEL[profile.source]}</Tag>
        <span className="faint">{SOURCE_HINT[profile.source]}</span>
      </div>
      {stale && (
        <Banner tone="warn" title="La fiche a changé entre-temps" actions={<Button size="sm" onClick={discard}>Recharger</Button>}>
          Une nouvelle version vient d’être enregistrée (génération ou autre fenêtre). Rechargez-la ou enregistrez la vôtre pour la remplacer.
        </Banner>
      )}

      {has('identity') && (
        <fieldset className="cp-sec">
          <legend>Identité</legend>
          <div className="cp-grid">
            <Field label="Nom affiché" required error={errors.display_name} right={<Counter v={form.display_name} max={LIMITS.display_name} />} className="cp-span">
              <input className="input" value={form.display_name} maxLength={LIMITS.display_name + 20} onChange={(e) => set('display_name', e.target.value)} />
            </Field>
            <Field label="Fonction" error={errors.title} right={<Counter v={form.title} max={LIMITS.title} />} className="cp-span">
              <input className="input" value={form.title} maxLength={LIMITS.title + 20} onChange={(e) => set('title', e.target.value)} placeholder="Analyste de veille" />
            </Field>
            <Field label="Matricule" error={errors.employee_id}>
              <input className="input input--mono" value={form.employee_id} maxLength={LIMITS.employee_id + 5} onChange={(e) => set('employee_id', e.target.value)} placeholder="RO-0042" spellCheck={false} />
            </Field>
            <Field label="N° de bureau" error={errors.office}>
              <input className="input input--mono" value={form.office} maxLength={LIMITS.office + 5} onChange={(e) => set('office', e.target.value)} placeholder="B-204" spellCheck={false} />
            </Field>
            <Field label="Date de recrutement" error={errors.hired_at} hint="AAAA-MM-JJ, facultative.">
              <input className="input input--mono" type="date" value={form.hired_at} onChange={(e) => set('hired_at', e.target.value)} />
            </Field>
            <div className="field"><span className="field__label">Département</span><span className="cp-ro">{profile.department || '—'}</span><div className="field__hint">Défini dans la configuration de l’agent.</div></div>
          </div>
        </fieldset>
      )}

      {has('story') && (
        <fieldset className="cp-sec">
          <legend>Histoire</legend>
          <Field label="Biographie" error={errors.bio} right={<Counter v={form.bio} max={LIMITS.bio} />}>
            <textarea className="textarea" rows={4} value={form.bio} maxLength={LIMITS.bio + 100} onChange={(e) => set('bio', e.target.value)} />
          </Field>
          {(['traits', 'interests', 'habits', 'skills'] as const).map((k) => <ListEditor key={k} k={k} value={form[k]} onChange={(v) => set(k, v)} error={errors[k]} />)}
        </fieldset>
      )}

      {has('personality') && (
        <fieldset className="cp-sec">
          <legend>Personnalité</legend>
          <PersonalitySliders value={form.personality} onChange={(v) => set('personality', v)} />
        </fieldset>
      )}

      {has('appearance') && (
        <fieldset className="cp-sec">
          <legend>Apparence</legend>
          <AppearancePicker value={form.appearance} onChange={(v) => set('appearance', v)} sprite={sprite} />
        </fieldset>
      )}

      {has('decor') && (
        <fieldset className="cp-sec">
          <legend>Bureau</legend>
          <DecorPicker value={form.decor} onChange={(v) => set('decor', v)} error={errors.decor} />
        </fieldset>
      )}

      {serverError && <Banner tone="err" title="Le serveur a refusé la fiche">{serverError}</Banner>}
      {submitted && Object.keys(errors).length > 0 && <Banner tone="err">{Object.keys(errors).length} champ(s) à corriger.</Banner>}

      <div className="cp-editor__actions">
        {showReset && profile.source !== 'default' && <Button variant="ghost" onClick={() => setConfirmReset(true)} disabled={saving}>Réinitialiser…</Button>}
        <span className="cp-grow" />
        {dirty && <Tag tone="amber">Non enregistré</Tag>}
        {onCancel ? <Button onClick={onCancel} disabled={saving}>{dirty ? 'Abandonner' : 'Fermer'}</Button> : dirty && <Button onClick={discard} disabled={saving}>Annuler</Button>}
        <Button variant="primary" busy={saving} disabled={!dirty && profile.source !== 'default'} onClick={() => void save()}>{saveLabel ?? 'Enregistrer'}</Button>
      </div>

      {confirmReset && (
        <Overlay>
          <ConfirmDialog title="Réinitialiser la fiche d’identité" danger confirmLabel="Réinitialiser" busy={saving} onCancel={() => setConfirmReset(false)} onConfirm={() => void reset()}>
            <p>La fiche enregistrée est supprimée (textes, personnalité, apparence et bureau) : l’agent retrouve sa <strong>fiche par défaut</strong>, calculée à partir de son nom, de son département et de sa mission.</p>
            {profile.source === 'generated' && <p>La fiche générée par l’IA sera perdue ; une nouvelle génération consommerait à nouveau du quota.</p>}
          </ConfirmDialog>
        </Overlay>
      )}
    </div>
  );
}
