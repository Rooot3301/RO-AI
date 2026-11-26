import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discordToForm, diffDiscord, buildDiscordUpdate, isDirty, validateDiscord, statusPollDelay, type DiscordForm } from './discordForm.ts';
import type { DiscordSettings } from '../api/types';

const server: DiscordSettings = {
  enabled: false, owner_id: '', application_id: '', delivery: 'dm', channel_id: '', dashboard_url: '',
  notify: { approvals: true, failures: true, emergency: true, auth: true, limits: true, system_errors: true, completions: false, startup: false },
  commands: { read: true, control: true, approve: true, run: false, chat: true }, token_set: false,
  status: { state: 'incomplete', bot_user: null, last_sent_at: null, last_error: null }, invite_url: null,
};
const base = discordToForm(server);
const ID = '123456789012345678';

test('discordToForm : jeton toujours vide, copie profonde', () => {
  assert.equal(base.token, '');
  const f = discordToForm(server); f.notify.failures = false;
  assert.equal(server.notify.failures, true);
});

test('diffDiscord : rien de modifié, puis champs modifiés seulement', () => {
  assert.deepEqual(diffDiscord(base, discordToForm(server)), {});
  const cur: DiscordForm = { ...base, enabled: true, owner_id: ` ${ID} `, notify: { ...base.notify, completions: true } };
  assert.deepEqual(diffDiscord(base, cur), { enabled: true, owner_id: ID, notify: { ...base.notify, completions: true } });
  // espaces seuls : pas de modification
  assert.deepEqual(diffDiscord(base, { ...base, dashboard_url: '   ' }), {});
});

test('buildDiscordUpdate : token absent s\'il est vide, présent sinon', () => {
  assert.equal('token' in buildDiscordUpdate(base, base), false);
  assert.equal('token' in buildDiscordUpdate(base, { ...base, token: '   ' }), false);
  assert.equal(buildDiscordUpdate(base, { ...base, token: ' abc.def ' }).token, 'abc.def');
  const clear = buildDiscordUpdate(base, { ...base, token: 'zzz' }, true);
  assert.equal(clear.clear_token, true); assert.equal('token' in clear, false);
  assert.deepEqual(buildDiscordUpdate(base, { ...base, delivery: 'channel', channel_id: ID }), { delivery: 'channel', channel_id: ID });
});

test('isDirty', () => {
  assert.equal(isDirty(base, base), false);
  assert.equal(isDirty(base, { ...base, token: 'x' }), true);
  assert.equal(isDirty(base, { ...base, commands: { ...base.commands, run: true } }), true);
});

test('validateDiscord : identifiants de 15 à 22 chiffres', () => {
  assert.deepEqual(validateDiscord(base, false), {});
  assert.ok(validateDiscord({ ...base, owner_id: '12345' }, false).owner_id);
  assert.ok(validateDiscord({ ...base, owner_id: '1'.repeat(23) }, false).owner_id);
  assert.ok(validateDiscord({ ...base, owner_id: '12345678901234a' }, false).owner_id);
  assert.equal(validateDiscord({ ...base, owner_id: '1'.repeat(15), application_id: '9'.repeat(22) }, false).owner_id, undefined);
  assert.ok(validateDiscord({ ...base, application_id: 'abc' }, false).application_id);
});

test('validateDiscord : activation, salon, adresse, jeton', () => {
  const on = validateDiscord({ ...base, enabled: true }, false);
  assert.ok(on.owner_id && on.application_id && on.token);
  assert.equal(validateDiscord({ ...base, enabled: true, owner_id: ID, application_id: ID }, true).token, undefined);
  assert.ok(validateDiscord({ ...base, delivery: 'channel' }, false).channel_id);
  assert.equal(validateDiscord({ ...base, delivery: 'channel', channel_id: ID }, false).channel_id, undefined);
  assert.ok(validateDiscord({ ...base, dashboard_url: 'ftp://x' }, false).dashboard_url);
  assert.ok(validateDiscord({ ...base, dashboard_url: 'pas une url' }, false).dashboard_url);
  assert.equal(validateDiscord({ ...base, dashboard_url: 'https://roai.exemple.fr' }, false).dashboard_url, undefined);
  assert.ok(validateDiscord({ ...base, token: 'court' }, false).token);
  assert.ok(validateDiscord({ ...base, token: 'a'.repeat(30) + ' b' }, false).token);
  assert.equal(validateDiscord({ ...base, token: 'a'.repeat(40) }, false).token, undefined);
});

test('statusPollDelay', () => {
  assert.equal(statusPollDelay('connecting'), 3000);
  assert.ok(statusPollDelay('connected') > statusPollDelay('error'));
});
