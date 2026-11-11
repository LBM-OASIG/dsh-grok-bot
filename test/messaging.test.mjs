import assert from 'node:assert/strict';
import test from 'node:test';

import { createMessaging } from '../host/messaging.js';

function makeWorld(targetCwd) {
  const target = 'session-target';
  const liveAgent = { id: target, cwd: targetCwd };
  const ctx = {
    agents: { get: (id) => (id === target ? liveAgent : undefined) },
    sessionController: {
      list: async () => ({ items: [] }),
      resolveAgent: async () => {
        throw new Error('the live agent must be used before resolveAgent');
      },
    },
  };
  const sender = { id: 'sunny', name: 'Sunny', sessionId: 'session-self', mode: 'companion' };
  const store = {
    path: 'C:\\work\\one',
    bots: new Map([[sender.id, sender]]),
  };
  const engine = { deliverBotMessage: async () => ({ ok: true, text: '' }) };
  const runtime = { hops: new Map(), errors: new Map() };
  const messaging = createMessaging({ ctx, hub: {}, engine, runtime, binder: {}, log: () => undefined });
  return { messaging, live: { bot: sender, store }, target };
}

test('a live ordinary Session in the same workspace is addressable without resolving it again', async () => {
  const { messaging, live, target } = makeWorld('C:\\work\\one');
  const result = await messaging.sendBotMessage(live, target, 'ping', 1);
  assert.equal(result.ok, true);
  assert.match(result.text, /已送达/);
});

test('a live Session in another workspace is still refused', async () => {
  const { messaging, live, target } = makeWorld('C:\\work\\two');
  const result = await messaging.sendBotMessage(live, target, 'ping', 1);
  assert.equal(result.ok, false);
  assert.match(result.text, /另一个工作区/);
});

test('a Bot reply comes back in full, without the old 240-character cut', async () => {
  const sender = { id: 'sunny', name: 'Sunny', sessionId: 'session-self', mode: 'chief' };
  const targetBot = { id: 'worker', name: 'Worker', sessionId: 'session-worker', mode: 'operator' };
  const longReply = `${'长回复内容 '.repeat(80)}结尾标记`;
  const store = {
    path: 'C:\\work\\one',
    bots: new Map([[sender.id, sender], [targetBot.id, targetBot]]),
  };
  const ctx = { agents: { get: () => undefined }, sessionController: {} };
  const engine = { deliverBotMessage: async () => ({ ok: true, text: longReply }) };
  const runtime = { hops: new Map(), errors: new Map() };
  const messaging = createMessaging({ ctx, hub: {}, engine, runtime, binder: {}, log: () => undefined });

  const result = await messaging.sendBotMessage({ bot: sender, store }, 'worker', '干点活', 1);

  assert.equal(result.ok, true);
  assert.ok(result.text.includes('结尾标记'), 'the full reply tail survives');
  assert.equal(result.text.includes('…'), false, 'no truncation marker');
});
