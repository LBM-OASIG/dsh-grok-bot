import assert from 'node:assert/strict';
import test from 'node:test';

import { SessionBinder } from '../host/sessions.js';

function makeBinder() {
  const created = [];
  const renamed = [];
  const ctx = {
    sessionController: {
      create: async (request) => {
        created.push(request);
        return { sessionId: `session-${created.length}` };
      },
      rename: async (request) => {
        renamed.push(request);
      },
    },
  };
  return { binder: new SessionBinder(ctx, () => undefined), created, renamed };
}

test('an ordinary Session is created without a Bot preset', async () => {
  const { binder, created } = makeBinder();
  const store = { id: 'ws-1', path: 'C:\\work\\one' };

  const sessionId = await binder.createSession(store, {});

  assert.equal(sessionId, 'session-1');
  assert.equal(created.length, 1);
  assert.deepEqual(created[0], { workspaceId: 'ws-1' });
  assert.equal('agentPreset' in created[0], false);
});

test('without a workspace id the ordinary Session falls back to cwd', async () => {
  const { binder, created } = makeBinder();
  const store = { path: 'C:\\work\\two' };

  await binder.createSession(store, {});

  assert.deepEqual(created[0], { cwd: 'C:\\work\\two' });
});

test('the Bot Session keeps the Bot preset', async () => {
  const { binder, created, renamed } = makeBinder();
  const store = { id: 'ws-1', path: 'C:\\work\\one' };

  const sessionId = await binder.createBotSession(store, { mode: 'chief' });

  assert.equal(sessionId, 'session-1');
  assert.deepEqual(created[0], { workspaceId: 'ws-1', agentPreset: 'grok-bot-agent' });
  assert.equal(renamed.length, 0);
});
