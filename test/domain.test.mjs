import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DomainError,
  MODE_IDS,
  computeNextAt,
  decideResponders,
  inQuietHours,
  nextCronTime,
  normalizeBot,
  normalizeRoutine,
  parseMentions,
  parseHandoffs,
  appendMemoryEntry,
  forgetMemoryLines,
  renderMemoryBlock,
  runCounters,
} from '../host/domain.js';

test('bot normalization fills mode defaults and keeps identity on update', () => {
  const created = normalizeBot(
    { name: 'Sunny', mode: 'companion', label: '日常助理', autonomy: { maxRunsPerDay: 6 } },
    undefined,
    () => 'sunny',
  );
  assert.equal(created.id, 'sunny');
  assert.equal(created.autonomy.dm, false);
  assert.equal(created.autonomy.routines, true);
  assert.equal(created.autonomy.maxRunsPerDay, 6);
  assert.deepEqual(Object.keys(created.avatar).sort(), ['color', 'shape']);

  const updated = normalizeBot({ ...created, mode: 'chief', name: 'Sunny 2' }, created);
  assert.equal(updated.id, 'sunny');
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.mode, 'chief');
  assert.equal(updated.autonomy.dm, false, 'an existing autonomy value survives an update');
});

test('invalid modes and empty names are rejected', () => {
  assert.throws(() => normalizeBot({ name: '', mode: 'companion' }, undefined, () => 'x'), DomainError);
  assert.throws(() => normalizeBot({ name: 'x', mode: 'nope' }, undefined, () => 'x'), DomainError);
  for (const mode of MODE_IDS) {
    assert.doesNotThrow(() => normalizeBot({ name: 'x', mode }, undefined, () => 'x'));
  }
});

test('routine schedules advance correctly for daily / every / after / cron', () => {
  const now = new Date(2026, 10, 10, 13, 30, 0).getTime();
  const daily = computeNextAt({ kind: 'daily', time: '09:00' }, now);
  assert.equal(new Date(daily).getDate(), 11);
  assert.equal(new Date(daily).getHours(), 9);

  assert.equal(computeNextAt({ kind: 'every', minutes: 5 }, now) - now, 5 * 60 * 1000);
  assert.equal(computeNextAt({ kind: 'after', minutes: 2 }, now) - now, 2 * 60 * 1000);

  const nextCron = nextCronTime('*/30 * * * *', now);
  assert.equal(new Date(nextCron).getMinutes(), 0);
  assert.ok(nextCron > now);
});

test('a routine is normalized and rejects empty instructions', () => {
  const routine = normalizeRoutine({ when: { kind: 'every', minutes: 90 }, instruction: '巡逻', report: 'silent' });
  assert.equal(routine.report, 'silent');
  assert.equal(routine.enabled, true);
  assert.deepEqual(routine.when, { kind: 'every', minutes: 90 });
  assert.throws(() => normalizeRoutine({ when: { kind: 'daily', time: '9:00' }, instruction: '' }), DomainError);
});

test('quiet hours wrap across midnight and move to the window end', () => {
  const at = (hour, minute) => new Date(2026, 10, 10, hour, minute, 0).getTime();
  assert.equal(inQuietHours(at(23, 30), ['23:00', '07:00']), true);
  assert.equal(inQuietHours(at(6, 59), ['23:00', '07:00']), true);
  assert.equal(inQuietHours(at(12, 0), ['23:00', '07:00']), false);
  assert.equal(inQuietHours(at(12, 0), null), false);
});

test('mentions and responder policy', () => {
  const members = [
    { id: 'sunny', name: 'Sunny' },
    { id: 'scout', name: '侦察兵' },
  ];
  assert.deepEqual(parseMentions('@侦察兵 看看这个', members).ids, ['scout']);
  assert.equal(parseMentions('@everyone 集合', members).everyone, true);
  assert.equal(parseMentions('@everyone 集合', members).text, '集合');

  const group = { members: ['sunny', 'scout'], leadBotId: 'sunny', responderPolicy: 'primary' };
  const bots = members.map((member) => ({ id: member.id, active: true }));
  assert.deepEqual(decideResponders({ everyone: false, ids: [] }, group, bots), ['sunny']);
  assert.deepEqual(decideResponders({ everyone: true, ids: [] }, group, bots), ['sunny', 'scout']);
  assert.deepEqual(decideResponders({ everyone: false, ids: ['scout'] }, group, bots), ['scout']);
});

test('hand-offs never include the author', () => {
  const members = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ];
  assert.deepEqual(parseHandoffs('@B 你来', members, 'a'), ['b']);
  assert.deepEqual(parseHandoffs('@A @B 一起', members, 'a'), ['b']);
});

test('memory entries append under one dated section', () => {
  let text = appendMemoryEntry('# mem\n', '喜欢短句', '2026-11-10');
  text = appendMemoryEntry(text, '周五不在', '2026-11-10');
  text = appendMemoryEntry(text, '换了显示器', '2026-11-11');
  const first = text.indexOf('## 2026-11-10');
  const second = text.indexOf('## 2026-11-11');
  assert.ok(first >= 0 && second > first);
  assert.ok(text.indexOf('喜欢短句') < second, 'the older entry stays in its own section');
  assert.ok(text.indexOf('周五不在') < second);
});

test('memory forget only removes matching entries', () => {
  const text = appendMemoryEntry('# mem\n', '周五不在', '2026-11-10');
  const result = forgetMemoryLines(text, '周五');
  assert.equal(result.removed.length, 1);
  assert.ok(!result.text.includes('周五'));
  assert.ok(result.text.includes('2026-11-10'));
});

test('memory injection keeps shared facts and truncates to the budget', () => {
  const memory = Array.from({ length: 200 }, (_, index) => `- fact ${index}`).join('\n');
  const block = renderMemoryBlock({ memory, shared: '主人叫大肥鱼', daily: [] }, 500);
  assert.ok(block.truncated);
  assert.ok(block.chars <= 500 + 40);
  assert.ok(block.text.includes('主人叫大肥鱼'), 'shared facts survive truncation');
});

test('run counters respect the daily and hourly window', () => {
  // Anchor at local noon so a run two hours earlier is still the same day
  // (the suite must pass at 00:30 as well as at 18:00).
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const runs = [
    { at: new Date(now.getTime()).toISOString(), outcome: 'ok' },
    { at: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(), outcome: 'error' },
    { at: new Date(now.getTime() - 60 * 1000).toISOString(), outcome: 'budget' },
    { at: new Date(now.getTime() - 60 * 1000).toISOString(), outcome: 'skipped' },
    { at: new Date(now.getTime() - 60 * 1000).toISOString(), outcome: 'ok', manual: true },
  ];
  const day = new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  const key = `${day.getFullYear()}-${p(day.getMonth() + 1)}-${p(day.getDate())}`;
  const counters = runCounters(runs, key, now.getTime());
  assert.equal(counters.today, 2, 'budget/skipped/manual entries do not consume the budget');
  assert.equal(counters.hour, 1, 'the hourly window only counts real scheduled runs');
});
