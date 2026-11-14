/**
 * dsh-grok-bot — Agent registration.
 *
 * Every Agent that belongs to a Bot Session receives two things on its own
 * context: the Bot prompt sections (identity + memory, both re-read on every
 * model step) and the `bot_*` tool catalog for the Bot's mode. Registration is
 * idempotent per Agent object and can be refreshed when a mode changes.
 */
import { registerPromptForAgent } from './prompt.js';
import { registerBotTools } from './tools.js';

/** Tools a read-only Bot mode (companion / scout) may not execute. */
const DENIED_FOR_READ_ONLY = new Set([
  'pwsh',
  'bash',
  'write',
  'edit',
  'apply_patch',
  'terminal_open',
  'terminal_send',
  'terminal_signal',
  'create_worktree',
  'job_kill',
]);

export class BotAgentRegistry {
  /**
   * @param {object} deps dependencies.
   */
  constructor(deps) {
    this.ctx = deps.ctx;
    this.hub = deps.hub;
    this.engine = deps.engine;
    this.runtime = deps.runtime;
    this.log = deps.log;
    this.emit = deps.emit;
    this.binder = deps.binder;
    this.sendBotMessage = deps.sendBotMessage;
    this.schedulerRef = deps.schedulerRef;
    this.roomsRef = deps.roomsRef;
    /** @type {WeakMap<object, object>} */
    this.byAgent = new WeakMap();
    /** @type {Map<string, object>} */
    this.byBot = new Map();
  }

  /** Listen for Agents created by any path (user chat, resume, routine). */
  start() {
    this.dispose = this.ctx.on('agent/created', ({ agent }) => {
      if (agent !== undefined) this.register(agent);
      return undefined;
    });
    for (const agent of this.liveAgents()) this.register(agent);
  }

  /**
   * List live Agents across DSH versions.
   *
   * `ctx.agents.roots()` existed up to 0.2.2-rc.1 and was replaced by `list()`
   * in rc.2+; calling a missing method here used to fail the whole plugin load.
   * @returns {object[]} live agents.
   */
  liveAgents() {
    const agents = this.ctx.agents;
    if (agents === undefined || agents === null) return [];
    try {
      if (typeof agents.list === 'function') {
        const listed = agents.list();
        if (Array.isArray(listed)) return listed.filter((agent) => agent !== undefined && agent !== null);
      }
      if (typeof agents.roots === 'function') {
        const roots = agents.roots();
        if (roots !== undefined && roots !== null) return [...roots];
      }
    } catch (error) {
      this.log('warn', `dsh-grok-bot: could not enumerate live Agents: ${error instanceof Error ? error.message : String(error)}`);
    }
    return [];
  }

  /** Release everything one Bot registration installed on its Agent. */
  release(record) {
    for (const dispose of [
      ...(record.promptDisposers ?? []),
      ...(record.toolDisposers ?? []),
      record.guardDisposer,
    ].filter(Boolean)) {
      try {
        dispose();
      } catch {
        /* a disposed agent scope is already gone */
      }
    }
  }

  /** @returns {() => void} teardown. */
  stop() {
    if (typeof this.dispose === 'function') this.dispose();
    // Do not dispose the Agent-scoped tools here: a reload may load the new
    // plugin before the old instance tears down, and the old disposers delete
    // a same-name entry without checking ownership — that is how bot_send
    // vanished after a hot reload. The next load adopts/replaces the retained
    // registration instead.
    this.byBot.clear();
  }

