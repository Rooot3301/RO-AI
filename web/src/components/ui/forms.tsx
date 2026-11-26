import { cloneElement, useId, type ChangeEvent, type ReactElement, type ReactNode } from 'react';

/** Étiquette + contrôle + aide + erreur, avec les liaisons ARIA nécessaires. */
export function Field({ label, hint, error, required, children, className = '', right }: {
  label: string; hint?: ReactNode; error?: string; required?: boolean; className?: string; right?: ReactNode;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean; 'aria-required'?: boolean }>;
}) {
  const id = useId();
  const describedBy = [hint ? `${id}-h` : '', error ? `${id}-e` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${className}`}>
      <label className="field__label" htmlFor={id}>
        <span>{label}</span>{required && <span className="field__req" aria-hidden="true">*</span>}
        {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
      </label>
      {cloneElement(children, { id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined, 'aria-required': required || undefined })}
      {hint && <div className="field__hint" id={`${id}-h`}>{hint}</div>}
      {error && <div className="field__err" id={`${id}-e`} role="alert">{error}</div>}
    </div>
  );
}

export function Seg<T extends string | number>({ name, value, options, onChange, label, size, disabled }: {
  name: string; value: T; options: { value: T; label: ReactNode; title?: string; disabled?: boolean }[]; onChange: (v: T) => void; label: string; size?: 'sm'; disabled?: boolean;
}) {
  return (
    <div className={`seg${size === 'sm' ? ' seg--sm' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label key={String(o.value)} className="seg__opt" title={o.title}>
          <input type="radio" name={name} checked={o.value === value} disabled={disabled || o.disabled} onChange={(e: ChangeEvent<HTMLInputElement>) => { if (e.target.checked) onChange(o.value); }} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, children, disabled, label, danger }: { checked: boolean; onChange: (v: boolean) => void; children?: ReactNode; disabled?: boolean; label?: string; danger?: boolean }) {
  return (
    <label className={`switch${danger ? ' switch--danger' : ''}`}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} aria-label={children ? undefined : label} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch__track" aria-hidden="true" />
      {children && <span className="switch__text">{children}</span>}
    </label>
  );
}
