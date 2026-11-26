// Fiches d'identité : libellés français, conversion formulaire <-> AgentProfileInput, validation (logique pure, sans DOM).
// Les limites reprennent celles du serveur (backend/roai/profiles.py, ProfileIn).
import type { Accessory, AgentProfile, AgentProfileInput, Appearance, Decor, DecorItem, DecorTheme, Personality } from '../../../api/types';

export const LIMITS = {
  display_name: 60, employee_id: 20, title: 80, office: 12, bio: 600,
  listItems: 6, listItemLen: 60, skills: 8, skillLen: 40, decorItems: 6,
} as const;

export const THEMES: readonly DecorTheme[] = ['general', 'security', 'space', 'dev', 'research', 'sysadmin', 'data', 'writing', 'design', 'finance', 'support'];
export const THEME_LABEL: Record<DecorTheme, string> = {
  general: 'Polyvalent', security: 'Sécurité', space: 'Espace', dev: 'Développement', research: 'Recherche', sysadmin: 'Administration système',
  data: 'Données', writing: 'Rédaction', design: 'Design', finance: 'Finance', support: 'Support',
};
/** Objets proposés par thème (mêmes listes que le serveur). */
export const THEME_ITEMS: Record<DecorTheme, readonly DecorItem[]> = {
  general: ['plant_small', 'photo_frame', 'mug', 'desk_lamp'],
  security: ['multi_monitor', 'network_rack', 'shield_poster', 'status_board'],
  space: ['ship_model', 'space_poster', 'planet_globe', 'star_map'],
  dev: ['mech_keyboard', 'code_poster', 'rubber_duck', 'second_monitor'],
  research: ['book_stack', 'documents', 'magnifier', 'notes_board'],
  sysadmin: ['multi_monitor', 'status_board', 'cable_box', 'server_mini'],
  data: ['chart_poster', 'second_monitor', 'notes_board', 'mug'],
  writing: ['book_stack', 'typewriter', 'documents', 'desk_lamp'],
  design: ['drawing_tablet', 'color_swatches', 'art_poster', 'plant_small'],
  finance: ['calculator', 'chart_poster', 'documents', 'photo_frame'],
  support: ['headset_stand', 'notes_board', 'mug', 'plant_small'],
};
export const ITEM_LABEL: Record<DecorItem, string> = {
  plant_small: 'Petite plante', photo_frame: 'Cadre photo', mug: 'Tasse', desk_lamp: 'Lampe de bureau', multi_monitor: 'Écrans multiples',
  network_rack: 'Baie réseau', shield_poster: 'Affiche bouclier', status_board: 'Tableau de supervision', ship_model: 'Maquette de vaisseau',
  space_poster: 'Affiche spatiale', planet_globe: 'Globe planétaire', star_map: 'Carte du ciel', mech_keyboard: 'Clavier mécanique',
  code_poster: 'Affiche de code', rubber_duck: 'Canard en plastique', second_monitor: 'Second écran', book_stack: 'Pile de livres',
  documents: 'Dossiers', magnifier: 'Loupe', notes_board: 'Tableau de notes', cable_box: 'Boîte à câbles', server_mini: 'Mini-serveur',
  chart_poster: 'Affiche de graphiques', typewriter: 'Machine à écrire', drawing_tablet: 'Tablette graphique', color_swatches: 'Nuancier',
  art_poster: 'Affiche artistique', calculator: 'Calculatrice', headset_stand: 'Support de casque',
};
/** Tous les objets, dans l'ordre des thèmes (sans doublon). */
export const ALL_ITEMS: readonly DecorItem[] = [...new Set(THEMES.flatMap((t) => THEME_ITEMS[t]))];

