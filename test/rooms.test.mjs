import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WorkspaceStore } from '../host/store.js';
import { RoomEngine } from '../host/rooms.js';

function makeRoom(replies) {
  const dir = mkdtempSync(join(tmpdir(), 'dgb-room-'));
  const store = new WorkspaceStore({ id: 'ws', path: dir, title: 'Test' }, () => undefined);
  store.load();
  const sunny = store.createBot({ name: 'Sunny', mode: 'chief' });
  store.updateBot(sunny.id, { sessionId: 'session-sunny' });
  const scout = store.createBot({ name: '侦察兵', mode: 'scout' });
  store.updateBot(scout.id, { sessionId: 'session-scout' });
  const scoutId = store.getBot(scout.id).id;
  const group = store.saveGroup({
    name: '小组',
    members: [sunny.id, scout.id],
    leadBotId: sunny.id,
    responderPolicy: 'primary',
    maxParallel: 2,
    handoffDepth: 1,
  });
  const events = [];
  const engine = {
    deliver: async ({ sessionId }) => {
      const reply = replies[sessionId] ?? '';
      return { ok: true, text: reply, tools: 0, reclaimed: false, reason: 'idle' };
    },
  };
  const hub = {
    list: () => [store],
    byPath: (path) => (path === dir ? store : undefined),
    findById: (id) => (store.getBot(id) === undefined ? undefined : { store, bot: store.getBot(id) }),
  };
  const runtime = { rooms: new Map(), active: new Map(), hops: new Map(), errors: new Map() };
  const binder = { cancel: async () => undefined };
  const rooms = new RoomEngine({
    ctx: {},
    hub,
    binder,
    engine,
    runtime,
    log: () => undefined,
    emit: (event, data) => events.push({ event, data }),
  });
  return {
    store,
    dir,
    group,
    rooms,
    events,
    sunnyId: sunny.id,
    scoutId,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
    sessionOf: (botId) => store.getBot(botId).sessionId,
  };
}

