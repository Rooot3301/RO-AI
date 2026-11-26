// Formulaire Discord : état, différences, corps du PUT et validation. Le jeton est en écriture seule.
import type { DiscordCommands, DiscordNotify, DiscordSettings, DiscordSettingsInput, DiscordUpdate } from '../api/types';

export interface DiscordForm extends DiscordSettingsInput { token: string }
export type DiscordErrors = Partial<Record<'token' | 'owner_id' | 'application_id' | 'channel_id' | 'dashboard_url', string>>;

export const SNOWFLAKE_RE = /^\d{15,22}$/;

export function discordToForm(s: DiscordSettings): DiscordForm {
  return {
    enabled: s.enabled, owner_id: s.owner_id ?? '', application_id: s.application_id ?? '', delivery: s.delivery ?? 'dm',
    channel_id: s.channel_id ?? '', dashboard_url: s.dashboard_url ?? '', notify: { ...s.notify }, commands: { ...s.commands }, token: '',
  };
}

const eqObj = (a: object, b: object) => (Object.keys(a) as (keyof typeof a)[]).every((k) => a[k] === b[k]);

/** Champs modifiés par rapport à l'état enregistré (les groupes imbriqués sont renvoyés en entier). Les identifiants sont comparés sans espaces. */
export function diffDiscord(base: DiscordForm, cur: DiscordForm): Partial<DiscordSettingsInput> {
  const out: Partial<DiscordSettingsInput> = {};
  if (cur.enabled !== base.enabled) out.enabled = cur.enabled;
  for (const k of ['owner_id', 'application_id', 'channel_id', 'dashboard_url'] as const) {
    if (cur[k].trim() !== base[k].trim()) out[k] = cur[k].trim();
  }
  if (cur.delivery !== base.delivery) out.delivery = cur.delivery;
  if (!eqObj(base.notify, cur.notify)) out.notify = { ...cur.notify } as DiscordNotify;
  if (!eqObj(base.commands, cur.commands)) out.commands = { ...cur.commands } as DiscordCommands;
  return out;
}

/** Corps du PUT : uniquement ce qui a changé ; `token` n'est jamais envoyé s'il est vide. */
export function buildDiscordUpdate(base: DiscordForm, cur: DiscordForm, clearToken = false): DiscordUpdate {
  const body: DiscordUpdate = diffDiscord(base, cur);
  const token = cur.token.trim();
  if (clearToken) body.clear_token = true;
  else if (token) body.token = token;
  return body;
}

export const isDirty = (base: DiscordForm, cur: DiscordForm) => Object.keys(buildDiscordUpdate(base, cur)).length > 0;

export function validateDiscord(f: DiscordForm, tokenSet: boolean): DiscordErrors {
  const e: DiscordErrors = {};
  const owner = f.owner_id.trim(); const app = f.application_id.trim(); const chan = f.channel_id.trim(); const url = f.dashboard_url.trim(); const token = f.token.trim();
  if (owner && !SNOWFLAKE_RE.test(owner)) e.owner_id = 'Un identifiant Discord est composé de 15 à 22 chiffres.';
  else if (!owner && f.enabled) e.owner_id = 'Obligatoire pour activer le bot : seul cet identifiant pourra utiliser les commandes.';
  if (app && !SNOWFLAKE_RE.test(app)) e.application_id = 'Un identifiant d’application est composé de 15 à 22 chiffres.';
  else if (!app && f.enabled) e.application_id = 'Obligatoire pour activer le bot (génère le lien d’invitation).';
  if (f.delivery === 'channel') {
    if (chan && !SNOWFLAKE_RE.test(chan)) e.channel_id = 'Un identifiant de salon est composé de 15 à 22 chiffres.';
    else if (!chan) e.channel_id = 'Obligatoire pour une livraison dans un salon.';
  }
  if (url) {
    try { const u = new URL(url); if (u.protocol !== 'http:' && u.protocol !== 'https:') e.dashboard_url = 'L’adresse doit commencer par http:// ou https://.'; }
    catch { e.dashboard_url = 'Adresse invalide (ex. https://roai.exemple.fr).'; }
  }
  if (token) { if (/\s/.test(token)) e.token = 'Le jeton ne doit contenir aucun espace ni retour à la ligne.'; else if (token.length < 20) e.token = 'Ce jeton semble trop court : recopiez-le en entier.'; }
  else if (f.enabled && !tokenSet) e.token = 'Obligatoire pour activer le bot.';
  return e;
}

export const DISCORD_STATE_LABEL = {
  disabled: 'Désactivé', incomplete: 'Configuration incomplète', connecting: 'Connexion en cours', connected: 'Connecté', error: 'Erreur',
} as const;

/** Délai avant la prochaine actualisation de l'état (court tant que la connexion s'établit). */
export function statusPollDelay(state: keyof typeof DISCORD_STATE_LABEL): number {
  return state === 'connecting' ? 3000 : state === 'connected' ? 30000 : 15000;
}

export const NOTIFY_ITEMS: { key: keyof DiscordNotify; label: string; help: string }[] = [
  { key: 'approvals', label: 'Approbations en attente', help: 'Un message avec des boutons Approuver et Rejeter dès qu’un agent attend votre accord.' },
  { key: 'failures', label: 'Échecs d’exécution', help: 'Une exécution se termine en erreur, avec sa cause.' },
  { key: 'emergency', label: 'Arrêt d’urgence et reprise', help: 'Prévenu quand l’arrêt d’urgence est déclenché ou levé, d’où qu’il vienne.' },
  { key: 'auth', label: 'Connexions des fournisseurs', help: 'Claude ou Codex n’est plus connecté : une reconnexion SSH est nécessaire.' },
  { key: 'limits', label: 'Limites d’usage', help: 'Un fournisseur atteint sa limite d’abonnement, avec l’heure de reprise.' },
  { key: 'system_errors', label: 'Erreurs du noyau', help: 'Avertissements et erreurs système remontés par le noyau.' },
  { key: 'completions', label: 'Exécutions réussies', help: 'Un message à chaque réussite. Très bavard si vos agents tournent souvent.' },
  { key: 'startup', label: 'Démarrage du noyau', help: 'Un message à chaque (re)démarrage de la plateforme.' },
];
export const COMMAND_ITEMS: { key: keyof DiscordCommands; label: string; help: string; warn?: string }[] = [
  { key: 'read', label: 'Lecture', help: 'Commandes /statut, /agents, /executions et /approbations : consultation seule.' },
  { key: 'control', label: 'Contrôle', help: 'Commandes /stop (arrêt d’urgence) et /reprise.' },
  { key: 'approve', label: 'Approbation par boutons', help: 'Approuver ou rejeter une exécution depuis les boutons des messages.' },
  { key: 'chat', label: 'Conversation : /parler', help: 'Parler avec un agent depuis Discord : vos messages reprennent la session de l’agent.', warn: 'Chaque réponse consomme du quota.' },
  { key: 'run', label: 'Lancement d’agents', help: 'Commande /lancer pour démarrer un agent à distance.', warn: 'Chaque lancement consomme du quota d’abonnement. Désactivé par défaut.' },
];
