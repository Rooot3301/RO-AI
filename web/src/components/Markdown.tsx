import { Fragment, memo, useMemo, type ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from '../lib/markdown';

function inlines(c: Inline[]): ReactNode {
  return c.map((n, i) => {
    switch (n.t) {
      case 'text': return <Fragment key={i}>{n.v}</Fragment>;
      case 'br': return <br key={i} />;
      case 'code': return <code key={i}>{n.v}</code>;
      case 'strong': return <strong key={i}>{inlines(n.c)}</strong>;
      case 'em': return <em key={i}>{inlines(n.c)}</em>;
      case 'link': return <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">{inlines(n.c)}</a>;
    }
  });
}

function block(b: Block, i: number): ReactNode {
  switch (b.t) {
    case 'heading': { const H = (`h${Math.min(6, b.level + 1)}`) as 'h2'; return <H key={i} className="md__h">{inlines(b.c)}</H>; }
    case 'p': return <p key={i}>{inlines(b.c)}</p>;
    case 'ul': return <ul key={i}>{b.items.map((it, j) => <li key={j}>{inlines(it)}</li>)}</ul>;
    case 'ol': return <ol key={i} start={b.start}>{b.items.map((it, j) => <li key={j}>{inlines(it)}</li>)}</ol>;
    case 'code': return <pre key={i} className="md__pre" tabIndex={0} aria-label={b.lang ? `Bloc de code ${b.lang}` : 'Bloc de code'}><code>{b.v}</code></pre>;
    case 'quote': return <blockquote key={i}>{inlines(b.c)}</blockquote>;
    case 'hr': return <hr key={i} />;
  }
}

/** Rendu Markdown sûr : uniquement des éléments React construits depuis l'arbre analysé (aucun HTML brut). */
export const Markdown = memo(function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className={`md untrusted ${className}`}>{blocks.map(block)}</div>;
});
