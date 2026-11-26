import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { EmptyGlyph } from './icons';

export type LedTone = 'ok' | 'warn' | 'err' | 'amber' | 'info' | 'off' | 'neutral';

export function Led({ tone = 'neutral', lit = true, busy = false, label }: { tone?: LedTone; lit?: boolean; busy?: boolean; label?: string }) {
  const cls = ['led', tone !== 'neutral' && `led--${tone}`, lit && tone !== 'off' && tone !== 'neutral' && 'led--lit', busy && 'led--busy'].filter(Boolean).join(' ');
  return <span className={cls} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

export function Tag({ tone = 'neutral', solid, children, title }: { tone?: 'ok' | 'warn' | 'err' | 'amber' | 'info' | 'neutral'; solid?: boolean; children: ReactNode; title?: string }) {
  return <span className={`tag tag--${tone}${solid ? ' tag--solid' : ''}`} title={title}>{children}</span>;
}

export function Panel({ title, meta, children, flush, tone, className = '', id, as: As = 'section' }: {
  title?: ReactNode; meta?: ReactNode; children: ReactNode; flush?: boolean; tone?: 'alert' | 'err'; className?: string; id?: string; as?: 'section' | 'div';
}) {
  const hid = id ? `${id}-title` : undefined;
  return (
    <As id={id} className={`panel${tone ? ` panel--${tone}` : ''} ${className}`} aria-labelledby={title ? hid : undefined}>
      {(title || meta) && (
        <header className="panel__head">
          {title && <h2 className="panel__title" id={hid}>{title}</h2>}
          {meta && <div className="panel__meta">{meta}</div>}
        </header>
      )}
      <div className={`panel__body${flush ? ' panel__body--flush' : ''}`}>{children}</div>
    </As>
  );
}

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger' | 'ok' | 'ghost' | 'stop' | 'stopghost'; size?: 'md' | 'sm'; busy?: boolean; icon?: boolean;
}
export function Button({ variant = 'default', size = 'md', busy, icon, className = '', children, disabled, type = 'button', ...rest }: BtnProps) {
  const cls = ['btn', variant !== 'default' && `btn--${variant}`, size === 'sm' && 'btn--sm', icon && 'btn--icon', className].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Banner({ tone = 'info', title, children, actions }: { tone?: 'err' | 'warn' | 'info' | 'ok'; title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className={`banner banner--${tone}`} role={tone === 'err' ? 'alert' : 'status'}>
      <div className="banner__body">{title && <div className="banner__title">{title}</div>}<div>{children}</div></div>
      {actions}
    </div>
  );
}

export function Skeleton({ rows = 4, widths }: { rows?: number; widths?: string[] }) {
  return (
    <div className="skel-rows" role="status" aria-label="Chargement">
      {Array.from({ length: rows }, (_, i) => <span key={i} className="skel" style={{ width: widths?.[i % widths.length] ?? `${92 - ((i * 17) % 40)}%`, animationDelay: `${i * 90}ms` }} />)}
    </div>
  );
}

export function Empty({ title, children, actions, center, glyph = true }: { title: string; children?: ReactNode; actions?: ReactNode; center?: boolean; glyph?: boolean }) {
  return (
    <div className={`empty${center ? ' empty--center' : ''}`}>
      {glyph && <EmptyGlyph />}
      <div className="empty__title">{title}</div>
      {children && <div className="empty__text">{children}</div>}
      {actions && <div className="empty__actions">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, unit, sub }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}{unit && <small>{unit}</small>}</span>
      {sub && <span className="stat__sub">{sub}</span>}
    </div>
  );
}

/** Message d'erreur de chargement avec bouton « Réessayer ». */
export function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Banner tone="err" title="Chargement impossible" actions={onRetry && <Button size="sm" onClick={onRetry}>Réessayer</Button>}>{message}</Banner>
  );
}
