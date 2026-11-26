import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHATS, GREETINGS, SOLO, activityWeights, clampPersonality, lineCount, pickDialogue, pickWeighted } from './social.ts';
import type { SocialClock } from './social.ts';

const clock = (o: Partial<SocialClock> = {}): SocialClock => ({ hour: 10, weekday: 2, month: 5, daylight: 1, ...o });

test('banques de répliques : au moins 80 répliques, dialogues de 2 à 4 répliques alternées', () => {
  assert.ok(lineCount() >= 80, `répliques : ${lineCount()}`);
  for (const d of [...GREETINGS, ...CHATS]) {
    assert.ok(d.lines.length >= 2 && d.lines.length <= 4, d.id);
    d.lines.forEach((l, i) => assert.equal(l.s, i % 2, `${d.id} alterne les interlocuteurs`));
  }
  const ids = [...GREETINGS, ...CHATS].map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, 'identifiants uniques');
  for (const k of Object.keys(SOLO) as (keyof typeof SOLO)[]) assert.ok(SOLO[k].length >= 2);
});

test('honnêteté : aucune réplique ne parle de travail réel (mission, exécution, résultat, progression)', () => {
  const all = [...GREETINGS, ...CHATS].flatMap((d) => d.lines.map((l) => l.text)).concat(...Object.values(SOLO));
  for (const t of all) assert.ok(!/mission|exécution|rapport|résultat|progress|tâche|termin[ée]|livr|déploi|bug|ticket|réunion/i.test(t), t);
});

test('répliques adaptées à l\'heure et au jour : pas de « Bonjour » la nuit, « Bon début de semaine » le lundi seulement', () => {
  const r = { s: 1 };
  for (let i = 0; i < 300; i++) {
    const night = pickDialogue(GREETINGS, clock({ hour: 2 }), r, []);
    assert.notEqual(night.id, 'g-bonjour');
    assert.notEqual(night.id, 'g-lundi');
    const tue = pickDialogue(GREETINGS, clock({ weekday: 2 }), r, []);
    assert.notEqual(tue.id, 'g-lundi');
  }
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) seen.add(pickDialogue(GREETINGS, clock({ weekday: 1, hour: 9 }), r, []).id);
  assert.ok(seen.has('g-lundi'));
});

test('variété : on évite les dialogues récents ; sur la durée, beaucoup de dialogues différents', () => {
  const r = { s: 42 }, recent: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const d = pickDialogue(CHATS, clock(), r, recent);
    assert.ok(!recent.includes(d.id), 'pas de répétition immédiate');
    seen.add(d.id); recent.push(d.id); if (recent.length > 12) recent.shift();
  }
  assert.ok(seen.size >= 25, `dialogues distincts : ${seen.size}`);
});

test('personnalité : la concentration retient au bureau, le café attire à la machine, la sociabilité fait discuter', () => {
  const count = (p: Parameters<typeof activityWeights>[0]) => { const r = { s: 7 }, n: Record<string, number> = {}; for (let i = 0; i < 4000; i++) { const a = pickWeighted(activityWeights(p, clock(), null, false), r); n[a] = (n[a] ?? 0) + 1; } return n; };
  const focus = count({ sociability: 0.1, curiosity: 0.1, energy: 0.1, focus: 1, coffee: 0.1 });
  const caf = count({ sociability: 0.1, curiosity: 0.1, energy: 0.1, focus: 0.1, coffee: 1 });
  const soc = count({ sociability: 1, curiosity: 0.1, energy: 0.1, focus: 0.1, coffee: 0.1 });
  assert.ok(focus.desk > 1500, `bureau : ${focus.desk}`); // plus de liberté depuis l’ajout des sorties sur le parvis
  assert.ok(caf.coffee > focus.coffee * 2);
  assert.ok(soc.visit > focus.visit * 3);
  assert.deepEqual(clampPersonality({ sociability: 3, focus: -1 } as never), { sociability: 1, curiosity: 0.5, energy: 0.5, focus: 0, coffee: 0.5 });
});
