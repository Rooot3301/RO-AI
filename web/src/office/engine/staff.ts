// Personnel figurant (non piloté par l'IA, sans réseau ni événement) : réceptionniste, technicien de la salle serveur,
// agent d'entretien en soirée. Ce qu'ils disent est soit une formule de politesse, soit un fait RÉEL calculé à partir des
// données déjà chargées par le bureau (états des agents, planifications, état du serveur). Jamais d'information inventée.
import type { SocialClock } from './social.ts';
import { whenLabel } from '../state/boards.ts';

/** `dev` : session Claude Code qui développe RO·AI (données réelles du hook local), pas un figurant. */
export type ExtraKind = 'reception' | 'tech' | 'cleaner' | 'dev' | 'courier' | 'orch';
export const STAFF_IDS: Readonly<Record<ExtraKind, string>> = { reception: '__reception__', tech: '__tech__', cleaner: '__cleaner__', dev: '__dev__:', courier: '__courier__:', orch: '__orchestrator__' };
export const STAFF_LABEL: Readonly<Record<ExtraKind, string>> = { reception: 'Accueil', tech: 'Technicien', cleaner: 'Entretien', dev: 'Claude Code', courier: 'Livreur', orch: 'Orchestrateur' };
export const isStaffId = (id: string | null | undefined): boolean => !!id && (id === STAFF_IDS.reception || id === STAFF_IDS.tech || id === STAFF_IDS.cleaner);

/** Faits réels transmis au personnel (null = donnée indisponible : on n'en parle pas). */
export interface StaffInfo {
  loaded: boolean;
  working: number; approvals: number; errors: number; queued: number;
  next: { agent: string; at: string } | null;
  memPct: number | null; diskPct: number | null; cpuPct: number | null;
  /** Fournisseur dont l'authentification est en défaut (identifiant), sinon null. */
  providerDown: string | null;
  /** Agent dont la dernière exécution a échoué pour une raison système (délai, erreur transitoire). */
  sysError: string | null;
  /** Planning du jour (heure de Paris) : null tant qu'il n'est pas chargé. */
  today?: { total: number; done: number; failed: number; paused: boolean } | null;
  /** Limite d'usage proche ou atteinte (signal réel des clients officiels), sinon null. */
  limit?: { provider: string; label: string; level: 'warning' | 'limited'; pct: number | null; resetsAt: string | null } | null;
  /** Arrêt d'urgence réel en cours. */
  paused?: boolean;
  /** Consommation connue par fenêtre (remarques calmes du technicien). */
  usage?: { provider: string; label: string; pct: number }[];
}
export const EMPTY_STAFF_INFO: StaffInfo = { loaded: false, working: 0, approvals: 0, errors: 0, queued: 0, next: null, memPct: null, diskPct: null, cpuPct: null, providerDown: null, sysError: null };

export const MEM_ALERT = 85, DISK_ALERT = 90;
const PROVIDER_NAME: Record<string, string> = { claude: 'Claude', codex: 'Codex' };

const pl = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
let timeFmt: Intl.DateTimeFormat | null = null;
/** Heure de Paris « 14 h 05 » d'un instant ISO (null si illisible). */
export function parisHM(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  try {
    timeFmt ??= new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false });
    const p = timeFmt.formatToParts(new Date(t));
    return `${Number(p.find((x) => x.type === 'hour')?.value)} h ${p.find((x) => x.type === 'minute')?.value}`;
  } catch { return null; }
}
const clockHM = (c: SocialClock) => `${c.hour} h ${String(c.minute ?? 0).padStart(2, '0')}`;

/** Salutation de la réceptionniste à un agent qui passe (formule, selon l'heure). */
export function receptionGreeting(name: string, c: SocialClock, variant: number): string {
  const short = name.length > 18 ? name.slice(0, 17) + '…' : name;
  if (c.hour >= 18 || c.hour < 5) return variant % 2 ? `Bonsoir ${short} !` : 'Bonsoir !';
  if (c.hour < 12) return variant % 3 === 0 ? `Bonjour ${short} !` : variant % 3 === 1 ? 'Bonjour, belle matinée !' : `Bonne journée ${short} !`;
  return variant % 2 ? `Bon après-midi ${short} !` : 'Bonjour !';
}

