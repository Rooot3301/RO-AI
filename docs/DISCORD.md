# Bot Discord de RO·AI

Un bot **privé** : il ne parle qu'à vous, ne lit aucun message, et n'agit que sur vos commandes explicites.

## Ce qu'il fait
**Notifications** (chacune activable dans Paramètres > Discord) : approbation requise (avec boutons Approuver / Rejeter), exécution en échec (cause et conseil), arrêt d'urgence et reprise, connexion d'un fournisseur perdue ou qui expire dans 7 jours ou moins, limite d'usage atteinte, erreur du noyau, et, désactivées par défaut, exécutions réussies et démarrage du noyau. Les rafales sont regroupées (5 messages maximum à la fois, le reste est résumé) et les doublons sont ignorés.

**Résumé Discord par agent** (fiche agent > « Résumé Discord ») : si la réponse de l'agent se termine par un bloc
`<<<DISCORD` … `DISCORD>>>`, RO·AI le retire du rapport et l'envoie seul (1 800 caractères au plus, masqué), avec le lien
vers le rapport complet ; sans bloc, rien n'est envoyé. C'est l'agent, guidé par sa mission, qui décide quand écrire ce
bloc (ex. le Manager sécurité : brief du matin, et alertes 🔴 seulement). Événement `discord.brief`. Aucun appel IA de plus.
À ne pas cumuler avec « Rapport Discord » (rapport complet de chaque exécution réussie), sauf à vouloir les deux.

**Format Discord** (fiche agent, si « Rapport » ou « Résumé » Discord est activé) : **Embed** (défaut), **Classique**
(messages texte de 2 000 caractères au plus, lien en fin de message) ou **Les deux** (pour comparer). S'applique aux envois
par webhook ; sans webhook, le bot RO·AI envoie toujours des embeds.

**Salon public** (fiche agent) : pour un salon ouvert à la communauté. La première ligne du rapport (titre Markdown ou gras)
devient le titre ; ni lien vers RO·AI, ni signature, ni nom « RO·AI » : le nom et l'avatar sont ceux du webhook.

**Commandes slash**, utilisables par vous seul (messages privés ou salon) :
| Commande | Effet | Réglage |
|---|---|---|
| `/statut` | arrêt d'urgence, file, fournisseurs, prochaine planification | lecture |
| `/agents` · `/executions` · `/approbations` | listes ; `/approbations` propose les boutons | lecture |
| `/stop [motif]` | arrêt d'urgence, avec bouton de confirmation | contrôle |
| `/reprise` | lève l'arrêt d'urgence | contrôle |
| `/lancer agent [prompt]` | lance un agent (désactivé par défaut : consomme du quota) | lancement |

## Sécurité
- Toute interaction d'un autre utilisateur que le propriétaire est refusée et signalée dans le journal.
- Le jeton est stocké sur le serveur (`/srv/ai/config/discord.json`, mode 0600, lisible par `agent` seul), jamais renvoyé à l'interface ni écrit dans les journaux. Au moment de l'enregistrement il transite par le serveur web (en HTTPS). Pour l'éviter, l'écrire directement dans le fichier est possible, mais le champ de l'interface est le chemin prévu.
- Aucune intention privilégiée Discord n'est demandée. Permissions de l'invitation : voir le salon, envoyer des messages, intégrer des liens, rien de plus.
- Si le jeton fuite : « Reset Token » dans le portail développeur, puis saisir le nouveau dans les paramètres. Le bot ne peut ordonner quoi que ce soit à RO·AI sans votre identifiant Discord, mais un jeton volé permettrait de se faire passer pour lui auprès de vous : restez attentif aux messages inattendus.

## Mise en place
1. https://discord.com/developers/applications > New Application.
2. Onglet Bot > Reset Token, copier le jeton. Ne pas activer les « Privileged Gateway Intents ».
3. Onglet General Information > copier l'Application ID.
4. Discord > Paramètres utilisateur > Avancés > mode développeur ; clic droit sur votre profil > Copier l'identifiant.
5. RO·AI > Paramètres > Discord : coller le jeton, votre identifiant, l'Application ID ; activer ; Enregistrer.
6. Ouvrir le lien d'invitation affiché, choisir votre serveur, autoriser.
7. Dans les paramètres de confidentialité de ce serveur, autoriser les messages privés des membres.
8. « Envoyer un message de test ».
