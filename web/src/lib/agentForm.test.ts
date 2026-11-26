import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyForm, validateForm, formToInput, agentToForm, agentToInput, parseEnv, slugify, emptyMcpRow } from './agentForm.ts';
import type { Agent } from '../api/types';

const valid = () => ({ ...emptyForm(), name: 'Veille', mission: 'Surveiller', department: 'R&D' });

test('validateForm : champs obligatoires', () => {
  const e = validateForm(emptyForm());
  assert.ok(e.name && e.mission && e.department);
  assert.deepEqual(validateForm(valid()), {});
});

test('validateForm : slug, durée, MCP', () => {
  assert.ok(validateForm({ ...valid(), slug: 'Pas Valide' }).slug);
  assert.equal(validateForm({ ...valid(), slug: 'ok-1' }).slug, undefined);
  assert.ok(validateForm({ ...valid(), max_runtime_s: '5' }).max_runtime_s);
  assert.ok(validateForm({ ...valid(), max_runtime_s: '12.5' }).max_runtime_s);
  assert.ok(validateForm({ ...valid(), max_runtime_s: '999999' }).max_runtime_s);
  assert.equal(validateForm({ ...valid(), max_runtime_s: '600' }).max_runtime_s, undefined);
  const m1 = { ...emptyMcpRow(), name: 'a', command: 'npx', env: 'KEY=1\nbad' };
  const m2 = { ...emptyMcpRow(), name: 'a', command: '' };
  const e = validateForm({ ...valid(), mcp: [m1, m2] });
  assert.ok(e['mcp.0.env']);
  assert.ok(e['mcp.1.name']); // doublon
  assert.ok(e['mcp.1.command']);
});

test('formToInput : claude', () => {
  const i = formToInput({ ...valid(), model: ' opus ', allowed_tools: ['Read', ' Grep '], sprite: 3, max_runtime_s: '600', require_approval: true,
    mcp: [{ ...emptyMcpRow(), name: 'fs', command: 'npx', args: '-y\n@x/server\n', env: 'A=1\nB=x=y' }] });
  assert.equal(i.model, 'opus');
  assert.deepEqual(i.avatar, { sprite: 3 });
  assert.deepEqual(i.config?.allowed_tools, ['Read', 'Grep']);
  assert.equal(i.config?.permission_mode, 'dontAsk');
  assert.equal(i.config?.sandbox, undefined);
  assert.equal(i.config?.max_runtime_s, 600);
  assert.deepEqual(i.config?.mcp_servers, [{ name: 'fs', command: 'npx', args: ['-y', '@x/server'], env: { A: '1', B: 'x=y' } }]);
  assert.equal('slug' in i, false);
});

test('formToInput : codex omet les champs claude, modèle vide -> null', () => {
  const i = formToInput({ ...valid(), provider: 'codex', sandbox: 'workspace-write', allowed_tools: ['Read'] });
  assert.equal(i.model, null);
  assert.equal(i.config?.sandbox, 'workspace-write');
  assert.equal(i.config?.allowed_tools, undefined);
  assert.equal(i.config?.permission_mode, undefined);
  assert.equal(i.config?.max_runtime_s, undefined);
});

test('agentToForm / agentToInput : aller-retour', () => {
  const agent: Agent = {
    id: 'ag_1', slug: 'veille', created_at: '', updated_at: '', state: 'idle', last_run: null, name: 'Veille', provider: 'claude', model: null,
    mission: 'M', default_prompt: 'P', description: 'D', department: 'R&D', domain: 'perso', avatar: { sprite: 2 }, enabled: true,
    config: { allowed_tools: ['Read'], permission_mode: 'plan', max_runtime_s: 300, require_approval: true, mcp_servers: [{ name: 'x', command: 'c', args: ['a'], env: { K: 'v' } }] },
  };
  const f = agentToForm(agent);
  assert.equal(f.permission_mode, 'plan');
  assert.equal(f.mcp[0].env, 'K=v');
  const input = agentToInput(agent, { enabled: false });
  assert.equal(input.enabled, false);
  assert.equal(input.slug, 'veille');
  assert.deepEqual(input.config?.mcp_servers, [{ name: 'x', command: 'c', args: ['a'], env: { K: 'v' } }]);
  assert.equal(input.domain, 'perso');
});

test('parseEnv et slugify', () => {
  assert.deepEqual(parseEnv('A=1\n\nB=\n').env, { A: '1', B: '' });
  assert.equal(parseEnv('=x').errors.length, 1);
  assert.equal(parseEnv('1A=x').errors.length, 1);
  assert.equal(slugify('Veille Technologique — Été'), 'veille-technologique-ete');
});

import { normalizeDomain, domainError, addDomains, confirmsUnrestricted, hasWebhookInText, isDiscordWebhookUrl, MAX_DOMAINS } from './agentForm.ts';

test('domaines : normalisation et validation', () => {
  assert.equal(normalizeDomain('  HTTPS://Exemple.FR/chemin/x '), 'exemple.fr');
  for (const ok of ['discord.com', '*.github.com', 'api.example.com:8443', 'a-b.c-d.fr']) assert.equal(domainError(ok), null, ok);
  for (const bad of ['', 'localhost', 'exemple', '*.com.', 'a..b.fr', '.exemple.fr', 'exemple.fr:', 'exemple.fr:99999', '*exemple.fr', 'ex emple.fr', 'exemple.fr:0']) assert.ok(domainError(bad), bad);
});

