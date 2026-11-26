import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { RoEvent } from '../api/types';
import { describeEvent, truncatePreview, type Tone } from '../lib/events';
import { formatTime } from '../lib/format';
import { Led, type LedTone } from './ui/primitives';

const LED: Record<Tone, LedTone> = { neutral: 'off', ok: 'ok', warn: 'warn', err: 'err', amber: 'amber', info: 'info' };

/** Ligne d'événement. Tout le contenu issu des agents est rendu comme texte. */
export function EventRow({ e, agentName, compact, expandable }: { e: RoEvent; agentName?: string; compact?: boolean; expandable?: boolean }) {
  const [open, setOpen] = useState(false);
  const v = describeEvent(e);
  const detail = v.detail ? (compact ? truncatePreview(v.detail, 140) : v.detail) : '';
  let raw = '';
  if (open) { try { raw = JSON.stringify(e.payload, null, 2); } catch { raw = ''; } }
  return (
    <li className={`evrow evrow--${v.level}${compact ? ' evrow--compact' : ''}`}>
      <div className="evrow__line">
        <time className="evrow__time num" dateTime={e.ts} title={e.ts}>{formatTime(e.ts)}</time>
        <Led tone={LED[v.tone]} lit={v.tone !== 'neutral'} />
        <div className="evrow__main">
          <span className={`evrow__title evrow__title--${v.tone}`}>{v.title}</span>
          {agentName && e.agent_id && <Link className="evrow__agent" to={`/agents/${e.agent_id}`}>{agentName}</Link>}
          {e.run_id && !compact && <Link className="evrow__run mono" to={`/runs/${e.run_id}`}>{e.run_id}</Link>}
          {detail && <span className="evrow__detail untrusted">{detail}</span>}
        </div>
        {expandable && <button type="button" className="evrow__toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'Réduire' : 'Détail'}</button>}
      </div>
      {open && <pre className="evrow__raw untrusted">{`seq ${e.seq} · ${e.type} · domaine ${e.domain}\n${raw}`}</pre>}
    </li>
  );
}