test('room turn routes mentions and writes one bubble per responder', async () => {
  const room = makeRoom({ 'session-sunny': '主答', 'session-scout': '@Sunny 交给主答' });
  try {
    const result = await room.rooms.post({ groupId: room.group.id, text: '@侦察兵 看下这个' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.responders, [room.scoutId]);
    // The async turn needs one tick to finish.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const transcript = room.store.readRoom(room.group.id, 50);
    assert.ok(transcript.some((message) => message.kind === 'user'));
    assert.ok(transcript.some((message) => message.kind === 'bot' && message.authorId === room.scoutId));
    assert.ok(transcript.some((message) => message.kind === 'system' && message.text.includes('交接第 1 跳')));
    assert.equal(room.rooms.status(room.group.id).status, 'idle');
    assert.ok(room.events.some((entry) => entry.event === 'room.append'));
  } finally {
    room.cleanup();
  }
});

test('a busy room rejects a second post', async () => {
  const room = makeRoom({ 'session-sunny': '' });
  try {
    const first = await room.rooms.post({ groupId: room.group.id, text: '第一句' });
    assert.equal(first.ok, true);
    const second = await room.rooms.post({ groupId: room.group.id, text: '第二句' });
    assert.equal(second.ok, false);
    assert.equal(second.code, 'room_busy');
    await new Promise((resolve) => setTimeout(resolve, 30));
  } finally {
    room.cleanup();
  }
});

test('an @ to an unknown name falls back to the lead and leaves a system note', async () => {
  const room = makeRoom({ 'session-sunny': '我在' });
  try {
    const result = await room.rooms.post({ groupId: room.group.id, text: '@不存在 有人吗' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.responders, ['sunny']);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const transcript = room.store.readRoom(room.group.id, 50);
    assert.ok(transcript.some((message) => message.kind === 'system'));
    assert.ok(transcript.some((message) => message.kind === 'bot' && message.authorId === 'sunny'));
  } finally {
    room.cleanup();
  }
});

test('stop marks the room stopped', async () => {
  const room = makeRoom({ 'session-sunny': '' });
  try {
    await room.rooms.post({ groupId: room.group.id, text: '开始' });
    const stopped = await room.rooms.stop(room.group.id, '测试');
    assert.equal(stopped.ok, true);
    assert.equal(room.rooms.status(room.group.id).status, 'stopped');
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    room.cleanup();
  }
});

test('bot_room_post appends an explicit bubble only during a running room turn', () => {
  const room = makeRoom({});
  try {
    assert.equal(room.rooms.findActiveByBot(room.sunnyId), undefined);
    const outside = room.rooms.postExplicit(room.sunnyId, '不该出现');
    assert.equal(outside.ok, false);

    room.rooms.rooms.set(room.group.id, { status: 'running', roomTurnId: 't1', responders: [room.sunnyId] });
    const posted = room.rooms.postExplicit(room.sunnyId, '补充一句');
    assert.equal(posted.ok, true);
    assert.equal(posted.groupId, room.group.id);
    const last = room.store.readRoom(room.group.id, 20).at(-1);
    assert.equal(last.authorId, room.sunnyId);
    assert.equal(last.meta.explicit, true);

    assert.equal(room.rooms.postExplicit(room.scoutId, '不在 responder 里').ok, false);
    assert.equal(room.rooms.postExplicit(room.sunnyId, '   ').ok, false);
  } finally {
    room.cleanup();
  }
});

test('a finished room turn writes a run summary', async () => {
  const room = makeRoom({ 'session-sunny': '我在' });
  try {
    await room.rooms.post({ groupId: room.group.id, text: '@Sunny 在吗' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const runs = room.store.readGroupRuns(room.group.id, 10);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, 'idle');
    assert.equal(runs[0].bubbles, 1);
    assert.deepEqual(runs[0].responders, [room.sunnyId]);
    assert.ok(runs[0].finishedAt);
  } finally {
    room.cleanup();
  }
});

test('assistant-stream text frames become room.delta events', () => {
  const room = makeRoom({});
  try {
    room.rooms.responderBySession.set('session-sunny', { groupId: room.group.id, botId: room.sunnyId });
    room.rooms.onStreamFrame({ session: { id: 'session-sunny' } }, { type: 'start' });
    room.rooms.onStreamFrame(
      { session: { id: 'session-sunny' } },
      { type: 'chunk', chunk: { type: 'text-delta', text: '你' } },
    );
    room.rooms.onStreamFrame(
      { session: { id: 'session-sunny' } },
      { type: 'chunk', chunk: { type: 'text-delta', text: '好' } },
    );
    room.rooms.onStreamFrame(
      { session: { id: 'session-scout' } },
      { type: 'chunk', chunk: { type: 'text-delta', text: 'not a responder' } },
    );
    const deltas = room.events.filter((entry) => entry.event === 'room.delta');
    assert.equal(deltas.length, 2);
    assert.equal(deltas[1].data.text, '你好');
    assert.equal(deltas[0].data.botId, room.sunnyId);
    assert.equal(deltas[0].data.groupId, room.group.id);
  } finally {
    room.cleanup();
  }
});

test('report=room can append a routine result outside a live turn', () => {
  const room = makeRoom({});
  try {
    const posted = room.rooms.postBotMessage(room.group.id, room.sunnyId, '例行汇报：一切正常。');
    assert.equal(posted, true);
    const transcript = room.store.readRoom(room.group.id, 20);
    const last = transcript.at(-1);
    assert.equal(last.kind, 'bot');
    assert.equal(last.authorId, room.sunnyId);
    assert.equal(last.meta.source, 'routine');
    assert.equal(room.rooms.postBotMessage('nope', room.sunnyId, 'x'), false);
  } finally {
    room.cleanup();
  }
});

test('a stopped turn keeps late completions out of the transcript', async () => {
  const room = makeRoom({});
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  room.rooms.engine = {
    deliver: async () => {
      await gate;
      return { ok: true, text: '迟到的回复', tools: 0, reclaimed: false };
    },
  };
  try {
    await room.rooms.post({ groupId: room.group.id, text: '开始' });
    await room.rooms.stop(room.group.id, '不要了');
    release();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const transcript = room.store.readRoom(room.group.id, 50);
    assert.ok(!transcript.some((message) => message.text === '迟到的回复'), 'no bubble appears after a stop');
    assert.equal(room.rooms.status(room.group.id).status, 'stopped');
  } finally {
    room.cleanup();
  }
});
