import { Button } from '../../components/ui/primitives';
import { Field } from '../../components/ui/forms';
import { IconPlus, IconTrash } from '../../components/ui/icons';
import { emptyMcpRow, type FormErrors, type McpRow } from '../../lib/agentForm';

export function McpEditor({ rows, onChange, errors }: { rows: McpRow[]; onChange: (r: McpRow[]) => void; errors: FormErrors }) {
  const patch = (i: number, p: Partial<McpRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div className="mcp">
      {rows.length === 0 && <p className="dim" style={{ fontSize: 12.5, marginBottom: 10 }}>Aucun serveur MCP. Un serveur MCP donne à l’agent des outils supplémentaires, lancés comme un processus local.</p>}
      {rows.map((r, i) => (
        <fieldset key={r.key} className="mcp__row">
          <legend className="micro">Serveur {i + 1}</legend>
          <div className="form-grid">
            <Field label="Nom" required error={errors[`mcp.${i}.name`]}><input className="input input--mono" value={r.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="filesystem" spellCheck={false} /></Field>
            <Field label="Commande" required error={errors[`mcp.${i}.command`]}><input className="input input--mono" value={r.command} onChange={(e) => patch(i, { command: e.target.value })} placeholder="npx" spellCheck={false} /></Field>
            <Field label="Arguments" hint="Un argument par ligne."><textarea className="textarea textarea--mono" rows={3} value={r.args} onChange={(e) => patch(i, { args: e.target.value })} placeholder={'-y\n@modelcontextprotocol/server-filesystem'} spellCheck={false} /></Field>
            <Field label="Variables d’environnement" hint="Une par ligne, au format CLE=valeur. Stockées avec la configuration de l’agent." error={errors[`mcp.${i}.env`]}><textarea className="textarea textarea--mono" rows={3} value={r.env} onChange={(e) => patch(i, { env: e.target.value })} spellCheck={false} autoComplete="off" /></Field>
          </div>
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
            <Button size="sm" variant="danger" onClick={() => onChange(rows.filter((_, j) => j !== i))}><IconTrash />Retirer ce serveur</Button>
          </div>
        </fieldset>
      ))}
      <Button size="sm" onClick={() => onChange([...rows, emptyMcpRow()])}><IconPlus />Ajouter un serveur MCP</Button>
    </div>
  );
}