  /**
   * Register one Agent when it belongs to a Bot Session.
   * @param {object} agent live Agent.
   */
  register(agent) {
    if (agent === undefined || typeof agent.id !== 'string') return;
    if (this.byAgent.has(agent)) return;
    const live = this.hub.findBySession(agent.id);
    if (live === undefined) return;
    this.byAgent.set(agent, agent.id);
    const promptDisposers = registerPromptForAgent({
      agent,
      botId: live.bot.id,
      hub: this.hub,
      log: this.log,
    });
    const toolDisposers = this.registerTools(agent, live.bot.id);
    const guardDisposer = this.registerModeGuard(agent, live.bot.id);
    this.byBot.set(agent.id, {
      agent,
      botId: live.bot.id,
      workspacePath: live.store.path,
      promptDisposers,
      toolDisposers,
      toolErrors: toolDisposers.errors ?? [],
      guardDisposer,
    });
    this.log('info', `dsh-grok-bot: registered agent ${agent.id} for bot ${live.bot.id} (${live.bot.mode})`);
  }

  /**
   * Deny mutating/shell tools for the read-only modes.
   *
   * Preset composition is locked once a Session starts, so a mode switch
   * cannot swap tool rows. A guard registered on the Agent scope is evaluated
   * on every call and reads the live bot record, which makes companion/scout
   * read-only immediately and makes a later upgrade to operator/chief work
   * without rebuilding the Session.
   * @param {object} agent live Agent.
   * @param {string} botId bot id.
   * @returns {(() => void) | undefined} guard disposer.
   */
  registerModeGuard(agent, botId) {
    try {
      return agent.ctx.tools.guard((execution) => {
        const live = this.hub.findBySession(agent.id);
        if (live === undefined) return undefined;
        const mode = live.bot.mode;
        if (mode === 'operator' || mode === 'chief') return undefined;
        const name = String(execution?.name ?? '');
        if (!DENIED_FOR_READ_ONLY.has(name)) return undefined;
        const label = mode === 'scout' ? '侦察' : '陪伴';
        return `「${live.bot.name}」当前是${label}模式（${mode}），不能使用 ${name}；需要动手请把这个 Bot 切到 operator 或 chief，或者让 operator Bot 来做。`;
      });
    } catch (error) {
      this.log('warn', `dsh-grok-bot: mode guard registration failed for ${agent.id}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  /**
   * Register the mode-appropriate bot tools on one Agent.
   * @param {object} agent live Agent.
   * @param {string} botId bot id.
   * @returns {Array<() => void>} disposers.
   */
  registerTools(agent, botId) {
    return registerBotTools({
      agent,
      botId,
      hub: this.hub,
      engine: this.engine,
      binder: this.binder,
      runtime: this.runtime,
      log: this.log,
      emit: this.emit,
      schedulerRef: this.schedulerRef,
      roomsRef: this.roomsRef,
      sendBotMessage: this.sendBotMessage,
    });
  }

  /**
   * Rebuild the tool catalog after a mode change.
   * @param {string} sessionId Bot Session id (unique across workspaces).
   */
  refresh(sessionId) {
    const record = this.byBot.get(sessionId);
    if (record === undefined) return;
    for (const dispose of record.toolDisposers ?? []) {
      try {
        dispose();
      } catch {
        /* a disposed agent scope is already gone */
      }
    }
    record.toolDisposers = this.registerTools(record.agent, record.botId);
    record.toolErrors = record.toolDisposers.errors ?? [];
  }

  /**
   * Resolve and register the Agent of a Session right after a Bot is created,
   * so the first user message already runs with identity, memory and tools.
   * @param {string} sessionId session id.
   */
  async bootstrap(sessionId) {
    try {
      const agent = await this.ctx.sessionController.resolveAgent(sessionId);
      if (agent?.error !== undefined) {
        this.log('warn', `dsh-grok-bot: bootstrap could not resume ${sessionId}: ${agent.error.message ?? agent.error.code}`);
        return;
      }
      if (agent?.agent !== undefined) this.register(agent.agent);
    } catch (error) {
      this.log('warn', `dsh-grok-bot: bootstrap failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Lift the registrations of a deleted Bot from its live Agent.
   * @param {string} sessionId Bot Session id.
   */
  forget(sessionId) {
    const record = this.byBot.get(sessionId);
    if (record === undefined) return;
    this.release(record);
    this.byBot.delete(sessionId);
  }
}
