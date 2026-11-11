/**
 * dsh-grok-bot — Bot-to-Bot / Bot-to-Session messaging.
 *
 * Deliveries go through the same engine primitive as everything else: resume
 * the target Session, queue a user-role message that names the sender, wait
 * for it to settle. The hop counter rides in memory (one delivery per Bot at
 * a time), so a chain A→B→C is allowed while A→B→C→D is refused.
 */

/**
 * Create the messaging helper.
 * @param {{ctx: object, hub: object, engine: object, runtime: object, binder: object, log: Function}} deps wiring.
 * @returns {{sendBotMessage: Function}} helper.
 */
export function createMessaging(deps) {
  const { ctx, hub, engine, runtime, binder, log } = deps;
  /** @type {Map<string, number[]>} */
  const rate = new Map();

  /**
   * Record one outgoing message and enforce the per-Bot minute budget.
   * @param {string} botId sender bot id.
   * @returns {boolean} whether the message may be sent.
   */
  function takeRate(botId) {
    const now = Date.now();
    const stamps = (rate.get(botId) ?? []).filter((at) => now - at < 60_000);
    if (stamps.length >= 10) {
      rate.set(botId, stamps);
      return false;
    }
    stamps.push(now);
    rate.set(botId, stamps);
    return true;
  }

  /**
   * Send one message from a Bot to another Bot or Session in the same workspace.
   * @param {{store: object, bot: object}} live sender owner.
   * @param {string} target Bot id, Bot name or exact Session id.
   * @param {string} text message body.
   * @param {number} hop hand-off depth of this message.
   * @returns {Promise<{ok: boolean, text: string}>} outcome.
   */
  async function sendBotMessage(live, target, text, hop) {
    const store = live.store;
    const sender = live.bot;
    const bots = [...store.bots.values()];
    const targetBot =
      bots.find((bot) => bot.id === target) ??
      bots.find((bot) => String(bot.name).toLowerCase() === target.toLowerCase()) ??
      bots.find((bot) => bot.sessionId === target);
    if (targetBot !== undefined) {
      if (targetBot.id === sender.id) return { ok: false, text: '不能给自己发消息。' };
      if (typeof targetBot.sessionId !== 'string') return { ok: false, text: `${targetBot.name} 还没有会话，先打开一次它的聊天。` };
      if (!takeRate(sender.id)) return { ok: false, text: '发送太频繁：每个 Bot 每分钟最多 10 条。' };
      runtime.hops.set(targetBot.sessionId, hop);
      const outcome = await engine.deliverBotMessage(targetBot.sessionId, sender.name, text, {
        reason: 'message',
      });
      runtime.hops.delete(targetBot.sessionId);
      if (!outcome.ok) {
        runtime.errors.set(targetBot.id, String(outcome.error ?? outcome.reason));
        return { ok: false, text: `投递失败：${outcome.error ?? outcome.reason}` };
      }
      runtime.errors.delete(targetBot.id);
      const replied = replyText(outcome.text);
      const reply = replied === '' ? '' : `，对方回复：${replied}`;
      return { ok: true, text: `已送达「${targetBot.name}」${reply}` };
    }

    const sessions = await listSessions(ctx);
    let hit = sessions.find((session) => String(session.sessionId) === target && sameDirectory(session.cwd, store.path));
    if (hit === undefined) {
      // A freshly forked Session can be absent from the visible list until it is
      // opened once, even though its log already lives in this workspace. A
      // Session that is already live is addressable by definition; resolving it
      // again can report "unavailable" while the GUI holds it, so check the live
      // registry first and only fall back to resolveAgent for a cold Session.
      const liveAgent = ctx.agents?.get?.(target)
        ?? ctx.agents?.list?.().find((candidate) => String(candidate.id) === target);
      if (liveAgent !== undefined && liveAgent !== null) {
        const liveCwd = typeof liveAgent.cwd === 'string' ? liveAgent.cwd : undefined;
        if (liveCwd !== undefined && !sameDirectory(liveCwd, store.path)) {
          return { ok: false, text: `找不到目标「${target}」：它在另一个工作区（${liveCwd}）。` };
        }
        hit = { sessionId: target };
      } else {
        const probe = await resolveSession(ctx, target);
        if (probe.agent === null) {
          return {
            ok: false,
            text: `找不到目标「${target}」：既不是这个工作区的 Bot，也不是这个工作区的普通会话（${probe.error}）。`,
          };
        }
        const cwd = typeof probe.agent.cwd === 'string' ? probe.agent.cwd : undefined;
        if (cwd !== undefined && !sameDirectory(cwd, store.path)) {
          return { ok: false, text: `找不到目标「${target}」：它在另一个工作区（${cwd}）。` };
        }
        const known = await listSessions(ctx);
        hit = known.find((session) => String(session.sessionId) === target);
        if (hit === undefined) hit = { sessionId: target };
      }
    }
    if (!takeRate(sender.id)) return { ok: false, text: '发送太频繁：每个 Bot 每分钟最多 10 条。' };
    const outcome = await engine.deliverBotMessage(target, sender.name, text, { reason: 'message' });
    if (!outcome.ok) return { ok: false, text: `投递失败：${outcome.error ?? outcome.reason}` };
    return { ok: true, text: `已送达会话 ${target}` };
  }

  return { sendBotMessage };
}

/**
 * List visible sessions without resuming any Agent.
 * @param {object} ctx host context.
 * @returns {Promise<object[]>} session summaries.
 */
async function listSessions(ctx) {
  try {
    const page = await ctx.sessionController.list({}, new AbortController().signal);
    return Array.isArray(page?.items) ? page.items : [];
  } catch (error) {
    return [];
  }
}

/**
 * Resolve one Session's Agent and report the stable failure code when it cannot
 * be resolved (for example `session/writer-held` while another window owns it).
 * @param {object} ctx host context.
 * @param {string} sessionId target Session id.
 * @returns {Promise<{agent: object|null, error: string}>} the Agent and failure.
 */
async function resolveSession(ctx, sessionId) {
  try {
    const result = await ctx.sessionController.resolveAgent(sessionId);
    if (result === null || typeof result !== 'object') return { agent: null, error: 'no-result' };
    if (result.error !== undefined) {
      const code = typeof result.error?.code === 'string' ? result.error.code : 'unknown';
      return { agent: null, error: code };
    }
    const agent = result.agent;
    if (agent === null || typeof agent !== 'object') return { agent: null, error: 'no-agent' };
    return { agent, error: '' };
  } catch (error) {
    return { agent: null, error: error instanceof Error ? error.message : 'throw' };
  }
}

/**
 * Compare two directory spellings.
 * @param {string | undefined} a path.
 * @param {string | undefined} b path.
 * @returns {boolean} equality.
 */
function sameDirectory(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return normalizePath(a) === normalizePath(b);
}

/**
 * @param {string} path directory path.
 * @returns {string} comparison spelling.
 */
function normalizePath(path) {
  return path.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
}

/**
 * @param {string} text assistant reply.
 * @returns {string} the full reply, trimmed.
 */
function replyText(text) {
  return text.trim();
}
