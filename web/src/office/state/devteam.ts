// Sessions Claude Code qui développent RO·AI (hook local) : identifiants, libellés et bulles courtes. Fonctions pures.
// Tout vient de données réelles réduites (type d'action, nom de fichier ou de commande) ; rien n'est inventé.
import type { DevAction, DevKind, DevSession } from '../../api/types.ts';

export const DEV_PREFIX = '__dev__:';
export const devCharId = (sessionId: string) => DEV_PREFIX + sessionId;
export const isDevId = (id: string | null | undefined): boolean => !!id && id.startsWith(DEV_PREFIX);
export const devSessionOf = (id: string) => id.slice(DEV_PREFIX.length);

export const DEV_KIND_FR: Readonly<Record<DevKind, string>> = {
  read: 'lit', write: 'modifie', search: 'cherche dans le code', exec: 'lance', test: 'lance les tests', build: 'construit',
  deploy: 'met en production', commit: 'enregistre (commit)', git: 'consulte git', restart: 'redémarre un service',
  web: 'consulte le web', delegate: 'délègue à un sous-agent', tool: 'utilise un outil',
};
export const DEV_STATE_FR: Readonly<Record<DevSession['state'], string>> = {
  working: 'Travaille', waiting: 'T’attend', idle: 'Tour terminé', ended: 'Session terminée',
};

/** Phrase d'une action réelle (« modifie plan.ts », « lance les tests »). */
export function devActionText(a: DevAction): string {
  const verb = DEV_KIND_FR[a.kind] ?? DEV_KIND_FR.tool;
  if (!a.target || a.kind === 'test' || a.kind === 'deploy' || a.kind === 'commit' || a.kind === 'restart' || a.kind === 'delegate' || a.kind === 'search') return verb;
  if (a.kind === 'build') return a.target === 'build de test' ? 'construit une version de test' : a.target === 'vérification des types' ? 'vérifie les types' : verb;
  return `${verb} ${a.target}`;
}

const BUBBLE: Partial<Record<DevKind, string>> = {
  test: 'Je lance les tests.', deploy: 'Mise en production !', commit: 'Je commite.', restart: 'Je redémarre un service.', delegate: 'Je délègue à un sous-agent.',
};
/** Bulle (≤ 44 caractères) pour une action marquante, sinon null (on ne commente pas chaque lecture). */
export function devBubble(a: DevAction): string | null {
  if (BUBBLE[a.kind]) return BUBBLE[a.kind]!;
  if (a.kind === 'build') return a.target === 'vérification des types' ? 'Je vérifie les types.' : 'Je construis une version.';
  if (a.kind === 'write' && a.target) { const t = `Je modifie ${a.target}`; return t.length <= 44 ? t : `Je modifie ${a.target.slice(0, 31)}…`; }
  return null;
}
export const DEV_WAIT_BUBBLE = 'J’attends ta réponse.';
