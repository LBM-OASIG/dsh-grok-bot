/**
 * dsh-grok-bot — one delivery primitive shared by routines, bot_send, room
 * turns and the panel's own "send message" action.
 *
 * The engine drives a real DSH Agent: resume the Session, queue one framed
 * user message, wait for the turn to settle, then read the assistant output
 * the host recorded after the delivery point. Nothing here invents a private
 * transport: delivery is the Agent's own inbox, and persistence is the
 * Session log.
 */
import { randomUUID } from 'node:crypto';
import { clip } from './util.js';

/** Producer-owned message source kind written by this plugin. */
export const SOURCE_KIND = 'plugin:dsh-grok-bot';

/**
 * Build one user-role message for an Agent inbox.
 * @param {string} text body text.
 * @param {{notice?: boolean, summary?: string}} [options] notice form renders as a context chip.
 * @returns {object} immutable-enough message value.
 */
export function buildUserMessage(text, options = {}) {
  const notice = options.notice === true;
  const source = notice
    ? { kind: SOURCE_KIND, form: 'notice', summary: clip(options.summary ?? text, 119) }
    : { kind: SOURCE_KIND };
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: String(text) }],
    source,
  };
}

/**
 * Pull assistant text out of the host's bounded output window.
 * @param {{records?: any[]}} output wait output.
 * @returns {{text: string, tools: number, messages: number}} extracted summary.
 */
export function extractAssistant(output) {
  const records = Array.isArray(output?.records) ? output.records : [];
  const texts = [];
  let tools = 0;
  let messages = 0;
  for (const record of records) {
    const event = record?.type === 'event' ? record.event : record;
    if (event === null || typeof event !== 'object') continue;
    if (event.type === 'tool/call') tools += 1;
    if (event.type !== 'assistant/message') continue;
    const content = event.data?.message?.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((part) => part !== null && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
      .trim();
    if (text !== '') {
      texts.push(text);
      messages += 1;
    }
  }
  return { text: texts.join('\n\n').trim(), tools, messages };
}

/** Default seconds a single delivery may take before it is marked timed out. */
export const DEFAULT_DELIVERY_TIMEOUT_MS = 300_000;

export class BotEngine {
  /**
   * @param {{ctx: object, hub: object, binder: object, log: Function, emit: Function, active: Map<string, object>}} deps
   *   host services plus the shared runtime table.
   */
  constructor(deps) {
    this.ctx = deps.ctx;
    this.hub = deps.hub;
    this.binder = deps.binder;
    this.log = deps.log;
    this.emit = deps.emit ?? (() => undefined);
    /** @type {Map<string, object>} per-session active delivery marker. */
    this.active = deps.active ?? new Map();
  }

  /**
   * Deliver one message to a Session and wait for its turn to settle.
   * @param {object} request delivery request.
   * @param {string} request.sessionId target session.
   * @param {string} request.text message body.
   * @param {boolean} [request.notice] render as a notice chip instead of a user bubble.
   * @param {string} [request.summary] short notice summary.
   * @param {number} [request.timeoutMs] delivery timeout.
   * @param {string} [request.reason] internal reason tag (`routine`, `message`, `room`).
   * @returns {Promise<{ok: boolean, reason: string, text: string, tools: number, error?: string}>} outcome.
   */
  async deliver(request) {
    const sessionId = request.sessionId;
    if (typeof sessionId !== 'string' || sessionId === '') {
      return { ok: false, reason: 'invalid', text: '', tools: 0, error: 'session id is required' };
    }
    if (this.active.has(sessionId)) {
      return { ok: false, reason: 'busy', text: '', tools: 0, error: 'this Bot is already running a delivery' };
    }
    const marker = { reason: request.reason ?? 'delivery', startedAt: Date.now() };
    this.active.set(sessionId, marker);
    try {
      const agent = await this.binder.ensureAgent(sessionId);
      const before = await this.binder.state(sessionId);
      const afterSeq = Number.isInteger(before?.cursor) ? before.cursor : -1;
      const message = buildUserMessage(request.text, {
        notice: request.notice === true,
        summary: request.summary ?? request.text,
      });
      try {
        agent.followup(message);
      } catch (error) {
        return { ok: false, reason: 'rejected', text: '', tools: 0, error: describe(error) };
      }
      const timeoutMs = Number.isInteger(request.timeoutMs) && request.timeoutMs > 0
        ? Math.min(request.timeoutMs, 15 * 60 * 1000)
        : DEFAULT_DELIVERY_TIMEOUT_MS;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs + 30_000);
      try {
        const waited = await this.ctx.sessionController.wait(
          { sessionId, afterSeq, timeoutMs, maxMessages: 200 },
          controller.signal,
        );
        const assistant = extractAssistant(waited.output);
        return {
          ok: true,
          reason: String(waited.reason ?? 'idle'),
          text: assistant.text,
          tools: assistant.tools,
          reclaimed: marker.reclaimed === true,
          reclaimReason: marker.reclaimReason ?? null,
        };
      } catch (error) {
        const code = typeof error?.code === 'string' ? error.code : '';
        if (code === 'session/wait-timeout' || controller.signal.aborted) {
          return { ok: false, reason: 'timeout', text: '', tools: 0, error: 'the turn did not settle before the timeout' };
        }
        return { ok: false, reason: 'error', text: '', tools: 0, error: describe(error) };
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code : 'error';
      return { ok: false, reason: code === 'session/not-found' ? 'missing' : 'error', text: '', tools: 0, error: describe(error) };
    } finally {
      this.active.delete(sessionId);
    }
  }

  /**
   * Deliver one Bot-to-Bot or Bot-to-Session message.
   * @param {string} sessionId target session.
   * @param {string} fromName sender display name.
   * @param {string} text message body.
   * @param {object} [options] delivery options.
   * @returns {Promise<object>} outcome.
   */
  async deliverBotMessage(sessionId, fromName, text, options = {}) {
    const body = `Bot message from ${fromName}: ${String(text).trim()}`;
    return this.deliver({
      sessionId,
      text: body,
      notice: options.notice === true,
      summary: options.summary ?? `Bot message from ${fromName}`,
      timeoutMs: options.timeoutMs,
      reason: options.reason ?? 'message',
    });
  }

  /**
   * @param {string} sessionId session id.
   * @returns {boolean} whether a delivery is running for it.
   */
  isBusy(sessionId) {
    return this.active.has(sessionId);
  }
}

/**
 * @param {unknown} error any thrown value.
 * @returns {string} its message.
 */
function describe(error) {
  return error instanceof Error ? error.message : String(error);
}
