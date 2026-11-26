// Livraisons : des outils externes (PerforceBot…) envoient des informations à un agent. Chaque source a sa clé (affichée
// une seule fois), un agent destinataire et des consignes. Le contenu est déposé dans le dossier de l'agent et traité
// comme une donnée externe non fiable ; les résultats repartent par le webhook de l'agent s'il en a un.
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Delivery, DeliveryStatus, InboxSource, InboxSourceInput } from '../api/types';
import { Banner, Button, Empty, LoadError, Panel, Skeleton, Tag } from '../components/ui/primitives';
import { Field, Switch } from '../components/ui/forms';
import { ConfirmDialog, Modal } from '../components/ui/Modal';
import { Rel } from '../components/ui/Time';
import { IconCopy, IconEdit, IconPlus, IconRefresh, IconTrash } from '../components/ui/icons';
import { useResource } from '../hooks/useResource';
import { useDocumentTitle } from '../hooks/useNow';
import { useEventListener, useLive } from '../store/LiveProvider';
import { useToast } from '../store/toast';

const STATUS: Record<DeliveryStatus, { label: string; tone: 'ok' | 'warn' | 'err' | 'amber' | 'info' | 'neutral' }> = {
  waiting: { label: 'En attente', tone: 'info' }, processing: { label: 'En traitement', tone: 'amber' }, done: { label: 'Traitée', tone: 'ok' },
  failed: { label: 'Échec', tone: 'err' }, stored: { label: 'Déposée', tone: 'neutral' }, unrouted: { label: 'Sans destinataire', tone: 'warn' },
};
const fmtBytes = (n: number) => (n < 1024 ? `${n} o` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0).replace('.', ',')} Kio`);

export default function InboxPage() {
  useDocumentTitle('Livraisons');
  const toast = useToast();
  const agents = useLive((s) => s.agents);
  const sources = useResource(() => api.inboxSources().then((r) => r.sources), []);
  const deliveries = useResource(() => api.inboxDeliveries(60).then((r) => r.deliveries), []);
  const [editing, setEditing] = useState<InboxSource | 'new' | null>(null);
  const [deleting, setDeleting] = useState<InboxSource | null>(null);
  const [token, setToken] = useState<{ name: string; token: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const agentName = useMemo(() => new Map((agents ?? []).map((a) => [a.id, a.name])), [agents]);
  useEventListener((e) => { if (e.type.startsWith('inbox.') || ((e.type === 'run.succeeded' || e.type === 'run.failed') && deliveries.data?.some((d) => d.run_id === e.run_id))) { deliveries.reload(); if (e.type === 'inbox.received' || e.type === 'inbox.source') sources.reload(); } });

  const toggle = async (s: InboxSource, enabled: boolean) => {
    setBusy(s.id);
    try { await api.inboxSourceUpdate(s.id, { name: s.name, agent_id: s.agent_id, auto_run: s.auto_run, instructions: s.instructions, enabled }); sources.reload(); }
    catch (e) { toast.push('err', e instanceof Error ? e.message : 'Modification impossible.'); }
    finally { setBusy(null); }
  };
  const rotate = async (s: InboxSource) => {
    setBusy(s.id);
    try { const r = await api.inboxSourceToken(s.id); setToken({ name: r.name, token: r.token }); sources.reload(); }
    catch (e) { toast.push('err', e instanceof Error ? e.message : 'Régénération impossible.'); }
    finally { setBusy(null); }
  };
  const remove = async () => {
    if (!deleting) return;
    setBusy(deleting.id);
    try { await api.inboxSourceDelete(deleting.id); toast.push('ok', 'Source supprimée : sa clé ne fonctionne plus.'); setDeleting(null); sources.reload(); }
    catch (e) { toast.push('err', e instanceof Error ? e.message : 'Suppression impossible.'); }
    finally { setBusy(null); }
  };

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__titles">
          <div className="micro page__crumb">Opérations</div>
          <h1 className="page__title">Livraisons</h1>
          <p className="page__sub">Tes outils (PerforceBot…) envoient des informations à un agent. Elles sont déposées dans son dossier, puis traitées comme une donnée externe : jamais comme des instructions. Le résultat repart par le webhook de l’agent s’il en a un.</p>
        </div>
        <div className="page__actions"><Button variant="primary" onClick={() => setEditing('new')}><IconPlus />Nouvelle source</Button></div>
      </div>

      <Panel title="Sources" meta={sources.data ? `${sources.data.length} source${sources.data.length > 1 ? 's' : ''}` : undefined} flush>
        {sources.loading && !sources.data ? <Skeleton rows={3} />
          : sources.error && !sources.data ? <div style={{ padding: 12 }}><LoadError message={sources.error} onRetry={sources.reload} /></div>
          : !sources.data || sources.data.length === 0 ? (
            <Empty title="Aucune source" actions={<Button variant="primary" size="sm" onClick={() => setEditing('new')}><IconPlus />Ajouter PerforceBot</Button>}>
              Une source reçoit sa propre clé. L’outil l’envoie à chaque livraison ; sans clé valide, rien n’est accepté.
            </Empty>
          ) : (
            <div className="tbl-scroll">
              <table className="tbl">
                <thead><tr><th>Active</th><th>Source</th><th>Agent destinataire</th><th>Traitement</th><th>Reçues</th><th>Dernière</th><th className="col-act"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {sources.data.map((s) => (
                    <tr key={s.id}>
                      <td><Switch checked={s.enabled} disabled={busy === s.id} onChange={(v) => void toggle(s, v)} label={`${s.enabled ? 'Désactiver' : 'Activer'} ${s.name}`} /></td>
                      <td><span style={{ fontWeight: 500 }}>{s.name}</span><div className="faint mono">clé …{s.token_hint}</div></td>
                      <td>{s.agent_id && agentName.get(s.agent_id) ? <Link to={`/agents/${s.agent_id}`}>{agentName.get(s.agent_id)}</Link> : <Tag tone="warn">aucun</Tag>}</td>
                      <td>{s.auto_run ? 'Automatique' : 'Dépôt seulement'}{s.instructions && <div className="faint ellipsis untrusted" title={s.instructions} style={{ maxWidth: 260 }}>{s.instructions}</div>}</td>
                      <td className="num">{s.received}</td>
                      <td>{s.last_at ? <Rel iso={s.last_at} /> : <span className="faint">jamais</span>}</td>
                      <td className="col-act">
                        <Button size="sm" disabled={busy === s.id} onClick={() => setEditing(s)} aria-label={`Modifier ${s.name}`}><IconEdit />Modifier</Button>
                        <Button size="sm" busy={busy === s.id} onClick={() => void rotate(s)} title="Nouvelle clé : l’ancienne cesse aussitôt de fonctionner"><IconRefresh />Nouvelle clé</Button>
                        <Button size="sm" variant="danger" icon disabled={busy === s.id} onClick={() => setDeleting(s)} aria-label={`Supprimer ${s.name}`}><IconTrash /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Panel>

      <div style={{ height: 16 }} />
      <Panel title="Dernières livraisons" flush>
        {deliveries.loading && !deliveries.data ? <Skeleton rows={4} />
          : deliveries.error && !deliveries.data ? <div style={{ padding: 12 }}><LoadError message={deliveries.error} onRetry={deliveries.reload} /></div>
          : !deliveries.data || deliveries.data.length === 0 ? <Empty title="Aucune livraison" glyph={false}>Les livraisons reçues apparaîtront ici, et une camionnette passera devant le bureau virtuel.</Empty>
          : (
            <div className="tbl-scroll">
              <table className="tbl">
                <thead><tr><th>Reçue</th><th>Source</th><th>Titre</th><th>Agent</th><th>Taille</th><th>État</th></tr></thead>
                <tbody>
                  {deliveries.data.map((d: Delivery) => (
                    <tr key={d.id}>
                      <td><Rel iso={d.received_at} /></td>
                      <td>{d.source ?? <span className="faint">source supprimée</span>}</td>
                      <td><span className="untrusted">{d.title}</span><div className="faint mono">{d.kind}{d.file ? ` · ${d.file}` : ''}</div></td>
                      <td>{d.agent_id ? <Link to={`/agents/${d.agent_id}`}>{d.agent_name ?? d.agent_id}</Link> : <span className="faint">—</span>}</td>
                      <td className="num">{fmtBytes(d.bytes)}</td>
                      <td><Tag tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Tag>{d.run_id && <> <Link to={`/runs/${d.run_id}`} className="faint">exécution</Link></>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Panel>

      {editing && <SourceEditor source={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
        onSaved={(tok) => { setEditing(null); sources.reload(); if (tok) setToken(tok); }} />}
      {token && <TokenDialog name={token.name} token={token.token} onClose={() => setToken(null)} />}
      {deleting && <ConfirmDialog title="Supprimer la source" danger confirmLabel="Supprimer" busy={busy === deleting.id} onCancel={() => setDeleting(null)} onConfirm={() => void remove()}>
        Supprimer « <strong>{deleting.name}</strong> » ? Sa clé cessera de fonctionner. Les livraisons déjà reçues restent dans le dossier de l’agent (30 jours).
      </ConfirmDialog>}
    </div>
  );
}

function SourceEditor({ source, onClose, onSaved }: { source: InboxSource | null; onClose: () => void; onSaved: (tok: { name: string; token: string } | null) => void }) {
  const agents = useLive((s) => s.agents) ?? [];
  const [form, setForm] = useState<InboxSourceInput>(() => source
    ? { name: source.name, agent_id: source.agent_id, auto_run: source.auto_run, instructions: source.instructions, enabled: source.enabled }
    : { name: 'PerforceBot', agent_id: agents.find((a) => /perforce/i.test(a.name))?.id ?? agents[0]?.id ?? null, auto_run: true, instructions: '', enabled: true });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nameOk = form.name.trim().length >= 2 && form.name.trim().length <= 40;
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!nameOk || saving) return;
    setSaving(true); setErr(null);
    try {
      if (source) { await api.inboxSourceUpdate(source.id, { ...form, name: form.name.trim() }); onSaved(null); }
      else { const r = await api.inboxSourceCreate({ ...form, name: form.name.trim() }); onSaved({ name: r.name, token: r.token }); }
    } catch (x) { setErr(x instanceof Error ? x.message : 'Enregistrement impossible.'); }
    finally { setSaving(false); }
  };
  return (
    <Modal title={source ? `Modifier ${source.name}` : 'Nouvelle source'} onClose={onClose} busy={saving}
      footer={<><Button onClick={onClose} disabled={saving}>Annuler</Button><Button variant="primary" busy={saving} disabled={!nameOk} onClick={() => void submit()}>{source ? 'Enregistrer' : 'Créer et afficher la clé'}</Button></>}>
      <form onSubmit={(e) => void submit(e)} className="stack" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Nom" required error={nameOk ? undefined : '2 à 40 caractères'}><input className="input" value={form.name} maxLength={40} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Agent destinataire" hint="Les livraisons sont déposées dans son dossier de travail (inbox/).">
          <select className="select" value={form.agent_id ?? ''} onChange={(e) => setForm({ ...form, agent_id: e.target.value || null })}>
            <option value="">Aucun (refuser le routage)</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Switch checked={form.auto_run} onChange={(v) => setForm({ ...form, auto_run: v })}>Traiter automatiquement à réception (sinon : dépôt seulement, lu à la prochaine mission)</Switch>
        <Field label="Consignes pour cet agent" hint="Ce que l’agent doit faire de ces informations. Les approbations, l’arrêt d’urgence et la sandbox de l’agent s’appliquent toujours.">
          <textarea className="textarea" rows={4} maxLength={4000} value={form.instructions} placeholder="Ex. : résume les changelists reçues, signale celles qui touchent au build, poste un bilan court." onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
        </Field>
        {err && <Banner tone="err">{err}</Banner>}
      </form>
    </Modal>
  );
}

function TokenDialog({ name, token, onClose }: { name: string; token: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/inbox/deliver`;
  const example = `curl --cacert ro-ai-ca.crt -X POST ${url} \\\n  -H "Authorization: Bearer ${token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"title": "CL 4242 : correctif build", "content": "…", "kind": "changelist", "meta": {"cl": 4242}}'`;
  const copy = async () => { try { await navigator.clipboard.writeText(token); setCopied(true); } catch { setCopied(false); } };
  return (
    <Modal title={`Clé de ${name}`} onClose={onClose} wide footer={<Button variant="primary" onClick={onClose}>J’ai noté la clé</Button>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Banner tone="warn" title="Affichée une seule fois">RO·AI n’en garde qu’une empreinte. Copie-la dans la configuration de l’outil ; en cas de perte, génère une nouvelle clé.</Banner>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <code className="mono" style={{ flex: 1, overflowWrap: 'anywhere', padding: '8px 10px', background: 'var(--ink-950)', borderRadius: 6 }}>{token}</code>
          <Button size="sm" onClick={() => void copy()}><IconCopy />{copied ? 'Copiée' : 'Copier'}</Button>
        </div>
        <p className="dim" style={{ margin: 0 }}>Envoi depuis le réseau local uniquement (HTTPS, certificat interne de RO·AI). Corps JSON : <code>title</code> (≤ 200 caractères), <code>content</code> (texte, ≤ 256 Kio), <code>kind</code> et <code>meta</code> facultatifs. 30 livraisons par minute au plus.</p>
        <pre className="mono" style={{ margin: 0, padding: 10, background: 'var(--ink-950)', borderRadius: 6, overflowX: 'auto', fontSize: 12 }}>{example}</pre>
      </div>
    </Modal>
  );
}
