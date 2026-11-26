import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentProfileInput } from '../../../api/types';
import {
  ALL_ITEMS, THEMES, THEME_ITEMS, ITEM_LABEL, THEME_LABEL, addListItems, cleanList, formToInput, generationErrorMessage, generationTokens, isValidDate,
  mergeParts, normalizeAppearance, normalizeDecor, profileToForm, sameForm, suggestedItems, toggleItem, validateProfileForm,
} from './profileForm.ts';

const base = (): AgentProfileInput => ({
  display_name: 'Ada Veille', employee_id: 'RO-0042', title: 'Analyste de veille', hired_at: '2026-03-14', office: 'B-204', bio: 'Suit la presse tech.',
  traits: ['Méthodique'], interests: ['Astronomie'], habits: ['Café à 10 h'], skills: ['Synthèse'],
  personality: { sociability: 0.4, curiosity: 0.9, energy: 0.5, focus: 0.7, coffee: 0.3 },
  appearance: { skin: 2, hair: 3, hair_style: 1, outfit: 5, accessory: 'glasses' },
  decor: { theme: 'research', items: ['book_stack', 'magnifier'], color: 2 },
});

test('profileToForm / formToInput : aller-retour sans perte', () => {
  const p = base();
  assert.deepEqual(formToInput(profileToForm(p)), p);
});

test('formToInput : nettoie espaces, doublons, vides et bornes', () => {
  const f = profileToForm(base());
  f.display_name = '  Ada   Veille \n'; f.traits = ['  Calme ', 'Calme', '', 'Drôle']; f.bio = '  texte\nsur deux lignes  ';
  f.personality.coffee = 1.7; f.personality.focus = 0.333333;
  const i = formToInput(f);
  assert.equal(i.display_name, 'Ada Veille');
  assert.deepEqual(i.traits, ['Calme', 'Drôle']);
  assert.equal(i.bio, 'texte\nsur deux lignes');
  assert.equal(i.personality.coffee, 1); assert.equal(i.personality.focus, 0.33);
});

test('normalisation de l’apparence et du décor (valeurs inconnues ou hors bornes)', () => {
  assert.deepEqual(normalizeAppearance({ skin: 9, hair: -2, hair_style: 2.7, outfit: Number.NaN, accessory: 'crown' as never }), { skin: 5, hair: 0, hair_style: 2, outfit: 0, accessory: 'none' });
  const d = normalizeDecor({ theme: 'castle' as never, items: ['mug', 'mug', 'nope' as never, 'plant_small', 'typewriter', 'calculator', 'star_map', 'documents', 'magnifier'], color: 12 });
  assert.equal(d.theme, 'general'); assert.equal(d.color, 7);
  assert.deepEqual(d.items, ['mug', 'plant_small', 'typewriter', 'calculator', 'star_map', 'documents']);
});

test('validation : longueurs maximales et nom obligatoire', () => {
  const f = profileToForm(base());
  assert.deepEqual(validateProfileForm(f), {});
  f.display_name = '   ';
  assert.match(validateProfileForm(f).display_name ?? '', /obligatoire/);
  f.display_name = 'x'.repeat(61); f.title = 't'.repeat(81); f.bio = 'b'.repeat(601); f.office = 'o'.repeat(13); f.employee_id = 'e'.repeat(21);
  const e = validateProfileForm(f);
  assert.ok(e.display_name && e.title && e.bio && e.office && e.employee_id);
  f.display_name = 'x'.repeat(60); f.title = 't'.repeat(80); f.bio = 'b'.repeat(600); f.office = 'o'.repeat(12); f.employee_id = 'e'.repeat(20);
  assert.deepEqual(validateProfileForm(f), {});
});

test('validation : listes (≤6 de ≤60 car., compétences ≤8 de ≤40)', () => {
  const f = profileToForm(base());
  f.traits = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  f.habits = ['h'.repeat(61)];
  f.skills = Array.from({ length: 8 }, (_, i) => `s${i}`);
  let e = validateProfileForm(f);
  assert.ok(e.traits); assert.ok(e.habits); assert.equal(e.skills, undefined);
  f.traits = ['a']; f.habits = ['h'.repeat(60)]; f.skills = [...f.skills, 's9'];
  e = validateProfileForm(f);
  assert.equal(e.traits, undefined); assert.equal(e.habits, undefined); assert.ok(e.skills);
  f.skills = ['k'.repeat(41)];
  assert.ok(validateProfileForm(f).skills);
});

