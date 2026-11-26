import { useNow } from '../../hooks/useNow';
import { formatDateTime, formatCountdown, relativeTime } from '../../lib/format';

/** Temps relatif rafraîchi ; l'horodatage exact reste dans l'infobulle. */
export function Rel({ iso, tz }: { iso: string | null | undefined; tz?: string }) {
  const now = useNow();
  if (!iso) return <span className="faint">—</span>;
  return <time dateTime={iso} title={formatDateTime(iso, tz, true)}>{relativeTime(iso, now)}</time>;
}
export function Countdown({ iso }: { iso: string | null | undefined }) {
  const now = useNow();
  if (!iso) return <span className="faint">—</span>;
  return <time dateTime={iso} title={formatDateTime(iso, undefined, true)}>{formatCountdown(iso, now)}</time>;
}
