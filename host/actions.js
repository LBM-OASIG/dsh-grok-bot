/**
 * dsh-grok-bot — the closed action vocabulary behind POST /action.
 *
 * Every handler validates its payload, mutates only the workspace store it
 * resolved, keeps the Session binding consistent, and returns either the fresh
 * snapshot or a stable `{ok:false, code, message}` error.
 */
import { DomainError, appendMemoryEntry, computeNextAt, forgetMemoryLines, normalizeRoutine } from './domain.js';
import { presentSnapshot } from './present.js';
import { clip, localDateKey } from './util.js';

/**
 * @typedef {{ok: false, code: string, message: string}} ActionFailure
 */

/**
 * Create the action dispatcher.
 * @param {object} deps wiring.
 * @returns {{action: (body: any) => Promise<object>}} dispatcher.
 */
export function createActions(deps) {
  const { ctx, hub, binder, engine, registry, runtime, log, emit, schedulerRef, rooms } = deps;
  const snapshot = () => presentSnapshot({ hub, ctx, runtime });
  const ok = () => ({ ok: true, snapshot: snapshot() });
  const fail = (code, message) => ({ ok: false, code, message });
  const changed = (reason, data) => emit('changed', { reason, ...(data ?? {}) });

  /**
   * Run one handler, converting domain errors into stable failures.
   * @param {() => Promise<object>} handler work.
   * @returns {Promise<object>} normalized result.
   */
  async function guard(handler) {
    try {
      return await handler();
    } catch (error) {
      if (error instanceof DomainError) return fail(error.code, error.message);
      const message = error instanceof Error ? error.message : String(error);
      log('warn', `dsh-grok-bot action failed: ${message}`);
      return fail(typeof error?.code === 'string' ? error.code : 'error', message);
    }
  }

  /**
   * Resolve one bot by id.
   * @param {string} botId bot id.
   * @returns {{store: object, bot: object}} owner.
   */
  function requireBot(payload) {
    const botId = typeof payload?.id === 'string' ? payload.id : '';
    if (botId === '') throw new DomainError('invalid_input', 'bot id is required');
    if (typeof payload?.workspacePath === 'string' && payload.workspacePath !== '') {
      const store = hub.resolveStore(payload);
      const bot = store.getBot?.(botId);
      if (bot === undefined) {
        throw new DomainError('unknown_bot', `unknown bot "${botId}" in ${store.path}`);
      }
      return { store, bot };
    }
    const found = hub.findById(botId);
    if (found === undefined) throw new DomainError('unknown_bot', `unknown bot "${botId}"`);
    return found;
  }

  /**
   * Create one Bot record plus its Session binding.
   * @param {object} payload create fields.
   * @returns {Promise<object>} result.
   */
  async function createBot(payload) {
    const store = hub.resolveStore(payload);
    if (store.missing) throw new DomainError('workspace_missing', `workspace directory is missing: ${store.path}`);
    const bot = store.createBot(payload);
    let sessionId = null;
    try {
      sessionId = await binder.createBotSession(store, bot);
      const bound = store.updateBot(bot.id, { sessionId });
      await binder.rename(sessionId, bot.name);
      await registry.bootstrap(sessionId);
      if (store.config.primaryBotId === null) store.updateConfig({ primaryBotId: bound.id });
      changed('bot', { botId: bound.id });
      return ok();
    } catch (error) {
      if (typeof sessionId === 'string') {
        try {
          await binder.archive(sessionId);
        } catch {
          // A failed create must not leave an orphan Session in the sidebar.
        }
      }
      store.deleteBot(bot.id);
      throw error;
    }
  }

  /**
   * Apply a mode change to a live Bot.
   *
   * A started Session's preset composition is locked by the host, so the mode
   * is enforced by the Agent-scope guard (which reads `bot.json` on every
   * call) and by rebuilding the mode-dependent `bot_*` catalog. The identity
   * and memory prompt sections re-read the record on every model step.
   * @param {{store: object, bot: object}} live bot owner.
   * @param {string} mode new mode id.
   * @returns {Promise<void>} completion.
   */
  async function switchMode(live, mode) {
    registry.refresh(live.bot.sessionId);
  }

  /**
   * Create a fresh Session for a Bot whose bound Session disappeared.
   * @param {{store: object, bot: object}} live bot owner.
   * @returns {Promise<string>} the new session id.
   */
  async function rebuildSession(live) {
    const sessionId = await binder.createBotSession(live.store, live.bot);
    live.store.updateBot(live.bot.id, { sessionId });
    await binder.rename(sessionId, live.bot.name);
    await registry.bootstrap(sessionId);
    runtime.errors.delete(live.bot.id);
    return sessionId;
  }

  /**
   * Resolve the store that owns a room id.
   * @param {string} groupId room id.
   * @param {object} [payload] optional workspace hint.
   * @returns {{store: object, group: object}} owner.
   */
  function requireRoom(groupId, payload) {
    if (typeof groupId !== 'string' || groupId === '') throw new DomainError('invalid_input', 'groupId is required');
    if (payload !== undefined && (typeof payload.workspacePath === 'string' || typeof payload.workspaceId === 'string')) {
      const hinted = hub.resolveStore(payload);
      const group = hinted.getGroup(groupId);
      if (group !== undefined) return { store: hinted, group };
    }
    for (const store of hub.list()) {
      const group = store.getGroup(groupId);
      if (group !== undefined) return { store, group };
    }
    throw new DomainError('unknown_group', `unknown room "${groupId}"`);
  }

  /* ------------------------------------------------------------------ bot */

  const handlers = {
    async 'bot.create'(payload) {
      return createBot(payload ?? {});
    },

    async 'bot.update'(payload) {
      const live = requireBot(payload);
      const previousMode = live.bot.mode;
      const patch = payload?.patch ?? payload ?? {};
      const bot = live.store.updateBot(live.bot.id, patch);
      if (patch.rebuildSession === true && typeof bot.sessionId !== 'string') {
        await rebuildSession({ store: live.store, bot });
      }
      if (bot.mode !== previousMode) await switchMode({ store: live.store, bot }, bot.mode);
      else if (patch.autonomy !== undefined) registry.refresh(bot.sessionId);
      changed('bot', { botId: bot.id });
      return ok();
    },

    async 'bot.delete'(payload) {
      if (payload?.confirm !== true) throw new DomainError('confirm_required', 'deleting a Bot needs confirm:true');
      const live = requireBot(payload);
      const sessionId = live.bot.sessionId;
      registry.forget(sessionId);
      if (typeof sessionId === 'string') {
        await binder.cancel(sessionId);
        await binder.archive(sessionId);
      }
      live.store.deleteBot(live.bot.id);
      if (live.store.config.primaryBotId === live.bot.id) live.store.updateConfig({ primaryBotId: null });
      changed('bot', { botId: live.bot.id });
      return ok();
    },

    async 'bot.duplicate'(payload) {
      const live = requireBot(payload);
      const name = typeof payload?.name === 'string' && payload.name.trim() !== '' ? payload.name.trim() : `${live.bot.name} · 副本`;
      return createBot({
        workspacePath: live.store.path,
        name,
        label: live.bot.label,
        mode: live.bot.mode,
        persona: live.bot.persona,
        avatar: { shape: live.bot.avatar.shape, color: live.bot.avatar.color },
        section: live.bot.section,
        autonomy: live.bot.autonomy,
      });
    },

    async 'bot.pin'(payload) {
      const live = requireBot(payload);
      live.store.updateBot(live.bot.id, { pinned: payload?.pinned === true });
      changed('bot', { botId: live.bot.id });
      return ok();
    },

    async 'bot.hide'(payload) {
      const live = requireBot(payload);
      live.store.updateBot(live.bot.id, { hidden: payload?.hidden === true });
      changed('bot', { botId: live.bot.id });
      return ok();
    },

    async 'bot.rebuild_session'(payload) {
      if (payload?.confirm !== true) throw new DomainError('confirm_required', 'rebuilding a Session needs confirm:true');
      const live = requireBot(payload);
      const sessionId = await rebuildSession(live);
      changed('bot', { botId: live.bot.id, sessionId });
      return ok();
    },

    async 'bot.open_session'(payload) {
      const live = requireBot(payload);
      const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
      if (title.length > 80) throw new DomainError('invalid_input', 'title is too long (80 characters)');
      const sessionId = await binder.createSession(live.store, {});
      if (title !== '') await binder.rename(sessionId, title);
      changed('bot', { botId: live.bot.id, sessionId });
      return { ok: true, sessionId, snapshot: snapshot() };
    },

    async 'bot.debug_tools'(payload) {
      const live = requireBot(payload);
      const agent = typeof live.bot.sessionId === 'string' ? ctx.agents.get(live.bot.sessionId) : undefined;
      const record = registry.byBot.get(live.bot.sessionId);
      let names = [];
      try {
        names = agent?.ctx?.tools?.definitions?.(agent)?.map((item) => item.name) ?? [];
      } catch {
        try {
          names = [...(agent?.ctx?.tools?.view?.(agent)?.visible?.keys?.() ?? [])];
        } catch {
          names = [];
        }
      }
      return {
        ok: true,
        hasAgent: agent !== undefined,
        hasRecord: record !== undefined,
        total: names.length,
        botTools: names.filter((name) => String(name).startsWith('bot_')),
        errors: record?.toolErrors ?? [],
      };
    },

    async 'bot.open_chat'(payload) {
      const live = requireBot(payload);
      if (typeof live.bot.sessionId !== 'string') throw new DomainError('session_missing', 'this Bot has no Session yet');
      return { ok: true, sessionId: live.bot.sessionId, snapshot: snapshot() };
    },

    /**
     * Export one Bot as a reusable template: persona, mode, avatar, autonomy and
     * routines, but never the Session binding or the memory files.
     */
    async 'bot.export'(payload) {
      const live = requireBot(payload);
      const bot = live.bot;
      return {
        ok: true,
        snapshot: snapshot(),
        template: {
          version: 1,
          name: bot.name,
          label: bot.label,
          mode: bot.mode,
          persona: bot.persona,
          avatar: bot.avatar,
          section: bot.section,
          autonomy: bot.autonomy,
          routines: bot.routines.map((routine) => ({
            when: routine.when,
            instruction: routine.instruction,
            report: routine.report,
            enabled: routine.enabled,
          })),
        },
      };
    },

    /** Create a new Bot (and Session) from an exported template. */
    async 'bot.import'(payload) {
      const template = payload?.template ?? payload;
      if (template === null || typeof template !== 'object') throw new DomainError('invalid_input', 'template is required');
      const store = hub.resolveStore(payload ?? {});
      const name = typeof payload?.name === 'string' && payload.name.trim() !== '' ? payload.name.trim() : template.name;
      if (typeof name !== 'string' || name.trim() === '') throw new DomainError('invalid_input', 'template has no name');
      return createBot({
        workspacePath: store.path,
        name,
        label: template.label,
        mode: template.mode,
        persona: template.persona,
        avatar: template.avatar,
        section: template.section,
        autonomy: template.autonomy,
        routines: Array.isArray(template.routines)
          ? template.routines.map((routine) => ({ ...routine, nextAt: null, lastRunAt: null }))
          : undefined,
      });
    },

    /** Send one message on behalf of a Bot (used by the panel's send-to form). */
    async 'bot.send'(payload) {
      const live = requireBot(payload);
      const target = String(payload?.target ?? '').trim();
      const text = String(payload?.text ?? '').trim();
      if (target === '' || text === '') throw new DomainError('invalid_input', 'target and text are required');
      if (deps.sendBotMessage === undefined) throw new DomainError('not_ready', 'messaging is not ready');
      const outcome = await deps.sendBotMessage(live, target, text, 1);
      return { ok: outcome.ok !== false, text: outcome.text, snapshot: snapshot(), ...(outcome.ok === false ? { code: 'send_failed' } : {}) };
    },

    /* --------------------------------------------------------------- memory */

    async 'memory.read'(payload) {
      const live = requireBot(payload);
      return {
        ok: true,
        snapshot: snapshot(),
        memory: {
          text: live.store.readMemory(live.bot.id),
          shared: live.store.readSharedFacts(),
          logs: live.store.recentDailyLogs(live.bot.id, 3),
          injected: live.store.renderMemory(live.bot.id),
          bytes: live.store.memoryBytes(live.bot.id),
        },
      };
    },

    async 'memory.write'(payload) {
      const live = requireBot(payload);
      if (typeof payload?.text !== 'string') throw new DomainError('invalid_input', 'memory text is required');
      live.store.writeMemory(live.bot.id, payload.text);
      changed('memory', { botId: live.bot.id });
      return ok();
    },

    async 'memory.append'(payload) {
      const live = requireBot(payload);
      const entry = String(payload?.entry ?? '').trim();
      if (entry === '') throw new DomainError('invalid_input', 'memory entry is required');
      const dateKey = localDateKey();
      if (payload?.shared === true) {
        live.store.writeSharedFacts(appendMemoryEntry(live.store.readSharedFacts(), entry, dateKey));
      } else {
        live.store.writeMemory(live.bot.id, appendMemoryEntry(live.store.readMemory(live.bot.id), entry, dateKey));
      }
      changed('memory', { botId: live.bot.id });
      return ok();
    },

    async 'memory.forget'(payload) {
      const live = requireBot(payload);
      const query = String(payload?.query ?? '').trim();
      if (query === '') throw new DomainError('invalid_input', 'query is required');
      const result = forgetMemoryLines(live.store.readMemory(live.bot.id), query);
      live.store.writeMemory(live.bot.id, result.text);
      changed('memory', { botId: live.bot.id });
      return ok();
    },

    async 'shared.read'(payload) {
      const store = hub.resolveStore(payload ?? {});
      return { ok: true, snapshot: snapshot(), text: store.readSharedFacts() };
    },

    async 'shared.write'(payload) {
      const store = hub.resolveStore(payload ?? {});
      if (typeof payload?.text !== 'string') throw new DomainError('invalid_input', 'shared facts text is required');
      store.writeSharedFacts(payload.text);
      changed('memory', { workspacePath: store.path });
      return ok();
    },

    /* ------------------------------------------------------------- routines */

    async 'routine.create'(payload) {
      const live = requireBot(payload);
      const routine = normalizeRoutine({
        when: payload?.when,
        instruction: payload?.instruction,
        report: payload?.report ?? 'chat',
        groupId: payload?.groupId ?? null,
        enabled: payload?.enabled ?? true,
      });
      routine.nextAt = new Date(computeNextAt(routine.when, Date.now())).toISOString();
      live.store.updateBot(live.bot.id, { routines: [...live.bot.routines, routine] });
      schedulerRef.current?.requestReplan();
      changed('routine', { botId: live.bot.id, routineId: routine.id });
      return { ok: true, snapshot: snapshot(), routine };
    },

    async 'routine.update'(payload) {
      const live = requireBot(payload);
      const routineId = String(payload?.routineId ?? payload?.routine?.id ?? '');
      let found = false;
      const routines = live.bot.routines.map((routine) => {
        if (routine.id !== routineId) return routine;
        found = true;
        const merged = normalizeRoutine(
          {
            ...routine,
            when: payload?.when ?? routine.when,
            instruction: payload?.instruction ?? routine.instruction,
            report: payload?.report ?? routine.report,
            enabled: payload?.enabled ?? routine.enabled,
            groupId: payload?.groupId ?? routine.groupId,
          },
          routine.id,
        );
        if (merged.enabled) merged.nextAt = new Date(computeNextAt(merged.when, Date.now())).toISOString();
        return merged;
      });
      if (!found) throw new DomainError('unknown_routine', `unknown routine "${routineId}"`);
      live.store.updateBot(live.bot.id, { routines });
      schedulerRef.current?.requestReplan();
      changed('routine', { botId: live.bot.id, routineId });
      return ok();
    },

    async 'routine.delete'(payload) {
      const live = requireBot(payload);
      const routineId = String(payload?.routineId ?? '');
      const routines = live.bot.routines.filter((routine) => routine.id !== routineId);
      if (routines.length === live.bot.routines.length) throw new DomainError('unknown_routine', `unknown routine "${routineId}"`);
      live.store.updateBot(live.bot.id, { routines });
      schedulerRef.current?.requestReplan();
      changed('routine', { botId: live.bot.id, routineId });
      return ok();
    },

    async 'routine.run_now'(payload) {
      const live = requireBot(payload);
      const routineId = String(payload?.routineId ?? '');
      const scheduler = schedulerRef.current;
      if (scheduler === undefined) throw new DomainError('not_ready', 'the routine scheduler is not ready');
      const outcome = await scheduler.runNow(live.bot.id, routineId, live.store.path);
      return { ok: true, snapshot: snapshot(), outcome };
    },

    /* --------------------------------------------------------------- config */

    async 'config.update'(payload) {
      const store = hub.resolveStore(payload ?? {});
      const patch = payload?.patch ?? {};
      const allowed = {};
      for (const key of ['primaryBotId', 'defaultMode', 'maxRunsPerDay', 'maxRunsPerHour', 'quietHours', 'maxGroupMembers', 'showBotSessions']) {
        if (key in patch) allowed[key] = patch[key];
      }
      store.updateConfig(allowed);
      // The workspace field is labelled "每 Bot 每天唤醒上限": saving it must
      // actually raise/lower the budget of every Bot in this workspace, not
      // just sit as a ceiling that a lower per-Bot value silently undercuts.
      if (Number.isInteger(allowed.maxRunsPerDay) && allowed.maxRunsPerDay >= 0) {
        for (const bot of store.listBots()) {
          if (bot.autonomy?.maxRunsPerDay === allowed.maxRunsPerDay) continue;
          store.updateBot(bot.id, { autonomy: { ...bot.autonomy, maxRunsPerDay: allowed.maxRunsPerDay } });
        }
      }
      schedulerRef.current?.requestReplan();
      changed('config', { workspacePath: store.path });
      return ok();
    },

    /* ---------------------------------------------------------------- groups */

    async 'group.create'(payload) {
      const store = hub.resolveStore(payload ?? {});
      const group = store.saveGroup(payload ?? {});
      changed('group', { groupId: group.id });
      return { ok: true, snapshot: snapshot(), group };
    },

    async 'group.update'(payload) {
      const groupId = String(payload?.groupId ?? payload?.id ?? '');
      const owner = requireRoom(groupId, payload);
      const group = owner.store.saveGroup(payload ?? {}, owner.group);
      changed('group', { groupId });
      return { ok: true, snapshot: snapshot(), group };
    },

    async 'group.delete'(payload) {
      const groupId = String(payload?.groupId ?? payload?.id ?? '');
      const owner = requireRoom(groupId, payload);
      rooms?.stop(groupId, 'room deleted');
      owner.store.deleteGroup(groupId);
      changed('group', { groupId });
      return ok();
    },

    /* ----------------------------------------------------------------- rooms */

    async 'room.post'(payload) {
      if (rooms === undefined) throw new DomainError('not_ready', 'the room engine is not ready');
      const result = await rooms.post(payload ?? {});
      return { ...result, snapshot: snapshot() };
    },

    async 'room.stop'(payload) {
      if (rooms === undefined) throw new DomainError('not_ready', 'the room engine is not ready');
      const result = await rooms.stop(payload?.groupId, 'stopped by the user');
      return { ...result, snapshot: snapshot() };
    },

    async 'room.history'(payload) {
      const groupId = String(payload?.groupId ?? '');
      const owner = requireRoom(groupId, payload);
      const before = typeof payload?.before === 'string' ? payload.before : undefined;
      return { ok: true, snapshot: snapshot(), page: readRoomPage(owner.store, groupId, before, payload?.limit) };
    },
  };

  /**
   * Dispatch one action body.
   * @param {any} body `{action, payload}`.
   * @returns {Promise<object>} action result.
   */
  async function action(body) {
    if (body === null || typeof body !== 'object') return fail('bad_action', 'body must be a JSON object');
    const name = typeof body.action === 'string' ? body.action : '';
    const handler = handlers[name];
    if (handler === undefined) return fail('unsupported', `unknown action "${name}"`);
    return guard(() => handler(body.payload ?? {}));
  }

  return { action, handlers, snapshot };
}

/**
 * Read one page of a room transcript.
 * @param {object} store workspace store.
 * @param {string} groupId room id.
 * @param {string} [before] message id to page before.
 * @param {number} [limit] page size.
 * @returns {{messages: object[], hasMore: boolean}} page.
 */
export function readRoomPage(store, groupId, before, limit) {
  const size = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 60;
  const all = store.readRoom(groupId, 0);
  let end = all.length;
  if (typeof before === 'string' && before !== '') {
    const index = all.findIndex((message) => message.id === before);
    if (index >= 0) end = index;
  }
  const start = Math.max(0, end - size);
  return { messages: all.slice(start, end), hasMore: start > 0 };
}

/**
 * @param {string} text source.
 * @param {number} max bound.
 * @returns {string} clipped source.
 */
export function clipText(text, max) {
  return clip(text, max);
}
