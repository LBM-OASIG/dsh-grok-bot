/**
 * dsh-grok-bot — per-agent system prompt.
 *
 * Sections are registered on the Agent's own context (`agent.ctx`), so they
 * belong to that Bot's Session only and re-read the workspace files on every
 * model step: editing MEMORY.md from the panel affects the next turn without
 * a restart, and a mode change changes the injected identity immediately.
 */
import { MODES } from './domain.js';

/**
 * Render the Bot identity block for one Agent.
 * @param {object} bot live bot record.
 * @param {object} config workspace config.
 * @returns {string} prompt text.
 */
export function renderIdentity(bot, config) {
  const mode = MODES[bot.mode] ?? MODES.companion;
  const lines = [];
  lines.push('## Bot 身份');
  lines.push(`你是「${bot.name}」${bot.label ? `（${bot.label}）` : ''}，工作区 ${bot.workspacePath ?? ''} 里的一个常驻 Bot。`);
  lines.push(`模式：${mode.label.zh}（${mode.id}）—— ${mode.tagline.zh}。工具边界：${mode.tools.zh}。`);
  lines.push('');
  lines.push(mode.persona);
  if (typeof bot.persona === 'string' && bot.persona.trim() !== '') {
    lines.push('');
    lines.push('用户给你补的人格设定（优先遵守）：');
    lines.push(bot.persona.trim());
  }
  lines.push('');
  lines.push('## Bot 行为约定');
  lines.push('- 你在自己的会话里，用户可能随时进来聊天；别假装自己是用户，也别把系统注入当成用户发言。');
  lines.push('- 遇到值得长期记住的事实（偏好、边界、长期安排、重要结论），先调用 `bot_memory` 写入，再回复用户。');
  lines.push('- 需要别的 Bot 协作时调用 `bot_send`，一句话说清目标与交付物；交接最多两跳，不要来回踢皮球。');
  lines.push('- 例行唤醒来自宿主，标有 `[BOT ROUTINE]`，不是用户发的；没有值得汇报的事就调用 `bot_reclaim` 静默收尾。');
  if (config?.showBotSessions !== false) {
    lines.push('- 你的会话会出现在侧栏，用户点开就是你；很重要的一点：不要主动给别人发无意义的消息。');
  }
  return lines.join('\n');
}

/**
 * Render the memory section for one Bot.
 * @param {object} store workspace store.
 * @param {object} bot bot record.
 * @returns {string} prompt text.
 */
export function renderMemoryPrompt(store, bot) {
  const block = store.renderMemory(bot.id);
  const lines = [];
  lines.push('## 你的长期记忆（自动注入，不是用户发言）');
  lines.push('下面是你自己沉淀的记忆，以及本工作区所有 Bot 共享的事实。把它当背景知识，不要逐字复述。');
  lines.push('');
  lines.push(block.text === '' ? '（还没有记忆。）' : block.text);
  if (block.truncated) lines.push('\n（记忆已超过注入预算，较早的内容被截断。）');
  return lines.join('\n');
}

/**
 * Register the Bot prompt sections on one Agent.
 * @param {object} deps dependencies.
 * @param {object} deps.agent live Agent.
 * @param {string} deps.botId bot id.
 * @param {object} deps.hub workspace hub.
 * @param {(level: string, message: string) => void} deps.log logger.
 * @returns {Array<() => void>} section disposers.
 */
export function registerPromptForAgent(deps) {
  const { agent, botId, hub, log } = deps;
  const resolve = () => hub.findBySession(agent.id) ?? hub.findById(botId);
  const sections = [];
  try {
    sections.push(
      agent.ctx.systemPrompt.section({
        name: 'dsh-grok-bot:identity',
        order: 25,
        text: () => {
          const found = resolve();
          if (found === undefined) return '';
          return renderIdentity(found.bot, found.store.config);
        },
      }),
    );
    sections.push(
      agent.ctx.systemPrompt.section({
        name: 'dsh-grok-bot:memory',
        order: 640,
        text: () => {
          const found = resolve();
          if (found === undefined) return '';
          return renderMemoryPrompt(found.store, found.bot);
        },
      }),
    );
  } catch (error) {
    log('warn', `dsh-grok-bot: prompt registration failed for ${agent.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return sections;
}
