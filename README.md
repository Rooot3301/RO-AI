# RO·AI

Plateforme d'orchestration d'agents IA auto-hébergée (Debian 13, LXC non privilégié). Elle pilote **uniquement les clients officiels** (Claude Code, Codex CLI) connectés par abonnement : aucun jeton n'est lu ni manipulé par ce code, aucune clé API, aucune facturation supplémentaire.

- **Control Center** : agents, exécutions avec journal en direct, planifications, fournisseurs, journal d'événements, approbations.
- **Virtual Office** : bureau pixel art animé, piloté par les événements réels du noyau (aucune animation sans événement).

```
backend/   noyau Python (FastAPI, SQLite) et serveur web      web/      React + TypeScript + Vite
deploy/    unités systemd, Caddyfile, install.sh, roai-login   docs/     API.md, ARCHITECTURE.md, OPERATIONS.md
```

## Démarrage rapide (déjà fait sur ro-ai)
1. `ROAI_ADDRESS=<ip> ROAI_LAN="<réseau>/24" deploy/install.sh` installe et démarre `ro-ai-core`, `ro-ai-web` et Caddy.
2. `roai-login claude` et `roai-login codex` : connexion officielle par abonnement (voir `docs/OPERATIONS.md`).
3. Ouvrir `https://<adresse-du-serveur>/` depuis le LAN d'administration.

Voir `docs/ARCHITECTURE.md` (principes et limites connues), `docs/API.md` (contrat), `docs/OPERATIONS.md` (exploitation).

## Licence
MIT, voir `LICENSE`.
