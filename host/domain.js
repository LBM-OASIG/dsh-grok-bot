/**
 * dsh-grok-bot — pure domain rules: Bot shape and validation, the four modes,
 * routine time arithmetic, quiet hours, mention parsing and memory text.
 *
 * Nothing here touches the host, the filesystem or an Agent, which keeps the
 * rules unit-testable with plain objects.
 */

/** Stable error shape for rejected user input. */
export class DomainError extends Error {
  /**
   * @param {string} code stable error code returned to the UI.
   * @param {string} message human-readable explanation.
   */
  constructor(code, message) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

/** The four Bot modes: persona slant, preset id and default autonomy. */
export const MODES = {
  companion: {
    id: 'companion',
    preset: 'grok-bot-companion',
    label: { zh: '陪伴', en: 'Companion' },
    tagline: { zh: '陪聊、轻任务，主动但不烦', en: 'Company and light tasks, proactive but never noisy' },
    tools: { zh: '读文件、搜索、联网、技能、待办；不能跑命令、不能写文件', en: 'read, search, web, skills, todo; no shell, no writes' },
    canDm: false,
    canUseRoutines: true,
    defaultReport: 'chat',
    maxRunsPerDay: 4,
    persona: [
      '你是一个陪伴型 Bot：说话自然、短句、有温度，先听懂人再给建议。',
      '你主动，但不烦：能自己查清楚的事不要反问，没有要紧事就少说。',
      '你不能运行命令、不能写文件；遇到需要动手的活，把办法说清楚，交给 operator 或 chief。',
    ].join('\n'),
  },
  operator: {
    id: 'operator',
    preset: 'grok-bot-operator',
    label: { zh: '干活', en: 'Operator' },
    tagline: { zh: '动手干活，交付结果', en: 'Gets work done and delivers the result' },
    tools: { zh: '完整文件工具、命令、联网、技能、待办', en: 'full file tools, shell, web, skills, todo' },
    canDm: true,
    canUseRoutines: true,
    defaultReport: 'chat',
    maxRunsPerDay: 12,
    persona: [
      '你是一个干活型 Bot：接到任务先做，做完给结果和证据，别只给方案。',
      '能用工具验证的就去验证，不猜。失败的尝试要说明失败在哪。',
      '交付时写清楚改了什么、怎么验证的；有风险的操作先说后果再动手。',
    ].join('\n'),
  },
  scout: {
    id: 'scout',
    preset: 'grok-bot-scout',
    label: { zh: '侦察', en: 'Scout' },
    tagline: { zh: '只读侦察，找线索不下结论', en: 'Read-only reconnaissance; findings, not verdicts' },
    tools: { zh: '只读文件、搜索、联网、技能', en: 'read-only files, search, web, skills' },
    canDm: false,
    canUseRoutines: true,
    defaultReport: 'silent',
    maxRunsPerDay: 8,
    persona: [
      '你是一个侦察型 Bot：只读、只查、只报告线索。',
      '你不写文件、不跑命令、不改任何东西；你的价值是快速把事实和可疑点摆出来。',
      '报告要短：找到了什么、在哪、下一步建议谁去看。没事就静默收尾。',
    ].join('\n'),
  },
  chief: {
    id: 'chief',
    preset: 'grok-bot-chief',
    label: { zh: '协调', en: 'Chief' },
    tagline: { zh: '协调者：拆活、派活、收口', en: 'Coordinator: split, delegate, close the loop' },
    tools: { zh: '全部工具 + Bot 交接能力', en: 'all tools plus bot handoff' },
    canDm: true,
    canUseRoutines: true,
    defaultReport: 'chat',
    maxRunsPerDay: 16,
    persona: [
      '你是一个协调型 Bot：把目标拆成几步，能自己做的做，该交给别的 Bot 的用 bot_send 交出去并说明要什么。',
      '你是工作区的主 Bot：主动跟进、收口、汇报。别把活揽在自己身上做不完。',
      '交给别的 Bot 时一句话说清目标、边界和交付物；交接最多两跳，不要来回踢皮球。',
    ].join('\n'),
  },
};

/** @type {string[]} valid mode ids. */
export const MODE_IDS = Object.keys(MODES);

/** Avatar shapes accepted by the UI. */
export const AVATAR_SHAPES = ['circle', 'tri', 'square', 'diamond', 'hex', 'star', 'shield', 'drop'];

/** Avatar palette shared by the client and the host defaults. */
export const AVATAR_COLORS = [
  '#e06c5a', '#e2a93b', '#7bb86f', '#3f9e9a', '#5b8def',
  '#8d7bd6', '#d268a8', '#c07a4e', '#6b7c93', '#b9544f',
];

const MAX_NAME = 60;
const MAX_LABEL = 160;
const MAX_PERSONA = 8000;
const MAX_INSTRUCTION = 4000;
const MAX_SECTION = 40;

/**
 * Throw unless a value is a non-empty trimmed string within `max` characters.
 * @param {unknown} value candidate.
 * @param {string} field field name for the error.
 * @param {number} max maximum length.
 * @returns {string} the trimmed value.
 */
function requireText(value, field, max) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DomainError('invalid_input', `${field} must be a non-empty string`);
  }
  const text = value.trim();
  if (text.length > max) throw new DomainError('invalid_input', `${field} exceeds ${max} characters`);
  return text;
}

