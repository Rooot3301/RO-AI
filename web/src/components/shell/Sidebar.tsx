import { NavLink } from 'react-router-dom';
import { Wordmark } from '../ui/Logo';
import { IconLogout } from '../ui/icons';
import { useAuth } from '../../store/auth';
import { useLive } from '../../store/LiveProvider';
import { pendingApprovals, activeRuns } from '../../lib/runs';
import { NAV } from './nav';

export function Sidebar() {
  const auth = useAuth();
  const runs = useLive((s) => s.runs);
  const pending = runs ? pendingApprovals(runs).length : 0;
  const active = runs ? activeRuns(runs).length : 0;
  const groups = [...new Set(NAV.map((n) => n.group))];
  return (
    <aside className="sidebar" aria-label="Navigation principale">
      <div className="sidebar__brand">
        <Wordmark height={16} />
        <span className="micro sidebar__sub">Control Center</span>
      </div>
      <nav className="sidebar__nav">
        {groups.map((g) => (
          <div className="sidebar__group" key={g}>
            <div className="micro sidebar__glabel">{g}</div>
            {NAV.filter((n) => n.group === g).map((n) => {
              const Icon = n.icon;
              const badge = n.to === '/' && pending > 0 ? { n: pending, tone: 'amber', title: `${pending} approbation(s) en attente` }
                : n.to === '/runs' && active > 0 ? { n: active, tone: 'dim', title: `${active} exécution(s) active(s)` } : null;
              return (
                <NavLink key={n.to} to={n.to} end={n.end} className="navitem" title={n.label}>
                  <Icon />
                  <span className="navitem__label">{n.label}</span>
                  {badge && <span className={`navitem__badge navitem__badge--${badge.tone}`} title={badge.title}>{badge.n}</span>}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="sidebar__foot">
        <div className="sidebar__user">
          <span className="micro">Session</span>
          <span className="mono ellipsis" title={auth.username ?? ''}>{auth.username}</span>
        </div>
        <button type="button" className="navitem navitem--btn" onClick={() => void auth.logout()} title="Se déconnecter">
          <IconLogout /><span className="navitem__label">Déconnexion</span>
        </button>
      </div>
    </aside>
  );
}
