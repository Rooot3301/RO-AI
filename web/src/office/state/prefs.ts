// Préférences d'affichage persistées en localStorage (toujours entourées de try/catch : stockage parfois indisponible).
import { MAX_ZOOM_DELTA, MIN_ZOOM_DELTA } from '../engine/camera.ts';

/** auto = suit l'heure réelle de Paris ; day / night = forcé. */
export type ThemePref = 'auto' | 'day' | 'night';
export interface OfficePrefs {
  theme: ThemePref; showNames: boolean; zoomDelta: number; listOpen: boolean; legendOpen: boolean;
  /** Vie sociale locale (promenades, café, discussions fictives). */
  social: boolean;
  /** Animations décoratives (vapeur, plantes, écrans de veille…). Les indications réelles restent animées. */
  decor: boolean;
  /** Étage affiché (0 = rez-de-chaussée, 1 = 1er étage). */
  level: number;
}
export const DEFAULT_PREFS: OfficePrefs = { theme: 'auto', showNames: false, zoomDelta: 0, listOpen: true, legendOpen: false, social: true, decor: true, level: 0 };
export const PREFS_KEY = 'roai.office.prefs.v2';
const OLD_KEY = 'roai.office.prefs.v1';

/**
 * Valide un JSON brut ; toute valeur invalide retombe sur le défaut. `wide` : la liste d'agents est ouverte par défaut
 * seulement sur les écrans larges ; `reduced` : mouvement réduit demandé par le système => vie sociale et animations
 * décoratives désactivées par défaut (une préférence enregistrée l'emporte).
 */
export function parsePrefs(raw: string | null, wide = true, reduced = false): OfficePrefs {
  const base: OfficePrefs = { ...DEFAULT_PREFS, listOpen: wide, social: !reduced, decor: !reduced };
  if (!raw) return base;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== 'object') return base;
    const z = typeof o.zoomDelta === 'number' && Number.isFinite(o.zoomDelta) ? Math.round(o.zoomDelta) : DEFAULT_PREFS.zoomDelta;
    const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
    return {
      theme: o.theme === 'day' || o.theme === 'night' || o.theme === 'auto' ? o.theme : base.theme,
      showNames: bool(o.showNames, base.showNames),
      zoomDelta: Math.max(MIN_ZOOM_DELTA, Math.min(MAX_ZOOM_DELTA, z)),
      listOpen: bool(o.listOpen, base.listOpen),
      legendOpen: bool(o.legendOpen, base.legendOpen),
      social: bool(o.social, base.social),
      decor: bool(o.decor, base.decor),
      level: o.level === 1 ? 1 : 0,
    };
  } catch { return base; }
}

export function loadPrefs(): OfficePrefs {
  const wide = typeof window !== 'undefined' && window.innerWidth >= 1600;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return parsePrefs(raw, wide, reduced);
    // reprise de l'ancienne version : on garde noms, zoom, liste, légende (le thème passe en automatique)
    const old = localStorage.getItem(OLD_KEY);
    if (old) { const p = parsePrefs(old, wide, reduced); return { ...p, theme: 'auto' }; }
    return parsePrefs(null, wide, reduced);
  } catch { return parsePrefs(null, wide, reduced); }
}
export function savePrefs(p: OfficePrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* stockage indisponible : on ignore */ }
}