/**
 * Coerce a time-of-day spelling into canonical `HH:MM`.
 * @param {unknown} value '09:00', '9:00' or '0900'.
 * @returns {string} canonical local time.
 */
export function normalizeClock(value) {
  if (typeof value !== 'string') throw new DomainError('invalid_time', 'time must be a string like "09:00"');
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (match === null) throw new DomainError('invalid_time', 'time must look like "09:00"');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new DomainError('invalid_time', 'time is out of range');
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Read one quiet-hours pair, accepting null as "no window".
 * @param {unknown} value `["23:00","07:00"]` or null.
 * @returns {[string, string] | null} normalized window.
 */
export function normalizeQuietHours(value) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.length !== 2) {
    throw new DomainError('invalid_input', 'quietHours must be ["HH:MM","HH:MM"] or null');
  }
  return [normalizeClock(value[0]), normalizeClock(value[1])];
}

/**
 * Validate and normalize one routine definition.
 * @param {unknown} raw candidate routine.
 * @param {string} [id] id to keep; a fresh id is required when absent.
 * @returns {object} normalized routine.
 */
export function normalizeRoutine(raw, id) {
  if (raw === null || typeof raw !== 'object') throw new DomainError('invalid_input', 'routine must be an object');
  const when = raw.when;
  if (when === null || typeof when !== 'object') throw new DomainError('invalid_input', 'routine.when is required');
  const kind = when.kind;
  /** @type {any} */
  let normalizedWhen;
  if (kind === 'daily') {
    normalizedWhen = { kind, time: normalizeClock(when.time) };
  } else if (kind === 'every') {
    const minutes = Number(when.minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) {
      throw new DomainError('invalid_input', 'every.minutes must be an integer between 1 and 10080');
    }
    normalizedWhen = { kind, minutes };
  } else if (kind === 'after') {
    const minutes = Number(when.minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) {
      throw new DomainError('invalid_input', 'after.minutes must be an integer between 1 and 10080');
    }
    normalizedWhen = { kind, minutes };
  } else if (kind === 'cron') {
    if (typeof when.expr !== 'string' || when.expr.trim().split(/\s+/).length !== 5) {
      throw new DomainError('invalid_input', 'cron.expr must be a five-field expression');
    }
    normalizedWhen = { kind, expr: when.expr.trim().replace(/\s+/g, ' ') };
  } else {
    throw new DomainError('invalid_input', 'routine.when.kind must be daily|every|after|cron');
  }
  const instruction = requireText(raw.instruction, 'routine.instruction', MAX_INSTRUCTION);
  const report = raw.report === 'room' ? 'room' : raw.report === 'silent' ? 'silent' : 'chat';
  return {
    id: typeof id === 'string' && id !== '' ? id : typeof raw.id === 'string' && raw.id !== '' ? raw.id : randomRoutineId(),
    when: normalizedWhen,
    instruction,
    report,
    groupId: typeof raw.groupId === 'string' && raw.groupId !== '' ? raw.groupId : null,
    enabled: raw.enabled === undefined ? true : raw.enabled === true,
    lastRunAt: typeof raw.lastRunAt === 'string' ? raw.lastRunAt : null,
    nextAt: typeof raw.nextAt === 'string' ? raw.nextAt : null,
    lastOutcome: typeof raw.lastOutcome === 'string' ? raw.lastOutcome : null,
    failures: Number.isInteger(raw.failures) && raw.failures >= 0 ? raw.failures : 0,
    pausedReason: typeof raw.pausedReason === 'string' ? raw.pausedReason : null,
  };
}

