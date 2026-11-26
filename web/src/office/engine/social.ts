// Simulation sociale LOCALE (sans IA, sans réseau, sans événement) : banques de répliques, dialogues scriptés,
// choix d'activités selon la personnalité. Tout est déterministe à partir d'une graine. Les répliques ne parlent JAMAIS
// du travail réel (missions, résultats, progression) : uniquement de petites conversations de couloir.
import type { Personality } from '../../api/types.ts';

/** Générateur pseudo-aléatoire à graine (mulberry32) : état dans un objet pour éviter toute allocation. */
export interface Rng { s: number }
export function rnd(r: Rng): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const hashStr = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Contexte temporel (heure de Paris) : sert à choisir des répliques plausibles. */
export interface SocialClock { hour: number; weekday: number; month: number; daylight: number; minute?: number;
  /** Week-end ou jour férié (calendrier français) : bureau plus calme. */
  calm?: boolean }
export const DEFAULT_CLOCK: SocialClock = { hour: 10, weekday: 2, month: 5, daylight: 1 };

type Cond = (c: SocialClock) => boolean;
const morning: Cond = (c) => c.hour >= 5 && c.hour < 12;
const afternoon: Cond = (c) => c.hour >= 12 && c.hour < 18;
const evening: Cond = (c) => c.hour >= 18 && c.hour < 23;
const night: Cond = (c) => c.hour >= 23 || c.hour < 5;
const lunch: Cond = (c) => c.hour >= 11 && c.hour < 14;
const monday: Cond = (c) => c.weekday === 1;
const friday: Cond = (c) => c.weekday === 5;
const weekend: Cond = (c) => c.weekday === 0 || c.weekday === 6;
const daylight: Cond = (c) => c.daylight > 0.6;
const dark: Cond = (c) => c.daylight < 0.3;
const winter: Cond = (c) => c.month <= 2 || c.month >= 11;
const any: Cond = () => true;

export interface Line { s: 0 | 1; text: string }
export interface Dialogue { id: string; when: Cond; lines: Line[] }
const d = (id: string, when: Cond, ...texts: string[]): Dialogue => ({ id, when, lines: texts.map((text, i) => ({ s: (i % 2) as 0 | 1, text })) });

/** Salutations en se croisant (2 répliques). */
export const GREETINGS: readonly Dialogue[] = [
  d('g-bonjour', morning, 'Bonjour !', 'Bonjour, bien dormi ?'),
  d('g-bonjour2', morning, 'Salut, bonne matinée !', 'Merci, à toi aussi !'),
  d('g-matin', morning, 'Déjà là de bon matin ?', 'Eh oui, j’aime bien le calme du matin.'),
  d('g-aprem', afternoon, 'Bon après-midi !', 'Merci, pareillement.'),
  d('g-salut', any, 'Salut !', 'Salut, ça va ?'),
  d('g-coucou', any, 'Coucou !', 'Hello !'),
  d('g-hey', any, 'Hey, ça roule ?', 'Tranquille, et toi ?'),
  d('g-soir', evening, 'Bonsoir !', 'Bonsoir, encore dans le coin ?'),
  d('g-nuit', night, 'Tiens, toi aussi tu veilles ?', 'Le bureau est calme la nuit.'),
  d('g-lundi', (c) => monday(c) && !night(c), 'Bon début de semaine !', 'Merci, à toi aussi !'),
  d('g-vendredi', (c) => friday(c) && !night(c), 'Bientôt le week-end !', 'Ça fait plaisir !'),
  d('g-weekend', weekend, 'On est là même le week-end !', 'Le bureau ne dort jamais.'),
  d('g-midi', lunch, 'Bon appétit !', 'Merci !'),
  d('g-croise', any, 'Oh, pardon !', 'Pas de souci, après toi.'),
];