export const ACCESSORIES: readonly Accessory[] = ['none', 'glasses', 'headset', 'cap', 'beanie', 'earrings'];
export const ACCESSORY_LABEL: Record<Accessory, string> = {
  none: 'Aucun', glasses: 'Lunettes', headset: 'Casque audio', cap: 'Casquette', beanie: 'Bonnet', earrings: 'Boucles d’oreilles',
};
export const APPEARANCE_RANGE = { skin: 6, hair: 8, hair_style: 6, outfit: 8 } as const;
export const APPEARANCE_LABEL: Record<keyof typeof APPEARANCE_RANGE, string> = {
  skin: 'Teint', hair: 'Couleur des cheveux', hair_style: 'Coiffure', outfit: 'Tenue',
};
export const DECOR_COLORS = 8;
/** Teintes d'accent proposées pour le poste (indices 0..7). Le moteur de rendu peut réutiliser cette palette. */
export const DECOR_ACCENT_SWATCHES: readonly string[] = ['#f5a742', '#4ccaa1', '#6fb0f2', '#a58be0', '#f26d5d', '#e6c04c', '#5fc3d6', '#c9ced8'];
export const DECOR_ACCENT_LABEL: readonly string[] = ['Ambre', 'Vert', 'Bleu', 'Violet', 'Corail', 'Jaune', 'Turquoise', 'Gris clair'];

export const PERSONALITY_KEYS: readonly (keyof Personality)[] = ['sociability', 'curiosity', 'energy', 'focus', 'coffee'];
export const PERSONALITY_LABEL: Record<keyof Personality, { label: string; low: string; high: string; hint: string }> = {
  sociability: { label: 'Sociabilité', low: 'Réservé', high: 'Bavard', hint: 'Fréquence des discussions avec les collègues.' },
  curiosity: { label: 'Curiosité', low: 'Casanier', high: 'Explorateur', hint: 'Visites de la bibliothèque, des fenêtres, petites promenades.' },
  energy: { label: 'Énergie', low: 'Calme', high: 'Remuant', hint: 'Fréquence des déplacements.' },
  focus: { label: 'Concentration', low: 'Dispersé', high: 'Concentré', hint: 'Tendance à rester à son bureau.' },
  coffee: { label: 'Café', low: 'Rarement', high: 'Souvent', hint: 'Fréquence des pauses café.' },
};
export const PERSONALITY_NOTE = 'Ces réglages influencent seulement la vie simulée du bureau (déplacements, pauses, discussions) : jamais le travail réel de l’agent.';

export const SOURCE_LABEL: Record<AgentProfile['source'], string> = {
  default: 'Fiche par défaut', manual: 'Fiche personnalisée', generated: 'Fiche générée par IA',
};
export const SOURCE_HINT: Record<AgentProfile['source'], string> = {
  default: 'Calculée automatiquement à partir du nom, du département et de la mission ; rien n’est enregistré tant que vous ne la modifiez pas.',
  manual: 'Enregistrée à la main.',
  generated: 'Générée une fois par l’IA, modifiable à la main.',
};

export const LIST_LABEL = { traits: 'Traits de caractère', interests: 'Centres d’intérêt', habits: 'Habitudes', skills: 'Compétences' } as const;
export type ListKey = keyof typeof LIST_LABEL;
export const listLimits = (k: ListKey) => (k === 'skills' ? { max: LIMITS.skills, len: LIMITS.skillLen } : { max: LIMITS.listItems, len: LIMITS.listItemLen });

/** Parties de la fiche éditables séparément (un éditeur n'envoie que les siennes, le reste vient de la fiche courante). */
export type ProfilePart = 'identity' | 'story' | 'personality' | 'appearance' | 'decor';
export const ALL_PARTS: readonly ProfilePart[] = ['identity', 'story', 'personality', 'appearance', 'decor'];
const PART_FIELDS: Record<ProfilePart, readonly (keyof AgentProfileInput)[]> = {
  identity: ['display_name', 'employee_id', 'title', 'hired_at', 'office'],
  story: ['bio', 'traits', 'interests', 'habits', 'skills'],
  personality: ['personality'],
  appearance: ['appearance'],
  decor: ['decor'],
};

export interface ProfileForm {
  display_name: string; employee_id: string; title: string; hired_at: string; office: string; bio: string;
  traits: string[]; interests: string[]; habits: string[]; skills: string[];
  personality: Personality; appearance: Appearance; decor: Decor;
}
export type ProfileErrors = Partial<Record<keyof ProfileForm, string>>;

