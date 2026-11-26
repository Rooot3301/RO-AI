import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Schedule } from '../api/types';
import { Banner, Button, Empty, LoadError, Panel, Skeleton, Led } from '../components/ui/primitives';
import { Field, Switch } from '../components/ui/forms';
import { ConfirmDialog, Modal } from '../components/ui/Modal';
import { Countdown, Rel } from '../components/ui/Time';
import { IconEdit, IconPlay, IconPlus, IconTrash } from '../components/ui/icons';
import { useResource } from '../hooks/useResource';
import { useDocumentTitle } from '../hooks/useNow';
import { usePaused } from '../hooks/useControl';
import { STOP_BLOCKED_TEXT, launchErrorMessage } from '../lib/control';
import { ApiError } from '../api/client';
import { useEventListener, useLive, useLiveStore } from '../store/LiveProvider';
import { useToast } from '../store/toast';
import { CRON_PRESETS, describeCron, nextRuns, parseCron } from '../lib/cron';
import { emptyScheduleForm, scheduleInputFrom, scheduleToForm, scheduleToInput, validateSchedule, type ScheduleForm } from '../lib/scheduleForm';
import { formatDateTime } from '../lib/format';
import './Schedules.css';

export default function SchedulesPage() {
  useDocumentTitle('Planifications');
  const nav = useNavigate();
  const toast = useToast();
  const store = useLiveStore();
  const paused = usePaused();
  const agents = useLive((s) => s.agents);
  const res = useResource(() => api.schedules(), []);
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Schedule | null>(null);
  const [busy, setBusy] = useState<Record<string, string | undefined>>({});
  const agentName = useMemo(() => new Map((agents ?? []).map((a) => [a.id, a.name])), [agents]);

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEventListener((e) => {
    if (!e.type.startsWith('schedule.') && !(e.type === 'run.queued' && e.payload?.trigger === 'schedule')) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(res.reload, 400);
  });
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const mark = (id: string, what: string | undefined) => setBusy((b) => ({ ...b, [id]: what }));
  const toggle = async (s: Schedule, enabled: boolean) => {
    mark(s.id, 'toggle');
    try { const saved = await api.updateSchedule(s.id, scheduleInputFrom(s, { enabled })); res.setData((l) => (l ?? []).map((x) => (x.id === s.id ? saved : x))); toast.push('ok', enabled ? 'Planification activée.' : 'Planification désactivée.'); }
    catch (e) { toast.push('err', e instanceof Error ? e.message : 'Modification impossible.'); }
    finally { mark(s.id, undefined); }
  };
  const runNow = async (s: Schedule) => {
    mark(s.id, 'run');
    try { const run = await api.runScheduleNow(s.id); store.putRun(run); toast.push('ok', 'Exécution lancée.'); nav(`/runs/${run.id}`); }
    catch (e) { toast.push('err', e instanceof Error ? launchErrorMessage(e instanceof ApiError ? e.status : undefined, e.message) : 'Lancement impossible.'); }
    finally { mark(s.id, undefined); }
  };
  const remove = async () => {
    if (!deleting) return;
    mark(deleting.id, 'delete');
    try { await api.deleteSchedule(deleting.id); res.setData((l) => (l ?? []).filter((x) => x.id !== deleting.id)); toast.push('ok', 'Planification supprimée.'); setDeleting(null); }
    catch (e) { toast.push('err', e instanceof Error ? e.message : 'Suppression impossible.'); }
    finally { mark(deleting.id, undefined); }
  };

  const list = res.data;
  return (
    <div className="page">
      <div className="page__head">
        <div className="page__titles">
          <div className="micro page__crumb">Opérations</div>
          <h1 className="page__title">Planifications</h1>
          <p className="page__sub">Déclenchez un agent à heure fixe avec une expression cron à 5 champs. La prochaine exécution est calculée par le serveur.</p>
        </div>
        <div className="page__actions"><Button variant="primary" onClick={() => setEditing('new')} disabled={!agents || agents.length === 0}><IconPlus />Nouvelle planification</Button></div>
      </div>

      {paused && <div style={{ marginBottom: 16 }}><Banner tone="warn" title="Planifications suspendues">{STOP_BLOCKED_TEXT} Les planifications ne se déclencheront pas tant que l’arrêt n’est pas levé.</Banner></div>}
      <Panel flush>
        {res.loading && !list ? <Skeleton rows={5} />
          : res.error && !list ? <div style={{ padding: 12 }}><LoadError message={res.error} onRetry={res.reload} /></div>
          : !list || list.length === 0 ? (
            <Empty title="Aucune planification" actions={agents && agents.length > 0 ? <Button variant="primary" size="sm" onClick={() => setEditing('new')}><IconPlus />Planifier un agent</Button> : <Link to="/agents/new"><Button size="sm">Créer d’abord un agent</Button></Link>}>
              {agents && agents.length === 0 ? 'Une planification lance un agent existant : créez d’abord un agent.' : 'Exemple : lancer l’agent de veille chaque jour ouvré à 09:00.'}
            </Empty>
          ) : (
            <div className="tbl-scroll">
              <table className="tbl sch-tbl">
                <thead><tr><th>Actif</th><th>Planification</th><th>Agent</th><th>Récurrence</th><th>Prochaine exécution</th><th>Dernière</th><th className="col-act"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {list.map((s) => {
                    const p = parseCron(s.cron);
                    const b = busy[s.id];
                    return (
                      <tr key={s.id}>
                        <td><Switch checked={s.enabled} disabled={!!b} onChange={(v) => void toggle(s, v)} label={`${s.enabled ? 'Désactiver' : 'Activer'} ${s.name}`} /></td>
                        <td><span className="rowlink" style={{ fontWeight: 500 }}>{s.name}</span>{s.prompt && <div className="faint ellipsis sch-prompt untrusted" title={s.prompt}>{s.prompt}</div>}</td>
                        <td>{agentName.get(s.agent_id) ? <Link to={`/agents/${s.agent_id}`}>{agentName.get(s.agent_id)}</Link> : <span className="mono faint">{s.agent_id}</span>}</td>
                        <td><code className="cron">{s.cron}</code><div className="dim sch-desc">{p.ok ? describeCron(p.cron) : 'Expression non reconnue'} <span className="faint">· {s.timezone}</span></div></td>
                        <td>{s.enabled && s.next_run_at ? <><div className="num"><Countdown iso={s.next_run_at} /></div><div className="faint num sch-desc">{formatDateTime(s.next_run_at, s.timezone)}</div></> : <span className="faint">{s.enabled ? 'non calculée' : 'désactivée'}</span>}</td>
                        <td>{s.last_run_id ? <Link to={`/runs/${s.last_run_id}`}><Rel iso={s.last_run_at} /></Link> : <span className="faint">jamais</span>}</td>
                        <td className="col-act">
                          <Button size="sm" busy={b === 'run'} disabled={!!b || paused} onClick={() => void runNow(s)} title={paused ? STOP_BLOCKED_TEXT : 'Lancer maintenant'}><IconPlay />Lancer</Button>
                          <Button size="sm" disabled={!!b} onClick={() => setEditing(s)} aria-label={`Modifier ${s.name}`}><IconEdit />Modifier</Button>
                          <Button size="sm" variant="danger" icon disabled={!!b} onClick={() => setDeleting(s)} aria-label={`Supprimer ${s.name}`}><IconTrash /></Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </Panel>

      {editing && <ScheduleEditor schedule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); res.reload(); }} />}
      {deleting && <ConfirmDialog title="Supprimer la planification" danger confirmLabel="Supprimer" busy={busy[deleting.id] === 'delete'} onCancel={() => setDeleting(null)} onConfirm={() => void remove()}>Supprimer « <strong>{deleting.name}</strong> » ? L’agent ne sera plus lancé automatiquement.</ConfirmDialog>}
    </div>
  );
}

const CRON_FIELDS = [['minute', '0–59'], ['heure', '0–23'], ['jour du mois', '1–31'], ['mois', '1–12'], ['jour sem.', '0–6 (dim=0)']] as const;

function ScheduleEditor({ schedule, onClose, onSaved }: { schedule: Schedule | null; onClose: () => void; onSaved: () => void }) {
  const agents = useLive((s) => s.agents) ?? [];
  const toast = useToast();
  const [form, setForm] = useState<ScheduleForm>(() => (schedule ? scheduleToForm(schedule) : emptyScheduleForm(agents[0]?.id ?? '')));
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const set = <K extends keyof ScheduleForm>(k: K, v: ScheduleForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const errors = validateSchedule(form);
  const shown = (k: string) => (submitted || k === 'cron' ? errors[k] : undefined);
  const parsed = parseCron(form.cron);
  const tz = form.timezone.trim();
  const upcoming = useMemo(() => (parsed.ok ? nextRuns(parsed.cron, Date.now(), tz || 'UTC', 3) : []), [form.cron, tz]); // eslint-disable-line react-hooks/exhaustive-deps
  const tokens = form.cron.trim().split(/\s+/).filter(Boolean);
  const zones = useMemo(() => { try { return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []; } catch { return []; } }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true); setServerError(null);
    if (Object.keys(errors).length) return;
    setSaving(true);
    try {
      const input = scheduleToInput(form);
      if (schedule) await api.updateSchedule(schedule.id, input); else await api.createSchedule(input);
      toast.push('ok', schedule ? 'Planification enregistrée.' : 'Planification créée.');
      onSaved();
    } catch (err) { setServerError(err instanceof Error ? err.message : 'Enregistrement impossible.'); }
    finally { setSaving(false); }
  };

  return (
    <Modal wide title={schedule ? `Modifier · ${schedule.name}` : 'Nouvelle planification'} onClose={onClose} busy={saving} footer={<>
      <Button onClick={onClose} disabled={saving}>Annuler</Button>
      <Button type="submit" form="sched-form" variant="primary" busy={saving}>{schedule ? 'Enregistrer' : 'Créer'}</Button>
    </>}>
      <form id="sched-form" onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {serverError && <Banner tone="err" title="Le serveur a refusé la planification">{serverError}</Banner>}
        <div className="form-grid">
          <Field label="Agent" required error={shown('agent_id')}>
            <select className="select" value={form.agent_id} onChange={(e) => set('agent_id', e.target.value)} data-autofocus>
              <option value="">— Choisir —</option>
              {form.agent_id && !agents.some((a) => a.id === form.agent_id) && <option value={form.agent_id}>{form.agent_id}</option>}
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.enabled ? '' : ' (désactivé)'}</option>)}
            </select>
          </Field>
          <Field label="Nom" required error={shown('name')}><input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Veille du matin" /></Field>
        </div>

        <div className="cronbox">
          <Field label="Expression cron" required error={shown('cron')} hint="5 champs : minute heure jour-du-mois mois jour-de-semaine.">
            <input className="input input--mono cron-input" value={form.cron} onChange={(e) => set('cron', e.target.value)} spellCheck={false} autoComplete="off" />
          </Field>
          <div className="cronstrip" aria-hidden="true">
            {CRON_FIELDS.map(([label, range], i) => (
              <div key={label} className={`cronstrip__cell${tokens[i] ? '' : ' is-empty'}`}>
                <span className="cronstrip__tok mono">{tokens[i] ?? '·'}</span>
                <span className="micro">{label}</span>
                <span className="cronstrip__range">{range}</span>
              </div>
            ))}
          </div>
          <div className="chips cronpresets" role="group" aria-label="Présélections">
            {CRON_PRESETS.map((p) => <button key={p.cron} type="button" className="chip" onClick={() => set('cron', p.cron)} aria-pressed={form.cron.trim() === p.cron}>{p.label}</button>)}
          </div>
          <div className="cronpreview" aria-live="polite">
            {parsed.ok ? (
              <>
                <div className="cronpreview__desc"><Led tone="ok" /> <span>{describeCron(parsed.cron)}</span> <span className="faint">({tz || 'UTC'})</span></div>
                {errors.timezone ? null : upcoming.length > 0 ? (
                  <div className="cronpreview__next"><span className="micro">Prochaines (aperçu navigateur)</span>
                    <ul>{upcoming.map((t) => <li key={t} className="num">{formatDateTime(new Date(t).toISOString(), tz)}</li>)}</ul></div>
                ) : <div className="faint" style={{ fontSize: 12 }}>Aucune occurrence dans les prochaines années.</div>}
              </>
            ) : <div className="cronpreview__desc err-text"><Led tone="err" /> <span>Expression invalide</span></div>}
          </div>
          <details className="cronhelp">
            <summary className="micro">Aide sur la syntaxe</summary>
            <ul>
              <li><code>*</code> toutes les valeurs · <code>*/15</code> toutes les 15 · <code>1-5</code> de 1 à 5 · <code>1,15</code> liste</li>
              <li>Jours de la semaine : <code>0</code> ou <code>7</code> = dimanche, <code>1</code> = lundi… ou <code>mon</code>, <code>tue</code>… Mois : <code>jan</code>… <code>dec</code>.</li>
              <li>Si jour du mois et jour de la semaine sont tous deux fixés, l’un <em>ou</em> l’autre déclenche.</li>
            </ul>
          </details>
        </div>

        <div className="form-grid">
          <Field label="Fuseau horaire" required error={shown('timezone')} hint="Nom IANA, ex. Europe/Paris ou UTC.">
            <input className="input input--mono" list="tz-list" value={form.timezone} onChange={(e) => set('timezone', e.target.value)} spellCheck={false} />
          </Field>
          <datalist id="tz-list">{zones.map((z) => <option key={z} value={z} />)}</datalist>
          <div className="field"><span className="field__label">État</span><Switch checked={form.enabled} onChange={(v) => set('enabled', v)}>Planification active</Switch></div>
        </div>
        <Field label="Prompt (facultatif)" hint="Vide : le prompt par défaut de l’agent est utilisé à chaque déclenchement."><textarea className="textarea" rows={3} value={form.prompt} onChange={(e) => set('prompt', e.target.value)} /></Field>
      </form>
    </Modal>
  );
}
