import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parseInline, safeUrl, inlineText, type Block, type Inline } from './markdown.ts';

const walkInline = (c: Inline[], f: (n: Inline) => void) => { for (const n of c) { f(n); if ('c' in n) walkInline(n.c, f); } };
const allInlines = (bs: Block[]): Inline[] => {
  const out: Inline[] = [];
  for (const b of bs) {
    const lists = b.t === 'ul' || b.t === 'ol' ? b.items : 'c' in b ? [b.c] : [];
    for (const l of lists) walkInline(l, (n) => out.push(n));
  }
  return out;
};

test('titres, gras, italique, code en ligne', () => {
  const b = parseMarkdown('# Titre\n\nUn **gras**, un *italique*, du `code *brut*` et _souligné_.');
  assert.equal(b[0].t, 'heading'); assert.equal((b[0] as { level: number }).level, 1);
  const p = b[1] as { c: Inline[] };
  assert.ok(p.c.some((n) => n.t === 'strong'));
  assert.equal(p.c.filter((n) => n.t === 'em').length, 2);
  const code = p.c.find((n) => n.t === 'code') as { v: string };
  assert.equal(code.v, 'code *brut*');
});

test('listes à puces et numérotées', () => {
  const b = parseMarkdown('- un\n- deux **fort**\n\n3. trois\n4. quatre');
  assert.equal(b[0].t, 'ul'); assert.equal((b[0] as { items: unknown[] }).items.length, 2);
  assert.equal(b[1].t, 'ol'); assert.equal((b[1] as { start: number }).start, 3);
});

test('blocs de code : contenu conservé tel quel, y compris du HTML', () => {
  const b = parseMarkdown('```html\n<script>alert(1)</script>\n**pas du gras**\n```\napres');
  assert.equal(b[0].t, 'code');
  assert.equal((b[0] as { lang: string }).lang, 'html');
  assert.equal((b[0] as { v: string }).v, '<script>alert(1)</script>\n**pas du gras**');
  assert.equal(b[1].t, 'p');
  // bloc non fermé : tout le reste est du code, rien n'est perdu
  assert.equal(parseMarkdown('```\nabc')[0].t, 'code');
});

test('injection : HTML brut conservé comme texte', () => {
  const b = parseMarkdown('<script>alert(1)</script> et <img src=x onerror=alert(1)> <b>gras</b>');
  const ins = allInlines(b);
  assert.ok(ins.every((n) => ['text', 'br', 'code', 'strong', 'em', 'link'].includes(n.t)));
  assert.match(inlineText((b[0] as { c: Inline[] }).c), /<script>alert\(1\)<\/script>/);
  assert.equal(ins.some((n) => n.t === 'link'), false);
});

test('injection : liens javascript:, data:, vbscript: jamais cliquables', () => {
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html;base64,AAAA', 'vbscript:x', '//evil.example', 'ftp://x.y/z', ' javascript:alert(1)']) {
    const ins = allInlines(parseMarkdown(`[cliquez](${bad})`));
    assert.equal(ins.some((n) => n.t === 'link'), false, bad);
    assert.match(inlineText(ins), /cliquez/);
  }
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('https://exemple.fr/a?b=1'), 'https://exemple.fr/a?b=1');
  assert.equal(safeUrl('http://exemple.fr'), 'http://exemple.fr/');
  assert.equal(safeUrl('https://'), null);
});

test('liens http(s) et URL nues', () => {
  const ins = allInlines(parseMarkdown('Voir [le site](https://exemple.fr/x) ou https://exemple.fr/doc, merci.'));
  const links = ins.filter((n) => n.t === 'link') as { href: string }[];
  assert.deepEqual(links.map((l) => l.href), ['https://exemple.fr/x', 'https://exemple.fr/doc']);
  // la virgule finale reste hors du lien
  assert.match(inlineText(ins), /doc, merci\./);
});

test('marqueurs non fermés et mots avec underscores restent du texte', () => {
  assert.equal(inlineText(parseInline('un **gras non fermé et snake_case_mot et 2 * 3 * 4')), 'un **gras non fermé et snake_case_mot et 2 * 3 * 4');
  assert.equal(parseInline('snake_case_mot').length, 1);
});

test('retours à la ligne et citation, règle horizontale', () => {
  const b = parseMarkdown('ligne 1\nligne 2\n\n> cité\n> suite\n\n---');
  assert.ok((b[0] as { c: Inline[] }).c.some((n) => n.t === 'br'));
  assert.equal(b[1].t, 'quote'); assert.equal(b[2].t, 'hr');
});

test('entrées dégénérées', () => {
  assert.deepEqual(parseMarkdown(''), []);
  assert.deepEqual(parseMarkdown('\n\n  \n'), []);
  assert.doesNotThrow(() => parseMarkdown('[](  ) [a](  ) ![x](y) **** __ ``` ~~~ # '));
  assert.doesNotThrow(() => parseMarkdown('*'.repeat(5000) + '_'.repeat(5000)));
});
