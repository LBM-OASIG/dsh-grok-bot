/**
 * dsh-grok-bot — the snapshot the Web panel renders.
 *
 * The persistence hub owns the durable part; this module adds the volatile
 * runtime view (dormant / busy / idle / error), the per-Bot usage counters read
 * from `runs.jsonl`, and the session→bot map used by the sidebar avatar seat.
 */
import { localDateKey } from './util.js';
import { runCounters } from './domain.js';

/**
 * Summarize a Bot's routine runs for the panel.
 * @param {object} store workspace store.
 * @param {string} botId bot id.
 * @returns {{total: number, today: number, lastAt: string|null, lastOutcome: string|null, failures: number}} usage.
 */
export function botUsage(store, botId) {
  const runs = store.readBotRuns(botId, 500);
  const today = localDateKey();
  const counters = runCounters(runs, today);
  let lastAt = null;
  let lastOutcome = null;
  for (const run of runs) {
    if (typeof run?.at === 'string') lastAt = run.at;
    if (typeof run?.outcome === 'string') lastOutcome = run.outcome;
  }
  let failures = 0;
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    if (runs[index].outcome === 'error' || runs[index].outcome === 'timeout') failures += 1;
    else break;
  }
  return { total: runs.length, today: counters.today, lastAt, lastOutcome, failures };
}

/**
 * Build the full panel snapshot.
 * @param {{hub: object, ctx: object, runtime: object}} deps snapshot sources.
 * @returns {object} snapshot.
 */
export function presentSnapshot(deps) {
  const { hub, ctx, runtime } = deps;
  const state = hub.state();
  const bots = state.bots.map((bot) => {
    const agent = typeof bot.sessionId === 'string' ? ctx.agents.get(bot.sessionId) : undefined;
    let runtimeState = 'dormant';
    if (bot.sessionId === null) runtimeState = 'missing';
    else if (agent !== undefined) runtimeState = agent.status === 'running' ? 'busy' : 'idle';
    if (runtime.active.has(bot.sessionId)) runtimeState = 'busy';
    const errorText = runtime.errors.get(bot.id);
    const store = hub.byPath(bot.workspacePath);
    return {
      ...bot,
      runtimeState,
      errorText: typeof errorText === 'string' ? errorText : null,
      live: agent !== undefined,
      usage: store === undefined ? { total: 0, today: 0, lastAt: null, lastOutcome: null, failures: 0 } : botUsage(store, bot.id),
      nextRoutineAt: nextRoutineAt(bot),
    };
  });
  const groups = state.groups.map((group) => ({
    ...group,
    runtime: runtime.rooms.get(group.id) ?? { status: 'idle', roomTurnId: null, responders: [] },
  }));
  return { ...state, bots, groups, active: [...runtime.active.keys()] };
}

/**
 * Next enabled routine fire time of one Bot.
 * @param {object} bot bot record.
 * @returns {string|null} ISO time.
 */
function nextRoutineAt(bot) {
  let next = null;
  for (const routine of bot.routines ?? []) {
    if (!routine.enabled || typeof routine.nextAt !== 'string') continue;
    if (next === null || routine.nextAt < next) next = routine.nextAt;
  }
  return next;
}
