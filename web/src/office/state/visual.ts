// Sélection du comportement visible : fonction pure (agent, instant) -> où aller, quelle posture, quel écran.
// Règle : tout ce qui prétend être réel découle d'un état ou d'un événement. Seul `free` (agent au repos) laisse la main
// à la simulation sociale locale (décorative, signalée comme telle).
import type { ErrorClass, ToolKind } from '../../api/types.ts';
import type { OfficeAgentModel } from './model.ts';

/** desk = assis à son poste ; stand = debout à côté de son poste ; approval = salle d'attente ; meeting = salle de réunion
 * (conversation réelle avec l'utilisateur) ; library = range un rapport réel ; free = libre (social) ; none = absent. */
export type Place = 'desk' | 'stand' | 'approval' | 'meeting' | 'library' | 'free' | 'none';
export type Pose = 'type' | 'terminal' | 'read' | 'web' | 'idle' | 'alarm' | 'quota' | 'wait' | 'hand' | 'cheer' | 'none';
export type ScreenMode = 'off' | 'standby' | 'read' | 'code' | 'terminal' | 'web' | 'mcp' | 'generic' | 'error' | 'quota';

export interface Visual {
  place: Place;
  pose: Pose;
  screen: ScreenMode;
  /** Alarme (état error) : classe d'erreur à illustrer. */
  alarm: ErrorClass | null;
  /** Quota atteint (error_class rate_limited) : état spécifique. */
  quota: boolean;
  /** Rappel discret : dernière exécution en échec, nouvelle exécution en cours. */
  errorBadge: ErrorClass | null;
  /** Connecteur MCP actif (icône de prise). */
  connector: boolean;
  /** Réussite récente (effet bref issu de run.succeeded). */
  success: boolean;
  /** Vrai si l'agent est libre : la simulation sociale peut le déplacer. */
  ambient: boolean;
  /** Désactivé : absent, poste visible avec un signe « absent ». */
  disabled: boolean;
  /** En conversation avec l'utilisateur (Chat, Discord) : en salle de réunion. */
  talk: 'chat' | 'discord' | null;
}

export const newVisual = (): Visual => ({
  place: 'none', pose: 'none', screen: 'off', alarm: null, quota: false, errorBadge: null, connector: false, success: false, ambient: false, disabled: false, talk: null,
});

const SCREEN_BY_KIND: Record<ToolKind, ScreenMode> = { read: 'read', write: 'code', exec: 'terminal', web: 'web', mcp: 'mcp', other: 'generic' };
const POSE_BY_KIND: Record<ToolKind, Pose> = { read: 'read', write: 'type', exec: 'terminal', web: 'web', mcp: 'type', other: 'type' };

/** Remplit `out` (aucune allocation) à partir de l'agent et de l'heure locale `nowMs`. */
export function selectVisual(a: OfficeAgentModel, nowMs: number, out: Visual): Visual {
  out.place = 'none'; out.pose = 'none'; out.screen = 'off'; out.alarm = null; out.quota = false; out.errorBadge = null;
  out.connector = false; out.success = false; out.ambient = false; out.disabled = false; out.talk = null;
  // conversation réelle : en cours (exécution de la conversation) ou récente (réponse donnée il y a moins de 5 min)
  const conv = a.conv && (a.conv.active ? a.conv.runId === a.runId : a.conv.until > nowMs) ? a.conv : null;
  switch (a.state) {
    case 'disabled':
      out.disabled = true;
      return out;
    case 'working': {
      const kind = a.toolKind;
      if (conv) { out.place = 'meeting'; out.pose = 'type'; out.talk = conv.via; out.connector = kind === 'mcp'; out.errorBadge = a.errorClass; return out; }
      out.place = 'desk';
      out.pose = kind ? POSE_BY_KIND[kind] : 'type';
      out.screen = kind ? SCREEN_BY_KIND[kind] : 'generic';
      out.connector = kind === 'mcp';
      out.errorBadge = a.errorClass;
      return out;
    }
    case 'waiting':
      if (a.waitKind === 'approval') { out.place = 'approval'; out.pose = 'hand'; }
      else if (conv) { out.place = 'meeting'; out.pose = 'idle'; out.talk = conv.via; }
      else { out.place = 'stand'; out.pose = 'wait'; out.screen = 'standby'; }
      out.errorBadge = a.errorClass;
      return out;
    case 'error':
      out.place = 'desk';
      out.alarm = a.errorClass ?? 'failed';
      if (a.errorClass === 'rate_limited') { out.quota = true; out.pose = 'quota'; out.screen = 'quota'; }
      else { out.pose = 'alarm'; out.screen = 'error'; }
      return out;
    default: { // idle
      if (conv) { out.place = 'meeting'; out.pose = 'idle'; out.talk = conv.via; return out; }
      for (let i = 0; i < a.effects.length; i++) if (a.effects[i].kind === 'success' && a.effects[i].until > nowMs) { out.place = 'stand'; out.pose = 'cheer'; out.success = true; out.screen = 'standby'; return out; }
      if (a.filedUntil && a.filedUntil > nowMs) { out.place = 'library'; out.pose = 'none'; return out; }
      out.place = 'free'; out.pose = 'idle'; out.ambient = true;
      return out;
    }
  }
}

export const visualOf = (a: OfficeAgentModel, nowMs: number): Visual => selectVisual(a, nowMs, newVisual());

export const STATE_LABEL_FR = { idle: 'Au repos', working: 'Au travail', waiting: 'En attente', error: 'En erreur', disabled: 'Désactivé' } as const;
export const ERROR_LABEL_FR: Record<ErrorClass, string> = {
  auth_expired: 'Authentification expirée', rate_limited: 'Quota atteint', denied: 'Action refusée',
  timeout: 'Délai dépassé', transient: 'Erreur transitoire', failed: 'Échec de l’exécution',
};
export const TOOL_KIND_LABEL_FR: Record<ToolKind, string> = {
  read: 'Lecture', write: 'Écriture', exec: 'Exécution', web: 'Web', mcp: 'Connecteur MCP', other: 'Autre outil',
};
