import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyScheduleForm, validateSchedule, scheduleToInput } from './scheduleForm.ts';

test('validateSchedule', () => {
  const ok = { ...emptyScheduleForm('ag_1'), name: 'Matin', timezone: 'Europe/Paris' };
  assert.deepEqual(validateSchedule(ok), {});
  assert.ok(validateSchedule({ ...ok, agent_id: '' }).agent_id);
  assert.ok(validateSchedule({ ...ok, name: ' ' }).name);
  assert.ok(validateSchedule({ ...ok, cron: '* * *' }).cron);
  assert.ok(validateSchedule({ ...ok, cron: '99 * * * *' }).cron);
  assert.ok(validateSchedule({ ...ok, timezone: 'Mars/Olympus' }).timezone);
});

test('scheduleToInput normalise les espaces du cron', () => {
  const i = scheduleToInput({ ...emptyScheduleForm('ag_1'), name: ' X ', cron: '  0   9 * *  1-5 ' });
  assert.equal(i.cron, '0 9 * * 1-5');
  assert.equal(i.name, 'X');
});
