import { useId, useState } from 'react';
import { addDomains, MAX_DOMAINS } from '../../lib/agentForm';

/** Domaines joignables par l'agent : puces, Entrée ou virgule pour ajouter, validation immédiate. */
export function DomainsEditor({ value, onChange, error }: { value: string[]; onChange: (v: string[]) => void; error?: string }) {
  const [draft, setDraft] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const id = useId();
  const add = (raw: string) => {
    if (!raw.trim()) return;
    const r = addDomains(value, raw);
    onChange(r.list);
    const parts: string[] = [];
    if (r.rejected.length) parts.push(`Refusé : ${r.rejected.map((x) => `${x.value} (${x.error})`).join(' ; ')}`);
    if (r.full) parts.push(`${MAX_DOMAINS} domaines au maximum.`);
    setMsg(parts.length ? parts.join(' ') : null);
    setDraft(r.rejected.length ? r.rejected.map((x) => x.value).join(' ') : '');
  };
  return (
    <div className="domains">
      {value.length > 0 ? (
        <ul className="chips" aria-label="Domaines autorisés">
          {value.map((d) => <li key={d} className="chip"><span>{d}</span><button type="button" aria-label={`Retirer ${d}`} onClick={() => onChange(value.filter((x) => x !== d))}>×</button></li>)}
        </ul>
      ) : <p className="faint" style={{ fontSize: 13 }}>Aucun domaine : l’agent n’a aucun accès réseau.</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input id={id} className="input input--mono" value={draft} placeholder="discord.com, *.github.com, api.exemple.fr:8443" aria-label="Ajouter un domaine autorisé" spellCheck={false} autoComplete="off" autoCapitalize="none"
          aria-invalid={msg || error ? true : undefined} disabled={value.length >= MAX_DOMAINS}
          onChange={(e) => { setDraft(e.target.value); if (msg) setMsg(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft); } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1)); }}
          onBlur={() => draft.trim() && add(draft)} />
        <button type="button" className="btn" onClick={() => add(draft)} disabled={!draft.trim() || value.length >= MAX_DOMAINS}>Ajouter</button>
      </div>
      <div className="domains__count num" aria-live="polite">{value.length} / {MAX_DOMAINS}</div>
      {(msg || error) && <div className="field__err" role="alert">{msg ?? error}</div>}
    </div>
  );
}
