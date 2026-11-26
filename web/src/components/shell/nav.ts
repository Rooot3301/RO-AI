import type { ComponentType } from 'react';
import { IconAgents, IconBridge, IconInbox, IconLog, IconOffice, IconProviders, IconRuns, IconSchedule, IconSettings, IconStats } from '../ui/icons';

export interface NavItem { to: string; label: string; icon: ComponentType; end?: boolean; group: string }
export const NAV: NavItem[] = [
  { to: '/', label: 'Tableau de bord', icon: IconBridge, end: true, group: 'Opérations' },
  { to: '/agents', label: 'Agents', icon: IconAgents, group: 'Opérations' },
  { to: '/runs', label: 'Exécutions', icon: IconRuns, group: 'Opérations' },
  { to: '/schedules', label: 'Planifications', icon: IconSchedule, group: 'Opérations' },
  { to: '/inbox', label: 'Livraisons', icon: IconInbox, group: 'Opérations' },
  { to: '/logs', label: 'Journal', icon: IconLog, group: 'Observation' },
  { to: '/stats', label: 'Consommation', icon: IconStats, group: 'Observation' },
  { to: '/office', label: 'Bureau virtuel', icon: IconOffice, group: 'Observation' },
  { to: '/providers', label: 'Fournisseurs', icon: IconProviders, group: 'Système' },
  { to: '/settings', label: 'Paramètres', icon: IconSettings, group: 'Système' },
];