/** Conversations (2 à 4 répliques) avec réponses cohérentes. */
export const CHATS: readonly Dialogue[] = [
  d('c-cava', any, 'Salut, comment ça va ?', 'Très bien, merci ! Et toi ?', 'Ça va, ça va.'),
  d('c-cava2', any, 'Ça va depuis tout à l’heure ?', 'Oui, tout roule. Merci !'),
  d('c-cafe', (c) => !night(c), 'Pause café ?', 'Avec plaisir !', 'Je te suis.'),
  d('c-cafe-non', any, 'Un petit café ?', 'Pas tout de suite, merci.', 'D’accord, une autre fois !'),
  d('c-cafe-bon', any, 'Le café est bon aujourd’hui ?', 'Comme d’habitude : corsé.', 'Parfait.'),
  d('c-calme', any, 'Une journée tranquille aujourd’hui.', 'Oui, c’est agréable.'),
  d('c-repos', any, 'On se retrouve en salle de repos ?', 'Bonne idée, j’arrive.'),
  d('c-pause', any, 'Ça fait du bien de faire une pause.', 'Je confirme !', 'Deux minutes et j’y retourne.'),
  d('c-plantes', any, 'Les plantes ont bien poussé, non ?', 'Quelqu’un s’en occupe bien.'),
  d('c-lumiere', (c) => daylight(c) && morning(c), 'Belle lumière ce matin.', 'Oui, on profite des fenêtres.'),
  d('c-lumiere2', (c) => daylight(c) && afternoon(c), 'Il y a du soleil dans le hall.', 'On y est bien, au calme.'),
  d('c-nuittot', (c) => winter(c) && dark(c) && !night(c), 'Il fait nuit tôt en ce moment.', 'C’est l’hiver, que veux-tu.', 'Vivement le printemps !'),
  d('c-bonsoir', evening, 'Encore là ce soir ?', 'Comme toujours !', 'Bonne soirée alors.'),
  d('c-nuit', night, 'Ça ne dort jamais ici.', 'C’est ce qui fait le charme.'),
  d('c-weekend', (c) => friday(c) || weekend(c), 'Des projets pour le week-end ?', 'Me reposer un peu.', 'Excellent programme.'),
  d('c-lundi', monday, 'Bon week-end ?', 'Très bien, merci. Et toi ?', 'Reposant !'),
  d('c-musique', any, 'Tu écoutes quoi en ce moment ?', 'Un peu de jazz, et toi ?', 'Plutôt du piano.'),
  d('c-livre', any, 'Tu as lu quelque chose de bien ?', 'Un roman de science-fiction.', 'Tu me le prêteras ?', 'Avec plaisir.'),
  d('c-biblio', any, 'La bibliothèque est bien rangée.', 'Oui, on y trouve de tout.'),
  d('c-vue', any, 'Tu as vu la vue depuis le coin fenêtre ?', 'Oui, c’est mon endroit préféré.'),
  d('c-chaise', any, 'Ta chaise est confortable ?', 'Ça va, j’ai réglé la hauteur.', 'Bonne idée.'),
  d('c-the', any, 'Plutôt thé ou café ?', 'Café, sans hésiter.', 'Je m’en doutais !'),
  d('c-eau', any, 'Pense à boire de l’eau !', 'Merci, je file à la fontaine.'),
  d('c-machine', any, 'La machine à café fait du bruit.', 'Elle travaille dur, elle aussi.'),
  d('c-marche', any, 'Je me dégourdis les jambes.', 'Tu as raison, ça fait du bien.'),
  d('c-calme2', any, 'C’est calme dans les couloirs.', 'J’aime bien cette ambiance.'),
  d('c-bureau', any, 'J’aime bien l’ambiance du bureau.', 'Moi aussi, c’est chaleureux.', 'Et bien rangé !'),
  d('c-deco', any, 'Ton bureau est joliment décoré.', 'Merci ! J’y tiens beaucoup.'),
  d('c-souvenir', any, 'Tu te souviens de ton premier jour ?', 'Un peu perdu dans les couloirs !', 'Comme tout le monde.'),
  d('c-merci', any, 'Merci pour tout à l’heure.', 'De rien, avec plaisir !'),
  d('c-midi', lunch, 'Tu as déjà mangé ?', 'Pas encore, et toi ?', 'Bientôt, j’ai faim.'),
  d('c-gouter', (c) => c.hour >= 15 && c.hour < 18, 'C’est l’heure du goûter ?', 'Il reste des biscuits à l’espace café.'),
  d('c-matin2', morning, 'Tu es matinal aujourd’hui.', 'Le café m’a réveillé.'),
  d('c-findejournee', (c) => c.hour >= 17 && c.hour < 21, 'La journée passe vite.', 'C’est vrai, déjà le soir.', 'Le temps file !'),
  d('c-bonnejournee', (c) => morning(c) || afternoon(c), 'Je retourne à mon bureau.', 'Bonne journée !'),
  d('c-abientot', any, 'Allez, à tout à l’heure !', 'À plus tard !'),
  d('c-sport', any, 'Tu fais un peu de sport ?', 'Un peu de marche, surtout.', 'C’est déjà bien.'),
  d('c-recette', any, 'Tu as une bonne recette de gâteau ?', 'Le gâteau au yaourt, imbattable.'),
  d('c-calme3', dark, 'Les lumières sont douces ce soir.', 'Oui, c’est reposant.'),
  d('c-silence', any, 'Tu entends ? Plus un bruit.', 'Profitons-en.'),
];

