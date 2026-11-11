import assert from 'node:assert/strict';
import test from 'node:test';

import { BotAgentRegistry } from '../host/agents.js';
import { createMessaging } from '../host/messaging.js';

function makeRegistry(mode) {
  const state = { mode };
  const bot = {
    get mode() {
      return state.mode;
    },
    id: 'sunny',
    name: 'Sunny',
    personae: '',
    routines: [],
    autonomy: { dm: true, routines: true },
  };
  const hub = {
    findBySession: (sessionId) => (sessionId === 'session-1' ? { store: {}, bot } : undefined),
    findById: (id) => (id === 'sunny' ? { store: {}, bot } : undefined),
    list: () => [],
  };
  let guardFn;
  const tools = {
    register: () => () => undefined,
    guard: (fn) => {
      guardFn = fn;
      return () => undefined;
    },
  };
  const agent = {
    id: 'session-1',
    ctx: {
      systemPrompt: { section: () => () => undefined },
      tools,
    },
  };
  const registry = new BotAgentRegistry({
    ctx: { sessionController: {}, agents: { roots: () => [] } },
    hub,
    engine: {},
    runtime: { active: new Map() },
    log: () => undefined,
    emit: () => undefined,
    schedulerRef: { current: null },
    sendBotMessage: async () => ({ ok: true, text: 'sent' }),
  });
  registry.register(agent);
  return {
    state,
    guard: (name) => guardFn({ name }),
  };
}

test('scout and companion deny shell and write tools, operator and chief allow them', () => {
  const scout = makeRegistry('scout');
  assert.match(scout.guard('pwsh'), /不能使用 pwsh/);
  assert.match(scout.guard('write'), /不能使用 write/);
  assert.equal(scout.guard('read'), undefined);

  const companion = makeRegistry('companion');
  assert.match(companion.guard('edit'), /不能使用 edit/);

  const operator = makeRegistry('operator');
  assert.equal(operator.guard('pwsh'), undefined);
  assert.equal(operator.guard('write'), undefined);

  const chief = makeRegistry('chief');
  assert.equal(chief.guard('pwsh'), undefined);
});

test('the guard reads the live mode, so a mode switch applies immediately', () => {
  const registry = makeRegistry('scout');
  assert.match(registry.guard('pwsh'), /不能使用 pwsh/);
  registry.state.mode = 'operator';
  assert.equal(registry.guard('pwsh'), undefined);
  registry.state.mode = 'companion';
  assert.match(registry.guard('pwsh'), /不能使用 pwsh/);
});

test('messaging refuses self-sends and enforces the per-minute rate', async () => {
  const delivered = [];
  const runtime = { hops: new Map(), active: new Map(), errors: new Map() };
  const engine = {
    deliverBotMessage: async (sessionId, from, text) => {
      delivered.push({ sessionId, from, text, hop: runtime.hops.get(sessionId) });
      return { ok: true, text: 'pong' };
    },
  };
  const store = {
    path: 'C:/ws',
    bots: new Map([
      ['sunny', { id: 'sunny', name: 'Sunny', sessionId: 's-sunny' }],
      ['scout', { id: 'scout', name: '侦察兵', sessionId: 's-scout' }],
    ]),
    getBot: (id) => store.bots.get(id),
  };
  const messaging = createMessaging({
    ctx: { sessionController: { list: async () => ({ items: [] }) } },
    hub: {},
    engine,
    runtime,
    binder: {},
    log: () => undefined,
  });
  const sender = { store, bot: store.bots.get('sunny') };
  const self = await messaging.sendBotMessage(sender, 'Sunny', 'hi', 1);
  assert.equal(self.ok, false);
  assert.match(self.text, /自己/);

  const first = await messaging.sendBotMessage(sender, '侦察兵', 'hello', 1);
  assert.equal(first.ok, true);
  assert.equal(delivered[0].hop, 1, 'the hop marker rides the delivery');
  assert.equal(runtime.hops.has('s-scout'), false, 'the hop marker is cleared after delivery');

  for (let index = 0; index < 9; index += 1) {
    await messaging.sendBotMessage(sender, '侦察兵', `again ${index}`, 1);
  }
  const limited = await messaging.sendBotMessage(sender, '侦察兵', 'one too many', 1);
  assert.equal(limited.ok, false);
  assert.match(limited.text, /频繁/);
});

test('a forked Session missing from the visible list still resolves and receives the message', async () => {
  const delivered = [];
  const runtime = { hops: new Map(), active: new Map(), errors: new Map() };
  const engine = {
    deliverBotMessage: async (sessionId, from, text) => {
      delivered.push({ sessionId, from, text });
      return { ok: true, text: 'pong' };
    },
  };
  const store = {
    path: 'C:/ws',
    bots: new Map([['sunny', { id: 'sunny', name: 'Sunny', sessionId: 's-sunny' }]]),
  };
  const messaging = createMessaging({
    ctx: {
      sessionController: {
        list: async () => ({ items: [] }),
        resolveAgent: async () => ({ agent: { id: 's-fork', cwd: 'C:/ws' } }),
      },
    },
    hub: {},
    engine,
    runtime,
    binder: {},
    log: () => undefined,
  });
  const sender = { store, bot: store.bots.get('sunny') };
  const outcome = await messaging.sendBotMessage(sender, 's-fork', 'hi', 1);
  assert.equal(outcome.ok, true);
  assert.equal(delivered[0].sessionId, 's-fork', 'the unlisted fork receives the delivery');
});

test('a resolved Session in another workspace is still refused', async () => {
  const runtime = { hops: new Map(), active: new Map(), errors: new Map() };
  const messaging = createMessaging({
    ctx: {
      sessionController: {
        list: async () => ({ items: [] }),
        resolveAgent: async () => ({ agent: { id: 's-other', cwd: 'C:/other' } }),
      },
    },
    hub: {},
    engine: { deliverBotMessage: async () => ({ ok: true, text: 'pong' }) },
    runtime,
    binder: {},
    log: () => undefined,
  });
  const store = { path: 'C:/ws', bots: new Map([['sunny', { id: 'sunny', name: 'Sunny', sessionId: 's-sunny' }]]) };
  const sender = { store, bot: store.bots.get('sunny') };
  const outcome = await messaging.sendBotMessage(sender, 's-other', 'hi', 1);
  assert.equal(outcome.ok, false);
  assert.match(outcome.text, /另一个工作区/);
});