const clamp01 = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5);
const clampInt = (n: unknown, size: number) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : 0;
  return Math.min(size - 1, Math.max(0, v));
};
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function normalizeAppearance(a: Partial<Appearance> | null | undefined): Appearance {
  const x = a ?? {};
  return {
    skin: clampInt(x.skin, APPEARANCE_RANGE.skin), hair: clampInt(x.hair, APPEARANCE_RANGE.hair),
    hair_style: clampInt(x.hair_style, APPEARANCE_RANGE.hair_style), outfit: clampInt(x.outfit, APPEARANCE_RANGE.outfit),
    accessory: ACCESSORIES.includes(x.accessory as Accessory) ? (x.accessory as Accessory) : 'none',
  };
}
export function normalizeDecor(d: Partial<Decor> | null | undefined): Decor {
  const x = d ?? {};
  const theme = THEMES.includes(x.theme as DecorTheme) ? (x.theme as DecorTheme) : 'general';
  const items = [...new Set(strList(x.items).filter((i): i is DecorItem => (ALL_ITEMS as readonly string[]).includes(i)))].slice(0, LIMITS.decorItems);
  return { theme, items, color: clampInt(x.color, DECOR_COLORS) };
}

export function profileToForm(p: AgentProfileInput): ProfileForm {
  const per = p.personality ?? ({} as Personality);
  return {
    display_name: p.display_name ?? '', employee_id: p.employee_id ?? '', title: p.title ?? '', hired_at: p.hired_at ?? '', office: p.office ?? '', bio: p.bio ?? '',
    traits: strList(p.traits), interests: strList(p.interests), habits: strList(p.habits), skills: strList(p.skills),
    personality: { sociability: clamp01(per.sociability), curiosity: clamp01(per.curiosity), energy: clamp01(per.energy), focus: clamp01(per.focus), coffee: clamp01(per.coffee) },
    appearance: normalizeAppearance(p.appearance), decor: normalizeDecor(p.decor),
  };
}

const oneLine = (s: string) => s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim();
const cleanText = (s: string) => s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim();
/** Liste nettoyée : espaces réduits, vides et doublons retirés (comme le serveur). */
export function cleanList(v: readonly string[]): string[] {
  const out: string[] = [];
  for (const s of v) { const t = oneLine(s); if (t && !out.includes(t)) out.push(t); }
  return out;
}
const round2 = (n: number) => Math.round(clamp01(n) * 100) / 100;

export function formToInput(f: ProfileForm): AgentProfileInput {
  return {
    display_name: oneLine(f.display_name), employee_id: oneLine(f.employee_id), title: oneLine(f.title), hired_at: f.hired_at.trim(), office: oneLine(f.office),
    bio: cleanText(f.bio), traits: cleanList(f.traits), interests: cleanList(f.interests), habits: cleanList(f.habits), skills: cleanList(f.skills),
    personality: { sociability: round2(f.personality.sociability), curiosity: round2(f.personality.curiosity), energy: round2(f.personality.energy), focus: round2(f.personality.focus), coffee: round2(f.personality.coffee) },
    appearance: normalizeAppearance(f.appearance), decor: normalizeDecor(f.decor),
  };
}

/** Extrait l'entrée éditable d'une fiche complète. */
export function profileInput(p: AgentProfileInput): AgentProfileInput { return formToInput(profileToForm(p)); }

/** Fusionne : les parties `parts` viennent du formulaire, le reste de la fiche courante (pour ne pas écraser un autre éditeur). */
export function mergeParts(base: AgentProfileInput, edited: AgentProfileInput, parts: readonly ProfilePart[]): AgentProfileInput {
  const out = { ...profileInput(base) } as Record<string, unknown>;
  for (const part of parts) for (const k of PART_FIELDS[part]) out[k] = edited[k];
  return out as unknown as AgentProfileInput;
}

