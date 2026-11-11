/**
 * dsh-grok-bot — host-level routine scheduler.
 *
 * Routines are stored on each Bot (`bot.json.routines`) and driven by one
 * host timer, independent of any Web page: the Electron main process keeps
 * running with the window closed, so a due routine still wakes its cold
 * Session. Gates: quiet hours, per-Bot daily/hourly budgets, a busy Session,
 * and three consecutive failures pausing the routine.
 */
import { computeNextAt, inQuietHours, nextOutsideQuietHours, runCounters } from './domain.js';
import { clip, localDateKey, localStamp, nowIso } from './util.js';

/** Jitter added to a planned fire time so many routines do not collide. */
const JITTER_MAX_MS = 60_000;
/** Minimum delay accepted between two fires of the same routine. */
const MIN_GAP_MS = 60_000;

export class RoutineScheduler {
  /**
   * @param {object} deps wiring.
   */
  constructor(deps) {
    this.ctx = deps.ctx;
    this.hub = deps.hub;
    this.engine = deps.engine;
    this.binder = deps.binder;
    this.runtime = deps.runtime;
    this.log = deps.log;
    this.emit = deps.emit;
    this.rooms = deps.rooms;
    this.timer = null;
    this.replanTimer = null;
    this.stopped = false;
  }

  /** Start scheduling every persisted routine. */
  start() {
    this.stopped = false;
    this.requestReplan();
  }

