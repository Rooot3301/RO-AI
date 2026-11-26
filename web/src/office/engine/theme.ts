// Palette du siège : chaleureuse et sobre (bois clair, tissus feutrés, graphite), accent ambre RO·AI #f5a742.
// Pas de néons ni de dégradés voyants : les volumes viennent des faces (dessus clair, façade plus sombre) et des ombres.
import type { AgentState } from '../../api/types.ts';
import type { FloorKind } from '../layout/plan.ts';
import { DECOR_ACCENT_SWATCHES } from '../ui/panel/profileForm.ts';

export type ThemeName = 'night' | 'day';
/** Opacité maximale du voile de nuit. */
export const NIGHT_VEIL = 0.72;
export const VEIL_ALPHA: Record<ThemeName, number> = { night: NIGHT_VEIL, day: 0 };

export const STATE_COLOR: Record<AgentState, string> = { idle: '#a7aebb', working: '#f5a742', waiting: '#6fb0f2', error: '#f26d5d', disabled: '#8590a2' };
export const UI = { amber: '#f5a742', ok: '#4ccaa1', err: '#f26d5d', info: '#6fb0f2', warn: '#e6c04c', plug: '#a58be0', ink: '#121418', text: '#e9ebef', dim: '#a7aebb' };

/** Couleurs d'accent des bureaux personnels (identiques au sélecteur de la fiche). */
export const ACCENTS: readonly string[] = DECOR_ACCENT_SWATCHES;

/** Teinte discrète de moquette par département (sol) + liseré. */
export const DEPT_COLORS: readonly { a: string; b: string; accent: string }[] = [
  { a: '#a9b4c2', b: '#a2adbb', accent: '#5f87b8' },
  { a: '#adbcaa', b: '#a6b5a3', accent: '#5f9a78' },
  { a: '#c4b8a2', b: '#bdb19b', accent: '#c08a3e' },
  { a: '#b5afc4', b: '#aea8bd', accent: '#8a76b8' },
  { a: '#c2adaf', b: '#bba6a8', accent: '#b56c78' },
  { a: '#a8bdbf', b: '#a1b6b8', accent: '#4f9ea8' },
];

export const FLOOR: Record<FloorKind, { a: string; b: string; line: string }> = {
  stone: { a: '#dcd5c7', b: '#d5cebf', line: 'rgba(120,105,80,0.16)' },
  carpet: { a: '#aab3bf', b: '#a4adb9', line: 'rgba(40,50,70,0.06)' },
  wood: { a: '#caa77b', b: '#c29f73', line: 'rgba(90,60,30,0.20)' },
  vinyl: { a: '#d8d4cb', b: '#d2cec5', line: 'rgba(80,80,90,0.10)' },
  tiles: { a: '#e2ded6', b: '#dcd8cf', line: 'rgba(80,80,90,0.14)' },
  raised: { a: '#b7bcc3', b: '#b1b6bd', line: 'rgba(40,50,60,0.22)' },
  terrazzo: { a: '#e4ddd1', b: '#ded7cb', line: 'rgba(80,70,60,0.12)' },
  dark: { a: '#484d56', b: '#444951', line: 'rgba(0,0,0,0.12)' },
};

export const C = {
  ground: '#6f7f63', groundDark: '#647459', paving: '#c3bdb1', pavingLine: 'rgba(90,80,70,0.18)', curb: '#a9a398',
  wallCap: '#4a4f58', wallCapHi: '#5b616b', extCap: '#383c43', extCapHi: '#474c55',
  wallFace: '#ebe6dd', wallFaceShade: '#ddd6ca', baseboard: '#bfb6a7', extFace: '#d9d3c7',
  glass: 'rgba(196,222,232,0.42)', glassHi: 'rgba(255,255,255,0.55)', frame: '#6e757f',
  deskTop: '#ece7df', deskTopB: '#e2dcd2', deskFront: '#b9ad9c', deskLeg: '#5d636d', oak: '#c9a676', oakDark: '#a8865a',
  metal: '#6a717c', metalDark: '#2c3038', bezel: '#1d2027', screenOff: '#14171c',
  fabric: '#5f7486', fabricDark: '#4b5e6f', leather: '#7a5a44', leatherDark: '#5f4534',
  chair: '#3c414b', chairHi: '#535a66',
  leaf: '#5a9468', leafDark: '#3f7650', leafHi: '#7db487', pot: '#c8bfb2', potDark: '#a89f92',
};