/** Pensées solitaires discrètes selon le lieu. */
export const SOLO: Readonly<Record<'coffee' | 'window' | 'shelf' | 'sofa' | 'water' | 'vending' | 'desk' | 'outside', readonly string[]>> = {
  outside: ['Un peu d’air frais.', 'Ça fait du bien de sortir.', 'Petite pause dehors.', 'On voit passer du monde.'],
  coffee: ['Un petit café…', 'Allongé, sans sucre.', 'Ça sent bon !', 'Encore une tasse.'],
  window: ['Belle vue d’ici.', 'On respire.', 'Quel calme dehors.'],
  shelf: ['Voyons voir…', 'Tiens, celui-là a l’air bien.', 'Je l’ai déjà lu.'],
  sofa: ['Ça fait du bien de faire une pause.', 'Ah, enfin assis.', 'Deux minutes de calme.'],
  water: ['Un verre d’eau.', 'Rafraîchissant.'],
  vending: ['Hmm, que prendre ?', 'Un petit en-cas.'],
  desk: ['Bon, je range un peu.', 'Hop, un peu d’ordre.'],
};

/** Nombre total de répliques disponibles (contrôle de variété). */
export function lineCount(): number {
  let n = 0;
  for (const x of GREETINGS) n += x.lines.length;
  for (const x of CHATS) n += x.lines.length;
  for (const k of Object.keys(SOLO) as (keyof typeof SOLO)[]) n += SOLO[k].length;
  return n;
}

/** Choisit un dialogue valable à cette heure, en évitant les plus récents (variété). */
export function pickDialogue(bank: readonly Dialogue[], clock: SocialClock, r: Rng, recent: readonly string[]): Dialogue {
  const ok = bank.filter((x) => x.when(clock));
  const fresh = ok.filter((x) => !recent.includes(x.id));
  const pool = fresh.length ? fresh : ok.length ? ok : bank;
  return pool[Math.floor(rnd(r) * pool.length) % pool.length];
}

/** Durée d'affichage d'une réplique (s). */
export const lineDuration = (text: string): number => Math.min(4.2, 1.5 + text.length * 0.045);

export type Activity = 'desk' | 'coffee' | 'water' | 'vending' | 'sofa' | 'shelf' | 'window' | 'wander' | 'visit' | 'outside';
export const DEFAULT_PERSONALITY: Personality = { sociability: 0.5, curiosity: 0.5, energy: 0.5, focus: 0.5, coffee: 0.5 };

/** Poids des activités selon la personnalité (focus ⇒ bureau, énergie/curiosité ⇒ promenade, café ⇒ pauses, sociabilité ⇒ discussions). */
export function activityWeights(p: Personality, clock: SocialClock, last: Activity | null, afterWork: boolean): Record<Activity, number> {
  const w: Record<Activity, number> = {
    desk: 0.4 + 1.5 * p.focus,
    coffee: 0.15 + 1.1 * p.coffee * (clock.hour >= 7 && clock.hour < 18 ? 1.2 : 0.8),
    water: 0.2,
    vending: 0.08 + 0.25 * p.coffee,
    sofa: 0.25 + 0.55 * (1 - p.energy) + 0.2 * p.sociability,
    shelf: 0.1 + 0.8 * p.curiosity,
    window: 0.1 + 0.5 * p.curiosity + (clock.daylight > 0.5 ? 0.1 : 0),
    wander: 0.15 + 0.9 * p.energy + 0.2 * p.curiosity,
    visit: 0.15 + 1.1 * p.sociability,
    // sortir prendre l'air sur le parvis : en journée et en soirée seulement
    outside: clock.hour >= 7 && clock.hour < 21 ? 0.08 + 0.35 * p.energy + (clock.daylight > 0.5 ? 0.1 : 0) : 0,
  };
  if (afterWork) { w.coffee *= 1.8; w.sofa *= 1.6; w.desk *= 0.4; } // après une exécution réussie : petite pause
  if (last) w[last] *= last === 'desk' ? 0.5 : 0.25; // variété : on évite de refaire la même chose
  return w;
}

export function pickWeighted<K extends string>(w: Record<K, number>, r: Rng): K {
  const keys = Object.keys(w) as K[];
  let total = 0;
  for (const k of keys) total += Math.max(0, w[k]);
  let x = rnd(r) * total;
  for (const k of keys) { x -= Math.max(0, w[k]); if (x <= 0) return k; }
  return keys[keys.length - 1];
}

export function clampPersonality(p: Partial<Personality> | null | undefined): Personality {
  const f = (v: unknown, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : dflt);
  return { sociability: f(p?.sociability, 0.5), curiosity: f(p?.curiosity, 0.5), energy: f(p?.energy, 0.5), focus: f(p?.focus, 0.5), coffee: f(p?.coffee, 0.5) };
}
