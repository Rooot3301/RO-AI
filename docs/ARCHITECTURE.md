# RO·AI — architecture (v0.1)

```
navigateur ──HTTPS (Caddy, TLS interne, LAN d'administration)──► ro-ai-web (user ro-ai-web, 127.0.0.1:8081)
                                                                      │ socket Unix /run/ro-ai/core.sock (groupe ro-ai)
                                                                      ▼
                                          ro-ai-core (user agent) : API · journal d'événements · worker · planificateur
                                                                      │ systemd-run --user (cgroup par exécution)
                                                                      ▼
                                              claude -p / codex exec  (binaires officiels, jetons dans le HOME de agent)
```

## Principes
- **Jamais de jeton dans RO·AI.** Les clients officiels s'authentifient eux-mêmes (`roai-login claude|codex`). Les sondes n'appellent que `claude auth status` / `codex login status`. L'environnement des exécutions est une liste blanche qui retire toute variable de facturation API.
- **Séparation des privilèges.** Le serveur web n'a aucun accès au HOME de `agent` ni à la base ; il relaie des requêtes validées vers le noyau par socket Unix.
- **Journal d'événements = colonne vertébrale.** Control Center et Virtual Office sont deux projections du même flux (SSE). Les événements sont masqués (jetons, mots de passe) à l'écriture.
- **Exécutions bornées.** Chaque exécution a son cgroup : `MemoryMax`, `MemorySwapMax=0`, `TasksMax`, durée maximale, `PrivateTmp`, `NoNewPrivileges`. Plafond global de l'utilisateur agent : 3 Go (`user-1000.slice`).
- **Aucun défaut dangereux.** Pas de `--dangerously-skip-permissions`, pas de `danger-full-access` (refusé par la validation), Claude en `dontAsk` avec liste d'outils, Codex en `read-only` par défaut.

## Composants
| Chemin | Rôle |
|---|---|
| `backend/roai/core_api.py` | API du noyau (contrat `docs/API.md`) |
| `backend/roai/worker.py` | file, concurrence (globale et par fournisseur), annulation, approbation, reprise |
| `backend/roai/providers/` | adaptateurs Claude et Codex, sonde d'état |
| `backend/roai/executor.py` | exécution isolée (`systemd-run --user`) |
| `backend/roai/scheduler.py` | cron à 5 champs avec fuseau, un seul rattrapage |
| `backend/roai/web.py` | authentification, CSRF, relais, statique, en-têtes de sécurité |
| `web/` | Control Center + Virtual Office (React, TypeScript, Vite) |
| `deploy/` | unités systemd, Caddyfile, `install.sh`, `roai-login` |

## Virtual Office
Projection illustrée du même flux d'événements : un siège d'entreprise vu de dessus (plan généré selon les agents et
départements, A* et évitement, rendu Canvas 2D en couches pré-rendues). Tout ce qui prétend être réel découle du snapshot et
du flux SSE ; la vie sociale des agents libres est une simulation locale, décorative et désactivable, sans réseau ni écriture.
Détails : [`docs/OFFICE.md`](OFFICE.md).

## Limites connues de la v0.1
- Pas de workflows multi-agents (donc pas de réunions dans le bureau virtuel).
- Les approbations portent sur le **lancement** d'une exécution ; l'approbation outil par outil (hook de permission) est à venir.
- Les limites d'usage affichées viennent des événements émis par le client officiel pendant les exécutions.
- Un seul domaine par instance (`perso`) ; le domaine `pro` demandera sa propre instance.