/** @returns {string} a short opaque routine id. */
export function randomRoutineId() {
  return `r${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Normalize one avatar or invent a deterministic one from the name.
 * @param {unknown} raw candidate avatar.
 * @param {string} name bot name used for the deterministic fallback.
 * @returns {{shape: string, color: string}} normalized avatar.
 */
export function normalizeAvatar(raw, name) {
  const shape = raw !== null && typeof raw === 'object' && AVATAR_SHAPES.includes(raw.shape) ? raw.shape : defaultShape(name);
  const color =
    raw !== null && typeof raw === 'object' && typeof raw.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color)
      ? raw.color.toLowerCase()
      : defaultColor(name);
  return { shape, color };
}

/**
 * @param {string} name bot name.
 * @returns {string} a stable shape id.
 */
export function defaultShape(name) {
  return AVATAR_SHAPES[hash(name) % AVATAR_SHAPES.length];
}

/**
 * @param {string} name bot name.
 * @returns {string} a stable palette color.
 */
export function defaultColor(name) {
  return AVATAR_COLORS[hash(name) % AVATAR_COLORS.length];
}

/**
 * @param {string} text any text.
 * @returns {number} a small deterministic positive hash.
 */
export function hash(text) {
  let value = 0;
  const input = String(text ?? '');
  for (let i = 0; i < input.length; i += 1) {
    value = (value * 31 + input.charCodeAt(i)) % 100000;
  }
  return value;
}

/**
 * Normalize the autonomy block, filling mode defaults.
 * @param {unknown} raw candidate autonomy.
 * @param {object} mode mode definition.
 * @returns {object} normalized autonomy.
 */
export function normalizeAutonomy(raw, mode) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  const maxRunsPerDay = Number.isInteger(source.maxRunsPerDay) && source.maxRunsPerDay >= 0
    ? source.maxRunsPerDay
    : mode.maxRunsPerDay;
  return {
    dm: source.dm === undefined ? mode.canDm : source.dm === true,
    routines: source.routines === undefined ? mode.canUseRoutines : source.routines === true,
    maxRunsPerDay,
    quietHours: normalizeQuietHours(source.quietHours),
  };
}

/**
 * Build a normalized Bot record from user input, preserving identity and
 * timestamps from `previous` when this is an update.
 * @param {object} input create/update payload.
 * @param {object} [previous] existing bot record.
 * @param {(name: string) => string} [nextId] id allocator used on create.
 * @returns {object} normalized bot record.
 */
export function normalizeBot(input, previous, nextId) {
  if (input === null || typeof input !== 'object') throw new DomainError('invalid_input', 'bot payload must be an object');
  const name = requireText(input.name ?? previous?.name, 'name', MAX_NAME);
  const modeId = input.mode ?? previous?.mode ?? 'companion';
  if (!MODE_IDS.includes(modeId)) throw new DomainError('invalid_mode', `mode must be one of ${MODE_IDS.join(', ')}`);
  const mode = MODES[modeId];
  const label = typeof input.label === 'string' ? clipText(input.label.trim(), MAX_LABEL) : typeof previous?.label === 'string' ? previous.label : '';
  const persona = typeof input.persona === 'string' ? clipText(input.persona, MAX_PERSONA) : typeof previous?.persona === 'string' ? previous.persona : '';
  const section = typeof input.section === 'string' ? clipText(input.section.trim(), MAX_SECTION) : typeof previous?.section === 'string' ? previous.section : '';
  const avatar = normalizeAvatar(input.avatar ?? previous?.avatar, name);
  const autonomy = normalizeAutonomy(input.autonomy ?? previous?.autonomy, mode);
  const routines = Array.isArray(input.routines)
    ? input.routines.map((routine) => normalizeRoutine(routine))
    : Array.isArray(previous?.routines)
      ? previous.routines.map((routine) => normalizeRoutine(routine, routine.id))
      : [];
  const createdAt = typeof previous?.createdAt === 'string' ? previous.createdAt : new Date().toISOString();
  return {
    version: 1,
    id: previous?.id ?? (nextId === undefined ? 'bot' : nextId(name)),
    name,
    label,
    mode: modeId,
    avatar,
    persona,
    section,
    sessionId: previous?.sessionId ?? (typeof input.sessionId === 'string' ? input.sessionId : null),
    workspaceId: previous?.workspaceId ?? (typeof input.workspaceId === 'string' ? input.workspaceId : null),
    workspacePath: previous?.workspacePath ?? (typeof input.workspacePath === 'string' ? input.workspacePath : null),
    autonomy,
    routines,
    model: input.model ?? previous?.model ?? null,
    primary: input.primary ?? previous?.primary ?? false,
    pinned: input.pinned ?? previous?.pinned ?? false,
    hidden: input.hidden ?? previous?.hidden ?? false,
    createdAt,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * @param {string} value text.
 * @param {number} max maximum length.
 * @returns {string} the value cut to the bound.
 */
function clipText(value, max) {
  return value.length <= max ? value : value.slice(0, max);
}

/**
 * Validate one room definition.
 * @param {object} input group payload.
 * @param {object} [previous] existing group.
 * @param {(members: string[]) => void} [checkMembers] membership validator.
 * @returns {object} normalized group.
 */
export function normalizeGroup(input, previous, checkMembers) {
  if (input === null || typeof input !== 'object') throw new DomainError('invalid_input', 'group payload must be an object');
  const name = requireText(input.name ?? previous?.name, 'name', MAX_NAME);
  const topic = typeof input.topic === 'string' ? clipText(input.topic.trim(), MAX_LABEL) : typeof previous?.topic === 'string' ? previous.topic : '';
  const members = Array.isArray(input.members) ? input.members.filter((id) => typeof id === 'string') : previous?.members ?? [];
  if (members.length < 2 || members.length > 6) throw new DomainError('invalid_group', 'a room needs 2–6 bots');
  if (typeof checkMembers === 'function') checkMembers(members);
  const leadBotId = typeof input.leadBotId === 'string' && members.includes(input.leadBotId)
    ? input.leadBotId
    : members.includes(previous?.leadBotId) ? previous.leadBotId : members[0];
  const responderPolicy = input.responderPolicy === 'all' ? 'all' : 'primary';
  const maxParallel = Number.isInteger(input.maxParallel) && input.maxParallel >= 1 && input.maxParallel <= 6
    ? input.maxParallel
    : Math.min(2, members.length);
  const handoffDepth = Number.isInteger(input.handoffDepth) && input.handoffDepth >= 0 && input.handoffDepth <= 2
    ? input.handoffDepth
    : 1;
  return {
    version: 1,
    id: previous?.id ?? (typeof input.id === 'string' ? input.id : `g${Date.now().toString(36)}`),
    name,
    topic,
    members,
    leadBotId,
    responderPolicy,
    maxParallel,
    handoffDepth,
    workspaceId: previous?.workspaceId ?? (typeof input.workspaceId === 'string' ? input.workspaceId : null),
    workspacePath: previous?.workspacePath ?? (typeof input.workspacePath === 'string' ? input.workspacePath : null),
    createdAt: typeof previous?.createdAt === 'string' ? previous.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ routines */

/**
 * Expand one cron field into a set of accepted integers.
 * @param {string} spec field expression (`*`, `5`, `1-5`, `*\/15`, `1-5\/2`).
 * @param {number} min lowest accepted value.
 * @param {number} max highest accepted value.
 * @returns {number[]} accepted values.
 */
export function cronFieldValues(spec, min, max) {
  const values = [];
  for (const part of spec.split(',')) {
    const match = part.trim().match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (match === null) throw new DomainError('invalid_cron', `invalid cron field "${spec}"`);
    const step = match[2] === undefined ? 1 : Number(match[2]);
    if (step < 1) throw new DomainError('invalid_cron', 'cron step must be >= 1');
    let from = min;
    let to = max;
    if (match[1] !== '*') {
      const range = match[1].split('-');
      from = Number(range[0]);
      to = range.length === 2 ? Number(range[1]) : from;
    }
    if (from < min || to > max || from > to) throw new DomainError('invalid_cron', `cron field "${spec}" is out of range`);
    for (let value = from; value <= to; value += step) values.push(value);
  }
  return values;
}

/**
 * Find the first minute at or after `fromMs` matching a five-field cron
 * expression (Sunday = 0). Searches up to a year before giving up.
 * @param {string} expr five-field expression.
 * @param {number} fromMs earliest epoch milliseconds.
 * @returns {number} matching epoch milliseconds.
 */
export function nextCronTime(expr, fromMs) {
  const [minuteSpec, hourSpec, daySpec, monthSpec, weekdaySpec] = expr.trim().split(/\s+/);
  const minutes = cronFieldValues(minuteSpec, 0, 59);
  const hours = cronFieldValues(hourSpec, 0, 23);
  const days = cronFieldValues(daySpec, 1, 31);
  const months = cronFieldValues(monthSpec, 1, 12);
  const weekdays = cronFieldValues(weekdaySpec, 0, 6);
  // Start one minute after the reference point so a due routine always advances.
  let candidate = new Date(fromMs);
  candidate.setSeconds(0, 0);
  candidate = new Date(candidate.getTime() + 60_000);
  const limit = fromMs + 366 * 24 * 60 * 60 * 1000;
  while (candidate.getTime() <= limit) {
    if (
      minutes.includes(candidate.getMinutes()) &&
      hours.includes(candidate.getHours()) &&
      days.includes(candidate.getDate()) &&
      months.includes(candidate.getMonth() + 1) &&
      weekdays.includes(candidate.getDay())
    ) {
      return candidate.getTime();
    }
    candidate = new Date(candidate.getTime() + 60_000);
  }
  throw new DomainError('invalid_cron', 'cron expression has no occurrence within a year');
}

/** Milliseconds in one minute. */
const MINUTE_MS = 60_000;

/**
 * Compute the first time a routine should fire strictly after `fromMs`.
 * @param {object} when normalized `when` block.
 * @param {number} fromMs reference epoch milliseconds.
 * @returns {number} next fire epoch milliseconds.
 */
export function computeNextAt(when, fromMs) {
  if (when.kind === 'daily') {
    const [hour, minute] = when.time.split(':').map(Number);
    const candidate = new Date(fromMs);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate.getTime() <= fromMs) candidate.setDate(candidate.getDate() + 1);
    return candidate.getTime();
  }
  if (when.kind === 'every' || when.kind === 'after') {
    return fromMs + Math.max(1, when.minutes) * MINUTE_MS;
  }
  if (when.kind === 'cron') return nextCronTime(when.expr, fromMs);
  throw new DomainError('invalid_input', `unknown routine kind ${String(when.kind)}`);
}

/**
 * @param {string} clock `HH:MM`.
 * @returns {number} minutes since local midnight.
 */
export function clockMinutes(clock) {
  const [hour, minute] = clock.split(':').map(Number);
  return hour * 60 + minute;
}

/**
 * Test whether a timestamp falls inside a quiet-hours window, wrap included.
 * @param {number} ms epoch milliseconds.
 * @param {[string, string] | null} window quiet-hours pair.
 * @returns {boolean} whether the moment is quiet.
 */
export function inQuietHours(ms, window) {
  if (window === null || window === undefined) return false;
  const now = new Date(ms);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = clockMinutes(window[0]);
  const end = clockMinutes(window[1]);
  if (start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/**
 * Move a timestamp out of a quiet-hours window (no-op when outside).
 * @param {number} ms epoch milliseconds.
 * @param {[string, string] | null} window quiet-hours pair.
 * @returns {number} first epoch milliseconds outside the window.
 */
export function nextOutsideQuietHours(ms, window) {
  if (!inQuietHours(ms, window)) return ms;
  const end = clockMinutes(window[1]);
  const date = new Date(ms);
  const minuteNow = date.getHours() * 60 + date.getMinutes();
  const target = new Date(ms);
  target.setHours(Math.floor(end / 60), end % 60, 0, 0);
  if (end <= minuteNow) target.setDate(target.getDate() + 1);
  return target.getTime();
}

/* ------------------------------------------------------------------ mentions */

/**
 * Parse `@name`, `@everyone` and `@all` mentions from room text.
 * @param {string} text raw user text.
 * @param {Array<{id: string, name: string}>} members room members.
 * @returns {{everyone: boolean, ids: string[], text: string}} parsed mentions.
 */
export function parseMentions(text, members) {
  const input = typeof text === 'string' ? text : '';
  if (/@(everyone|all|所有人|全体)\b/i.test(input) || /@(everyone|all|所有人|全体)/i.test(input)) {
    return { everyone: true, ids: [], text: input.replace(/@(everyone|all|所有人|全体)/gi, '').trim() };
  }
  const ids = [];
  let output = input;
  for (const member of members) {
    const name = String(member.name ?? '').trim();
    if (name === '') continue;
    const pattern = new RegExp(`@${escapeRegExp(name)}`, 'gi');
    if (pattern.test(output)) {
      ids.push(member.id);
      output = output.replace(pattern, '');
    }
  }
  // An id may also be mentioned directly (`@sunny`), which the name loop covers
  // for ASCII ids; keep the explicit id pass for names that differ from ids.
  for (const member of members) {
    const idPattern = new RegExp(`@${escapeRegExp(String(member.id))}`, 'gi');
    if (idPattern.test(output) && !ids.includes(member.id)) {
      ids.push(member.id);
      output = output.replace(idPattern, '');
    }
  }
  return { everyone: false, ids, text: output.trim() };
}

/**
 * @param {string} value literal text.
 * @returns {string} the text escaped for a regular expression.
 */
export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Decide which room members answer one user message.
 * @param {{everyone: boolean, ids: string[]}} mentions parsed mentions.
 * @param {object} group room definition.
 * @param {Array<{id: string, active: boolean}>} bots member bots.
 * @returns {string[]} responder bot ids.
 */
export function decideResponders(mentions, group, bots) {
  const active = new Set(bots.filter((bot) => bot.active !== false).map((bot) => bot.id));
  const members = group.members.filter((id) => active.has(id));
  if (mentions.everyone) return members;
  if (mentions.ids.length > 0) {
    return members.filter((id) => mentions.ids.includes(id));
  }
  if (group.responderPolicy === 'all') return members;
  return members.includes(group.leadBotId) ? [group.leadBotId] : members.slice(0, 1);
}

/**
 * Find the bot ids a Bot message hands off to (`@name` in a bot reply).
 * @param {string} text assistant text.
 * @param {Array<{id: string, name: string}>} members room members.
 * @param {string} authorId author bot id.
 * @returns {string[]} handoff targets, never the author.
 */
export function parseHandoffs(text, members, authorId) {
  const mentioned = parseMentions(text, members);
  return mentioned.ids.filter((id) => id !== authorId);
}

/* ------------------------------------------------------------------- memory */

/** Default character budget for one Bot's injected memory. */
export const MEMORY_BUDGET_CHARS = 6000;

/**
 * Append one memory entry under the dated section for `dateKey`, creating the
 * section at the end of the file when it does not exist yet.
 * @param {string} text current memory text.
 * @param {string} entry one-fact entry line.
 * @param {string} dateKey local `YYYY-MM-DD`.
 * @returns {string} updated memory text.
 */
export function appendMemoryEntry(text, entry, dateKey) {
  const line = `- ${String(entry).trim()}`;
  const source = typeof text === 'string' ? text : '';
  const heading = `## ${dateKey}`;
  const start = source.indexOf(heading);
  if (start === -1) {
    const base = source.trimEnd();
    return `${base === '' ? '' : `${base}\n\n`}${heading}\n${line}\n`;
  }
  const afterHeading = source.indexOf('\n', start + heading.length);
  const nextHeading = source.indexOf('\n## ', afterHeading === -1 ? source.length : afterHeading);
  const insertAt = nextHeading === -1 ? source.length : nextHeading + 1;
  const head = source.slice(0, insertAt).trimEnd();
  const tail = source.slice(insertAt);
  const merged = `${head}\n${line}\n`;
  return tail.trim() === '' ? merged : `${merged}\n${tail.replace(/^\n+/, '')}`;
}

