/**
 * dsh-grok-bot — the `bot_*` tools. They are registered on each Bot Agent's
 * own context, so they exist only for Bot Sessions and cannot be reached from
 * an ordinary user Session, a subagent or another Bot.
 *
 * Mode decides the catalog: every Bot can read/write its memory and end a
 * routine silently; only modes that may message others get `bot_send`, and
 * only modes with routines enabled get `bot_routine`.
 */
import {
  MODES,
  appendMemoryEntry,
  computeNextAt,
  normalizeRoutine,
  searchMemoryLines,
  forgetMemoryLines,
  runCounters,
} from './domain.js';
import { clip, localDateKey, newId, nowIso } from './util.js';

/** JSON output used by tools whose result is a short human summary. */
const TEXT_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: true,
    properties: {
      ok: { type: 'boolean' },
      text: { type: 'string' },
    },
    required: ['ok', 'text'],
  },
  render: (_args, value) => [{ type: 'text', text: typeof value?.text === 'string' ? value.text : JSON.stringify(value) }],
};

/**
 * @param {object} deps tool dependencies.
 * @returns {Array<() => void>} tool disposers.
 */
export function registerBotTools(deps) {
  const { agent, botId, hub, engine, binder, runtime, log } = deps;
  const scheduler = () => deps.schedulerRef?.current;
  const disposers = [];
  const errors = [];

  const found = () => {
    const live = hub.findById(botId);
    if (live === undefined) throw new Error(`this Bot (${botId}) no longer exists`);
    return live;
  };

  const emit = (event, data) => {
    try {
      deps.emit?.(event, data);
    } catch {
      /* an SSE listener must never break a tool */
    }
  };

  /**
   * Adopt an existing same-name registration after a plugin reload.
   *
   * Tool registrations live on the Agent's context, not on this plugin's, and
   * duplicate names are rejected. Swapping the retained registration's
   * definition keeps the tool present and points it at this load's handler.
   * @param {object} definition tool definition.
   * @returns {boolean} whether an existing registration was adopted.
   */
  const adoptExisting = (definition) => {
    try {
      const layers = agent.ctx.tools.layers;
      if (layers === undefined || layers === null) return false;
      if (typeof layers.chainLayers !== 'function') return false;
      const candidates = layers.chainLayers(agent);
      for (const layer of candidates) {
        if (layer?.tools?.has?.(definition.name) !== true) continue;
        const registration = layer.tools.get(definition.name);
        if (registration === null || typeof registration !== 'object') continue;
        registration.definition = definition;
        return true;
      }
    } catch {
      /* registry internals changed; fall back to a normal registration */
    }
    return false;
  };

  /** Register one tool and remember its disposer. */
  const register = (definition) => {
    try {
      if (adoptExisting(definition)) return true;
      const dispose = agent.ctx.tools.register(definition);
      disposers.push(dispose);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${definition.name}: ${message}`);
      log('warn', `dsh-grok-bot: tool "${definition.name}" could not be registered for ${agent.id}: ${message}`);
      return false;
    }
  };

  /* --------------------------------------------------------------- memory */

  register({
    name: 'bot_memory',
    description:
      'Read or edit your own long-term memory. `write` appends one durable fact under today\'s section of MEMORY.md before you answer; `shared:true` writes into the workspace-wide shared facts instead. `forget` needs confirm:true. Use `search` to look for a remembered fact.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['read', 'write', 'search', 'forget', 'list'],
          description: 'what to do with the memory files',
        },
        entry: { type: 'string', description: 'one factual line for action=write' },
        query: { type: 'string', description: 'substring for action=search or action=forget' },
        confirm: { type: 'boolean', description: 'required true for action=forget' },
        shared: { type: 'boolean', description: 'action=write targets the workspace shared facts' },
        history: { type: 'boolean', description: 'action=read also returns the recent daily logs' },
      },
      required: ['action'],
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const live = found();
      const action = String(args?.action ?? '');
      if (action === 'read') {
        const memory = live.store.readMemory(live.bot.id);
        const shared = live.store.readSharedFacts();
        const logs = args?.history === true
          ? live.store
              .recentDailyLogs(live.bot.id, 3)
              .map((entry) => `## ${entry.day}\n${entry.text}`)
              .join('\n\n')
          : '';
        const parts = [`# MEMORY.md\n${memory}`, shared.trim() === '' ? '' : `# 共享事实\n${shared}`, logs]
          .filter((part) => part !== '');
        return { ok: true, text: parts.join('\n\n') };
      }
      if (action === 'list') {
        const block = live.store.renderMemory(live.bot.id);
        return {
          ok: true,
          text: `MEMORY.md ${live.store.memoryBytes(live.bot.id)} bytes · injected ${block.chars} chars${block.truncated ? ' (truncated)' : ''} · shared facts ${live.store.readSharedFacts().length} chars`,
        };
      }
      if (action === 'search') {
        const query = String(args?.query ?? '').trim();
        if (query === '') return { ok: false, text: 'query is required for action=search' };
        const hits = searchMemoryLines(live.store.readMemory(live.bot.id), query);
        return { ok: true, text: hits.length === 0 ? `nothing remembered about "${query}"` : hits.join('\n') };
      }
      if (action === 'forget') {
        if (args?.confirm !== true) return { ok: false, text: 'forget needs confirm:true' };
        const query = String(args?.query ?? '').trim();
        if (query === '') return { ok: false, text: 'query is required for action=forget' };
        const result = forgetMemoryLines(live.store.readMemory(live.bot.id), query);
        live.store.writeMemory(live.bot.id, result.text);
        emit('changed', { reason: 'memory' });
        return {
          ok: true,
          text: result.removed.length === 0 ? `nothing matched "${query}"` : `forgot ${result.removed.length} line(s)`,
        };
      }
      if (action === 'write') {
        const entry = String(args?.entry ?? '').trim();
        if (entry === '') return { ok: false, text: 'entry is required for action=write' };
        const dateKey = localDateKey();
        if (args?.shared === true) {
          live.store.writeSharedFacts(appendMemoryEntry(live.store.readSharedFacts(), entry, dateKey));
        } else {
          live.store.writeMemory(live.bot.id, appendMemoryEntry(live.store.readMemory(live.bot.id), entry, dateKey));
        }
        emit('changed', { reason: 'memory' });
        return { ok: true, text: `记住了：${clip(entry, 120)}` };
      }
      return { ok: false, text: `unknown action "${action}"` };
    },
  });

  /* --------------------------------------------------------------- profile */

  register({
    name: 'bot_profile',
    description:
      'Read your own Bot profile: name, mode, label, section, autonomy switches, routine count, memory size and the workspace shared facts. Read-only; it never changes configuration.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {}, required: [] },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute() {
      const live = found();
      const mode = MODES[live.bot.mode] ?? MODES.companion;
      const block = live.store.renderMemory(live.bot.id);
      const config = live.store.config;
      const dailyCap = Math.min(
        Number.isInteger(live.bot.autonomy?.maxRunsPerDay) ? live.bot.autonomy.maxRunsPerDay : 12,
        Number.isInteger(config.maxRunsPerDay) && config.maxRunsPerDay > 0 ? config.maxRunsPerDay : 24,
      );
      const hourlyCap = Number.isInteger(config.maxRunsPerHour) && config.maxRunsPerHour > 0 ? config.maxRunsPerHour : 6;
      const counters = runCounters(live.store.readBotRuns(live.bot.id, 1000), localDateKey());
      return {
        id: live.bot.id,
        name: live.bot.name,
        label: live.bot.label,
        mode: live.bot.mode,
        modeLabel: mode.label.zh,
        section: live.bot.section,
        workspacePath: live.store.path,
        autonomy: live.bot.autonomy,
        limits: {
          daily: dailyCap,
          hourly: hourlyCap,
          runsToday: counters.today,
          runsThisHour: counters.hour,
          botDaily: live.bot.autonomy?.maxRunsPerDay ?? null,
          workspaceDaily: config.maxRunsPerDay,
          workspaceHourly: config.maxRunsPerHour,
        },
        routines: live.bot.routines.map((routine) => ({
          id: routine.id,
          when: routine.when,
          report: routine.report,
          enabled: routine.enabled,
          nextAt: routine.nextAt,
        })),
        memory: { bytes: live.store.memoryBytes(live.bot.id), injectedChars: block.chars, truncated: block.truncated },
        sharedFacts: live.store.readSharedFacts(),
      };
    },
  });

  /* ---------------------------------------------------------------- reclaim */

  register({
    name: 'bot_reclaim',
    description:
      'End a host-scheduled routine wake silently. Call it as your only action when there is nothing worth reporting; the wake is then recorded as silent instead of posting a message. Outside a routine wake it does nothing.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reason: { type: 'string', description: 'one short sentence saying why there is nothing to report' },
      },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const marker = runtime.active?.get(agent.id);
      if (marker === undefined) {
        return { ok: false, text: 'bot_reclaim is only meaningful during a host routine wake; this turn keeps its normal reply' };
      }
      marker.reclaimed = true;
      marker.reclaimReason = clip(String(args?.reason ?? ''), 160);
      return { ok: true, text: '本轮按静默收尾，不产生可见汇报。' };
    },
  });

  /* ---------------------------------------------------------------- room post */

  register({
    name: 'bot_room_post',
    description:
      'Post one extra message into the room you are currently answering in. Only valid while a room turn is running; the turn still posts your final reply automatically, so use this for a short supplementary note rather than the whole answer.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string', description: 'the extra room message' },
      },
      required: ['text'],
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const rooms = deps.roomsRef?.current;
      if (rooms === undefined || rooms === null) return { ok: false, text: '房间引擎还没就绪。' };
      return rooms.postExplicit(botId, String(args?.text ?? ''));
    },
  });

  /* ------------------------------------------------------------------- send */

  const liveBot = hub.findById(botId)?.bot;
  const canSend = liveBot !== undefined && ((MODES[liveBot.mode] ?? MODES.companion).canDm || liveBot.autonomy?.dm === true);
  if (canSend) {
    register({
      name: 'bot_send',
      description:
        'Send one short message to another Bot in this workspace, or to a session whose directory is this workspace. The target cold Session is resumed automatically. Hand-off depth is capped: a message that already travelled two hops is refused. Use it for real delegation, not chatter.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          target: { type: 'string', description: 'Bot name or id, or an exact session id in this workspace' },
          text: { type: 'string', description: 'the message body; state the goal and the deliverable' },
        },
        required: ['target', 'text'],
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        const live = found();
        const target = String(args?.target ?? '').trim();
        const text = String(args?.text ?? '').trim();
        if (target === '' || text === '') return { ok: false, text: 'target and text are required' };
        if (text.length > 4000) return { ok: false, text: 'message is too long (4000 characters)' };
        const hop = (runtime.hops?.get(agent.id) ?? 0) + 1;
        if (hop > 2) {
          log('warn', `dsh-grok-bot: refused a hand-off deeper than two hops from ${botId}`);
          return { ok: false, text: 'hand-off depth exceeded: a Bot message may travel at most two hops' };
        }
        const delivered = await deps.sendBotMessage(live, target, text, hop);
        return delivered;
      },
    });
  }

  /* ----------------------------------------------------------- open session */

  if (canSend && binder !== undefined) {
    register({
      name: 'bot_open_session',
      description:
        'Create a fresh ordinary Session in this workspace without touching your own bound Session. The new Session runs the host default agent (not a Bot). Hand it work with bot_send; it answers there, not here.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: 'optional title for the new Session (80 characters max)' },
        },
        required: [],
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        const live = found();
        const title = String(args?.title ?? '').trim();
        if (title.length > 80) return { ok: false, text: 'title is too long (80 characters)' };
        try {
          const sessionId = await binder.createSession(live.store, {});
          if (title !== '') await binder.rename(sessionId, title);
          log('info', `dsh-grok-bot: ${live.bot.id} opened ordinary session ${sessionId}`);
          const named = title === '' ? '' : `，标题「${title}」`;
          return {
            ok: true,
            text: `已新建普通会话 ${sessionId}（工作区 ${live.store.path}）${named}。用 bot_send，target 填这个 session id，把目标、边界和交付物发过去。`,
          };
        } catch (error) {
          return { ok: false, text: `新建会话失败：${error instanceof Error ? error.message : String(error)}` };
        }
      },
    });
  }

  /* ---------------------------------------------------------------- routine */

  if (liveBot !== undefined && liveBot.autonomy?.routines !== false) {
    register({
      name: 'bot_routine',
      description:
        'Manage your own routines: remove the host scheduler entry, list them, create one, enable/disable, or run one immediately. A routine wakes this Session at the given local time even when it is cold.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['list', 'create', 'update', 'delete', 'run_now'] },
          id: { type: 'string', description: 'routine id for update/delete/run_now' },
          when: {
            type: 'object',
            description: 'schedule: {kind:"daily",time:"09:00"} | {kind:"every",minutes:90} | {kind:"after",minutes:30} | {kind:"cron",expr:"0 9 * * 1-5"}',
            additionalProperties: true,
            properties: {},
          },
          instruction: { type: 'string', description: 'what to do when the routine fires' },
          report: { type: 'string', enum: ['chat', 'silent', 'room'] },
          groupId: { type: 'string', description: 'room id for report:"room"' },
          enabled: { type: 'boolean' },
        },
        required: ['action'],
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        const live = found();
        const action = String(args?.action ?? '');
        const planner = scheduler();
        if (action === 'list') {
          if (live.bot.routines.length === 0) return { ok: true, text: '还没有例行任务。' };
          const lines = live.bot.routines.map(
            (routine) =>
              `- ${routine.id} · ${describeWhen(routine.when)} · ${routine.enabled ? '启用' : '暂停'} · ${routine.report} · 下次 ${routine.nextAt ?? '—'} · 「${clip(routine.instruction, 80)}」`,
          );
          return { ok: true, text: lines.join('\n') };
        }
        if (action === 'create') {
          if (live.bot.autonomy?.routines === false) return { ok: false, text: '这个模式不允许创建例行任务' };
          const routine = normalizeRoutine({
            when: args?.when,
            instruction: args?.instruction,
            report: args?.report ?? (MODES[live.bot.mode]?.defaultReport ?? 'chat'),
            groupId: args?.groupId ?? null,
            enabled: args?.enabled ?? true,
          });
          const nextAt = computeNextAt(routine.when, Date.now());
          routine.nextAt = new Date(nextAt).toISOString();
          const routines = [...live.bot.routines, routine];
          live.store.updateBot(live.bot.id, { routines });
          planner?.requestReplan();
          emit('changed', { reason: 'routine' });
          return { ok: true, text: `已创建例行任务 ${routine.id}，下次 ${routine.nextAt}。` };
        }
        if (action === 'update') {
          const id = String(args?.id ?? '');
          const routines = live.bot.routines.map((routine) => {
            if (routine.id !== id) return routine;
            const merged = normalizeRoutine(
              {
                ...routine,
                when: args?.when ?? routine.when,
                instruction: args?.instruction ?? routine.instruction,
                report: args?.report ?? routine.report,
                enabled: args?.enabled ?? routine.enabled,
              },
              routine.id,
            );
            if (merged.enabled && (args?.when !== undefined || routine.nextAt === null)) {
              merged.nextAt = new Date(computeNextAt(merged.when, Date.now())).toISOString();
            }
            return merged;
          });
          if (!routines.some((routine) => routine.id === id)) return { ok: false, text: `没有这个例行任务：${id}` };
          live.store.updateBot(live.bot.id, { routines });
          planner?.requestReplan();
          emit('changed', { reason: 'routine' });
          return { ok: true, text: `已更新例行任务 ${id}。` };
        }
        if (action === 'delete') {
          const id = String(args?.id ?? '');
          const routines = live.bot.routines.filter((routine) => routine.id !== id);
          if (routines.length === live.bot.routines.length) return { ok: false, text: `没有这个例行任务：${id}` };
          live.store.updateBot(live.bot.id, { routines });
          planner?.requestReplan();
          emit('changed', { reason: 'routine' });
          return { ok: true, text: `已删除例行任务 ${id}。` };
        }
        if (action === 'run_now') {
          const id = String(args?.id ?? '');
          const routine = live.bot.routines.find((item) => item.id === id);
          if (routine === undefined) return { ok: false, text: `没有这个例行任务：${id}` };
          if (planner === undefined) return { ok: false, text: '调度器还没就绪，稍后再试' };
          const outcome = await planner.runNow(live.bot.id, routine.id);
          return { ok: outcome.ok !== false, text: outcome.text ?? '已触发一次例行任务。' };
        }
        return { ok: false, text: `unknown action "${action}"` };
      },
    });
  }

  const result = disposers;
  result.errors = errors;
  return result;
}

/**
 * Readable one-line description of a routine schedule.
 * @param {object} when normalized schedule block.
 * @returns {string} description.
 */
export function describeWhen(when) {
  if (when.kind === 'daily') return `每天 ${when.time}`;
  if (when.kind === 'every') return `每 ${when.minutes} 分钟`;
  if (when.kind === 'after') return `一次性，${when.minutes} 分钟后`;
  if (when.kind === 'cron') return `cron ${when.expr}`;
  return String(when.kind);
}

/**
 * Build a routine run record.
 * @param {string} routineId routine id.
 * @param {string} outcome outcome tag.
 * @param {object} extra extra fields.
 * @returns {object} run row.
 */
export function buildRun(routineId, outcome, extra = {}) {
  return {
    id: newId(),
    routineId,
    at: nowIso(),
    outcome,
    ...extra,
  };
}
