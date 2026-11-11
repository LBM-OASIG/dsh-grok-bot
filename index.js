/**
 * dsh-grok-bot — host entry.
 *
 * Wiring order matters:
 *   1. load every registered workspace's bots (bot.json is the source of truth)
 *   2. build the Session binder + delivery engine
 *   3. register per-Agent prompt sections and `bot_*` tools for every Bot Session
 *   4. arm the host-level routine scheduler
 *   5. expose the Web panel routes
 */
import { BotStoreHub } from './host/store.js';
import { SessionBinder } from './host/sessions.js';
import { BotEngine } from './host/engine.js';
import { BotAgentRegistry } from './host/agents.js';
import { createMessaging } from './host/messaging.js';
import { RoutineScheduler } from './host/scheduler.js';
import { createActions, readRoomPage } from './host/actions.js';
import { RoomEngine } from './host/rooms.js';
import { installRoutes } from './host/routes.js';
import { presentSnapshot } from './host/present.js';
import { installBotPresets } from './host/presets.js';

export const name = 'dsh-grok-bot';
export const inject = ['agents', 'sessionController', 'tools', 'systemPrompt', 'workspaceRegistry', 'timer'];

/**
 * Log through the plugin logger, falling back silently during teardown.
 * @param {object} ctx host plugin context.
 * @returns {(level: string, message: string) => void} logger.
 */
function createLogger(ctx) {
  return (level, message) => {
    try {
      const method = typeof ctx.logger?.[level] === 'function' ? level : 'info';
      ctx.logger[method](message);
    } catch {
      // never break the plugin because logging failed
    }
  };
}

/**
 * Apply the host half of the plugin.
 * @param {object} ctx host plugin context.
 * @returns {Promise<() => void>} disposer.
 */
export async function apply(ctx) {
  const log = createLogger(ctx);
  const hub = new BotStoreHub(
    {
      workspaceRegistry: ctx.get('workspaceRegistry', false),
      workingDirectory: ctx.get('workingDirectory', false),
    },
    log,
  );
  hub.refresh();

  /** Shared volatile runtime view (also handed to the engine's busy guard). */
  const runtime = {
    active: new Map(),
    hops: new Map(),
    errors: new Map(),
    rooms: new Map(),
  };

  /** @type {Set<(event: string, data: unknown) => void>} */
  const listeners = new Set();
  const emit = (event, data) => {
    for (const listener of listeners) {
      try {
        listener(event, data);
      } catch {
        // one broken SSE client must not affect the others
      }
    }
  };

  const binder = new SessionBinder(ctx, log);
  const engine = new BotEngine({ ctx, hub, binder, log, emit, active: runtime.active });
  const schedulerRef = { current: null };
  const roomsRef = { current: null };
  const messaging = createMessaging({ ctx, hub, engine, runtime, binder, log });
  const registry = new BotAgentRegistry({
    ctx,
    hub,
    engine,
    binder,
    runtime,
    log,
    emit,
    schedulerRef,
    roomsRef,
    sendBotMessage: messaging.sendBotMessage,
  });
  const rooms = new RoomEngine({ ctx, hub, binder, engine, runtime, log, emit });
  roomsRef.current = rooms;
  const scheduler = new RoutineScheduler({ ctx, hub, engine, binder, runtime, log, emit, rooms });
  schedulerRef.current = scheduler;
  const actions = createActions({
    ctx,
    hub,
    binder,
    engine,
    registry,
    runtime,
    log,
    emit,
    schedulerRef,
    rooms,
    sendBotMessage: messaging.sendBotMessage,
  });

  const snapshot = () => presentSnapshot({ hub, ctx, runtime });

  /**
   * Find the workspace store that owns one room id.
   * @param {string} groupId room id.
   * @returns {{store: object, group: object} | undefined} owner.
   */
  function findRoom(groupId) {
    for (const store of hub.list()) {
      const group = store.getGroup(groupId);
      if (group !== undefined) return { store, group };
    }
    return undefined;
  }

  const service = {
    snapshot: async () => snapshot(),
    action: async (body) => actions.action(body),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    room: async (groupId, before, limit) => {
      if (typeof groupId !== 'string' || groupId === '') throw new Error('room id is required');
      const found = findRoom(groupId);
      if (found === undefined) throw new Error(`unknown room "${groupId}"`);
      const page = readRoomPage(found.store, groupId, before, typeof limit === 'string' ? Number(limit) : limit);
      return {
        ok: true,
        group: found.group,
        messages: page.messages,
        hasMore: page.hasMore,
      };
    },
  };

  const disposeRoutes = ctx.effect(() => installRoutes(ctx, service), 'dsh-grok-bot: panel routes');
  const presetService = ctx.get('agentPresets', false);
  const disposePresets = presetService !== undefined && typeof presetService.register === 'function'
    ? await installBotPresets(presetService, log)
    : [];
  if (disposePresets.length === 0) {
    log('warn', 'dsh-grok-bot: agentPresets is unavailable; Bot Sessions cannot be created until a preset registry is composed');
  }
  registry.start();
  scheduler.start();

  const disposeRefresh = typeof ctx.interval === 'function'
    ? ctx.interval(() => {
        hub.refresh();
        scheduler.requestReplan();
      }, 60_000)
    : () => undefined;

  log(
    'info',
    `dsh-grok-bot started: ${hub.list().length} workspace(s), ${hub.list().reduce((sum, store) => sum + store.bots.size, 0)} bot(s), ${hub.list().reduce((sum, store) => sum + store.groups.size, 0)} room(s)`,
  );

  return async () => {
    try {
      disposeRoutes();
    } catch {
      /* already disposed */
    }
    try {
      disposeRefresh();
    } catch {
      /* already disposed */
    }
    registry.stop();
    scheduler.stop();
    rooms.dispose();
    for (const dispose of disposePresets) {
      try {
        await dispose();
      } catch {
        /* preset already gone after a reload */
      }
    }
    listeners.clear();
  };
}
