import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, formatDuration, formatUptime, formatTokens, formatCost, relativeTime, formatSeconds, formatCountdown, formatDateTime, truncate } from './format.ts';

const norm = (s: string) => s.replace(/[  ]/g, ' ');

test('formatBytes', () => {
  assert.equal(formatBytes(null), '—');
  assert.equal(formatBytes(512), '512 o');
  assert.equal(norm(formatBytes(1536)), '1,50 Kio');
  assert.equal(norm(formatBytes(4 * 1024 ** 3)), '4,00 Gio');
  assert.equal(norm(formatBytes(150 * 1024 ** 2)), '150 Mio');
});

test('formatDuration', () => {
  assert.equal(formatDuration(null), '—');
  assert.equal(formatDuration(420), '420 ms');
  assert.equal(norm(formatDuration(1234)), '1,2 s');
  assert.equal(formatDuration(42_000), '42 s');
  assert.equal(formatDuration(185_000), '3 min 05 s');
  assert.equal(formatDuration(3_720_000), '1 h 02 min');
});

test('formatUptime', () => {
  assert.equal(formatUptime(30), '30 s');
  assert.equal(formatUptime(720), '12 min');
  assert.equal(formatUptime(5 * 3600 + 12 * 60), '5 h 12 min');
  assert.equal(formatUptime(3 * 86400 + 4 * 3600), '3 j 04 h');
});

test('formatSeconds', () => {
  assert.equal(formatSeconds(900), '15 min');
  assert.equal(formatSeconds(90), '1 min 30 s');
  assert.equal(formatSeconds(3600), '1 h');
  assert.equal(formatSeconds(0), '—');
});

test('formatTokens et formatCost', () => {
  assert.equal(formatTokens(999), '999');
  assert.equal(norm(formatTokens(1500)), '1,5 k');
  assert.equal(norm(formatTokens(2_500_000)), '2,5 M');
  assert.equal(norm(formatCost(0.01234)), '≈ 0,0123 $');
  assert.equal(norm(formatCost(2.5)), '≈ 2,50 $');
  assert.equal(formatCost(null), '—');
});

test('relativeTime', () => {
  const now = Date.parse('2026-11-24T10:00:00Z');
  assert.equal(relativeTime('2026-11-24T10:00:00Z', now), "à l'instant");
  assert.equal(relativeTime('2026-11-24T09:59:30Z', now), 'il y a 30 s');
  assert.equal(relativeTime('2026-11-24T09:50:00Z', now), 'il y a 10 min');
  assert.equal(relativeTime('2026-11-24T07:00:00Z', now), 'il y a 3 h');
  assert.equal(relativeTime('2026-11-24T12:00:00Z', now), 'dans 2 h');
  assert.equal(relativeTime(null, now), '—');
});

test('formatCountdown', () => {
  const now = Date.parse('2026-11-24T10:00:00Z');
  assert.equal(formatCountdown('2026-11-24T10:00:45Z', now), '45 s');
  assert.equal(formatCountdown('2026-11-24T10:20:00Z', now), '20 min');
  assert.equal(formatCountdown('2026-11-24T12:05:00Z', now), '2 h 05');
  assert.equal(formatCountdown('2026-11-24T09:00:00Z', now), 'maintenant');
});

test('formatDateTime dans un fuseau', () => {
  assert.equal(formatDateTime('2026-11-24T09:41:00Z', 'Europe/Paris'), '24/11/2026 10:41');
  assert.equal(formatDateTime('2026-07-01T09:41:00Z', 'Europe/Paris'), '01/07/2026 11:41');
  assert.equal(formatDateTime('nope'), '—');
});

test('truncate', () => {
  assert.equal(truncate('abcdef', 4), 'abc…');
  assert.equal(truncate('abc', 4), 'abc');
});
