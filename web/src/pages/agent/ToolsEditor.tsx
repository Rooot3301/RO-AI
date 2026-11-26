import { useId, useState } from 'react';

/** Éditeur de liste d'outils autorisés (puces + saisie). Entrée ou virgule valide. */
export function ToolsEditor({ value, onChange, suggestions, error, describedBy }: {
  value: string[]; onChange: (v: string[]) => void; suggestions: string[]; error?: string; describedBy?: string;
}) {
  const [draft, setDraft] = useState('');
  const id = useId();
  const add = (raw: string) => {
    const items = raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).filter((s) => !value.includes(s));
    if (items.length) onChange([...value, ...items]);
    setDraft('');
  };
  const remaining = suggestions.filter((s) => !value.includes(s));
  return (
    <div className="tools">
      {value.length > 0 ? (
        <ul className="chips" aria-label="Outils autorisés">
          {value.map((t) => (
            <li key={t} className="chip"><span>{t}</span><button type="button" aria-label={`Retirer ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>×</button></li>
          ))}
        </ul>
      ) : <p className="faint" style={{ fontSize: 12 }}>Aucun outil autorisé : avec le mode « dontAsk », tout appel d’outil sera refusé.</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input id={id} className="input input--mono" value={draft} placeholder="Read, Grep, Bash(git status *)…" aria-describedby={describedBy} aria-invalid={error ? true : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft); } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1)); }}
          onBlur={() => draft.trim() && add(draft)} aria-label="Ajouter un outil autorisé" />
        <button type="button" className="btn" onClick={() => add(draft)} disabled={!draft.trim()}>Ajouter</button>
      </div>
      {remaining.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <span className="micro" style={{ marginRight: 8 }}>Suggestions</span>
          <span className="chips" style={{ display: 'inline-flex' }}>
            {remaining.map((s) => <button key={s} type="button" className="chip" onClick={() => onChange([...value, s])}>+ {s}</button>)}
          </span>
        </div>
      )}
    </div>
  );
}
