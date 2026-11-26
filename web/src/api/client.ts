import type { Agent, AgentInput, Conversation, DiscordSettings, DiscordUpdate, Control, Stats, OfficeSnapshot, Provider, ProviderId, RoEvent, Run, Schedule, ScheduleInput, SystemInfo, CodexModel, AgentProfile, AgentProfileInput, OfficeLayoutDoc, OfficeBoards, OfficeReport, DevSession, InboxSource, InboxSourceInput, Delivery, OfficeSociety } from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function csrfToken(): string {
  const m = document.cookie.match(/(?:^|;\s*)roai_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

/** `detail` peut être une chaîne ou (validation 422 FastAPI) une liste d'objets {loc, msg}. */
export function formatDetail(d: unknown): string {
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) {
    return d.map((x) => {
      if (x && typeof x === 'object' && 'msg' in x) {
        const loc = Array.isArray((x as { loc?: unknown[] }).loc) ? (x as { loc: unknown[] }).loc.filter((l) => l !== 'body').join('.') : '';
        return loc ? `${loc} : ${String((x as { msg: unknown }).msg)}` : String((x as { msg: unknown }).msg);
      }
      return typeof x === 'string' ? x : JSON.stringify(x);
    }).join(' ; ');
  }
  return d == null ? '' : JSON.stringify(d);
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken();
  let res: Response;
  try {
    res = await fetch(path, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Serveur injoignable. Vérifiez la connexion réseau.');
  }
  if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
  if (!res.ok) {
    let detail = res.statusText;
    try { const j = await res.json(); detail = formatDetail(j.detail) || detail; } catch { /* corps vide */ }
    throw new ApiError(res.status, detail);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
const q = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  login: (username: string, password: string) => request<{ username: string }>('POST', '/auth/login', { username, password }),
  logout: () => request<void>('POST', '/auth/logout'),
  me: () => request<{ username: string }>('GET', '/auth/me'),
  health: () => request<{ status: string; version: string; uptime_s: number; domain: string }>('GET', '/api/health'),
  system: () => request<SystemInfo>('GET', '/api/system'),
  providers: () => request<Provider[]>('GET', '/api/providers'),
  refreshProvider: (id: ProviderId) => request<Provider>('POST', `/api/providers/${id}/refresh`),
  agentProfile: (id: string) => request<AgentProfile>('GET', `/api/agents/${id}/profile`),
  saveAgentProfile: (id: string, p: AgentProfileInput) => request<AgentProfile>('PUT', `/api/agents/${id}/profile`, p),
  resetAgentProfile: (id: string) => request<void>('DELETE', `/api/agents/${id}/profile`),
  generateAgentProfile: (id: string, force = false) => request<{ status: 'generating' }>('POST', `/api/agents/${id}/profile/generate`, { force }),
  officeLayout: () => request<{ layout: OfficeLayoutDoc | null }>('GET', '/api/office/layout'),
  officeBoards: () => request<OfficeBoards>('GET', '/api/office/boards'),
  saveOfficeLayout: (layout: OfficeLayoutDoc | null) => request<{ layout: OfficeLayoutDoc | null }>('PUT', '/api/office/layout', { layout }),
  codexModels: () => request<{ models: CodexModel[] }>('GET', '/api/providers/codex/models'),
  agents: () => request<Agent[]>('GET', '/api/agents'),
  agent: (id: string) => request<Agent>('GET', `/api/agents/${id}`),
  createAgent: (a: AgentInput) => request<Agent>('POST', '/api/agents', a),
  updateAgent: (id: string, a: AgentInput) => request<Agent>('PUT', `/api/agents/${id}`, a),
  deleteAgent: (id: string) => request<void>('DELETE', `/api/agents/${id}`),
  setAgentWebhook: (id: string, webhook_url: string) => request<{ discord_webhook_set: boolean }>('PUT', `/api/agents/${id}/discord-webhook`, { webhook_url }),
  deleteAgentWebhook: (id: string) => request<{ discord_webhook_set: boolean }>('DELETE', `/api/agents/${id}/discord-webhook`),
  testAgentWebhook: (id: string) => request<{ ok: boolean; error: string | null }>('POST', `/api/agents/${id}/discord-webhook/test`),
  runAgent: (id: string, prompt?: string, via?: 'chat') => request<Run>('POST', `/api/agents/${id}/run`, via ? { prompt, via } : { prompt }),
  officeArchive: (limit = 40) => request<{ reports: OfficeReport[] }>('GET', `/api/office/archive?limit=${limit}`),
  officeDevteam: () => request<{ now: string; sessions: DevSession[] }>('GET', '/api/office/devteam'),
  officeSociety: () => request<OfficeSociety>('GET', '/api/office/society'),
  officeSocietyGenerate: () => request<{ status: string }>('POST', '/api/office/society/generate'),
  officeSocietySettings: (enabled: boolean) => request<OfficeSociety>('PUT', '/api/office/society/settings', { enabled }),
  inboxSources: () => request<{ sources: InboxSource[] }>('GET', '/api/inbox/sources'),
  inboxSourceCreate: (b: InboxSourceInput) => request<InboxSource & { token: string }>('POST', '/api/inbox/sources', b),
  inboxSourceUpdate: (id: string, b: InboxSourceInput) => request<InboxSource>('PUT', `/api/inbox/sources/${id}`, b),
  inboxSourceToken: (id: string) => request<InboxSource & { token: string }>('POST', `/api/inbox/sources/${id}/token`),
  inboxSourceDelete: (id: string) => request<void>('DELETE', `/api/inbox/sources/${id}`),
  inboxDeliveries: (limit = 50) => request<{ deliveries: Delivery[] }>('GET', `/api/inbox/deliveries?limit=${limit}`),
  runs: (f: { agent_id?: string; status?: string; limit?: number; before?: string; conversation_id?: string } = {}) => request<Run[]>('GET', `/api/runs${q(f)}`),
  run: (id: string) => request<Run>('GET', `/api/runs/${id}`),
  runEvents: (id: string, since = 0) => request<{ events: RoEvent[]; last_seq: number }>('GET', `/api/runs/${id}/events${q({ since })}`),
  replyRun: (id: string, prompt: string) => request<Run>('POST', `/api/runs/${id}/reply`, { prompt }),
  conversation: (id: string) => request<Conversation>('GET', `/api/conversations/${id}`),
  cancelRun: (id: string) => request<Run>('POST', `/api/runs/${id}/cancel`),
  approveRun: (id: string) => request<Run>('POST', `/api/runs/${id}/approve`),
  rejectRun: (id: string) => request<Run>('POST', `/api/runs/${id}/reject`),
  schedules: () => request<Schedule[]>('GET', '/api/schedules'),
  createSchedule: (s: ScheduleInput) => request<Schedule>('POST', '/api/schedules', s),
  updateSchedule: (id: string, s: ScheduleInput) => request<Schedule>('PUT', `/api/schedules/${id}`, s),
  deleteSchedule: (id: string) => request<void>('DELETE', `/api/schedules/${id}`),
  runScheduleNow: (id: string) => request<Run>('POST', `/api/schedules/${id}/run-now`),
  events: (f: { since?: number; limit?: number; agent_id?: string; run_id?: string; type_prefix?: string } = {}) =>
    request<{ events: RoEvent[]; last_seq: number }>('GET', `/api/events${q(f)}`),
  control: () => request<Control>('GET', '/api/control'),
  emergencyStop: (reason?: string) => request<Control>('POST', '/api/control/emergency-stop', reason?.trim() ? { reason: reason.trim() } : {}),
  resume: () => request<Control>('POST', '/api/control/resume'),
  stats: (days: number) => request<Stats>('GET', `/api/stats${q({ days })}`),
  discord: () => request<DiscordSettings>('GET', '/api/settings/discord'),
  saveDiscord: (u: DiscordUpdate) => request<DiscordSettings>('PUT', '/api/settings/discord', u),
  testDiscord: (target: 'bot' | 'webhook' = 'bot') => request<{ ok: boolean; error: string | null }>('POST', '/api/settings/discord/test', { target }),
  officeSnapshot: () => request<OfficeSnapshot>('GET', '/api/office/snapshot'),
};
