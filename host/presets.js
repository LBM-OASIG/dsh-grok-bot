/**
 * dsh-grok-bot — the Bot agent preset, registered at runtime.
 *
 * Why one preset instead of one per mode: the preset registry locks a Session's
 * composition once its first turn has started (`agent-preset/locked`), so a
 * mode switch on a session that already chatted could never swap tool rows.
 * The full tool catalog is therefore composed once, and the Bot's mode is
 * enforced by an execution guard registered on the Agent scope (see
 * `host/tools.js`): it reads the live `bot.json` on every call, so switching
 * companion → operator → scout takes effect on the next tool call in both
 * directions.
 *
 * Registered through `ctx.agentPresets.register()` rather than a bundle patch
 * so a plugin reload picks it up without restarting the host.
 */

/** Rows shared by the Bot preset: persona, instructions, time, files, shell, web, skills, todo. */
function botRows() {
  const rows = [
    {
      id: 'persona',
      name: '@deepseek-ai/dsh-persona',
      config: {
        prefix:
          'You are a resident Bot inside DeepSeek Harness. Follow the Bot identity and memory sections this plugin injects; they define who you are.',
      },
    },
    { id: 'agent-instructions', name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } },
    { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
    {
      id: 'tool-fs',
      name: '@deepseek-ai/dsh-tool-fs',
      config: { applyPatch: false },
    },
    {
      id: 'tool-fs-search',
      name: '@deepseek-ai/dsh-tool-fs-search',
      config: { sampleOverCapGlobResults: false },
    },
    { id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', config: { fetch: true, searchTimeoutMs: 60000 } },
    { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem' },
    { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
    { id: 'tool-todo', name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true } },
  ];
  if (process.platform === 'win32') rows.push({ id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh' });
  else rows.push({ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' });
  return rows;
}

/**
 * Build the Bot preset definition for the current platform.
 * @returns {{id: string, name: string, description: string, order: number, plugins: object[]}} definition.
 */
export function botPresetDefinition() {
  return {
    id: 'grok-bot-agent',
    name: 'Bot · Agent',
    description: 'A resident workspace Bot. The plugin adds identity, memory and bot_* tools, and enforces the Bot mode on every tool call.',
    order: 10,
    plugins: botRows(),
  };
}

/**
 * Register the Bot preset on the host registry.
 *
 * A host-row reload in the same process can leave an earlier registration
 * behind (a row that failed after registering never runs its disposer). The
 * id belongs to this plugin alone, so a stale record is dropped before
 * re-registering; on a fresh process this is a no-op.
 * @param {object} presets host `ctx.agentPresets` service.
 * @param {(level: string, message: string) => void} log logger.
 * @returns {Promise<Array<() => Promise<void> | void>>} unregister disposers.
 */
export async function installBotPresets(presets, log) {
  const definition = botPresetDefinition();
  const entries = presets.definitions;
  if (entries !== undefined && entries !== null && typeof entries.delete === 'function') {
    if (typeof entries.has === 'function' && entries.has(definition.id)) {
      entries.delete(definition.id);
      log('warn', `dsh-grok-bot: reclaimed a stale preset registration ${definition.id} from a previous plugin load`);
    }
  }
  const disposers = [];
  try {
    const unregister = await presets.register(definition);
    disposers.push(unregister);
  } catch (error) {
    log('warn', `dsh-grok-bot: preset ${definition.id} was not registered: ${error instanceof Error ? error.message : String(error)}`);
  }
  return disposers;
}