/**
 * Remove memory lines containing a case-insensitive substring.
 * @param {string} text current memory text.
 * @param {string} needle substring to forget.
 * @returns {{text: string, removed: string[]}} updated text and removed lines.
 */
export function forgetMemoryLines(text, needle) {
  const source = typeof text === 'string' ? text : '';
  const lower = needle.toLowerCase();
  const removed = [];
  const kept = [];
  for (const line of source.split('\n')) {
    if (line.trim().startsWith('- ') && line.toLowerCase().includes(lower)) removed.push(line);
    else kept.push(line);
  }
  return { text: kept.join('\n').replace(/\n{3,}/g, '\n\n'), removed };
}

/**
 * Return memory lines containing a case-insensitive substring.
 * @param {string} text current memory text.
 * @param {string} needle substring to find.
 * @returns {string[]} matching lines.
 */
export function searchMemoryLines(text, needle) {
  const lower = String(needle ?? '').toLowerCase();
  if (lower === '') return [];
  return String(text ?? '')
    .split('\n')
    .filter((line) => line.trim() !== '' && line.toLowerCase().includes(lower));
}

/**
 * Build the memory block injected into one Bot's system prompt, honoring
 * the character budget while always keeping shared workspace facts.
 * @param {{memory: string, shared: string, daily: Array<{day: string, text: string}>}} sources memory sources.
 * @param {number} [budget] character budget.
 * @returns {{text: string, chars: number, truncated: boolean}} block and its size.
 */
