import type { Schedule, ScheduleInput } from '../api/types';
import { isValidTimezone, parseCron } from './cron.ts';

export interface ScheduleForm { agent_id: string; name: string; cron: string; timezone: string; prompt: string; enabled: boolean }

export function defaultTimezone(): string {
  try { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; if (tz && isValidTimezone(tz)) return tz; } catch { /* ignore */ }
  return 'Europe/Paris';
}
export const emptyScheduleForm = (agentId = ''): ScheduleForm => ({ agent_id: agentId, name: '', cron: '0 9 * * 1-5', timezone: defaultTimezone(), prompt: '', enabled: true });
export const scheduleToForm = (s: Schedule): ScheduleForm => ({ agent_id: s.agent_id, name: s.name, cron: s.cron, timezone: s.timezone || 'UTC', prompt: s.prompt ?? '', enabled: s.enabled });

export function validateSchedule(f: ScheduleForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.agent_id) e.agent_id = 'Choisissez l’agent à lancer.';
  if (!f.name.trim()) e.name = 'Le nom est obligatoire.';
  const c = parseCron(f.cron);
  if (!c.ok) e.cron = c.errors.join(' ');
  if (!f.timezone.trim()) e.timezone = 'Le fuseau horaire est obligatoire.';
  else if (!isValidTimezone(f.timezone.trim())) e.timezone = 'Fuseau horaire inconnu (ex. Europe/Paris, UTC).';
  return e;
}

export function scheduleToInput(f: ScheduleForm): ScheduleInput {
  return { agent_id: f.agent_id, name: f.name.trim(), cron: f.cron.trim().split(/\s+/).join(' '), timezone: f.timezone.trim(), prompt: f.prompt, enabled: f.enabled };
}
export const scheduleInputFrom = (s: Schedule, patch: Partial<ScheduleInput> = {}): ScheduleInput => ({ ...scheduleToInput(scheduleToForm(s)), ...patch });
