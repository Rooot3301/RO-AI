# RO·AI — exploitation

## Accès
- URL : `https://<adresse-du-serveur>/` (LAN d'administration uniquement : réseaux `ROAI_LAN` choisis à l'installation, voir `deploy/Caddyfile`).
- Certificat : autorité interne de Caddy. Pour supprimer l'avertissement du navigateur, importez **une fois** `/root/ro-ai-ca.crt` comme autorité racine de confiance (Windows : double-clic, « Placer tous les certificats dans le magasin suivant », « Autorités de certification racines de confiance »). Empreinte SHA-256 : `3A:29:FA:4E:B7:93:8F:6E:91:0B:21:2E:34:A4:4C:E7:29:82:CB:B6:1A:CD:86:6A:45:81:22:A4:87:F1:37:6F` (à comparer avant d'approuver).
- Identifiants initiaux : `/root/ro-ai-first-login.txt` (lecture réservée à root). Pour changer le mot de passe : `PYTHONPATH=/opt/ro-ai/backend python3 -m roai.cli set-password`.

## Connexion des fournisseurs (abonnement, par les clients officiels)
```bash
roai-login claude    # URL à ouvrir sur votre poste, puis coller le code
roai-login codex     # code d'appareil à saisir sur auth.openai.com/codex/device (valable 15 min)
roai-login status
```
Ces commandes s'exécutent sous l'utilisateur `agent`. Le Control Center n'affiche que l'état ; il ne reçoit jamais de jeton. Après connexion, cliquez sur « Revérifier » dans la page Fournisseurs.

## Arrêt d'urgence
Bouton « Arrêt d'urgence » dans la barre du haut du Control Center, ou en ligne de commande (fonctionne même si le site web est arrêté) :
```bash
roai-ctl stop "motif"   # annule tout (en cours, en file, en attente d'approbation), suspend les planifications, bloque les lancements
roai-ctl status
roai-ctl resume         # levée manuelle ; les planifications repartent de maintenant, sans rattrapage
```
L'état est persistant : après un redémarrage du noyau ou du serveur, l'arrêt reste actif jusqu'à `resume`. Les exécutions en cours sont arrêtées en supprimant leur cgroup (processus et sous-processus compris).

## Services
| Unité | Rôle |
|---|---|
| `ro-ai-core.socket` / `.service` | noyau (utilisateur `agent`), API sur `/run/ro-ai/core.sock` |
| `ro-ai-web.service` | serveur web (utilisateur `ro-ai-web`) sur 127.0.0.1:8081 |
| `caddy.service` | HTTPS sur :443 |

```bash
systemctl status ro-ai-core ro-ai-web caddy
journalctl -u ro-ai-core -f          # journaux du noyau
journalctl -u ro-ai-web -f
deploy/install.sh                    # réinstalle/redémarre les services après une mise à jour du code
```

## Données
- Base et état : `/srv/ai/data/roai.db` (SQLite, WAL) ; espaces de travail des agents : `/srv/ai/workspace/<slug>` ; jamais dans `/tmp` (en RAM sur ce serveur).
- Sauvegarde : copier `/srv/ai/data` (arrêter le noyau ou utiliser `sqlite3 roai.db ".backup …"`). Le HOME de `agent` contient les sessions des clients officiels : à sauvegarder **chiffré**.
- Rétention du journal d'événements : 60 jours (`ROAI_EVENT_RETENTION_DAYS`).

## Limites et sécurité
- Plafond mémoire de tout ce que lance `agent` : 3 Go (`user-1000.slice`). Par exécution : 1536 Mo, swap interdit, 512 tâches, durée maximale configurable par agent.
- `max_concurrency` = 2 (Claude 2, Codex 1 : un seul processus Codex à la fois, car `auth.json` n'a qu'un écrivain).
- Aucun agent ne tourne en root. L'API du noyau n'est joignable que par le groupe `ro-ai`.

## Développement
```bash
cd /opt/ro-ai/backend && python3 -m pytest -q tests       # noyau et serveur web (faux clients de test)
cd /opt/ro-ai/web && npm run typecheck && node --test $(find src -name '*.test.ts')
cd /opt/ro-ai/web && npx vite build                        # produit web/dist, servi tel quel
deploy/dev-stack.sh start                                  # pile jetable avec faux clients : http://127.0.0.1:18081 (admin / dev-password-12345)
```