/** Date AAAA-MM-JJ existante (ou vide). */
export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Validation côté client ; seules les parties éditées sont contrôlées. */
export function validateProfileForm(f: ProfileForm, parts: readonly ProfilePart[] = ALL_PARTS): ProfileErrors {
  const e: ProfileErrors = {};
  const has = (p: ProfilePart) => parts.includes(p);
  if (has('identity')) {
    const name = oneLine(f.display_name);
    if (!name) e.display_name = 'Le nom affiché est obligatoire.';
    else if (name.length > LIMITS.display_name) e.display_name = `Nom affiché : ${LIMITS.display_name} caractères maximum (${name.length}).`;
    if (oneLine(f.title).length > LIMITS.title) e.title = `Fonction : ${LIMITS.title} caractères maximum.`;
    if (oneLine(f.employee_id).length > LIMITS.employee_id) e.employee_id = `Matricule : ${LIMITS.employee_id} caractères maximum.`;
    if (oneLine(f.office).length > LIMITS.office) e.office = `N° de bureau : ${LIMITS.office} caractères maximum.`;
    const d = f.hired_at.trim();
    if (d && !isValidDate(d)) e.hired_at = 'Date de recrutement invalide (format AAAA-MM-JJ).';
  }
  if (has('story')) {
    if (cleanText(f.bio).length > LIMITS.bio) e.bio = `Biographie : ${LIMITS.bio} caractères maximum (${cleanText(f.bio).length}).`;
    for (const k of ['traits', 'interests', 'habits', 'skills'] as const) {
      const { max, len } = listLimits(k);
      const l = cleanList(f[k]);
      if (l.length > max) e[k] = `${LIST_LABEL[k]} : ${max} éléments maximum.`;
      else if (l.some((x) => x.length > len)) e[k] = `${LIST_LABEL[k]} : ${len} caractères maximum par élément.`;
    }
  }
  if (has('decor') && normalizeDecor(f.decor).items.length < f.decor.items.length) e.decor = `Bureau : ${LIMITS.decorItems} objets maximum.`;
  return e;
}

/** Ajoute/retire un objet de décor (≤ 6, sans doublon). Renvoie la même liste si l'ajout est impossible. */
export function toggleItem(items: readonly DecorItem[], item: DecorItem): DecorItem[] {
  if (items.includes(item)) return items.filter((i) => i !== item);
  if (items.length >= LIMITS.decorItems) return [...items];
  return [...items, item];
}
/** Suggestions du thème non encore posées sur le bureau. */
export const suggestedItems = (theme: DecorTheme, items: readonly DecorItem[]): DecorItem[] => THEME_ITEMS[theme].filter((i) => !items.includes(i));

/** Ajoute des éléments à une liste de la fiche (séparés par virgule ou retour à la ligne), en respectant les limites. */
export function addListItems(list: readonly string[], raw: string, key: ListKey): { list: string[]; rejected: string | null } {
  const { max, len } = listLimits(key);
  const out = [...list];
  let rejected: string | null = null;
  for (const s of raw.split(/[,\n]/)) {
    const t = oneLine(s);
    if (!t || out.includes(t)) continue;
    if (t.length > len) { rejected = `${len} caractères maximum par élément.`; continue; }
    if (out.length >= max) { rejected = `${max} éléments maximum.`; break; }
    out.push(t);
  }
  return { list: out, rejected };
}

export const sameForm = (a: ProfileForm, b: ProfileForm) => JSON.stringify(formToInput(a)) === JSON.stringify(formToInput(b));

/** Message clair pour un refus de génération (409/503) ou une erreur réseau. */
export function generationErrorMessage(status: number | undefined, detail: string): string {
  const d = detail || '';
  if (status === 409) {
    if (/arr[êe]t d.urgence/i.test(d)) return 'Arrêt d’urgence actif : la génération reprendra possible après la reprise.';
    if (/en cours/i.test(d)) return 'Une génération est déjà en cours pour cet agent.';
    if (/d[ée]j[àa] g[ée]n[ée]r[ée]e/i.test(d)) return 'Cette fiche a déjà été générée : utilisez « Régénérer » pour la refaire.';
    return d || 'Génération refusée (conflit).';
  }
  if (status === 503) return d ? `Fournisseur indisponible : ${d}` : 'Le fournisseur de l’agent est indisponible (connexion ou installation).';
  if (status === 0) return d || 'Serveur injoignable.';
  return d || 'Génération impossible.';
}

/** Somme des jetons d'une génération (null si inconnue). */
export function generationTokens(g: AgentProfile['generation']): { input: number | null; output: number | null; total: number | null } {
  if (!g) return { input: null, output: null, total: null };
  const i = typeof g.input_tokens === 'number' ? g.input_tokens : null;
  const o = typeof g.output_tokens === 'number' ? g.output_tokens : null;
  return { input: i, output: o, total: i == null && o == null ? null : (i ?? 0) + (o ?? 0) };
}
