# Registre des assets du Virtual Office

Tout est produit par code au chargement (Canvas 2D vectoriel) : aucun fichier image tiers, aucune image générée par IA,
aucune requête réseau. Les droits sont donc ceux du projet.

| Catégorie | Origine | Licence | Production |
|---|---|---|---|
| Personnages (apparence de la fiche : 6 teints, 8 couleurs et 6 coupes de cheveux, 8 tenues, 5 accessoires ; repli sur les 6 variantes `avatar.sprite`) | Original RO·AI | Droits propres (code) | `engine/avatar.ts` : marche 4 directions, assis (dos, face, profil), postures de travail (frappe, terminal, lecture, souris), alarme, quota, main levée, tasse, livre, discussion, buste pour les portraits |
| Personnel figurant (réceptionniste, technicien, agent d'entretien et son chariot, badge « personnel ») | Original RO·AI | Droits propres (code) | `engine/renderer.ts` (`STAFF_STYLE`, `cart`), `engine/avatar.ts` |
| Orchestrateur (le noyau) | Original RO·AI | Droits propres (code) | `engine/avatar.ts` `drawOrchestrator` |
| Bâtiment : sols (moquette par département, parquet, pierre, terrazzo, faux plancher, vinyle), murs coupés avec épaisseur, cloisons vitrées, fenêtres, portes animées, abords (pelouse, parvis, arbres) | Original RO·AI | Droits propres (code) | `engine/baker.ts`, `engine/renderer.ts` (portes) |
| Mobilier (canapés, fauteuils, tables, machines à café, distributeur, fontaine, réfrigérateur, mange-debout, bibliothèques, sièges d'attente, guichet, banque d'accueil, borne, baies serveur, climatisation, caissons, imprimante, casiers, lampadaires, plantes, tapis, table de réunion, console de la régie) | Original RO·AI | Droits propres (code) | `engine/props.ts` `drawFurniture` |
| Postes personnalisés et 29 objets de décor de la fiche (écrans multiples, baie réseau, affiches, maquette de vaisseau, globe, carte stellaire, clavier mécanique, canard, livres, documents, loupe, tableau de notes, machine à écrire, tablette graphique, nuancier, calculatrice, casque…) | Original RO·AI | Droits propres (code) | `engine/props.ts` `drawDesk`, `drawPanelItem`, `drawSurfaceItem` |
| Décor mural (tableaux, horloges à l'heure réelle, tableaux blancs, écrans, enseignes, logo RO·AI, menu, carte) | Original RO·AI | Droits propres (code) | `engine/props.ts` `drawWallDecor`, `engine/renderer.ts` (aiguilles, textes réels) |
| Éclairage (soleil par les fenêtres, voile de nuit, lampes, halos d'écrans, ombres de contact) | Original RO·AI | Droits propres (code) | `engine/lighting.ts`, `engine/baker.ts` |
| Pictogrammes (états et outils) | Original RO·AI | Droits propres (code) | `engine/draw.ts` `drawIcon` |
| Répliques de la vie sociale et du personnel | Original RO·AI | Droits propres | `engine/social.ts`, `engine/staff.ts` |
| Jauges de la salle serveur (mémoire, disque, poste de supervision) | Original RO·AI | Droits propres (code) | `engine/renderer.ts` (`rackGauges`, `rackLamp`) |
| Police | Inter (variable), déjà chargée par le Control Center via `@fontsource-variable/inter` | SIL OFL 1.1 | Utilisée par le canvas (`FONT_FAMILY`) et le DOM |

Retiré lors d'une refonte antérieure : les 6 sprites PNG « Metro City » (JIK-A-4, CC0), le dossier `vendor/pixel-agents` et la police Silkscreen.