test('addDomains : ajout multiple, doublons, refus, plafond', () => {
  const r = addDomains(['discord.com'], 'Discord.com, *.github.com  nope api.exemple.fr:8443');
  assert.deepEqual(r.list, ['discord.com', '*.github.com', 'api.exemple.fr:8443']);
  assert.deepEqual(r.rejected.map((x) => x.value), ['nope']);
  const full = addDomains(Array.from({ length: MAX_DOMAINS }, (_, i) => `d${i}.fr`), 'un.fr');
  assert.equal(full.list.length, MAX_DOMAINS); assert.equal(full.full, true);
});

test('formulaire : network_domains et unrestricted', () => {
  const base = { ...emptyForm(), name: 'A', mission: 'M', department: 'D' };
  assert.equal('network_domains' in (formToInput(base).config ?? {}), false);
  assert.equal('unrestricted' in (formToInput(base).config ?? {}), false);
  const c = formToInput({ ...base, network_domains: ['Discord.com', 'discord.com', '*.github.com'] }).config!;
  assert.deepEqual(c.network_domains, ['discord.com', '*.github.com']);
  const u = formToInput({ ...base, unrestricted: true, require_approval: false }).config!;
  assert.equal(u.unrestricted, true); assert.equal(u.require_approval, true);
  assert.ok(validateForm({ ...base, network_domains: ['pas valide'] }).network_domains);
  assert.ok(validateForm({ ...base, network_domains: Array.from({ length: MAX_DOMAINS + 1 }, (_, i) => `d${i}.fr`) }).network_domains);
  const agent = { id: 'a', slug: 'a', created_at: '', updated_at: '', state: 'idle', last_run: null, name: 'A', provider: 'claude', model: null, mission: 'M', default_prompt: '', description: '', department: 'D', domain: 'perso', avatar: { sprite: 0 }, enabled: true, config: { network_domains: ['x.fr'], unrestricted: true, require_approval: true } } as unknown as Agent;
  const f = agentToForm(agent);
  assert.deepEqual(f.network_domains, ['x.fr']); assert.equal(f.unrestricted, true);
  assert.equal(agentToInput(agent, { enabled: false }).config?.unrestricted, true);
});

test('confirmation du mode libre et détection de webhook', () => {
  assert.equal(confirmsUnrestricted('MODE LIBRE'), true); assert.equal(confirmsUnrestricted(' MODE LIBRE '), true);
  assert.equal(confirmsUnrestricted('mode libre'), false); assert.equal(confirmsUnrestricted('MODE'), false);
  assert.equal(hasWebhookInText('rien', 'POST https://discord.com/api/webhooks/123/abc'), true);
  assert.equal(hasWebhookInText('https://discordapp.com/api/v10/webhooks/1/x'), true);
  assert.equal(hasWebhookInText('parle de discord.com et de webhooks'), false);
  assert.equal(isDiscordWebhookUrl('https://discord.com/api/webhooks/123456/abc_DEF-1'), true);
  assert.equal(isDiscordWebhookUrl('http://discord.com/api/webhooks/1/a'), false);
  assert.equal(isDiscordWebhookUrl('https://evil.example/api/webhooks/1/a'), false);
});

test('effort de raisonnement : envoyé pour Codex seulement, niveaux selon le modèle', async () => {
  const { codexModelInfo, effortChoices } = await import('./agentForm.ts');
  const f = { ...emptyForm(), name: 'x', mission: 'm', department: 'd', provider: 'codex' as const, reasoning_effort: 'medium' as const };
  assert.equal(formToInput(f).config?.reasoning_effort, 'medium');
  assert.equal(formToInput({ ...f, provider: 'claude' }).config?.reasoning_effort, undefined);
  assert.equal(formToInput({ ...f, reasoning_effort: '' }).config?.reasoning_effort, undefined);
  const models = [{ slug: 'gpt-a', name: 'A', description: 'rapide', default_effort: 'low' as const, efforts: ['low' as const, 'medium' as const] }];
  const def = codexModelInfo(models, '', 'gpt-a');
  assert.equal(def.model?.slug, 'gpt-a'); assert.equal(def.isDefault, true);
  assert.deepEqual(effortChoices(def.model), ['low', 'medium']);
  assert.equal(effortChoices(codexModelInfo(models, 'inconnu', null).model).length, 6);
});

test('mode autonome : retire l’approbation imposée, seulement avec le mode libre', () => {
  const f = { ...emptyForm(), name: 'x', mission: 'm', department: 'd', unrestricted: true, require_approval: false };
  assert.equal(formToInput(f).config?.require_approval, true);
  assert.equal(formToInput(f).config?.autonomous, undefined);
  const auto = formToInput({ ...f, autonomous: true }).config;
  assert.equal(auto?.autonomous, true); assert.equal(auto?.require_approval, false);
  assert.equal(formToInput({ ...f, unrestricted: false, autonomous: true }).config?.autonomous, undefined);
});

test('mode léger et fichier mémoire (Claude) : conservés à l’enregistrement, validés, absents pour Codex', () => {
  const base = { ...emptyForm(), name: 'Plume', provider: 'claude' as const, mission: 'Relecteur', department: 'Rédaction' };
  const lean = { ...base, lean: true, memory_file: 'style.md' };
  assert.deepEqual([formToInput(lean).config?.lean, formToInput(lean).config?.memory_file], [true, 'style.md']);
  assert.equal(formToInput({ ...base, lean: false, memory_file: 'style.md' }).config?.lean, undefined);
  assert.ok(validateForm({ ...lean, memory_file: '../secret' }).memory_file);
  assert.equal(formToInput({ ...lean, provider: 'codex' }).config?.lean, undefined);
});
