import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WorkspaceStore } from '../host/store.js';

function withStore(run) {
  const dir = mkdtempSync(join(tmpdir(), 'dgb-'));
  const store = new WorkspaceStore({ id: 'ws-1', path: dir, title: 'Test' }, () => undefined);
  store.load();
  try {
    run(store, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('bots persist, reload and keep ids unique after deletion', () => {
  withStore((store, dir) => {
    const first = store.createBot({ name: 'Sunny', mode: 'companion' });
    assert.equal(first.id, 'sunny');
    const bound = store.updateBot(first.id, { sessionId: 'session-1' });

    const reloaded = new WorkspaceStore({ id: 'ws-1', path: dir, title: 'Test' }, () => undefined);
    reloaded.load();
    assert.equal(reloaded.getBot('sunny').sessionId, 'session-1');
    assert.equal(reloaded.listBots().length, 1);

    reloaded.deleteBot('sunny');
    const second = reloaded.createBot({ name: 'Sunny', mode: 'operator' });
    assert.notEqual(second.id, 'sunny', 'a deleted bot id is never reused');
  });
});

test('memory, daily logs and shared facts live inside the workspace', () => {
  withStore((store) => {
    const bot = store.createBot({ name: 'Sunny', mode: 'companion' });
    store.writeMemory(bot.id, '## 2026-11-10\n- 喜欢短句\n');
    store.appendDailyLog(bot.id, '聊了插件', '2026-11-10');
    store.writeSharedFacts('- 主人叫大肥鱼\n');
    assert.ok(store.readMemory(bot.id).includes('喜欢短句'));
    assert.ok(store.readMemory(bot.id).includes('喜欢短句'));
    assert.equal(store.readSharedFacts().trim(), '- 主人叫大肥鱼');
    const memory = store.renderMemory(bot.id);
    assert.ok(memory.text.includes('主人叫大肥鱼'));
    assert.ok(memory.chars > 0);
  });
});

test('rooms append and page their transcript', () => {
  withStore((store) => {
    const sunny = store.createBot({ name: 'Sunny', mode: 'chief' });
    const scout = store.createBot({ name: '侦察兵', mode: 'scout' });
    const group = store.saveGroup({ name: '小组', members: [sunny.id, scout.id], leadBotId: sunny.id });
    for (let index = 0; index < 5; index += 1) {
      store.appendRoomMessage(group.id, {
        id: `m${index}`,
        kind: 'user',
        authorId: null,
        text: `消息 ${index}`,
        at: new Date().toISOString(),
      });
    }
    assert.equal(store.readRoom(group.id, 3).length, 3);
    assert.equal(store.readRoom(group.id, 3).at(-1).text, '消息 4');
    const file = join(store.root, 'groups', group.id, 'room.jsonl');
    assert.ok(readFileSync(file, 'utf8').includes('消息 4'));
  });
});

test('pinned/hidden survive updates and created routines get a fire time', () => {
  withStore((store) => {
    const bot = store.createBot({
      name: 'Sunny',
      mode: 'chief',
      routines: [{ when: { kind: 'daily', time: '09:00' }, instruction: '早报' }],
    });
    assert.equal(typeof bot.routines[0].nextAt, 'string');
    store.updateBot(bot.id, { pinned: true, hidden: true });
    assert.equal(store.getBot(bot.id).pinned, true);
    assert.equal(store.getBot(bot.id).hidden, true);
    store.updateBot(bot.id, { pinned: false });
    assert.equal(store.getBot(bot.id).pinned, false);
  });
});

test('group validation rejects unknown members and too small rooms', () => {
  withStore((store) => {
    const only = store.createBot({ name: 'Solo', mode: 'chief' });
    assert.throws(() => store.saveGroup({ name: 'x', members: [only.id] }), /2–6/);
    assert.throws(() => store.saveGroup({ name: 'x', members: [only.id, 'ghost'] }), /unknown bot/);
  });
});
