// Conversations avec un agent : regroupement des exécutions, état du composeur, cibles d'envoi.
import type { Run } from '../api/types';
import { isRunActive } from './labels.ts';
import { STOP_BLOCKED_TEXT } from './control.ts';
import { truncate } from './format.ts';

export interface Conv {
  id: string; agentId: string; runs: Run[]; title: string; createdAt: string; updatedAt: string; exchanges: number; tokens: number; last: Run;
}
const byCreated = (a: Run, b: Run) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1);
export const convKey = (r: Run) => r.conversation_id ?? r.id;
export const runTokens = (r: Run) => (r.usage ? r.usage.input_tokens + r.usage.output_tokens : 0);

export function convTitle(first: Run): string {
  const line = (first.prompt || '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return line ? truncate(line, 64) : 'Conversation sans titre';
}

/** Regroupe des exécutions en conversations (plus récente d'abord). Une exécution isolée est une conversation d'un seul échange ;
 *  les exécutions planifiées isolées ne sont pas des conversations. */
export function groupConversations(runs: readonly Run[]): Conv[] {
  const map = new Map<string, Run[]>();
  for (const r of runs) { const k = convKey(r); const l = map.get(k); if (l) l.push(r); else map.set(k, [r]); }
  const out: Conv[] = [];
  for (const [id, list] of map) {
    list.sort(byCreated);
    if (list.length === 1 && list[0].trigger === 'schedule') continue;
    const first = list[0]; const last = list[list.length - 1];
    out.push({ id, agentId: first.agent_id, runs: list, title: convTitle(first), createdAt: first.created_at, updatedAt: last.created_at, exchanges: list.length, tokens: list.reduce((s, r) => s + runTokens(r), 0), last });
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

/** Retrouve la conversation désignée par `?c=` (identifiant de conversation ou d'une de ses exécutions). */
export function findConversation(convs: readonly Conv[], key: string | null): Conv | null {
  if (!key) return null;
  return convs.find((c) => c.id === key) ?? convs.find((c) => c.runs.some((r) => r.id === key)) ?? null;
}

/** Exécution à reprendre pour répondre : la dernière qui a une session. */
export function replyBase(runs: readonly Run[]): Run | null {
  for (let i = runs.length - 1; i >= 0; i--) if (runs[i].session_id) return runs[i];
  return null;
}

export type SendTarget = { kind: 'new' } | { kind: 'reply'; runId: string };
export function sendTarget(runs: readonly Run[]): SendTarget | null {
  if (runs.length === 0) return { kind: 'new' };
  const base = replyBase(runs);
  return base ? { kind: 'reply', runId: base.id } : null;
}
/** « Réessayer » : renvoie le même message à partir de l'exécution parente (ou comme nouvelle conversation s'il n'y en a pas). */
export function retryTarget(failed: Run): SendTarget { return failed.parent_run_id ? { kind: 'reply', runId: failed.parent_run_id } : { kind: 'new' }; }

export interface ComposerState { canSend: boolean; reason: string | null }
export function composerState(o: { runs: readonly Run[]; agentEnabled: boolean; paused: boolean; sending?: boolean }): ComposerState {
  const last = o.runs[o.runs.length - 1];
  if (o.paused) return { canSend: false, reason: STOP_BLOCKED_TEXT };
  if (!o.agentEnabled) return { canSend: false, reason: 'Cet agent est désactivé : activez-le pour poursuivre la conversation.' };
  if (o.sending) return { canSend: false, reason: 'Envoi en cours…' };
  if (last) {
    if (last.status === 'awaiting_approval') return { canSend: false, reason: 'Cet échange attend votre approbation avant de démarrer.' };
    if (isRunActive(last.status)) return { canSend: false, reason: 'L’agent est en train de répondre.' };
    if (!sendTarget(o.runs)) return { canSend: false, reason: 'Aucune session à reprendre dans cette conversation : démarrez une nouvelle conversation.' };
  }
  return { canSend: true, reason: null };
}

export const CONTEXT_WARN_AFTER = 10;
export const contextHint = (exchanges: number): string | null =>
  exchanges > CONTEXT_WARN_AFTER ? 'Le contexte s’alourdit (quota) : pensez à démarrer une nouvelle conversation.' : null;

export function activityLabel(kind: string | null | undefined): string {
  switch (kind) {
    case 'read': return 'lit…'; case 'web': return 'cherche sur le web…'; case 'exec': return 'exécute…';
    case 'write': return 'écrit…'; case 'mcp': return 'utilise un outil externe…'; default: return 'travaille…';
  }
}

/** Texte que renverra le bouton « Réessayer » ou le premier message d'une conversation. */
export const cleanPrompt = (s: string) => s.replace(/\s+$/g, '').replace(/^\s*\n/, '');
export const canSubmitText = (s: string) => s.trim().length > 0;
