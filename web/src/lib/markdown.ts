// Markdown minimal et sûr : analyse en arbre (AST) de types fermés, jamais de HTML.
// Le rendu (components/Markdown.tsx) ne crée que des éléments React à partir de cet arbre : le HTML brut
// n'est donc jamais interprété (il reste du texte), et seuls les liens http(s) deviennent cliquables.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'br' }
  | { t: 'code'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] };
export type Block =
  | { t: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; start: number; items: Inline[][] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'quote'; c: Inline[] }
  | { t: 'hr' };

/** Renvoie l'URL normalisée si elle est en http(s), sinon null (javascript:, data:, vbscript:, etc. refusés). */
export function safeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!/^https?:\/\//i.test(s)) return null;
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null; } catch { return null; }
}

const isAlnum = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;
    if (ch === '\n') { flush(); out.push({ t: 'br' }); i++; continue; }
    if (ch === '`' && (m = rest.match(/^`([^`\n]+)`/))) { flush(); out.push({ t: 'code', v: m[1] }); i += m[0].length; continue; }
    if (ch === '[' && (m = rest.match(/^\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"\n]*")?\)/))) {
      const href = safeUrl(m[2]);
      flush();
      if (href) out.push({ t: 'link', href, c: parseInline(m[1]) });
      else out.push(...parseInline(m[1]), { t: 'text', v: ` (${m[2]})` }); // lien refusé : on garde le texte, jamais d'ancre
      i += m[0].length; continue;
    }
    if (ch === 'h' && !isAlnum(src[i - 1]) && (m = rest.match(/^https?:\/\/[^\s<>]*[^\s<>.,;:!?'")\]]/i))) {
      const href = safeUrl(m[0]); flush();
      if (href) out.push({ t: 'link', href, c: [{ t: 'text', v: m[0] }] }); else out.push({ t: 'text', v: m[0] });
      i += m[0].length; continue;
    }
    if ((ch === '*' || ch === '_') && rest[1] === ch && (m = rest.match(ch === '*' ? /^\*\*(?=\S)([\s\S]*?\S)\*\*/ : /^__(?=\S)([\s\S]*?\S)__/)) && (ch === '*' || (!isAlnum(src[i - 1]) && !isAlnum(src[i + m[0].length])))) {
      flush(); out.push({ t: 'strong', c: parseInline(m[1]) }); i += m[0].length; continue;
    }
    if ((ch === '*' || ch === '_') && rest[1] !== ch && rest[1] !== ' ' && rest[1] !== undefined
      && (m = rest.match(ch === '*' ? /^\*(?=\S)([^*\n]*?\S)\*(?!\*)/ : /^_(?=\S)([^_\n]*?\S)_(?!_)/))
      && (ch === '*' || (!isAlnum(src[i - 1]) && !isAlnum(src[i + m[0].length])))) {
      flush(); out.push({ t: 'em', c: parseInline(m[1]) }); i += m[0].length; continue;
    }
    if (ch === '\\' && i + 1 < src.length && /[\\`*_[\]()#>+\-.!]/.test(src[i + 1])) { buf += src[i + 1]; i += 2; continue; }
    buf += ch; i++;
  }
  flush();
  return out;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const UL = /^\s*[-*+]\s+(.*)$/;
const OL = /^\s*(\d{1,9})[.)]\s+(.*)$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => { if (para.length) { blocks.push({ t: 'p', c: parseInline(para.join('\n')) }); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m: RegExpMatchArray | null;
    if ((m = line.match(FENCE))) {
      flushPara();
      const fence = m[1]; const lang = m[2]; const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i].trim().startsWith(fence[0].repeat(fence.length)) && /^\s*[`~]+\s*$/.test(lines[i]))) { body.push(lines[i]); i++; }
      blocks.push({ t: 'code', lang, v: body.join('\n') });
      continue;
    }
    if (line.trim() === '') { flushPara(); continue; }
    if (HR.test(line)) { flushPara(); blocks.push({ t: 'hr' }); continue; }
    if ((m = line.match(HEADING))) { flushPara(); blocks.push({ t: 'heading', level: m[1].length as 1 | 2 | 3 | 4 | 5 | 6, c: parseInline(m[2]) }); continue; }
    if (QUOTE.test(line)) {
      flushPara(); const q: string[] = [];
      while (i < lines.length && (m = lines[i].match(QUOTE))) { q.push(m[1]); i++; }
      i--; blocks.push({ t: 'quote', c: parseInline(q.join('\n')) }); continue;
    }
    if (UL.test(line) || OL.test(line)) {
      flushPara();
      const ordered = OL.test(line) && !UL.test(line);
      const start = ordered ? Number(line.match(OL)![1]) : 1;
      const items: Inline[][] = [];
      while (i < lines.length) {
        const l = lines[i]; const u = ordered ? null : l.match(UL); const o = ordered ? l.match(OL) : null;
        if (u) items.push(parseInline(u[1]));
        else if (o) items.push(parseInline(o[2]));
        else if (/^\s{2,}\S/.test(l) && items.length && !UL.test(l) && !OL.test(l)) { items[items.length - 1].push({ t: 'br' }, ...parseInline(l.trim())); }
        else break;
        i++;
      }
      i--;
      blocks.push(ordered ? { t: 'ol', start, items } : { t: 'ul', items });
      continue;
    }
    para.push(line);
  }
  flushPara();
  return blocks;
}

/** Texte brut d'un contenu en ligne (titres de conversation, lecteurs d'écran). */
export function inlineText(c: Inline[]): string {
  return c.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : n.t === 'br' ? ' ' : inlineText(n.c))).join('');
}
