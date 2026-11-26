/** Mot-symbole RO·AI : texte simple, point médian ambre. */
export function Wordmark({ height = 20, title = 'RO·AI' }: { height?: number; title?: string }) {
  return (
    <span className="wordmark" role="img" aria-label={title} style={{ fontSize: Math.round(height * 0.95), lineHeight: 1 }}>
      RO<span className="wordmark__dot">·</span>AI
    </span>
  );
}

/** Marque seule (barre latérale réduite, favicon). */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-label="RO·AI" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="6" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="3" fill="var(--amber)" />
    </svg>
  );
}

export const FAVICON_SVG = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#0a0d13"/><rect x="3.5" y="3.5" width="17" height="17" fill="none" stroke="#d6dbe5" stroke-width="2"/><rect x="9.5" y="9.5" width="5" height="5" fill="#ffb347"/></svg>',
);
