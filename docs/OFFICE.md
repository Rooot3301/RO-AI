# Virtual Office — moteur du siège virtuel

Le Virtual Office (`web/src/office/`) représente RO·AI comme le siège d'une entreprise vu de dessus, en « trois-quarts »
(murs coupés à mi-hauteur, mobilier avec dessus et façade), dessiné entièrement par code en Canvas 2D. Aucune image,
police ou ressource externe n'est chargée au rendu ; aucune requête réseau n'est émise par la simulation.

## Règle d'honnêteté

Deux couches, strictement séparées :

| Couche | Source | Exemples visibles |
|---|---|---|
| **Réelle** (prioritaire) | snapshot `/api/office/snapshot` + flux SSE (`state/model.ts`) | poste occupé et écran allumé selon `tool_kind`, file d'attente, salle d'attente des approbations, alarme d'erreur, « Quota atteint » (`rate_limited`), réussite, absence (`enabled:false`), fiches de l'orchestrateur, voyants de la salle serveur (plus actifs quand des exécutions tournent), décor personnel de la fiche |
| **Décorative** (désactivable) | simulation locale déterministe (`engine/sim.ts`, `engine/social.ts`) | promenades, café, salle de repos, bibliothèque, fenêtre, salutations et petites conversations |

- « Pas d'événement, pas d'animation » pour tout ce qui prétend être réel. La vie sociale ne concerne que les agents **libres**
  (état `idle`) et cède immédiatement la place à l'état réel (une exécution qui démarre interrompt toute conversation).
- Les bulles fictives sont claires, grises, en italique ; les indications réelles sont sombres avec un point ambre ou des pastilles
  d'état. Les répliques ne parlent jamais du travail (ni mission, ni résultat, ni progression) — un test le vérifie.
- La **salle de réunion reste vide** : RO·AI n'a pas de collaboration multi-agents ; aucun emplacement n'y est proposé à la
  simulation (testé). Elle est prête pour une future fonction de collaboration réelle.
- Zéro appel réseau, zéro événement, zéro écriture serveur pour la simulation. Les seules écritures du bureau sont explicites :
  l'agencement (mode « Aménager », `PUT /api/office/layout`) et les fiches (panneau du personnage).

## Plan (`layout/plan.ts`)

Génération pure et déterministe à partir des départements et des agents (rang = ordre du snapshot, donc un nouvel agent
prend le dernier poste de son département) :

- **Ailes** : chaque aile = rangée de pièces au nord, couloir (3 cases), rangée au sud. Une à trois ailes, choisies pour
  remplir au mieux l'écran (`fitPlan`), reliées par un couloir vertical. Le bâtiment s'agrandit quand on ajoute des agents
  ou des départements (pièces plus larges, plus de pièces, aile supplémentaire).
- **Deux étages**, même emprise, dans la même grille (l'étage n occupe les rangées `[n·floorRows, (n+1)·floorRows)`,
  `levelOfRow` / `levelOfY` / `levelRect`). **Rez-de-chaussée** : hall d'accueil (entrée principale vitrée dans le mur
  sud, parvis d'où arrivent les nouveaux agents), régie de l'orchestrateur, attente des approbations (près du hall),
  espace café, salle de réunion, bibliothèque, salle serveur. **1er étage** : open spaces des départements (tous les
  postes), salle de repos, kitchenette ; pièces d'appoint (« Espace détente », « Salle calme ») quand une rangée est
  beaucoup plus courte que la plus longue des deux étages. Coins fenêtre aux extrémités.
- **Palier** (`landing`, « Escalier · ascenseur ») : cage en saillie au bout est du couloir principal, ouverte sur lui,
  à chaque étage. Ascenseur au mur nord, escalier en U contre le pignon est (dessiné au sol : montée au RDC, trémie et
  descente au 1er), baie réseau d'étage au 1er. `portals` : case d'attente devant l'ascenseur et pied de l'escalier,
  par étage. La connexité se vérifie depuis l'entrée et depuis l'accès de chaque étage supérieur (`levelSeeds`).
- **Postes** : module de 4 × 3 cases (plan de travail 3 cases + caisson, siège, allée) ; 2 ou 3 rangées selon la taille du plus
  grand département. Pièces vitrées côté couloir (open spaces, réunion, régie, bibliothèque, serveurs), portes de 2 cases.
