/**
 * dsh-grok-bot — Session binding for Bots.
 *
 * A Bot owns exactly one ordinary DSH Session. The plugin never copies chat
 * history: it creates the Session through the host controller, resumes it by
 * id, renames it, and archives it when the Bot is deleted. A Session that
 * cannot be resumed is reported as `missing` instead of being silently
 * replaced, so a user keeps the chance to decide.
 */

/** The single Bot preset id: the mode is enforced by tool guards, not by composition. */
export const BOT_PRESET_ID = 'grok-bot-agent';

/** @returns {string} the preset id every Bot Session runs. */
export function presetForMode() {
  return BOT_PRESET_ID;
}

export class SessionBinder {
  /**
   * @param {object} ctx host plugin context.
   * @param {(level: string, message: string) => void} log logger.
   */
  constructor(ctx, log) {
    this.ctx = ctx;
    this.log = log;
  }

  /**
   * Create one Bot Session in its workspace.
   * @param {object} store workspace store.
   * @param {object} bot bot record.
   * @returns {Promise<string>} the new session id.
   */
  async createBotSession(store, bot) {
    return this.createSession(store, { agentPreset: presetForMode(bot.mode) });
  }

  /**
   * Create one ordinary Session in a workspace without touching any Bot binding.
   * @param {object} store workspace store.
   * @param {{agentPreset?: string}} [options] optional preset override; omitted
   *   means the host default preset, i.e. an ordinary agent, not a Bot.
   * @returns {Promise<string>} the new session id.
   */
  async createSession(store, options = {}) {
    const request = {};
    if (typeof store.id === 'string' && store.id !== '') request.workspaceId = store.id;
    else request.cwd = store.path;
    if (typeof options.agentPreset === 'string' && options.agentPreset !== '') {
      request.agentPreset = options.agentPreset;
    }
    const created = await this.ctx.sessionController.create(request);
    if (created === null || typeof created !== 'object' || typeof created.sessionId !== 'string') {
      throw new Error('sessionController.create returned no session id');
    }
    return created.sessionId;
  }

  /**
   * Rename one Session to the Bot title.
   * @param {string} sessionId session id.
   * @param {string} title display title.
   */
  async rename(sessionId, title) {
    try {
      await this.ctx.sessionController.rename({ sessionId, title });
    } catch (error) {
      this.log('warn', `dsh-grok-bot: could not rename session ${sessionId}: ${describe(error)}`);
    }
  }

  /**
   * Resolve or resume one Session's Agent.
   * @param {string} sessionId session id.
   * @returns {Promise<object>} the live Agent.
   */
  async ensureAgent(sessionId) {
    const found = await this.ctx.sessionController.resolveAgent(sessionId);
    if (found !== null && typeof found === 'object' && found.error !== undefined) {
      const error = new Error(`session ${sessionId} is unavailable: ${found.error.message ?? found.error.code ?? 'unknown'}`);
      error.code = found.error.code ?? 'session/not-found';
      throw error;
    }
    const agent = found?.agent ?? this.ctx.agents.get(sessionId);
    if (agent === undefined) throw Object.assign(new Error(`session ${sessionId} could not be resumed`), { code: 'session/not-found' });
    return agent;
  }

  /**
   * Cancel one running turn without dropping queued input.
   * @param {string} sessionId session id.
   */
  async cancel(sessionId) {
    try {
      await this.ctx.sessionController.cancel({ sessionId });
    } catch (error) {
      this.log('warn', `dsh-grok-bot: cancel failed for ${sessionId}: ${describe(error)}`);
    }
  }

  /**
   * Archive one Session (used when a Bot is deleted).
   * @param {string} sessionId session id.
   */
  async archive(sessionId) {
    try {
      await this.ctx.workspaceRegistry?.archiveSession(sessionId, { stopActivity: true });
    } catch (error) {
      this.log('warn', `dsh-grok-bot: could not archive session ${sessionId}: ${describe(error)}`);
    }
  }

  /**
   * Read one Session's passive state, treating absence as undefined.
   * @param {string} sessionId session id.
   * @returns {Promise<object | undefined>} the state.
   */
  async state(sessionId) {
    try {
      return await this.ctx.sessionController.state({ sessionId }, new AbortController().signal);
    } catch {
      return undefined;
    }
  }

  /**
   * Test whether a Session currently has a live Agent.
   * @param {string} sessionId session id.
   * @returns {boolean} liveness.
   */
  isLive(sessionId) {
    return this.ctx.agents.get(sessionId) !== undefined;
  }

  /**
   * Switch one live Agent onto the preset of its mode.
   * @param {object} agent live Agent.
   * @param {string} mode bot mode.
   */
  async selectPreset(agent, mode) {
    const presets = this.ctx.get('agentPresets', false);
    if (presets === undefined || typeof presets.select !== 'function') {
      this.log('warn', 'dsh-grok-bot: agentPresets is unavailable; mode change keeps the current tool composition');
      return;
    }
    try {
      if (typeof agent.whenIdle === 'function') await agent.whenIdle();
    } catch {
      /* best effort */
    }
    try {
      await presets.select(agent, presetForMode(mode));
    } catch (error) {
      this.log('warn', `dsh-grok-bot: preset switch failed for ${agent.id}: ${describe(error)}`);
    }
  }
}

/**
 * @param {unknown} error any thrown value.
 * @returns {string} its message.
 */
function describe(error) {
  return error instanceof Error ? error.message : String(error);
}
