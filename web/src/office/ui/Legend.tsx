import { IconGlyph } from './Portrait.tsx';
import type { IconName } from '../engine/draw.ts';
import { ICON_LABEL_FR } from '../engine/draw.ts';
import { STATE_LABEL_FR } from '../state/visual.ts';
import type { AgentState } from '../../api/types.ts';

const STATE_HELP: Record<AgentState, string> = {
  working: 'à son poste, écran allumé selon l’activité réelle (terminal, lecture, web…)',
  waiting: 'debout près de son poste (file) ou en salle d’attente, main levée (approbation)',
  error: 'alarme rouge au poste ; « Quota atteint » si la limite du fournisseur est atteinte',
  idle: 'libre : vie de bureau simulée (si l’option « Vie sociale » est active)',
  disabled: 'absent : le poste reste, avec un signe « absent »',
};
const ICONS: IconName[] = ['failed', 'auth_expired', 'rate_limited', 'denied', 'timeout', 'transient', 'success', 'hand', 'dots', 'retry', 'read', 'code', 'web', 'plug'];

export function Legend({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="office-legend">
      <button type="button" className="office-legend__toggle" aria-expanded={open} onClick={onToggle}>Légende {open ? '−' : '+'}</button>
      {open && (
        <div className="office-legend__body">
          <ul className="office-legend__states">
            {(Object.keys(STATE_LABEL_FR) as AgentState[]).map((s) => (
              <li key={s}><span className={`office-dot office-dot--${s}`} aria-hidden="true" /><b>{STATE_LABEL_FR[s]}</b> · {STATE_HELP[s]}</li>
            ))}
          </ul>
          <p className="office-legend__core"><span className="office-diamond" aria-hidden="true" /> <b>Orchestrateur</b> · le noyau, dans sa régie : visualise la file (pile de fiches), les lancements (fiche en vol), les approbations (presse-papier) et les planifications (réveil). Ce n'est pas un agent.</p>
          <p className="office-legend__core"><span className="office-legend__real" aria-hidden="true">Démarre</span> Bulle sombre à point ambre : activité <b>réelle</b> (événement reçu). <span className="office-legend__fake" aria-hidden="true">Salut !</span> Bulle claire en italique : conversation <b>fictive</b> de la vie de bureau, sans lien avec le travail réel.</p>
          <p className="office-legend__core">Aucune réunion entre agents n'est simulée : RO·AI n'a pas de collaboration entre agents. La <b>salle serveur</b> représente la machine qui héberge RO·AI : ses voyants suivent les exécutions et le processeur, une baie porte les jauges mémoire (M) et disque (D) ; un clic ouvre les mesures réelles.</p>
          <p className="office-legend__core"><b>Tableaux réels</b> · dans le hall, le <b>planning du jour</b> (prochaines missions planifiées, compte à rebours) ; en salle serveur, l’<b>écran des limites d’usage</b> de Claude et Codex (barre 5 h et 7 jours). Cliquer sur un tableau ouvre le détail. Cliquer sur la <b>salle d’attente</b> ou sur un agent qui lève la main permet d’approuver ou de rejeter sa demande.</p>
          <p className="office-legend__core"><b>Pièces utiles</b> · la <b>salle de réunion</b> accueille les agents avec qui tu discutes (Chat, /parler), pendant l’échange et 5 min après ; la <b>bibliothèque</b> archive les rapports réels : après une mission réussie avec un résultat, l’agent vient l’y ranger. En zoomant sur un poste au travail, son écran affiche ses 3 dernières actions réelles. <b>Arrêt d’urgence</b> : éclairage rouge, régie « SUSPENDU », vie de bureau figée. <b>Saisons</b> et fêtes (heure de Paris) : arbres, sapins et guirlande à Noël, drapeaux le 14 juillet ; le week-end et les jours fériés, le bureau est plus calme (décor seulement).</p>
          <p className="office-legend__core"><b>Étages</b> · au <b>RDC</b>, l’accueil, la régie, les approbations, la réunion, la bibliothèque et le serveur ; au <b>1er</b>, les postes des agents, la salle de repos et la kitchenette. Boutons « RDC / 1er » (nombre d’agents présents) ou clic sur le palier (escalier, ascenseur) au bout du couloir. Un agent ne change d’étage que pour aller là où l’appelle son état réel ou la vie de bureau.</p>
          <p className="office-legend__core"><b>Ambiance</b> (bouton « Animations ») · rue avec passants, vélos et circulation ; voitures garées le jour en semaine et parties le soir (heure de Paris) ; lampadaires et phares la nuit ; trotteuse des horloges, voyants, souffle de la clim. Ce sont des figurants, sans lien avec le travail des agents. La <b>boîte aux lettres</b> de l’accueil compte les rapports réels arrivés depuis ta dernière visite de la bibliothèque (clic : ouvre la bibliothèque). Sur l’écran d’un poste, la barre de titre montre la cible réelle de l’action en cours (fichier, site, commande).</p>
          <p className="office-legend__core"><b>Personnel</b> (badge sur la poitrine, étiquette « personnel ») : réceptionniste, technicien, agent d'entretien le soir. Ce sont des figurants non pilotés par l'IA ; l'accueil ne donne que des informations calculées depuis les données réelles, le technicien ne se déplace vers une baie ou vers l’écran des limites que sur une vraie alerte.</p>
          <p className="office-legend__core"><b>Claude Code</b> (sweat sombre, liseré et badge orange) : une vraie session Claude Code qui développe RO·AI sur ce serveur. Elle entre par l’accueil quand elle commence à travailler, s’installe devant une baie de la salle serveur, lève la main quand elle t’attend et repart 45 s après la fin de son tour. Clic : ses dernières actions (lecture seule).</p>
          <p className="office-legend__core"><b>Livraisons</b> : une camionnette s’arrête devant l’entrée quand un outil externe (PerforceBot…) envoie de vraies informations ; le livreur les dépose à l’accueil, qui annonce le destinataire, et un colis reste sur son bureau jusqu’au traitement.</p>
          <p className="office-legend__core"><b>Fil</b> (bouton de la barre) : le réseau social interne. Chaque matin, un seul appel Claude Haiku écrit les publications, le journal de chaque agent et les dialogues de pause à partir de leurs faits réels ; plafond de 4 appels par jour, rien au-delà de 60 % d’une limite Claude.</p>
          <ul className="office-legend__icons">
            {ICONS.map((n) => <li key={n}><IconGlyph name={n} />{ICON_LABEL_FR[n]}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