  /** Stop timers. */
  stop() {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.replanTimer !== null) clearTimeout(this.replanTimer);
    this.timer = null;
    this.replanTimer = null;
  }

  /** Ask for a debounced full replan. */
  requestReplan() {
    if (this.stopped) return;
    if (this.replanTimer !== null) clearTimeout(this.replanTimer);
    this.replanTimer = setTimeout(() => {
      this.replanTimer = null;
      this.replan();
    }, 400);
  }

  /** Recompute the next fire time for every enabled routine and arm one timer. */
  replan() {
    if (this.stopped) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const now = Date.now();
    let earliest = null;
    for (const store of this.hub.list()) {
      for (const bot of store.listBots()) {
        if (bot.autonomy?.routines === false) continue;
        for (const routine of bot.routines) {
          if (!routine.enabled) continue;
          let nextAt = routine.nextAt === null ? null : Date.parse(routine.nextAt);
          if (!Number.isFinite(nextAt) || nextAt < now) {
            nextAt = computeNextAt(routine.when, now) + jitter(routine.id);
            const iso = new Date(nextAt).toISOString();
            if (routine.nextAt !== iso) store.updateBot(bot.id, { routines: replaceRoutine(bot.routines, { ...routine, nextAt: iso }) });
          }
          if (earliest === null || nextAt < earliest.at) earliest = { at: nextAt, botId: bot.id, workspacePath: store.path, routineId: routine.id };
        }
      }
    }
    if (earliest === null) return;
    const delay = Math.max(0, earliest.at - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.fire(earliest).finally(() => this.requestReplan());
    }, delay);
    if (delay > 0) {
      const seconds = Math.round(delay / 1000);
      this.log('info', `dsh-grok-bot: next routine ${earliest.routineId} of bot ${earliest.botId} in ${seconds}s`);
    }
  }

  /**
   * Fire one planned routine.
   * @param {{botId: string, workspacePath: string, routineId: string}} entry plan entry.
   */
  async fire(entry) {
    const store = this.hub.byPath(entry.workspacePath);
    const live = store?.getBot(entry.botId);
    if (store === undefined || live === undefined) return;
    const routine = live.routines.find((item) => item.id === entry.routineId);
    if (routine === undefined || !routine.enabled) return;
    const now = Date.now();
    const dueAt = routine.nextAt === null ? now : Date.parse(routine.nextAt);
    if (Number.isFinite(dueAt) && dueAt > now + 5000) return;
    const config = store.config;
    const quietWindow = live.autonomy?.quietHours ?? config.quietHours ?? null;
    if (inQuietHours(now, quietWindow)) {
      const nextAt = new Date(nextOutsideQuietHours(computeNextAt(routine.when, now), quietWindow)).toISOString();
      store.updateBot(live.id, { routines: replaceRoutine(live.routines, { ...routine, nextAt }) });
      this.emit('bot.status', { botId: live.id, status: 'quiet', routineId: routine.id });
      return;
    }
    const outcome = await this.run(live, store, routine, { manual: false });
    this.emit('bot.status', { botId: live.id, status: outcome.outcome, routineId: routine.id });
  }

  /**
   * Run one routine immediately (manual runs bypass quiet hours).
   * @param {string} botId bot id.
   * @param {string} routineId routine id.
   * @returns {Promise<{ok: boolean, outcome: string, text: string}>} result.
   */
  async runNow(botId, routineId) {
    const found = this.hub.findById(botId);
    if (found === undefined) return { ok: false, outcome: 'error', text: 'this Bot no longer exists' };
    const routine = found.bot.routines.find((item) => item.id === routineId);
    if (routine === undefined) return { ok: false, outcome: 'error', text: `unknown routine "${routineId}"` };
    const outcome = await this.run(found.bot, found.store, routine, { manual: true });
    return { ok: outcome.outcome !== 'error', outcome: outcome.outcome, text: outcome.text };
  }

  /**
   * Execute one routine turn and persist its result.
   * @param {object} bot bot record.
   * @param {object} store workspace store.
   * @param {object} routine routine record.
   * @param {{manual: boolean}} options run options.
   * @returns {Promise<{outcome: string, text: string}>} outcome.
   */
  async run(bot, store, routine, options) {
    const sessionId = bot.sessionId;
    if (typeof sessionId !== 'string') {
      this.record(store, bot, routine, 'error', 'this Bot has no Session', options);
      return { outcome: 'error', text: 'no session' };
    }
    if (this.runtime.active.has(sessionId)) {
      this.record(store, bot, routine, 'skipped', 'the Bot was already running', options);
      this.advance(store, bot, routine);
      return { outcome: 'skipped', text: 'busy' };
    }
    if (!options.manual) {
      const counters = runCounters(store.readBotRuns(bot.id, 1000), localDateKey());
      const dailyCap = Math.min(
        Number.isInteger(bot.autonomy?.maxRunsPerDay) ? bot.autonomy.maxRunsPerDay : 12,
        Number.isInteger(store.config.maxRunsPerDay) && store.config.maxRunsPerDay > 0 ? store.config.maxRunsPerDay : 24,
      );
      if (counters.today >= dailyCap) {
        this.record(store, bot, routine, 'budget', `daily budget ${dailyCap} reached`, options);
        this.advance(store, bot, routine);
        return { outcome: 'budget', text: 'daily budget reached' };
      }
      const hourlyCap = Number.isInteger(store.config.maxRunsPerHour) && store.config.maxRunsPerHour > 0 ? store.config.maxRunsPerHour : 6;
      if (counters.hour >= hourlyCap) {
        this.record(store, bot, routine, 'budget', `hourly budget ${hourlyCap} reached`, options);
        this.advance(store, bot, routine);
        return { outcome: 'budget', text: 'hourly budget reached' };
      }
    }
    const text = [
      `[BOT ROUTINE] 现在是 ${localStamp()}。这是宿主定时唤醒，不是用户发言。`,
      `任务：${routine.instruction}`,
      routine.report === 'silent'
        ? '没有值得汇报的事就调用 bot_reclaim(reason) 作为唯一动作，不要输出文本。'
        : routine.report === 'room'
          ? '宿主会把本轮结果自动投到指定房间；不要在聊天里复述，也不要去找群聊工具。'
          : '做完用一两句话汇报结果；没有值得汇报的事就调用 bot_reclaim(reason) 静默收尾。',
    ].join('\n');
    const delivered = await this.engine.deliver({
      sessionId,
      text,
      notice: true,
      summary: `例行任务 ${routine.id}`,
      reason: 'routine',
      timeoutMs: 10 * 60 * 1000,
    });
    const reclaimed = delivered.reclaimed === true;
    let outcome;
    if (!delivered.ok) outcome = delivered.reason === 'timeout' ? 'timeout' : 'error';
    else if (reclaimed) outcome = 'silent';
    else outcome = 'ok';
    await this.record(store, bot, routine, outcome, delivered.error ?? delivered.text ?? '', options);
    this.persistResult(store, bot, routine, outcome, delivered);
    return { outcome, text: delivered.text ?? '' };
  }

  /**
   * Append one run row and keep the Bot's failure counter.
   * @param {object} store workspace store.
   * @param {object} bot bot record.
   * @param {object} routine routine record.
   * @param {string} outcome outcome tag.
   * @param {string} detail detail text.
   * @param {{manual: boolean}} options run options.
   */
  record(store, bot, routine, outcome, detail, options) {
    store.appendBotRun(bot.id, {
      id: `${routine.id}-${Date.now().toString(36)}`,
      routineId: routine.id,
      at: nowIso(),
      outcome,
      manual: options.manual === true,
      detail: typeof detail === 'string' ? detail.slice(0, 1000) : '',
    });
    // The daily log is what the Bot reads back on its next wake: one line per
    // routine outcome keeps long-running Bots oriented without extra tokens.
    const summary = typeof detail === 'string' && detail.trim() !== '' ? `: ${clip(detail, 200)}` : '';
    store.appendDailyLog(
      bot.id,
      `${localStamp()} 例行 ${routine.id} → ${outcome}${summary}`,
      localDateKey(),
    );
  }

  /**
   * Persist routine bookkeeping after a run and advance its next fire time.
   * @param {object} store workspace store.
   * @param {object} bot bot record.
   * @param {object} routine routine record.
   * @param {string} outcome outcome tag.
   * @param {object} delivered engine result.
   */
  persistResult(store, bot, routine, outcome, delivered) {
    const failures = outcome === 'error' || outcome === 'timeout' ? (routine.failures ?? 0) + 1 : 0;
    const pause = failures >= 3;
    const oneShot = routine.when.kind === 'after';
    const nextAt = pause || oneShot
      ? null
      : new Date(computeNextAt(routine.when, Date.now())).toISOString();
    const next = {
      ...routine,
      lastRunAt: nowIso(),
      lastOutcome: outcome,
      failures,
      enabled: pause || oneShot ? false : routine.enabled,
      pausedReason: pause ? '连续失败 3 次，已自动暂停' : routine.pausedReason,
      nextAt,
    };
    store.updateBot(bot.id, { routines: replaceRoutine(bot.routines, next) });
    if (outcome === 'error' || outcome === 'timeout') {
      this.runtime.errors.set(bot.id, String(delivered.error ?? outcome));
    } else {
      this.runtime.errors.delete(bot.id);
    }
    if (
      routine.report === 'room' &&
      typeof routine.groupId === 'string' &&
      routine.groupId !== '' &&
      typeof delivered.text === 'string' &&
      delivered.text.trim() !== '' &&
      delivered.reclaimed !== true &&
      this.rooms !== undefined
    ) {
      const posted = this.rooms.postBotMessage(routine.groupId, bot.id, delivered.text.trim());
      if (!posted) this.log('warn', `dsh-grok-bot: routine ${routine.id} could not post to room ${routine.groupId}`);
    }
    this.emit('changed', { reason: 'routine', botId: bot.id, routineId: routine.id });
  }

  /**
   * Move a skipped routine to its next occurrence.
   * @param {object} store workspace store.
   * @param {object} bot bot record.
   * @param {object} routine routine record.
   */
  advance(store, bot, routine) {
    if (routine.when.kind === 'after') {
      store.updateBot(bot.id, { routines: replaceRoutine(bot.routines, { ...routine, enabled: false, nextAt: null }) });
      return;
    }
    const nextAt = new Date(computeNextAt(routine.when, Date.now())).toISOString();
    store.updateBot(bot.id, { routines: replaceRoutine(bot.routines, { ...routine, nextAt }) });
  }
}

/**
 * Replace one routine in a list by id.
 * @param {object[]} routines routines.
 * @param {object} next replacement.
 * @returns {object[]} new list.
 */
function replaceRoutine(routines, next) {
  return routines.map((routine) => (routine.id === next.id ? next : routine));
}

/**
 * Deterministic-per-routine jitter in [0, 60s).
 * @param {string} id routine id.
 * @returns {number} milliseconds.
 */
function jitter(id) {
  let hash = 0;
  for (let i = 0; i < String(id).length; i += 1) hash = (hash * 31 + String(id).charCodeAt(i)) % 1000;
  return (hash % 60) * 1000 + Math.floor(Math.random() * 1000) * 0;
}

/**
 * Placeholder for the room engine dependency; kept explicit so the wiring can
 * grow without silently reinventing room reporting.
 * @param {object} _scheduler scheduler instance.
 * @returns {boolean} always false today.
 */
function depsRoomsAvailable(_scheduler) {
  return false;
}

/** Ensure MIN_GAP_MS is part of the contract even for after-kind routines. */
export const ROUTINE_MIN_GAP_MS = MIN_GAP_MS;
