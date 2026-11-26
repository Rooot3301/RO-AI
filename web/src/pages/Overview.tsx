import { Link } from 'react-router-dom';
import { Banner, Button } from '../components/ui/primitives';
import { IconPlus } from '../components/ui/icons';
import { useLive, useLiveStore } from '../store/LiveProvider';
import { useDocumentTitle } from '../hooks/useNow';
import { ProvidersPanel } from './overview/ProvidersPanel';
import { SystemPanel } from './overview/SystemPanel';
import { AgentsPanel } from './overview/AgentsPanel';
import { RunsPanel } from './overview/RunsPanel';
import { ApprovalsPanel } from './overview/ApprovalsPanel';
import { ActivityPanel } from './overview/ActivityPanel';
import './Overview.css';

export default function OverviewPage() {
  useDocumentTitle('Tableau de bord');
  const store = useLiveStore();
  const loadError = useLive((s) => s.loadError);
  return (
    <div className="page">
      <div className="page__head">
        <div className="page__titles">
          <div className="micro page__crumb">Vue d’ensemble</div>
          <h1 className="page__title">Tableau de bord</h1>
          <p className="page__sub">État en direct de la plateforme : fournisseurs, ressources, agents et décisions en attente.</p>
        </div>
        <div className="page__actions"><Link to="/agents/new"><Button variant="primary"><IconPlus />Nouvel agent</Button></Link></div>
      </div>
      {loadError && <div style={{ marginBottom: 16 }}><Banner tone="err" title="Données incomplètes" actions={<Button size="sm" onClick={store.retryLoad}>Réessayer</Button>}>{loadError}</Banner></div>}
      <div className="ov">
        <div className="ov__col">
          <ProvidersPanel />
          <AgentsPanel />
          <RunsPanel />
        </div>
        <div className="ov__col">
          <ApprovalsPanel />
          <SystemPanel />
          <ActivityPanel />
        </div>
      </div>
    </div>
  );
}