test('validation : date de recrutement AAAA-MM-JJ réelle ou vide', () => {
  assert.ok(isValidDate('2026-02-28')); assert.ok(isValidDate('2024-02-29'));
  assert.ok(!isValidDate('2026-02-30')); assert.ok(!isValidDate('2026-2-3')); assert.ok(!isValidDate('14/03/2026'));
  const f = profileToForm(base());
  f.hired_at = ''; assert.equal(validateProfileForm(f).hired_at, undefined);
  f.hired_at = '2026-13-01'; assert.match(validateProfileForm(f).hired_at ?? '', /AAAA-MM-JJ/);
});

test('validation limitée aux parties éditées', () => {
  const f = profileToForm(base());
  f.display_name = '';
  assert.deepEqual(validateProfileForm(f, ['appearance', 'decor']), {});
  assert.ok(validateProfileForm(f, ['identity']).display_name);
});

test('mergeParts : un éditeur n’écrase pas les parties des autres', () => {
  const current = base();
  const edited = { ...base(), display_name: 'Autre', appearance: { skin: 0, hair: 0, hair_style: 0, outfit: 0, accessory: 'cap' as const } };
  const m = mergeParts(current, edited, ['appearance']);
  assert.equal(m.display_name, 'Ada Veille');
  assert.equal(m.appearance.accessory, 'cap');
  const m2 = mergeParts(current, edited, ['identity', 'story']);
  assert.equal(m2.display_name, 'Autre'); assert.equal(m2.appearance.accessory, 'glasses');
});

test('décor : ajout/retrait d’objets limité à 6 et suggestions du thème', () => {
  let items = toggleItem([], 'mug');
  assert.deepEqual(items, ['mug']);
  items = toggleItem(items, 'mug');
  assert.deepEqual(items, []);
  const six = ['mug', 'plant_small', 'typewriter', 'calculator', 'star_map', 'documents'] as const;
  assert.deepEqual(toggleItem([...six], 'magnifier'), [...six]);
  assert.deepEqual(suggestedItems('research', ['book_stack']), ['documents', 'magnifier', 'notes_board']);
  // Libellés français pour tous les thèmes et objets, et objets suggérés connus.
  for (const t of THEMES) { assert.ok(THEME_LABEL[t]); for (const i of THEME_ITEMS[t]) assert.ok(ALL_ITEMS.includes(i)); }
  assert.equal(ALL_ITEMS.length, 29);
  for (const i of ALL_ITEMS) assert.ok(ITEM_LABEL[i]);
});

test('addListItems : virgules, doublons, limites', () => {
  let r = addListItems(['Calme'], 'Drôle, calme,Calme ,  ', 'traits');
  assert.deepEqual(r.list, ['Calme', 'Drôle', 'calme']); assert.equal(r.rejected, null);
  r = addListItems(['a', 'b', 'c', 'd', 'e'], 'f, g', 'traits');
  assert.deepEqual(r.list, ['a', 'b', 'c', 'd', 'e', 'f']); assert.match(r.rejected ?? '', /6 éléments/);
  r = addListItems([], 'k'.repeat(41), 'skills');
  assert.deepEqual(r.list, []); assert.match(r.rejected ?? '', /40 caractères/);
  assert.deepEqual(cleanList([' x ', 'x', '']), ['x']);
});

test('sameForm ignore les différences purement cosmétiques', () => {
  const a = profileToForm(base()); const b = profileToForm(base());
  b.display_name = ' Ada Veille ';
  assert.ok(sameForm(a, b));
  b.title = 'Autre';
  assert.ok(!sameForm(a, b));
});

test('messages d’erreur de génération (409/503) en clair', () => {
  assert.match(generationErrorMessage(409, 'génération déjà en cours'), /déjà en cours/);
  assert.match(generationErrorMessage(409, "arrêt d'urgence actif : reprise requise avant toute génération"), /Arrêt d’urgence/);
  assert.match(generationErrorMessage(409, 'fiche déjà générée : la régénération doit être demandée explicitement'), /Régénérer/);
  assert.match(generationErrorMessage(503, "Claude n'est pas disponible"), /^Fournisseur indisponible : Claude/);
  assert.equal(generationErrorMessage(500, ''), 'Génération impossible.');
});

test('jetons d’une génération', () => {
  assert.deepEqual(generationTokens(null), { input: null, output: null, total: null });
  assert.deepEqual(generationTokens({ provider: 'claude', model: 'haiku', input_tokens: 1200, output_tokens: 340 }), { input: 1200, output: 340, total: 1540 });
  assert.deepEqual(generationTokens({ provider: 'codex', model: null, input_tokens: null, output_tokens: 50 }), { input: null, output: 50, total: 50 });
});
