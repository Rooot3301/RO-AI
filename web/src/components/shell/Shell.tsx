import { Suspense } from 'react';
import { Outlet, useLocation, matchPath } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { EmergencyBanner, useStopTitle } from './Emergency';
import { ErrorBoundary } from './ErrorBoundary';
import { NAV } from './nav';
import { Skeleton } from '../ui/primitives';

function titleFor(path: string): string {
  const hit = NAV.find((n) => matchPath({ path: n.to, end: n.end ?? false }, path));
  if (path.startsWith('/agents/new')) return 'Agents / Nouveau';
  return hit?.label ?? 'Control Center';
}

export function Shell() {
  const loc = useLocation();
  const bleed = loc.pathname.startsWith('/office');
  useStopTitle();
  return (
    <div className="shell">
      <a href="#main" className="skip">Aller au contenu</a>
      <Sidebar />
      <StatusBar title={titleFor(loc.pathname)} />
      <EmergencyBanner />
      <main id="main" className={`main${bleed ? ' main--bleed' : ''}`} tabIndex={-1}>
        <ErrorBoundary resetKey={loc.pathname}>
          <Suspense fallback={<div className="page"><Skeleton rows={6} /></div>}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
