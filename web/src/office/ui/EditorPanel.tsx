// Panneau du mode édition : meuble sélectionné (pivoter, masquer), meubles masqués (réafficher), réinitialiser,
// enregistrer (agencement versionné côté serveur) ou annuler. Toute modification est validée par le plan.
import type { Layout, LayoutOverrides } from '../layout/plan.ts';
import { FURNITURE } from '../layout/furniture.ts';
import { hiddenKeys } from '../layout/editor.ts';

interface Props {
  layout: Layout; overrides: LayoutOverrides; selectedKey: string | null;
  message: { text: string; err: boolean } | null; saving: boolean;
  onRotate: (key: string) => void; onHide: (key: string) => void; onShow: (key: string) => void;
  onReset: () => void; onSave: () => void; onCancel: () => void;
}

const kindOf = (key: string) => key.slice(key.lastIndexOf('/') + 1).replace(/-\d+$/, '') as keyof typeof FURNITURE;
const roomOf = (layout: Layout, key: string) => { const rk = key.slice(0, key.lastIndexOf('/')); const r = layout.rooms.find((x) => x.key === rk); return r ? (r.label || 'Couloir') : rk; };

export function EditorPanel({ layout, overrides, selectedKey, message, saving, onRotate, onHide, onShow, onReset, onSave, onCancel }: Props) {
  const f = selectedKey ? layout.furniture.find((x) => x.key === selectedKey) ?? null : null;
  const hidden = hiddenKeys(overrides);
  const changes = Object.keys(overrides.furniture).length;
  return (
    <aside className="office-editor" aria-label="Aménagement du bureau">
      <header><b>Aménager le bureau</b><span className="office-dim">Glissez un meuble décoratif (cadre pointillé) vers une case libre de sa pièce.</span></header>
      <section aria-live="polite">
        {f ? (
          <div className="office-editor__sel">
            <div><b>{FURNITURE[f.kind].label}</b><span className="office-dim"> · {roomOf(layout, f.key)}</span></div>
            <div className="office-editor__row">
              <button type="button" className="office-btn" onClick={() => onRotate(f.key)}>Pivoter</button>
              <button type="button" className="office-btn" onClick={() => onHide(f.key)}>Masquer</button>
            </div>
          </div>
        ) : <p className="office-dim">Aucun meuble sélectionné.</p>}
        {message && <p className={message.err ? 'is-err' : 'office-dim'} role={message.err ? 'alert' : 'status'}>{message.text}</p>}
      </section>
      {hidden.length > 0 && (
        <section>
          <h4>Meubles masqués</h4>
          <ul className="office-editor__list">
            {hidden.map((k) => <li key={k}><span>{FURNITURE[kindOf(k)]?.label ?? k}<span className="office-dim"> · {roomOf(layout, k)}</span></span><button type="button" className="office-btn" onClick={() => onShow(k)}>Réafficher</button></li>)}
          </ul>
        </section>
      )}
      <section className="office-editor__note office-dim">
        Les postes de travail, la régie, la salle serveur et les portes restent fixes. Un emplacement qui bloquerait un passage, une porte ou l'accès à un siège est refusé.
      </section>
      <footer className="office-editor__row">
        <button type="button" className="office-btn" onClick={onReset} disabled={!changes}>Réinitialiser</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="office-btn" onClick={onCancel}>Annuler</button>
        <button type="button" className="office-btn office-btn--primary" onClick={onSave} disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
      </footer>
    </aside>
  );
}