- **Mobilier** placé par `Placer` : chaque meuble est validé (dans sa pièce, sans chevauchement, portes dégagées) et la
  **connexité** depuis l'entrée est vérifiée (BFS) pour toutes les portes, tous les sièges, places debout et emplacements
  d'usage. Les emplacements (`spotsOf`) se déduisent du meuble : s'asseoir (canapé, fauteuil, siège d'attente), se servir
  (machine à café, distributeur, fontaine), consulter (étagère), boire (mange-debout), regarder (fenêtre).
- **Personnalisation** (`layout/editor.ts`) : document versionné `{version:1, furniture:{"<pièce>/<type>-<rang>":{x,y,dir,hidden}}}`
  (positions relatives à la pièce, ≤ 64 Kio). Chaque modification recalcule le plan : refus si chevauchement, sortie de pièce,
  porte bloquée ou passage coupé ; une entrée devenue invalide (plan modifié) est ignorée, le meuble garde sa place d'origine.
  Postes, régie, salle serveur, guichet et portes sont fixes.

## Navigation (`layout/pathfinding.ts`, `engine/sim.ts`)

- A* 8-connexe sans couper les angles, tas binaire, tampons réutilisés (aucune allocation par recherche), coût par case
  (sièges et emplacements contournés), cases à éviter, plafond d'expansions ; au plus `PATHS_PER_FRAME` (6) recherches par image.
- Réservation des cases (occupation) et des emplacements (un siège = une personne). Évitement local : attendre, recalculer
  en évitant la case occupée, céder le passage (se décaler sur une case libre, priorité à l'état réel), et en dernier recours,
  après une longue attente, se croiser. Jamais de traversée de mur ou de meuble ; pas de téléportation dans les déplacements
  ordinaires (placement direct au premier chargement et lors d'une réorganisation du bâtiment).
- Portes animées (s'ouvrent à l'approche), marche dans 4 directions, postures : frappe (écriture), frappe rapide (terminal),
  lecture, souris (web), alarme, bras croisés (quota), main levée (approbation), tasse, livre, discussion…

## Vie sociale (`engine/social.ts`)

Machine d'états par personnage avec minuteries et générateur pseudo-aléatoire à graine : bureau, café (puis mange-debout),
fontaine, distributeur, canapé ou fauteuil, étagère (puis lecture), fenêtre, promenade, visite à un collègue. La personnalité
de la fiche module les poids (concentration ⇒ bureau, énergie / curiosité ⇒ promenades, café ⇒ pauses, sociabilité ⇒
discussions). Deux agents libres qui se croisent dans un espace dégagé peuvent s'arrêter, se tourner l'un vers l'autre et
échanger 2 à 4 répliques (recharge par paire, plafond de conversations simultanées, rotation des dialogues récents). Après
une réussite réelle, l'agent reste un moment à son poste puis s'accorde plus volontiers une pause. Banques : plus de
100 répliques adaptées à l'heure et au jour de Paris (salutations, café, pause, lumière, fin de journée, week-end…).

## Rendu (`engine/`)

- `baker.ts` : deux couches pré-rendues à la résolution courante (sol ; volumes : murs avec décor mural, mobilier, postes
  personnalisés), régénérées seulement si le plan, les fiches, l'échelle (après stabilisation) ou la police changent.
- `renderer.ts` : chaque image, les volumes visibles sont redessinés par sous-image et intercalés (tri en profondeur) avec les
  personnages, chaises, portes et l'orchestrateur ; puis éclairage, effets réels, étiquettes en pixels écran.
  Hors champ : rien n'est dessiné. Boucle adaptative (0 à 60 images/s) **arrêtée quand l'onglet est masqué**.
- `props.ts` : mobilier, décor mural et postes ; le décor personnel suit `profile.decor` (thème, objets, couleur d'accent :
  cloison, écrans supplémentaires, affiches, maquettes, livres, baie réseau…). `avatar.ts` : personnages selon
  `profile.appearance` (peau, cheveux, coiffure, tenue, accessoire), repli sur `avatar.sprite`.
- `daylight.ts` + `lighting.ts` : jour/nuit à l'heure réelle de Paris (lever/coucher approchés selon la saison), soleil par
  les fenêtres le jour, voile de nuit avec salles éclairées, lampes, halos d'écrans. Préférence « Auto / Jour / Nuit ».

## Postes : emplacements réservés (`layout/deskSlots.ts`)

Chaque poste a des emplacements fixes qui ne se chevauchent pas : zone des écrans (1, 2 ou 3 selon `second_monitor` /
`multi_monitor`), clavier et souris, deux affiches sur la cloison (gauche, droite), trois emplacements posés (gauche, droite,
dessus du caisson) et un petit devant le clavier, un objet au sol (baie réseau ou mini-serveur, à la place du caisson),
plaque nominative et post-it (planification réelle) sur la façade. Les objets sont répartis du plus encombrant au plus petit ;
un objet sans place compatible est écarté plutôt que superposé (testé : thèmes par défaut, toutes les paires, 3 000
combinaisons aléatoires). Un agent désactivé a un panneau « ABSENT » accroché à sa chaise rangée, sous le bureau.
Les étiquettes de nom cherchent une place libre (sous les pieds, à droite, à gauche, au-dessus, puis en taille compacte) sans
mur, poste ni meuble haut ; un agent au repos sans place n'affiche pas son nom (survol ou sélection toujours possibles).
Les plaques de pièce sont posées dans le couloir, devant la porte.

## Personnel figurant (`engine/staff.ts`)

Non pilotés par l'IA, absents de la liste et des compteurs, badge et étiquette « personnel », bulles au style fictif :
- **Réceptionniste** derrière la banque d'accueil (vie sociale active : de temps en temps une petite tâche dans le hall,
  arroser une plante, regarder la borne ou la boîte aux lettres, un verre d'eau, ranger la table basse, puis retour ;
  une livraison réelle la ramène aussitôt à la banque) : salue les agents qui traversent le hall et donne des faits **réels**
  calculés depuis les données déjà chargées (agents au travail, approbations en attente, file, erreurs, prochaine mission
  planifiée et son heure, heure de Paris) ; sans donnée, uniquement des formules de politesse. Clic : panneau « Accueil ».
- **Technicien** de la salle serveur : reste au poste de supervision ou fait des rondes calmes ; ne va vers une baie que sur
  une vraie alerte (mémoire ≥ 85 %, disque ≥ 90 %, fournisseur déconnecté, exécution en erreur « délai / transitoire »).
- **Agent d'entretien** en soirée (19 h – 23 h, heure de Paris), avec son chariot, si la vie sociale est active.

## Salle serveur · ro-ai

Représente la machine qui héberge RO·AI. Un clic sur la salle (ou sur le technicien) ouvre le panneau « Serveur RO·AI » :
processeur et charge, mémoire, échange, disque, tranche des agents IA, exécutions en cours, file, disponibilité, état des
fournisseurs. `GET /api/system` est interrogé toutes les 7 s panneau ouvert, toutes les 60 s sinon (voyants et jauges), jamais
quand l'onglet est masqué. Les voyants suivent les exécutions réelles et la charge processeur ; une baie porte les jauges
mémoire (M) et disque (D) ; un voyant d'alerte s'allume au-dessus d'une baie en cas de seuil dépassé ou de fournisseur déconnecté.

## Tableaux réels et approbations (`state/boards.ts`, `state/useBoards.ts`, `ui/BoardPanels.tsx`, `ui/Approvals.tsx`)

Données de `GET /api/office/boards` (lecture seule, aucun appel aux clients IA) : relues 3 s après un événement qui peut
les changer (planification, cycle de vie d'exécution, limite, agent), toutes les 5 min sinon, jamais onglet masqué.

- **Planning du jour** (tableau mural du hall, clic → panneau) : occurrences d'aujourd'hui (heure de Paris) des
  planifications actives et sort réel de chacune (`succeeded`, `failed`, `running`…, `missed` = horaire passé sans
  exécution, `upcoming`). Les exécutions d'une planification hors horaire (« Lancer maintenant », rattrapage) sont
  listées comme telles. Agent désactivé : signalé (le planificateur ne lancera rien). Arrêt d'urgence : « suspendu ».
- **Limites d'usage** (écran sur pied de la salle serveur, clic → section du panneau Serveur) : fenêtres relevées par
  les clients officiels pendant les exécutions — Claude : statut (`rate_limit_event`), pourcentage seulement s'il est
  fourni ; Codex : pourcentage utilisé lu dans son fichier de session (`rate_limits`). Une fenêtre dont l'heure de
  remise à zéro est passée s'affiche « remise à zéro », sans pourcentage (inconnu jusqu'à la prochaine exécution).
  Seuils : avertissement à 80 % ou signal `allowed_warning`, alerte si atteinte. Le technicien va lire l'écran
  seulement dans ces cas (après mémoire, disque et fournisseur déconnecté, plus graves).
- **Approbations** : clic sur un agent qui lève la main (carte en tête de sa fiche), sur la salle d'attente ou sur le
  compteur « Attente » (liste complète). Mêmes appels et mêmes protections que le Control Center
  (`POST /api/runs/{id}/approve|reject` via le BFF : session + CSRF), même retour (toast). Approuver lance réellement
  l'exécution. La demande est affichée comme texte non interprété.
- Après chaque fin d'exécution, le bureau relit le snapshot : un agent qui a d'autres demandes en file ou en attente
  d'approbation reste « en attente » (c'est le serveur qui fait foi).

## Pièces utiles, écran du poste, arrêt d'urgence, saisons

- **Écran du poste** : les 3 dernières actions réelles (résumés `tool.call`, snapshot `recent_actions` puis flux SSE) sont
  écrites sur le moniteur ; à partir d'un zoom ×2,6, la bulle d'activité devient « l'écran agrandi » (repère écran, lisible).
- **Salle de réunion = conversations réelles** : exécution `reply`, ou `notify_target` `chat` (premier message de la page
  Chat, `via: "chat"`) / `discord` (/parler). L'agent s'y assoit pendant l'exécution et 5 min après la dernière réponse
  (snapshot `conversation`, événement `run.queued` avec `conversation`). Chaises « meet » réservées : la vie sociale ne les
  utilise jamais. Une mission ordinaire, une approbation ou une erreur reste prioritaire (poste, salle d'attente).
- **Discuter depuis le bureau** : onglet « Discuter » du panneau personnage (bouton de la barre d'outils, « Voir la
  conversation » des instructions, « Ouvrir la conversation » de la salle de réunion). Même code que la page Chat
  (`hooks/useAgentChat.ts`, `components/chat/ChatThread.tsx`) : mêmes appels (`POST /api/agents/{id}/run` avec
  `via: "chat"`, `POST /api/runs/{id}/reply`), mêmes protections (arrêt d'urgence, agent désactivé, approbation).
  Liste déroulante des conversations ; sur « Nouvelle conversation », les conversations passées sont listées et se
  reprennent d’un clic. La conversation en cours (salle de réunion) est présélectionnée, sinon une
  nouvelle. « Agrandir » ouvre la même conversation dans la page Chat.
- **Bibliothèque = archives** : après `run.succeeded` avec un résultat (hors conversation), l'agent va ranger le rapport
  (étagère de la bibliothèque, ~40 s), puis revient. Clic sur la pièce : `GET /api/office/archive` (derniers rapports).
- **Arrêt d'urgence** : snapshot `control` + événements `system.emergency_stop` / `system.resumed` : voile rouge tamisé,
  régie « SUSPENDU », vie sociale suspendue (agents à leur poste). Le bandeau global du Control Center garde « Reprendre ».
- **Saisons et fêtes** (`engine/calendar.ts`, heure de Paris) : arbres extérieurs en fleurs, roux avec feuilles au sol ou
  dépouillés ; sapins à l'entrée et guirlande du hall du 1er décembre au 6 janvier ; drapeaux tricolores du 13 au 15 juillet.
  Week-end et jours fériés français : vie sociale ralentie, pas d'agent d'entretien. Aucun effet sur le travail réel.

## Rue, immeuble et petites animations (`engine/street.ts`, `layout/plan.ts`)

- **Rue** (5 rangées sous le parvis) : trottoir avec lampadaires, places de stationnement, chaussée à deux voies avec
  passage piéton face à l'entrée, trottoir d'en face. Chaque place a un horaire déterministe par jour (arrivée 7 h –
  9 h 30, départ 16 h 30 – 19 h 30, heure de Paris), forte occupation en semaine, faible le week-end et les jours fériés,
  quelques riverains toujours garés. Passants, vélos et circulation plus nombreux en journée. Tout est figurant ; rien
  ne bouge quand « Animations » est coupé (les voitures restent garées selon l'horaire).
- **Étages** (`engine/sim.ts`) : un but à l'autre étage fait passer par le palier. Escalier (montée en fondu, palier,
  arrivée par l'escalier de l'autre étage) ou ascenseur (appel de la cabine si elle est à l'autre étage, portes
  ouvertes, entrée en fondu, trajet, sortie) : environ deux trajets sur cinq en ascenseur pour les agents, l'escalier
  pour le technicien, l'ascenseur pour l'agent d'entretien (chariot). La cabine est simulée localement (`world.lift` :
  étage, trajet, portes) ; son indicateur montre l'étage réel de la cabine (▲ / ▼ pendant le trajet). Le technicien
  passe parfois à la baie réseau du 1er ; l'agent d'entretien circule sur les deux étages. Aucun trajet n'est inventé :
  un agent ne change d'étage que si son but (état réel ou vie sociale) est à l'autre étage.
- **Affichage par étage** : boutons « RDC / 1er » (nombre d'agents présents à chaque étage, préférence enregistrée), clic
  sur le palier pour changer d'étage ; choisir un agent (liste, flèches) ou le suivre montre son étage, y compris
  pendant un changement d'étage. Pré-rendu par étage (`bakeStatic(…, level)`) pour garder la résolution ; depuis le
  1er, la rue et les abords apparaissent assombris en contrebas, avec une ombre portée plus large. Les fiches de la
  régie vers un poste du 1er filent vers l'ascenseur (vue du RDC) puis en sortent (vue du 1er).
- **Boîte aux lettres** (accueil) : rapports réels (`GET /api/office/archive`) plus récents que la dernière visite de la
  bibliothèque dans ce navigateur (localStorage `roai.office.mail.seen.v1`) ; ouvrir la bibliothèque la vide.
- **Écrans** : barre de titre avec la cible réelle de la dernière action (`state/screenText.ts` : fichier, domaine,
  commande, recherche) au-dessus de l'animation d'activité.
- **Petites animations** (« Animations ») : trotteuse, souffle de la clim et plantes voisines, voyants (imprimante,
  fontaine, distributeur, borne), bulles de la fontaine, vapeur du café.

## Préférences (`state/prefs.ts`, localStorage)

Éclairage (auto par défaut), vie sociale, animations décoratives (désactivées par défaut si le système demande moins de
mouvement), noms, liste, zoom, étage affiché. Les indications réelles restent animées quelles que soient les préférences.

## Tests

`layout/plan.test.ts` (accessibilité de chaque pièce, porte, siège et emplacement depuis l'entrée ; aucun chevauchement ;
proportions ; croissance ; A*), `layout/editor.test.ts` (validation, connexité, document versionné), `engine/sim.test.ts`
(priorité de l'état réel, pas de téléportation, pas de réunion simulée, 40 agents, plafond de recherches),
`engine/social.test.ts` (≥ 80 répliques, variété, adéquation à l'heure, personnalité), `state/prefs.test.ts`, `engine/daylight.test.ts`.

## Sessions Claude Code en salle serveur

- **Source réelle** : hooks Claude Code de root (voir docs/API.md, « Sessions Claude Code qui développent RO·AI ») →
  `GET /api/office/devteam`, relu toutes les 4 s quand le bureau est visible (`state/useDevTeam.ts`).
- **Présence** : une session dont le tour est en cours (ou qui attend l'utilisateur) devient un technicien « Claude Code ·
  xxxx » (extra `dev` du sim, sweat sombre, liseré et badge orange, visage selon la session). Il entre par l'accueil,
  va devant une baie de la salle serveur (une par session, depuis le fond de la salle), travaille (`use`), se retourne
  et lève la main quand la session attend une réponse ou une permission, puis repart par l'entrée 45 s après la fin du
  tour. Déjà active à l'ouverture du bureau : placée directement.
- **Bulles** (vie sociale active) : seulement les actions marquantes et réelles (tests, build, mise en production,
  commit, redémarrage, « J'attends ta réponse. »), au plus une bulle « Je modifie … » toutes les 12 s.
- **Panneau** (clic) : état, dernières actions, compteurs depuis l'ouverture ; lecture seule, aucune commande vers la
  session. Rien n'est écrit dans le journal de RO·AI.

## Livraisons (camionnette, livreur, accueil)

- Événement réel `inbox.received` frais (≤ 15 s) : une camionnette « LIVRAISON » arrive dans la rue et s'arrête devant
  l'entrée, feux de détresse (14 s) ; ~4 s plus tard un livreur (figurant, casquette) apporte le colis à la banque
  d'accueil ; la réceptionniste annonce « Colis de <source> pour <agent> ! » (vie sociale active), puis il repart.
- Colis posé sur le bureau de l'agent destinataire tant que la livraison n'est pas traitée (`inbox_pending`, nombre
  si plusieurs). Le traitement lui-même est une exécution réelle ordinaire (poste, écran, bibliothèque à la fin).

## Liberté des agents libres (vie sociale, sans IA)

- **Sorties** : activité « prendre l'air » sur le parvis devant l'entrée (7 h – 21 h, heure de Paris), selon l'énergie.
- **Étages** : pour choisir où aller, un autre étage compte comme un détour fixe (escalier) et non comme l'écart du plan :
  les agents montent et descendent régulièrement (bureau au 1er, café, bibliothèque, hall au RDC…).
- **Échanges** : plus de visites spontanées entre collègues ; deux agents en pause côte à côte (café, fontaine,
  distributeur, parvis, canapé) peuvent engager la conversation. Toujours les banques de dialogues locales, jamais
  de discussion sur un travail inventé ; le travail réel reste prioritaire.
- Sortie d'escalier ou d'ascenseur : la case d'arrivée est réservée ; si elle est occupée, on patiente au lieu
  d'apparaître une case plus loin.

## Vie intérieure (fil interne façon réseau social, journal, dialogues générés)

- Bouton **Fil** (pastille = publications pas encore vues dans ce navigateur, `roai.office.feed.seen.v1`) : le réseau
  social de l'équipe. En tête, les **stories** : un rond par agent, coloré selon son état RÉEL (anneau ambre qui tourne
  au travail, rouge qui pulse en erreur) ; clic = sa fiche. Filtres Tout / Vie de bureau / Missions / Photos.
  Publications : portrait, @pseudo, heure, badge (Mission réelle, Livraison réelle, Arrivée, Pensée, Question, Photo),
  likes avec mini-portraits (« Lyra et 2 autres »), fils de commentaires en bulles (l'auteur marqué), lien vers
  l'exécution. Onglets Journaux (5 derniers jours par agent) et Coulisses (fonctionnement, jetons du jour, éditions).
- **Publications réelles sans IA** (`backend/roai/society_voice.py`) : une mission réussie ou échouée, une livraison
  traitée ou un nouvel agent deviennent un post écrit à la première personne avec le ton de sa fiche (énergie,
  concentration, sociabilité, curiosité, café) : nom de la planification plutôt que la demande brute, durée, série du
  jour (3e, 5e, 10e), « ça remarche » après un échec, quota, badge expiré… Pièces jointes réelles : **capture d'écran**
  (4 dernières actions `tool.call`, déjà masquées) et **aperçu du résultat** replié. Les collègues réagissent avec des
  réponses toutes faites selon leur caractère (les plus sociables d'abord), l'auteur remercie parfois, et les likes
  arrivent échelonnés sur ~45 min (`like_at`). Déterministe (graine = exécution), zéro jeton.
- **Éditions Haiku** (inchangées en nombre : 4 appels/jour au plus) : posts, pensées, **photos** (légende sur son
  poste) et **questions** aux collègues, fils où les agents se répondent entre eux, emojis avec parcimonie ; jamais de
  travail inventé. Une **photo** est dessinée côté navigateur par le moteur du bureau (`ui/DeskPhoto.tsx`) : le vrai
  poste de l'agent (déco et apparence de sa fiche), vu par-dessus l'épaule ; aucune image stockée ni transmise.
- Le marqueur technique « [masqué] » d'une donnée masquée devient « 🔒 » à l'affichage.
- Quand une publication apparaît, son auteur le dit dans le bureau (« Je poste sur le fil. », « Une pensée pour le fil… »)
  s'il est libre (vie sociale active). Onglet **Fiche** d'un agent : son journal.
- Les dialogues générés pour un duo servent une fois chacun lors de leurs pauses, puis retour aux dialogues locaux.
