import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { Modal, ConfirmDialog } from '../ui/Modal';
import { Button } from '../ui/primitives';
import { IconStop } from '../ui/icons';
import { Rel } from '../ui/Time';
import { useControl } from '../../hooks/useControl';
import { useLiveStore } from '../../store/LiveProvider';
import { useToast } from '../../store/toast';
import { describeCancelled, withStopPrefix } from '../../lib/control';
import { formatDateTime } from '../../lib/format';

const ARM_DELAY_MS = 700;

/** Bouton de la barre du haut : déclenche la confirmation ; devient un indicateur d'état quand l'arrêt est actif. */
export function EmergencyButton() {
  const { paused } = useControl();
  const [open, setOpen] = useState(false);
  if (paused) {
    return <span className="stopstate" role="status" title="Arrêt d’urgence actif"><IconStop /><span>Arrêt d’urgence actif</span></span>;
  }
  return (
    <>
      <button type="button" className="stopbtn" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label="Arrêt d’urgence" title="Arrêt d’urgence : annule toutes les exécutions et bloque les lancements">
        <IconStop /><span>Arrêt d’urgence</span>
      </button>
      {open && <EmergencyDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function EmergencyDialog({ onClose }: { onClose: () => void }) {
  const store = useLiveStore();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setArmed(true), ARM_DELAY_MS); return () => clearTimeout(t); }, []);
  const confirm = async () => {
    if (!armed || busy) return;
    setBusy(true); setError(null);
    try {
      const c = await api.emergencyStop(reason);
      store.putControl(c); store.refetchRuns(); store.refetchAgents();
      toast.push('err', `Arrêt d’urgence déclenché : ${describeCancelled(c.cancelled)}.`);
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Arrêt impossible.'); setBusy(false); }
  };
  return (
    <Modal title="Déclencher l’arrêt d’urgence" onClose={onClose} busy={busy} footer={<>
      <Button onClick={onClose} disabled={busy} data-autofocus>Annuler</Button>
      <Button variant="stop" onClick={() => void confirm()} busy={busy} disabled={!armed}><IconStop />Déclencher l’arrêt d’urgence</Button>
    </>}>
      <div className="stopdlg">
        <p>Cette action coupe immédiatement toute l’activité des agents :</p>
        <ul>
          <li>les exécutions <strong>en cours, en file et en attente d’approbation</strong> sont annulées ;</li>
          <li>les <strong>planifications sont suspendues</strong> : aucun déclenchement, aucun rattrapage à la reprise ;</li>
          <li>tout <strong>nouveau lancement est bloqué</strong>, manuel ou par l’API ;</li>
          <li>l’arrêt survit à un redémarrage : la <strong>reprise est toujours manuelle</strong>.</li>
        </ul>
        <div className="field">
          <label className="field__label" htmlFor="stop-reason">Motif (facultatif)</label>
          <input id="stop-reason" className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Ex. comportement inattendu d’un agent" autoComplete="off" />
          <div className="field__hint">Affiché dans le bandeau et enregistré dans le journal.</div>
        </div>
        {error && <div className="field__err" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}

/** Bandeau pleine largeur, visible sur toutes les pages tant que l'arrêt est actif. */
export function EmergencyBanner() {
  const { paused, since, reason, cancelled } = useControl();
  const store = useLiveStore();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!paused) return null;
  const resume = async () => {
    setBusy(true);
    try { const c = await api.resume(); store.putControl(c); store.refetchRuns(); store.refetchAgents(); toast.push('ok', 'Activité reprise : les lancements sont de nouveau possibles.'); setConfirming(false); }
    catch (e) { toast.push('err', e instanceof Error ? e.message : 'Reprise impossible.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="alertbar" role="alert">
      <span className="alertbar__icon" aria-hidden="true"><IconStop /></span>
      <div className="alertbar__text">
        <strong>Arrêt d’urgence actif{since ? <> depuis <span title={formatDateTime(since, undefined, true)}>{formatDateTime(since)} (<Rel iso={since} />)</span></> : null}</strong>
        <span>{reason ? <>Motif : <span className="untrusted">{reason}</span> · </> : null}{describeCancelled(cancelled)} · lancements bloqués, planifications suspendues.</span>
      </div>
      <Button variant="stopghost" onClick={() => setConfirming(true)}>Reprendre</Button>
      {confirming && (
        <ConfirmDialog title="Reprendre l’activité" confirmLabel="Reprendre" busy={busy} onCancel={() => setConfirming(false)} onConfirm={() => void resume()}>
          Les lancements seront de nouveau autorisés et les planifications reprendront ; leurs échéances sont recalculées à partir de maintenant. Les exécutions annulées ne sont pas relancées.
        </ConfirmDialog>
      )}
    </div>
  );
}

/** Garde le préfixe « [ARRÊT] » sur le titre d'onglet, quelle que soit la page qui le réécrit. */
export function useStopTitle() {
  const { paused } = useControl();
  const guard = useRef(false);
  useEffect(() => {
    const apply = () => {
      if (guard.current) return;
      const next = withStopPrefix(document.title, paused);
      if (next !== document.title) { guard.current = true; document.title = next; guard.current = false; }
    };
    apply();
    const el = document.querySelector('title');
    if (!el) return;
    const mo = new MutationObserver(apply);
    mo.observe(el, { childList: true, characterData: true, subtree: true });
    return () => { mo.disconnect(); document.title = withStopPrefix(document.title, false); };
  }, [paused]);
}
