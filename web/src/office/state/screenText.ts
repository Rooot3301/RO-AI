// Ce que montre l'écran d'un poste : la cible RÉELLE de la dernière action (fichier lu ou écrit, site consulté, commande
// lancée), tirée du résumé d'outil reçu du noyau. Fonction pure ; aucun contenu inventé.
import type { ToolKind } from '../../api/types.ts';

const URL_RE = /\bhttps?:\/\/([^\s/?#]+)/i;
const FILE_RE = /([\w.~-]+\/)*([\w-][\w.-]*\.[A-Za-z0-9]{1,8})\b/;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Titre court affiché dans la barre de l'écran (ou chaîne vide si rien d'exploitable). */
export function screenTarget(kind: ToolKind | null, summary: string | null | undefined): string {
  const s = (summary ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const url = URL_RE.exec(s);
  if (kind === 'web' || url) {
    if (url) return url[1].replace(/^www\./, '');
    const q = /(?:recherche|search|cherche)\s*:?\s*(.+)/i.exec(s);
    return clip(q ? `« ${q[1].replace(/^[«"']|[»"']$/g, '').trim()} »` : s, 26);
  }
  if (kind === 'exec') return clip('$ ' + s.replace(/^(exécute|execute|lance|run|commande)\s*:?\s*/i, ''), 30);
  const f = FILE_RE.exec(s);
  if (f && (kind === 'read' || kind === 'write' || kind === 'other' || kind === null)) return clip(f[2], 26);
  return clip(s, 26);
}
