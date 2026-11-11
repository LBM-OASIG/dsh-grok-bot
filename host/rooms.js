/**
 * dsh-grok-bot — multi-Bot rooms.
 *
 * One user message starts a room turn: the plugin resolves `@name` mentions,
 * decides who answers, drives each responder's own Session (the same delivery
 * primitive as everything else), writes every bubble into `room.jsonl`, and
 * supports one-hop hand-off between Bots. The room itself is not a Session:
 * each Bot keeps its own Session, memory and tools.
 */
import { decideResponders, parseHandoffs, parseMentions } from './domain.js';
import { clip, newId, nowIso, localStamp } from './util.js';

/** Default wall-clock limit for one responder turn. */
const TURN_TIMEOUT_MS = 180_000;

export class RoomEngine {
  /**
   * @param {{ctx: object, hub: object, binder: object, engine: object, runtime: object, log: Function, emit: Function}} deps wiring.
   */
  constructor(deps) {
    this.ctx = deps.ctx;
    this.hub = deps.hub;
    this.binder = deps.binder;
    this.engine = deps.engine;
    this.runtime = deps.runtime;
    this.log = deps.log;
    this.emit = deps.emit;
    /** @type {Map<string, {status: string, roomTurnId: string|null, responders: string[]}>} */
    this.rooms = deps.runtime.rooms;
    /** @type {Map<string, {groupId: string, botId: string}>} session id → active responder */
    this.responderBySession = new Map();
    /** @type {Map<string, string>} `${groupId}|${botId}` → streamed text so far */
    this.buffers = new Map();
    this.streamDispose = undefined;
    if (typeof this.ctx?.on === 'function') {
      try {
        this.streamDispose = this.ctx.on(
          'agent/assistant-stream',
          ({ agent, frame }) => this.onStreamFrame(agent, frame),
          { global: true },
        );
      } catch (error) {
        this.log('warn', `dsh-grok-bot: assistant-stream subscription failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Turn one live assistant token frame into a `room.delta` SSE event.
   * @param {object} agent live Agent whose Session produced the frame.
   * @param {object} frame assistant-stream frame.
   */
  onStreamFrame(agent, frame) {
    const target = this.responderBySession.get(agent?.session?.id);
    if (target === undefined) return;
    const key = `${target.groupId}|${target.botId}`;
    if (frame?.type === 'start') {
      this.buffers.set(key, '');
      return;
    }
    if (frame?.type !== 'chunk') return;
    const chunk = frame.chunk;
    if (chunk === null || typeof chunk !== 'object' || chunk.type !== 'text-delta' || typeof chunk.text !== 'string') return;
    const text = (this.buffers.get(key) ?? '') + chunk.text;
    this.buffers.set(key, text);
    this.emit('room.delta', { groupId: target.groupId, botId: target.botId, delta: chunk.text, text });
  }

  /** Release the assistant-stream subscription and per-room buffers. */
  dispose() {
    try {
      this.streamDispose?.();
    } catch {
      /* already disposed */
    }
    this.streamDispose = undefined;
    this.responderBySession.clear();
    this.buffers.clear();
  }

  /**
   * Read the room's runtime view.
   * @param {string} groupId room id.
   * @returns {object} runtime row.
   */
  status(groupId) {
    return this.rooms.get(groupId) ?? { status: 'idle', roomTurnId: null, responders: [] };
  }

  /**
   * Post one user message and run the resulting room turn.
   * @param {{groupId: string, text: string}} payload post request.
   * @returns {Promise<{ok: boolean, text?: string, code?: string, message?: string}>} outcome.
   */
  async post(payload) {
    const groupId = String(payload?.groupId ?? '');
    const text = String(payload?.text ?? '').trim();
    if (groupId === '' || text === '') return { ok: false, code: 'invalid_input', message: 'groupId and text are required' };
    const found = this.findRoom(groupId);
    if (found === undefined) return { ok: false, code: 'unknown_room', message: `unknown room "${groupId}"` };
    const { store, group } = found;
    const current = this.status(groupId);
    if (current.status === 'running' || current.status === 'routing' || current.status === 'stopping') {
      return { ok: false, code: 'room_busy', message: '这个房间还在上一轮对话里，等它说完再发。' };
    }
    const members = [...store.bots.values()].filter((bot) => group.members.includes(bot.id) && !bot.hidden);
    if (members.length < 2) return { ok: false, code: 'invalid_group', message: '房间成员不足两个' };
    const mentionList = members.map((bot) => ({ id: bot.id, name: bot.name }));
    const mentions = parseMentions(text, mentionList);
    const responders = decideResponders(
      mentions,
      group,
      members.map((bot) => ({ id: bot.id, active: true })),
    );
    if (mentions.ids.length === 0 && !mentions.everyone && text.trim().startsWith('@')) {
      this.appendSystem(store, group, `没有找到被 @ 的成员；房间成员是：${members.map((bot) => bot.name).join('、')}`);
    }
    const roomTurnId = `t${newId().slice(0, 8)}`;
    this.append(store, group, {
      kind: 'user',
      authorId: null,
      text: mentions.text === '' ? text : mentions.text,
      roomTurnId,
    });
    this.emit('room.append', { groupId, roomTurnId });
    if (responders.length === 0) {
      this.appendSystem(store, group, '@ 到了不在房间里的成员；没有 Bot 需要回应。', roomTurnId);
      this.emit('room.status', { groupId, status: 'idle', roomTurnId });
      return { ok: true, roomTurnId, responders: [] };
    }
    this.rooms.set(groupId, { status: 'running', roomTurnId, responders, startedAt: nowIso() });
    this.emit('room.status', { groupId, status: 'running', roomTurnId, responders });
    void this.runTurn({ store, group, members, mentions, responders, roomTurnId, depth: 0 }).catch((error) => {
      this.log('warn', `dsh-grok-bot: room ${groupId} turn failed: ${error instanceof Error ? error.message : String(error)}`);
      this.rooms.set(groupId, { status: 'error', roomTurnId, responders: [], error: String(error?.message ?? error) });
      this.emit('room.status', { groupId, status: 'error', roomTurnId });
      this.recordTurn(store, group, {
        roomTurnId,
        responders,
        status: 'error',
        startedAt: nowIso(),
        finishedAt: nowIso(),
        bubbles: 0,
        error: String(error?.message ?? error).slice(0, 500),
      });
    });
    return { ok: true, roomTurnId, responders };
  }

  /**
   * Run one room turn, including hand-offs.
   * @param {object} turn turn context.
   */
  async runTurn(turn) {
    const { store, group, members, mentions, responders, roomTurnId, depth } = turn;
    const startedAt = turn.startedAt ?? nowIso();
    const maxParallel = Math.max(1, Math.min(Number(group.maxParallel) || 1, responders.length));
    let queue = responders.slice();
    let handoffQueue = [];
    let bubbles = 0;
    while (queue.length > 0) {
      const batch = queue.splice(0, maxParallel);
      const results = await Promise.all(
        batch.map((botId) => this.runResponder({ store, group, members, botId, mentions, roomTurnId, depth })),
      );
      const phase = this.rooms.get(group.id)?.status;
      for (const result of results) {
        if (result === undefined) continue;
        if (phase === 'stopping' || phase === 'stopped') {
          // A stopped turn keeps its partial text out of the transcript: the
          // user asked for silence, and a late completion is not new content.
          continue;
        }
        if (result.text !== '') {
          bubbles += 1;
          this.append(store, group, {
            kind: 'bot',
            authorId: result.botId,
            text: result.text,
            roomTurnId,
            meta: { tools: result.tools, silence: result.reclaimed === true },
          });
          this.emit('room.append', { groupId: group.id, roomTurnId });
        }
        if (result.handoffs.length > 0) handoffQueue.push(...result.handoffs);
      }
    }
    if (handoffQueue.length > 0 && depth < (Number(group.handoffDepth) || 0)) {
      const nextDepth = depth + 1;
      const handoffMembers = handoffQueue.filter((id) => group.members.includes(id));
      if (handoffMembers.length > 0) {
        this.appendSystem(store, group, `交接第 ${nextDepth} 跳：${handoffMembers.map((id) => members.find((bot) => bot.id === id)?.name ?? id).join('、')}`, roomTurnId);
        await this.runTurn({ ...turn, responders: [...new Set(handoffMembers)], depth: nextDepth });
      }
    } else if (handoffQueue.length > 0) {
      this.appendSystem(store, group, '交接已超过房间允许的深度，后续 @ 被忽略。', roomTurnId);
    }
    const phase = this.rooms.get(group.id)?.status;
    if (phase !== 'stopping' && phase !== 'stopped') {
      this.rooms.set(group.id, { status: 'idle', roomTurnId, responders: [], finishedAt: nowIso() });
      this.emit('room.status', { groupId: group.id, status: 'idle', roomTurnId });
    }
    if (depth === 0) {
      const finalPhase = this.rooms.get(group.id)?.status;
      this.recordTurn(store, group, {
        roomTurnId,
        responders: turn.responders,
        status: finalPhase === 'stopped' || finalPhase === 'stopping' ? 'stopped' : 'idle',
        startedAt,
        finishedAt: nowIso(),
        bubbles,
      });
    }
  }

  /**
   * Append one room-turn summary to `groups/<id>/runs.jsonl`.
   * @param {object} store workspace store.
   * @param {object} group room definition.
   * @param {object} row summary fields.
   */
  recordTurn(store, group, row) {
    try {
      store.appendGroupRun(group.id, { id: newId(), at: nowIso(), ...row });
    } catch (error) {
      this.log('warn', `dsh-grok-bot: room ${group.id} turn summary was not written: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Drive one member's Session for this room turn.
   * @param {object} request responder request.
   * @returns {Promise<{botId: string, text: string, tools: number, reclaimed: boolean, handoffs: string[]} | undefined>} result.
   */
  async runResponder(request) {
    const { store, group, members, botId, mentions, roomTurnId, depth } = request;
    const bot = store.getBot(botId);
    if (bot === undefined || typeof bot.sessionId !== 'string') {
      this.appendSystem(store, group, `${botId} 还没有会话，跳过了。`, roomTurnId);
      return undefined;
    }
    const transcript = store.readRoom(group.id, 40);
    const others = members.filter((member) => member.id !== botId).map((member) => member.name);
    const lines = [];
    lines.push(`[群房间] 房间「${group.name}」${group.topic ? `（${group.topic}）` : ''}，现在是 ${localStamp()}。`);
    lines.push(`成员：${members.map((member) => member.name).join('、')}；你自己是「${bot.name}」。`);
    lines.push('这是宿主投递的房间消息，不是私聊。请直接在房间里回复，不要私信用户。');
    lines.push('要交给别的 Bot，就在回复里以 @名字 开头（最多一跳，不要来回踢皮球）。');
    lines.push('');
    lines.push('最近的房间记录：');
    const recent = transcript.filter((message) => message.kind !== 'system').slice(-30);
    for (const message of recent) {
      const author = message.kind === 'user' ? '用户' : message.authorId === null ? 'system' : store.getBot(message.authorId)?.name ?? message.authorId;
      lines.push(`- ${author}: ${clip(message.text, 220)}`);
    }
    lines.push('');
    lines.push(`用户刚刚说：${mentions.text === '' ? '（@了你）' : mentions.text}`);
    lines.push('用一两句话在房间回复；没有要说的就调用 bot_reclaim 静默收尾。');
    const frame = lines.join('\n');
    this.responderBySession.set(bot.sessionId, { groupId: group.id, botId });
    this.buffers.set(`${group.id}|${botId}`, '');
    let delivered;
    try {
      delivered = await this.engine.deliver({
        sessionId: bot.sessionId,
        text: frame,
        notice: true,
        summary: `房间 ${group.name} · ${roomTurnId}`,
        reason: 'room',
        timeoutMs: TURN_TIMEOUT_MS,
      });
    } finally {
      this.responderBySession.delete(bot.sessionId);
      this.buffers.delete(`${group.id}|${botId}`);
    }
    if (!delivered.ok) {
      this.appendSystem(store, group, `${bot.name} 这一轮没有答上来：${delivered.error ?? delivered.reason}`, roomTurnId);
      return { botId, text: '', tools: 0, reclaimed: false, handoffs: [] };
    }
    const text = delivered.text.trim();
    const handoffs = depth < (Number(group.handoffDepth) || 0)
      ? parseHandoffs(text, members.map((member) => ({ id: member.id, name: member.name })), botId)
      : [];
    return { botId, text, tools: delivered.tools ?? 0, reclaimed: delivered.reclaimed === true, handoffs };
  }

  /**
   * Stop the running room turn.
   * @param {string} groupId room id.
   * @param {string} [reason] stop reason.
   * @returns {Promise<{ok: boolean, text?: string, code?: string, message?: string}>} outcome.
   */
  async stop(groupId, reason) {
    const found = this.findRoom(groupId);
    if (found === undefined) return { ok: false, code: 'unknown_room', message: `unknown room "${groupId}"` };
    const current = this.status(groupId);
    if (current.status !== 'running' && current.status !== 'routing') {
      return { ok: true, text: '房间当前没有在说话。' };
    }
    this.rooms.set(groupId, { ...current, status: 'stopping' });
    this.emit('room.status', { groupId, status: 'stopping', roomTurnId: current.roomTurnId });
    const sessions = [];
    for (const botId of current.responders ?? []) {
      const bot = found.store.getBot(botId);
      if (typeof bot?.sessionId === 'string') sessions.push(bot.sessionId);
    }
    await Promise.all(sessions.map((sessionId) => this.binder.cancel(sessionId)));
    this.appendSystem(found.store, found.group, `回合被停止：${reason ?? '用户要求停止'}`, current.roomTurnId);
    this.rooms.set(groupId, { status: 'stopped', roomTurnId: current.roomTurnId, responders: [], finishedAt: nowIso() });
    this.emit('room.status', { groupId, status: 'stopped', roomTurnId: current.roomTurnId });
    this.recordTurn(found.store, found.group, {
      roomTurnId: current.roomTurnId,
      responders: current.responders ?? [],
      status: 'stopped',
      startedAt: current.startedAt ?? nowIso(),
      finishedAt: nowIso(),
      bubbles: 0,
      reason: reason ?? null,
    });
    return { ok: true, text: '已停止。' };
  }

  /**
   * Append one Bot message outside a live turn (used by `report: 'room'`
   * routines, which wake a cold Session and then drop the result here).
   * @param {string} groupId room id.
   * @param {string} botId author bot id.
   * @param {string} text message body.
   * @returns {boolean} whether the room and the author exist.
   */
  postBotMessage(groupId, botId, text) {
    const found = this.findRoom(groupId);
    if (found === undefined) return false;
    const bot = found.store.getBot(botId);
    if (bot === undefined) return false;
    this.append(found.store, found.group, {
      kind: 'bot',
      authorId: botId,
      text,
      roomTurnId: null,
      meta: { source: 'routine' },
    });
    this.emit('room.append', { groupId, roomTurnId: null, authorId: botId });
    return true;
  }

  /**
   * Find the running room whose responder set currently contains a Bot.
   * @param {string} botId bot id.
   * @returns {{store: object, group: object, turn: object} | undefined} active room.
   */
  findActiveByBot(botId) {
    for (const [groupId, turn] of this.rooms.entries()) {
      if (turn?.status !== 'running' || !Array.isArray(turn.responders) || !turn.responders.includes(botId)) continue;
      const found = this.findRoom(groupId);
      if (found !== undefined) return { ...found, turn };
    }
    return undefined;
  }

  /**
   * Append one explicit Bot bubble during a room turn (`bot_room_post`).
   * @param {string} botId author bot id.
   * @param {string} text message body.
   * @returns {{ok: boolean, groupId?: string, text: string}} outcome.
   */
  postExplicit(botId, text) {
    const active = this.findActiveByBot(botId);
    if (active === undefined) return { ok: false, text: '当前不在任何房间回合里，不能在房间发消息。' };
    const body = String(text ?? '').trim();
    if (body === '') return { ok: false, text: '消息内容不能为空。' };
    this.append(active.store, active.group, {
      kind: 'bot',
      authorId: botId,
      text: body,
      roomTurnId: active.turn.roomTurnId,
      meta: { explicit: true },
    });
    this.emit('room.append', { groupId: active.group.id, roomTurnId: active.turn.roomTurnId, authorId: botId });
    return { ok: true, groupId: active.group.id, text: '已在房间发言。' };
  }

  /**
   * @param {string} groupId room id.
   * @returns {{store: object, group: object} | undefined} owner.
   */
  findRoom(groupId) {
    for (const store of this.hub.list()) {
      const group = store.getGroup(groupId);
      if (group !== undefined) return { store, group };
    }
    return undefined;
  }

  /**
   * Append one room message.
   * @param {object} store workspace store.
   * @param {object} group room definition.
   * @param {object} row message fields.
   */
  append(store, group, row) {
    const message = {
      id: newId(),
      kind: row.kind,
      authorId: row.authorId ?? null,
      text: String(row.text ?? ''),
      replyTo: row.replyTo ?? null,
      at: nowIso(),
      meta: { roomTurnId: row.roomTurnId ?? null, ...(row.meta ?? {}) },
    };
    store.appendRoomMessage(group.id, message);
    return message;
  }

  /**
   * Append one system bubble.
   * @param {object} store workspace store.
   * @param {object} group room definition.
   * @param {string} text system text.
   * @param {string} [roomTurnId] turn id.
   */
  appendSystem(store, group, text, roomTurnId) {
    this.append(store, group, { kind: 'system', authorId: null, text, roomTurnId });
    this.emit('room.append', { groupId: group.id, roomTurnId: roomTurnId ?? null });
  }
}
