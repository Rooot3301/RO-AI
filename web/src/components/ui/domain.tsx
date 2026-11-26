import { useState } from 'react';
import type { AgentState, Provider, ProviderId, RunStatus, ToolKind } from '../../api/types';
import { AGENT_STATE_LABEL, PROVIDER_LABEL, RUN_STATUS_LABEL, TOOL_KIND_LABEL } from '../../lib/labels';
import { Led, Tag, type LedTone } from './primitives';
import { IconCheck, IconCopy } from './icons';

export function agentLedTone(s: AgentState): { tone: LedTone; busy: boolean } {
  switch (s) {
    case 'working': return { tone: 'amber', busy: true };
    case 'waiting': return { tone: 'warn', busy: false };
    case 'error': return { tone: 'err', busy: false };
    case 'disabled': return { tone: 'off', busy: false };
    default: return { tone: 'ok', busy: false };
  }
}
/** Voyant d'un agent : ne pulse que lorsqu'il travaille réellement. */
export function AgentLed({ state }: { state: AgentState }) {
  const { tone, busy } = agentLedTone(state);
  return <Led tone={tone} busy={busy} label={AGENT_STATE_LABEL[state]} />;
}
export function AgentStateText({ state }: { state: AgentState }) {
  return <span className="nowrap" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><AgentLed state={state} /><span>{AGENT_STATE_LABEL[state]}</span></span>;
}

const RUN_TONE: Record<RunStatus, 'ok' | 'warn' | 'err' | 'amber' | 'info' | 'neutral'> = {
  queued: 'neutral', awaiting_approval: 'amber', running: 'amber', succeeded: 'ok', failed: 'err', cancelled: 'warn',
};
export function RunStatusTag({ status }: { status: RunStatus }) {
  return (
    <Tag tone={RUN_TONE[status]}>
      {status === 'running' && <Led tone="amber" busy label="" />}
      {RUN_STATUS_LABEL[status]}
    </Tag>
  );
}

export function providerTone(p: Provider | undefined): { tone: LedTone; text: string } {
  if (!p) return { tone: 'off', text: 'Inconnu' };
  if (!p.installed) return { tone: 'off', text: 'Non installé' };
  if (p.auth.state === 'logged_out') return { tone: 'err', text: 'Déconnecté' };
  if (p.auth.state === 'unknown') return { tone: 'warn', text: 'État inconnu' };
  if (p.limits?.status === 'limited') return { tone: 'warn', text: 'Limité' };
  return { tone: 'ok', text: 'Connecté' };
}
export function ProviderName({ id }: { id: ProviderId }) { return <span>{PROVIDER_LABEL[id]}</span>; }

const KIND_TONE: Record<ToolKind, 'ok' | 'warn' | 'err' | 'amber' | 'info' | 'neutral'> = {
  read: 'info', write: 'amber', exec: 'warn', web: 'ok', mcp: 'neutral', other: 'neutral',
};
export function ToolKindTag({ kind }: { kind: ToolKind }) { return <Tag tone={KIND_TONE[kind]}>{TOOL_KIND_LABEL[kind]}</Tag>; }

