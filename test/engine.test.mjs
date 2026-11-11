import assert from 'node:assert/strict';
import test from 'node:test';

import { BotEngine, buildUserMessage, extractAssistant } from '../host/engine.js';

function makeEngine(overrides = {}) {
  const followups = [];
  const agent = {
    id: 'session-1',
    followup: (message) => {
      followups.push(message);
    },
    session: { seq: 3 },
  };
  const binder = {
    ensureAgent: async () => agent,
    state: async () => ({ cursor: 2 }),
    ...(overrides.binder ?? {}),
  };
  const ctx = {
    sessionController: {
      wait: async ({ afterSeq }) => ({
        reason: 'idle',
        output: {
          records: [
            {
              type: 'event',
              event: {
                type: 'assistant/message',
                data: { message: { role: 'assistant', content: [{ type: 'text', text: `reply after ${afterSeq}` }] } },
              },
            },
          ],
        },
      }),
      ...(overrides.sessionController ?? {}),
    },
  };
  const engine = new BotEngine({ ctx, hub: {}, binder, log: () => undefined, emit: () => undefined });
  return { engine, followups, agent };
}

test('deliver queues one notice message and returns assistant text', async () => {
  const { engine, followups } = makeEngine();
  const result = await engine.deliver({
    sessionId: 'session-1',
    text: 'hello',
    notice: true,
    summary: 'routine',
    reason: 'routine',
  });
  assert.equal(result.ok, true);
  assert.equal(result.text, 'reply after 2');
  assert.equal(followups.length, 1);
  assert.equal(followups[0].role, 'user');
  assert.equal(followups[0].source.kind, 'plugin:dsh-grok-bot');
  assert.equal(followups[0].source.form, 'notice');
});

test('deliver refuses a second concurrent delivery to the same Bot', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { engine } = makeEngine({
    sessionController: {
      wait: async () => {
        await gate;
        return { reason: 'idle', output: { records: [] } };
      },
    },
  });
  const first = engine.deliver({ sessionId: 'session-1', text: 'one' });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await engine.deliver({ sessionId: 'session-1', text: 'two' });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'busy');
  release();
  await first;
});

test('a wait timeout is reported as a timeout and frees the Bot', async () => {
  const { engine } = makeEngine({
    sessionController: {
      wait: async () => {
        throw Object.assign(new Error('timed out'), { code: 'session/wait-timeout' });
      },
    },
  });
  const result = await engine.deliver({ sessionId: 'session-1', text: 'slow' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'timeout');
  assert.equal(engine.isBusy('session-1'), false);
});

test('extractAssistant reads only committed assistant text', () => {
  const output = {
    records: [
      { type: 'event', event: { type: 'tool/call', data: {} } },
      { type: 'event', event: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'first' }] } } } },
      { type: 'event', event: { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'final' }, { type: 'tool-call' }] } } } },
    ],
  };
  const result = extractAssistant(output);
  assert.equal(result.text, 'first\n\nfinal');
  assert.equal(result.tools, 1);
  assert.equal(result.messages, 2);
});

test('buildUserMessage clips the notice summary', () => {
  const long = 'x'.repeat(400);
  const message = buildUserMessage('body', { notice: true, summary: long });
  assert.ok(message.source.summary.length <= 120);
});