export function renderMemoryBlock(sources, budget = MEMORY_BUDGET_CHARS) {
  const parts = [];
  const shared = String(sources.shared ?? '').trim();
  if (shared !== '') parts.push(`### 工作区共享事实（所有 Bot 都知道）\n${shared}`);
  let used = parts.join('\n\n').length;
  let truncated = false;
  const push = (text) => {
    const value = String(text ?? '').trim();
    if (value === '') return;
    if (used + value.length + 2 > budget) {
      const room = budget - used - 2;
      if (room > 120) {
        parts.push(`${value.slice(0, room)}…`);
        used = budget;
      } else {
        used = budget;
      }
      truncated = true;
      return;
    }
    parts.push(value);
    used += value.length + 2;
  };
  const memory = String(sources.memory ?? '').trim();
  if (memory !== '') push(`### 你的长期记忆（MEMORY.md）\n${memory}`);
  for (const log of sources.daily ?? []) {
    if (truncated) break;
    push(`### ${log.day} 的日志\n${log.text}`);
  }
  return { text: parts.join('\n\n'), chars: used, truncated };
}

/**
 * Normalize a persisted runs row into the counters used by the budget gates.
 * @param {any[]} runs parsed run rows.
 * @param {string} dateKey local day key.
 * @returns {{today: number, hour: number, failures: number}} counters.
 */
export function runCounters(runs, dateKey, nowMs = Date.now()) {
  const now = nowMs;
  let today = 0;
  let hour = 0;
  let failures = 0;
  for (const run of runs) {
    // Budget and busy refusals did not run a model turn, and a manual run was
    // requested by the user. Counting them would let one blocked slot consume
    // the next slot's budget, so only real scheduled wakes count here.
    if (run?.outcome === 'budget' || run?.outcome === 'skipped') continue;
    if (run?.manual === true) continue;
    const at = typeof run?.at === 'string' ? Date.parse(run.at) : Number(run?.at);
    if (!Number.isFinite(at)) continue;
    const day = new Date(at);
    const p = (n) => String(n).padStart(2, '0');
    if (`${day.getFullYear()}-${p(day.getMonth() + 1)}-${p(day.getDate())}` === dateKey) today += 1;
    if (now - at <= 60 * 60 * 1000) hour += 1;
    if (run?.outcome === 'error') failures += 1;
    else if (run?.outcome === 'ok' || run?.outcome === 'silent') failures = 0;
  }
  return { today, hour, failures };
}