/* ───────── Avatars : 6 profils pixel, aperçu schématique des sprites du Bureau virtuel ───────── */
const SPRITES = [
  { hair: 'short', skin: '#e3b08a', hairC: '#3a2a1f', cloth: '#ffb347', accent: '#ffb347' },
  { hair: 'long', skin: '#c68a5e', hairC: '#17120f', cloth: '#3fd9b4', accent: '#3fd9b4' },
  { hair: 'cap', skin: '#f0c9a8', hairC: '#6b4a2e', cloth: '#6fb7ff', accent: '#ff5c4a' },
  { hair: 'bald', skin: '#8d5a3b', hairC: '#000', cloth: '#d6dbe5', accent: '#d6dbe5' },
  { hair: 'bun', skin: '#a8704a', hairC: '#c9c3b8', cloth: '#e8c547', accent: '#e8c547' },
  { hair: 'mohawk', skin: '#d9a47c', hairC: '#2a1c14', cloth: '#ff5c4a', accent: '#3fd9b4' },
] as const;
function spriteGrid(i: number) {
  const s = SPRITES[i % SPRITES.length];
  const g: string[][] = Array.from({ length: 10 }, () => Array(8).fill('.'));
  const put = (r: number, c0: number, c1: number, ch: string) => { for (let c = c0; c <= c1; c++) g[r][c] = ch; };
  for (let r = 2; r <= 5; r++) put(r, 1, 6, 's');
  put(6, 2, 5, 's'); g[3][2] = 'e'; g[3][5] = 'e';
  put(7, 1, 6, 'c'); put(8, 0, 7, 'c'); put(9, 0, 7, 'c'); g[9][3] = 'd'; g[9][4] = 'd';
  switch (s.hair) {
    case 'short': put(0, 2, 5, 'h'); put(1, 1, 6, 'h'); g[2][1] = 'h'; g[2][6] = 'h'; break;
    case 'long': put(0, 2, 5, 'h'); put(1, 1, 6, 'h'); for (let r = 2; r <= 6; r++) { g[r][0] = 'h'; g[r][7] = 'h'; } g[2][1] = 'h'; g[2][6] = 'h'; break;
    case 'cap': put(0, 2, 5, 'a'); put(1, 1, 6, 'a'); put(2, 0, 7, 'a'); break;
    case 'bald': put(1, 2, 5, 's'); break;
    case 'bun': put(0, 3, 4, 'h'); put(1, 1, 6, 'h'); g[2][1] = 'h'; g[2][6] = 'h'; break;
    case 'mohawk': put(0, 3, 4, 'a'); put(1, 3, 4, 'a'); break;
  }
  return { g, s };
}
export function Sprite({ index, size = 28, title }: { index: number; size?: number; title?: string }) {
  const { g, s } = spriteGrid(((index % 6) + 6) % 6);
  const color = (ch: string) => ch === 's' ? s.skin : ch === 'h' ? s.hairC : ch === 'c' ? s.cloth : ch === 'a' ? s.accent : ch === 'e' ? '#06080c' : ch === 'd' ? '#06080c33' : '';
  return (
    <svg viewBox="0 0 8 10" width={size * 0.8} height={size} shapeRendering="crispEdges" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} style={{ flex: 'none' }}>
      {g.flatMap((row, r) => row.map((ch, c) => (ch === '.' ? null : <rect key={`${r}-${c}`} x={c} y={r} width="1" height="1" fill={color(ch)} />)))}
    </svg>
  );
}

/** Bouton de copie ; masqué si le presse-papiers n'est pas disponible (contexte non sécurisé). */
export function CopyButton({ text, label = 'Copier' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  if (typeof navigator === 'undefined' || !navigator.clipboard) return null;
  return (
    <button type="button" className="btn btn--sm" onClick={() => { navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1600); }).catch(() => undefined); }}>
      {done ? <IconCheck /> : <IconCopy />}<span>{done ? 'Copié' : label}</span>
    </button>
  );
}

/** Badges de configuration d'un agent : mode libre (rouge) et accès réseau (discret). */
export function AgentBadges({ config }: { config?: import('../../api/types').AgentConfig | null }) {
  const n = config?.network_domains?.length ?? 0;
  if (!config?.unrestricted && n === 0) return null;
  return (
    <span className="agentbadges">
      {config?.unrestricted && (config.autonomous
        ? <Tag tone="err" solid title="Aucun bac à sable ni restriction d’outils, et lancements sans approbation">Mode libre · autonome</Tag>
        : <Tag tone="err" solid title="Aucun bac à sable ni restriction d’outils : approbation obligatoire avant chaque lancement">Mode libre</Tag>)}
      {n > 0 && <Tag tone="neutral" title={config?.network_domains?.join(', ')}>Réseau : {n} domaine{n > 1 ? 's' : ''}</Tag>}
    </span>
  );
}
