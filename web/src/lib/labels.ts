import type { AgentState, ErrorClass, ProviderId, RunStatus, ToolKind } from '../api/types';

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  queued: 'En file', awaiting_approval: 'Approbation requise', running: 'En cours',
  succeeded: 'Réussie', failed: 'Échec', cancelled: 'Annulée',
};
export const AGENT_STATE_LABEL: Record<AgentState, string> = {
  idle: 'Au repos', working: 'Au travail', waiting: 'En attente', error: 'En erreur', disabled: 'Désactivé',
};
export const ERROR_CLASS_LABEL: Record<ErrorClass, string> = {
  auth_expired: 'Authentification expirée', rate_limited: 'Limite atteinte', denied: 'Action refusée',
  timeout: 'Délai dépassé', transient: 'Erreur transitoire', failed: 'Échec',
};
export const ERROR_CLASS_HINT: Record<ErrorClass, string> = {
  auth_expired: "La session du fournisseur n'est plus valide : reconnectez-vous en SSH (voir « Fournisseurs »).",
  rate_limited: "Le fournisseur a limité l'usage : l'exécution pourra être relancée à la réinitialisation de la fenêtre.",
  denied: "Un outil a été refusé par la politique de permissions de l'agent.",
  timeout: "La durée maximale d'exécution de l'agent a été atteinte.",
  transient: 'Erreur réseau ou service momentanément indisponible, même après nouvelles tentatives.',
  failed: "L'exécution s'est terminée en erreur.",
};
export const TRIGGER_LABEL: Record<string, string> = { manual: 'Manuel', schedule: 'Planifié', api: 'API', reply: 'Réponse' };
export const PROVIDER_LABEL: Record<ProviderId, string> = { claude: 'Claude', codex: 'Codex' };
export const TOOL_KIND_LABEL: Record<ToolKind, string> = {
  read: 'Lecture', write: 'Écriture', exec: 'Exécution', web: 'Web', mcp: 'MCP', other: 'Autre',
};
export const DOMAIN_LABEL = { perso: 'Perso', pro: 'Pro' } as const;
export const AUTH_STATE_LABEL = { logged_in: 'Connecté', logged_out: 'Déconnecté', unknown: 'Inconnu' } as const;
export const LIMIT_STATUS_LABEL = { ok: 'Aucune limite signalée', limited: 'Limité', unknown: 'Inconnu' } as const;

export const isRunActive = (s: RunStatus) => s === 'queued' || s === 'awaiting_approval' || s === 'running';
export const isRunTerminal = (s: RunStatus) => !isRunActive(s);

/** Statuts de limite émis par les clients officiels (valeurs inconnues affichées telles quelles). */
export function rateStatusLabel(status: string): string {
  switch (status) {
    case 'allowed': case 'ok': return 'Autorisé';
    case 'allowed_warning': case 'warning': return 'Proche de la limite';
    case 'rejected': case 'limited': return 'Limite atteinte';
    default: return status || 'Signalée';
  }
}

/** Libellé lisible d'une fenêtre de limite d'usage émise par le client officiel. */
export function windowLabel(w: string | null | undefined): string {
  if (!w) return '';
  const known: Record<string, string> = { five_hour: '5 heures', seven_day: '7 jours', seven_day_opus: '7 jours (Opus)', seven_day_sonnet: '7 jours (Sonnet)', weekly: 'semaine', daily: 'jour' };
  return known[w] ?? w.replace(/_/g, ' ');
}
