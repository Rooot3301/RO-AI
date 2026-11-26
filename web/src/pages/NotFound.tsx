import { Link } from 'react-router-dom';
import { Empty } from '../components/ui/primitives';
import { useDocumentTitle } from '../hooks/useNow';

export default function NotFoundPage() {
  useDocumentTitle('Page introuvable');
  return (
    <div className="page">
      <div className="panel"><Empty title="Page introuvable" center>Cette adresse ne correspond à aucune vue du Control Center. <Link to="/">Retour au pont de commande</Link></Empty></div>
    </div>
  );
}
