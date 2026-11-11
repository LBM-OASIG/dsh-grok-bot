import assert from 'node:assert/strict';
import test from 'node:test';

import { RoutineScheduler } from '../host/scheduler.js';

function makeScheduler() {
  const runs = [];
  const logs = [];
  const store = {
    config: { maxRunsPerDay: 20, maxRunsPerHour: 4 },
    appendBotRun: (botId, run) => runs.push({ botId, ...run }),
    appendDailyLog: (botId, text, day) => logs.push({ botId, text, day }),
  };
  const scheduler = new RoutineScheduler({
    ctx: {},
    hub: { list: () => [] },
    engine: {},
    binder: {},
    runtime: { errors: new Map(), active: new Map() },
    log: () => undefined,
    emit: () => undefined,
  });
  return { scheduler, store, runs, logs };
}

test('one routine run writes both a run row and a daily log line', () => {
  const { scheduler, store, runs, logs } = makeScheduler();
  scheduler.record(store, { id: 'sunny' }, { id: 'r1' }, 'ok', '汇报了一句', { manual: false });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].outcome, 'ok');
  assert.equal(logs.length, 1);
  assert.match(logs[0].text, /例行 r1 → ok/);
  assert.match(logs[0].text, /汇报了一句/);
  assert.match(logs[0].day, /^\d{4}-\d{2}-\d{2}$/);
});

test('silent outcomes are logged as silent', () => {
  const { scheduler, store, logs } = makeScheduler();
  scheduler.record(store, { id: 'scout' }, { id: 'r2' }, 'silent', '已静默结束本轮。', { manual: false });
  assert.match(logs[0].text, /→ silent/);
});

test('a skipped run does not advance into a fired state twice', () => {
  const { scheduler, store } = makeScheduler();
  let saved = null;
  store.updateBot = (botId, patch) => {
    saved = patch;
  };
  const routine = { id: 'r3', when: { kind: 'after', minutes: 5 }, enabled: true, nextAt: new Date().toISOString() };
  scheduler.advance(store, { id: 'b', routines: [routine] }, routine);
  assert.equal(saved.routines[0].enabled, false);
  assert.equal(saved.routines[0].nextAt, null);
});

test('the daily budget blocks a run before any delivery happens', async () => {
  const { scheduler, store, runs } = makeScheduler();
  let delivered = 0;
  scheduler.engine = {
    deliver: async () => {
      delivered += 1;
      return { ok: true, text: 'x', tools: 0, reclaimed: false };
    },
  };
  const now = new Date().toISOString();
  store.readBotRuns = () => Array.from({ length: 3 }, () => ({ at: now, outcome: 'ok' }));
  store.updateBot = () => undefined;
  const routine = { id: 'r', when: { kind: 'every', minutes: 60 }, enabled: true, failures: 0, instruction: '巡检' };
  const bot = { id: 'b', sessionId: 's', autonomy: { maxRunsPerDay: 2 }, mode: 'companion', routines: [routine] };
  const result = await scheduler.run(bot, store, routine, { manual: false });
  assert.equal(result.outcome, 'budget');
  assert.equal(delivered, 0, 'no model turn is started when the budget is exhausted');
  assert.equal(runs.at(-1).outcome, 'budget');
});

test('a busy Session skips the wake and advances the schedule', async () => {
  const { scheduler, store, runs } = makeScheduler();
  let delivered = 0;
  scheduler.engine = {
    deliver: async () => {
      delivered += 1;
      return { ok: true, text: '', tools: 0, reclaimed: false };
    },
  };
  scheduler.runtime = { active: new Map([['s', { reason: 'routine' }]]), errors: new Map() };
  let saved = null;
  store.updateBot = (botId, patch) => {
    saved = patch;
  };
  const routine = { id: 'r', when: { kind: 'every', minutes: 90 }, enabled: true, failures: 0, nextAt: new Date().toISOString() };
  const bot = { id: 'b', sessionId: 's', autonomy: { maxRunsPerDay: 10 }, mode: 'companion', routines: [routine] };
  const result = await scheduler.run(bot, store, routine, { manual: true });
  assert.equal(result.outcome, 'skipped');
  assert.equal(delivered, 0);
  assert.equal(runs.at(-1).outcome, 'skipped');
});

test('quiet hours defer the next fire instead of waking the Bot', async () => {
  const { scheduler, store } = makeScheduler();
  let delivered = 0;
  scheduler.engine = {
    deliver: async () => {
      delivered += 1;
      return { ok: true, text: '', tools: 0, reclaimed: false };
    },
  };
  const routine = { id: 'r', when: { kind: 'daily', time: '09:00' }, enabled: true, failures: 0, nextAt: new Date().toISOString() };
  const bot = { id: 'b', sessionId: 's', autonomy: { maxRunsPerDay: 10, quietHours: ['00:00', '23:59'] }, mode: 'companion', routines: [routine] };
  let saved = null;
  store.updateBot = (botId, patch) => {
    saved = patch;
  };
  scheduler.hub = { byPath: () => store };
  store.getBot = () => bot;
  await scheduler.fire({ botId: 'b', workspacePath: 'C:/ws', routineId: 'r' });
  assert.equal(delivered, 0);
  assert.ok(saved.routines[0].nextAt, 'the routine moves past the quiet window');
});
