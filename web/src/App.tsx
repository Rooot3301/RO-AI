import { lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './store/auth';
import { ToastProvider } from './store/toast';
import { LiveProvider } from './store/LiveProvider';
import { Shell } from './components/shell/Shell';
import { Wordmark } from './components/ui/Logo';
import { Banner, Button } from './components/ui/primitives';
import LoginPage from './pages/Login';
import OverviewPage from './pages/Overview';
import AgentsPage from './pages/Agents';
import AgentEditPage from './pages/AgentEdit';
import RunsPage from './pages/Runs';
import RunDetailPage from './pages/RunDetail';
import SchedulesPage from './pages/Schedules';
import InboxPage from './pages/Inbox';
import LogsPage from './pages/Logs';
import ProvidersPage from './pages/Providers';
import StatsPage from './pages/Stats';
import SettingsPage from './pages/Settings';
import ChatPage from './pages/Chat';
import NotFoundPage from './pages/NotFound';

// Le Bureau virtuel est chargé à la demande (module indépendant).
const OfficeView = lazy(() => import('./office'));

function Gate() {
  const auth = useAuth();
  const loc = useLocation();
  if (auth.status === 'loading') return <Boot />;
  if (auth.status === 'error') {
    return (
      <div className="boot">
        <Wordmark height={26} />
        <Banner tone="err" title="Serveur injoignable" actions={<Button size="sm" onClick={auth.retry}>Réessayer</Button>}>{auth.error}</Banner>
      </div>
    );
  }
  if (auth.status === 'anon') return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return (
    <LiveProvider>
      <Shell />
    </LiveProvider>
  );
}

function Boot() {
  return (
    <div className="boot" role="status" aria-label="Chargement">
      <Wordmark height={26} />
      <span className="micro">Initialisation <span className="spinner" style={{ marginLeft: 6 }} /></span>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<Gate />}>
            <Route index element={<OverviewPage />} />
            <Route path="agents" element={<AgentsPage />} />
            <Route path="agents/new" element={<AgentEditPage />} />
            <Route path="agents/:id/chat" element={<ChatPage />} />
            <Route path="agents/:id" element={<AgentEditPage />} />
            <Route path="runs" element={<RunsPage />} />
            <Route path="runs/:id" element={<RunDetailPage />} />
            <Route path="schedules" element={<SchedulesPage />} />
            <Route path="inbox" element={<InboxPage />} />
            <Route path="logs" element={<LogsPage />} />
            <Route path="stats" element={<StatsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="providers" element={<ProvidersPage />} />
            <Route path="office/*" element={<OfficeView />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}