/** Informations réelles que la réceptionniste peut donner (ou formules de politesse sans donnée). */
export function receptionFacts(info: StaffInfo, c: SocialClock, nowMs: number = Date.now()): string[] {
  const out: string[] = [];
  if (info.loaded) {
    if (info.paused) out.push('Arrêt d’urgence : tout est suspendu.');
    out.push(info.working ? `${pl(info.working, 'agent', 'agents')} au travail en ce moment.` : 'Aucun agent au travail pour l’instant.');
    if (info.approvals) out.push(`${pl(info.approvals, 'demande attend', 'demandes attendent')} une approbation.`);
    if (info.queued) out.push(`${pl(info.queued, 'exécution', 'exécutions')} en file d’attente.`);
    if (info.errors) out.push(`${pl(info.errors, 'agent signale', 'agents signalent')} une erreur.`);
    // phrases courtes : elles s'affichent aussi dans les bulles (44 caractères au plus)
    if (info.today) {
      if (info.today.paused && !info.paused) out.push('Arrêt d’urgence : planning suspendu.');
      if (info.today.total) out.push(`Aujourd’hui : ${pl(info.today.total, 'mission prévue', 'missions prévues')}, ${pl(info.today.done, 'faite', 'faites')}.`);
      else out.push('Aucune mission planifiée aujourd’hui.');
      if (info.today.failed) out.push(`${pl(info.today.failed, 'mission planifiée', 'missions planifiées')} en échec.`);
    }
    if (info.next) {
      const hm = parisHM(info.next.at), left = Date.parse(info.next.at) - nowMs;
      if (hm) out.push(`Prochaine mission à ${hm} : ${info.next.agent}.`);
      if (hm && left > 0 && left < 3 * 3600_000) out.push(`Départ de la prochaine mission dans ${left < 3600_000 ? `${Math.max(1, Math.round(left / 60_000))} min` : `${Math.floor(left / 3600_000)} h ${String(Math.round((left % 3600_000) / 60_000)).padStart(2, '0')}`}.`);
    }
    if (c.minute !== undefined) out.push(`Il est ${clockHM(c)}.`);
  }
  if (!out.length) out.push('Bienvenue chez RO·AI.', 'Bonne journée !');
  return out;
}

export interface TechAlert { kind: 'mem' | 'disk' | 'provider' | 'limit' | 'system'; text: string }
/** Alerte réelle qui justifie une intervention du technicien (par ordre de gravité), sinon null. */
export function techAlert(info: StaffInfo, nowMs: number = Date.now()): TechAlert | null {
  if (info.memPct !== null && info.memPct >= MEM_ALERT) return { kind: 'mem', text: `Mémoire à ${Math.round(info.memPct)} % : je surveille.` };
  if (info.diskPct !== null && info.diskPct >= DISK_ALERT) return { kind: 'disk', text: `Disque à ${Math.round(info.diskPct)} % : il faudra faire de la place.` };
  if (info.providerDown) return { kind: 'provider', text: `${PROVIDER_NAME[info.providerDown] ?? info.providerDown} est déconnecté.` };
  if (info.limit) {
    const l = info.limit, who = `${PROVIDER_NAME[l.provider] ?? l.provider} ${l.label}`, hm = l.resetsAt ? whenLabel(l.resetsAt, nowMs).replace(':', ' h ') : null;
    return { kind: 'limit', text: l.level === 'limited' ? `${who} bloqué${hm ? `, retour ${/^\d/.test(hm) ? 'à ' : ''}${hm}` : ''}.` : `${who}${l.pct !== null ? ` à ${Math.round(l.pct)} %` : ' : limite proche'}, je surveille.` };
  }
  if (info.sysError) return { kind: 'system', text: `Erreur système sur une exécution de ${info.sysError}.` };
  return null;
}

/** Remarques calmes du technicien pendant ses rondes (réelles si les mesures sont connues). */
export function techRemarks(info: StaffInfo): string[] {
  const out: string[] = [];
  if (info.cpuPct !== null) out.push(`Processeur à ${Math.round(info.cpuPct)} %.`);
  if (info.memPct !== null) out.push(`Mémoire à ${Math.round(info.memPct)} %, tout va bien.`);
  if (info.diskPct !== null) out.push(`Disque occupé à ${Math.round(info.diskPct)} %.`);
  for (const u of info.usage ?? []) out.push(`${PROVIDER_NAME[u.provider] ?? u.provider} : ${Math.round(u.pct)} % de la limite ${u.label}.`);
  if (!out.length) out.push('Ronde de routine.', 'Tout est calme ici.');
  return out;
}
