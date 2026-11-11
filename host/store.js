/**
 * dsh-grok-bot — workspace-scoped persistence.
 *
 * Every Bot, room and memory file lives inside the workspace it belongs to:
 *
 *   <workspace>/.deepseek-harness/bots/
 *     registry.json              id bookkeeping (never-reused ids, primary Bot)
 *     config.json                workspace-wide defaults (budget, quiet hours…)
 *     shared-facts.md            facts every Bot in this workspace remembers
 *     groups/<groupId>/group.json
 *     groups/<groupId>/room.jsonl
 *     groups/<groupId>/runs.jsonl
 *     <botId>/bot.json
 *     <botId>/runs.jsonl
 *     <botId>/memory/MEMORY.md
 *     <botId>/memory/YYYY-MM-DD.md
 *
 * Writes are atomic and per-key serialized; reads used by prompt assembly are
 * synchronous on purpose.
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import {
  appendJsonlSync,
  ensureDir,
  readJsonlSync,
  readJsonSync,
  readTextSync,
  KeyedQueue,
  newId,
  writeJsonAtomicSync,
  writeTextAtomicSync,
} from './util.js';
import {
  AVATAR_COLORS,
  MEMORY_BUDGET_CHARS,
  computeNextAt,
  normalizeBot,
  normalizeGroup,
  randomRoutineId,
  renderMemoryBlock,
} from './domain.js';

/** Directory name holding all bot data inside a workspace. */
export const DATA_DIR = '.deepseek-harness';
/** Directory name under DATA_DIR. */
export const BOTS_DIR = 'bots';

/**
 * Default workspace-wide configuration.
 * @returns {object} a fresh config object.
 */
export function defaultConfig() {
  return {
    version: 1,
    primaryBotId: null,
    defaultMode: 'companion',
    maxRunsPerDay: 20,
    maxRunsPerHour: 4,
    quietHours: null,
    maxGroupMembers: 6,
    showBotSessions: true,
  };
}

/**
 * Per-workspace data store: one instance per registered workspace.
 */
export class WorkspaceStore {
  /**
   * @param {{id: string, path: string, title: string}} workspace host workspace entity.
   * @param {(level: string, message: string) => void} log logger.
   */
  constructor(workspace, log) {
    this.workspace = workspace;
    this.path = workspace.path;
    this.id = workspace.id;
    this.title = workspace.title;
    this.root = join(this.path, DATA_DIR, BOTS_DIR);
    this.log = log ?? (() => undefined);
    this.queue = new KeyedQueue();
    /** @type {Map<string, object>} */
    this.bots = new Map();
    /** @type {Map<string, object>} */
    this.groups = new Map();
    this.config = defaultConfig();
    this.registry = { version: 1, usedIds: [], primaryBotId: null };
    this.missing = false;
    /** @type {Map<string, number>} */
    this.runtime = new Map();
  }

  /** Load (or create) every persisted record for this workspace. */
  load() {
    this.missing = !existsSync(this.path) || !statSync(this.path).isDirectory();
    if (this.missing) return;
    ensureDir(this.root);
    this.config = { ...defaultConfig(), ...(readJsonSync(join(this.root, 'config.json'), {}) ?? {}) };
    const registry = readJsonSync(join(this.root, 'registry.json'), null);
    if (registry !== null && typeof registry === 'object') {
      this.registry = {
        version: 1,
        usedIds: Array.isArray(registry.usedIds) ? registry.usedIds.filter((id) => typeof id === 'string') : [],
        primaryBotId: typeof registry.primaryBotId === 'string' ? registry.primaryBotId : null,
      };
    }
    this.bots.clear();
    const entries = readdirSync(this.root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'groups') continue;
      const file = join(this.root, entry.name, 'bot.json');
      const bot = readJsonSync(file, null);
      if (bot === null || typeof bot !== 'object' || typeof bot.id !== 'string') continue;
      this.bots.set(bot.id, {
        ...bot,
        workspaceId: this.id,
        workspacePath: this.path,
      });
      if (!this.registry.usedIds.includes(bot.id)) this.registry.usedIds.push(bot.id);
    }
    this.groups.clear();
    const groupRoot = join(this.root, 'groups');
    if (existsSync(groupRoot)) {
      for (const entry of readdirSync(groupRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const group = readJsonSync(join(groupRoot, entry.name, 'group.json'), null);
        if (group === null || typeof group !== 'object' || typeof group.id !== 'string') continue;
        this.groups.set(group.id, { ...group, workspaceId: this.id, workspacePath: this.path });
      }
    }
  }

  /** @returns {object} workspace identity for snapshots. */
  summary() {
    return {
      id: this.id,
      title: this.title,
      path: this.path,
      missing: this.missing,
      root: this.root,
    };
  }

  /** @returns {object[]} every bot, ordered for display. */
  listBots() {
    const bots = [...this.bots.values()];
    return bots.sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      if ((a.section ?? '') !== (b.section ?? '')) return String(a.section ?? '').localeCompare(String(b.section ?? ''));
      return String(a.createdAt).localeCompare(String(b.createdAt));
    });
  }

  /**
   * @param {string} botId bot id.
   * @returns {object | undefined} the bot record.
   */
  getBot(botId) {
    return this.bots.get(botId);
  }

  /**
   * Persist one bot record (bot.json is the source of truth).
   * @param {object} bot normalized bot.
   * @returns {object} the stored bot.
   */
  saveBot(bot) {
    ensureDir(join(this.root, bot.id));
    writeJsonAtomicSync(join(this.root, bot.id, 'bot.json'), bot);
    this.bots.set(bot.id, bot);
    return bot;
  }

  /**
   * Allocate a never-reused bot id from a display name.
   * @param {string} name display name.
   * @returns {string} fresh id.
   */
  allocateBotId(name) {
    const slug = String(name ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^[-]+|[-]+$/g, '')
      .slice(0, 24);
    const base = slug === '' ? 'bot' : slug;
    let candidate = base;
    let counter = 2;
    while (this.bots.has(candidate) || this.registry.usedIds.includes(candidate)) {
      candidate = `${base}-${counter}`;
      counter += 1;
      if (counter > 999) {
        candidate = `${base}-${newId().slice(0, 6)}`;
        break;
      }
    }
    return candidate;
  }

  /**
   * Create one bot record; the caller attaches its session afterwards.
   * @param {object} input create payload.
   * @returns {object} stored bot.
   */
  createBot(input) {
    const bot = normalizeBot(
      { ...input, workspaceId: this.id, workspacePath: this.path },
      undefined,
      (name) => this.allocateBotId(name),
    );
    this.registry.usedIds.push(bot.id);
    if (this.registry.primaryBotId === null) this.registry.primaryBotId = bot.id;
    this.writeRegistry();
    this.saveBot(bot);
    this.ensureBotDirs(bot.id);
    // A template or an import may carry routines without a planned fire time;
    // seed it now so the scheduler sees them on its next replan.
    const routines = bot.routines.map((routine) =>
      routine.enabled && routine.nextAt === null
        ? { ...routine, nextAt: new Date(computeNextAt(routine.when, Date.now())).toISOString() }
        : routine,
    );
    if (routines.some((routine, index) => routine !== bot.routines[index])) {
      return this.updateBot(bot.id, { routines });
    }
    return bot;
  }

  /**
   * Apply one update to a bot record.
   * @param {string} botId bot id.
   * @param {object} patch fields to change.
   * @returns {object} stored bot.
   */
  updateBot(botId, patch) {
    const previous = this.bots.get(botId);
    if (previous === undefined) throw new Error(`unknown bot "${botId}"`);
    const bot = normalizeBot({ ...previous, ...patch }, previous);
    this.saveBot(bot);
    return bot;
  }

  /** @param {string} botId bot id. */
  ensureBotDirs(botId) {
    ensureDir(join(this.root, botId, 'memory'));
    const memoryFile = join(this.root, botId, 'memory', 'MEMORY.md');
    if (!existsSync(memoryFile)) {
      writeTextAtomicSync(memoryFile, `# ${botId} 的长期记忆\n\n`);
    }
  }

  /** @param {string} botId bot id. */
  deleteBot(botId) {
    const dir = join(this.root, botId);
    rmSync(dir, { recursive: true, force: true });
    this.bots.delete(botId);
    writeJsonAtomicSync(join(this.root, 'registry.json'), this.registry);
  }

  /** Persist the id bookkeeping file. */
  writeRegistry() {
    this.registry.primaryBotId = this.config.primaryBotId ?? this.registry.primaryBotId ?? null;
    writeJsonAtomicSync(join(this.root, 'registry.json'), {
      version: 1,
      usedIds: this.registry.usedIds,
      primaryBotId: this.registry.primaryBotId,
    });
  }

  /** @param {object} patch config changes. */
  updateConfig(patch) {
    this.config = { ...maintenanceConfig(this.config), ...patch, version: 1 };
    if (this.config.primaryBotId !== null && !this.bots.has(this.config.primaryBotId)) this.config.primaryBotId = null;
    writeJsonAtomicSync(join(this.root, 'config.json'), this.config);
    if (this.registry.primaryBotId !== this.config.primaryBotId) {
      this.registry.primaryBotId = this.config.primaryBotId;
      this.writeRegistry();
    }
    return this.config;
  }

  /* ------------------------------------------------------------------ groups */

  /**
   * @param {object} input group payload.
   * @param {object} [previous] existing group.
   * @returns {object} stored group.
   */
  saveGroup(input, previous) {
    const group = normalizeGroup(
      { ...input, workspaceId: this.id, workspacePath: this.path },
      previous,
      (members) => {
        for (const member of members) {
          if (!this.bots.has(member)) throw new Error(`unknown bot "${member}"`);
        }
        if (members.length > this.config.maxGroupMembers) throw new Error(`a room allows at most ${this.config.maxGroupMembers} bots`);
      },
    );
    ensureDir(join(this.root, 'groups', group.id));
    writeJsonAtomicSync(join(this.root, 'groups', group.id, 'group.json'), group);
    this.groups.set(group.id, group);
    return group;
  }

  /**
   * @param {string} groupId room id.
   * @returns {object | undefined} the room definition.
   */
  getGroup(groupId) {
    return this.groups.get(groupId);
  }

  /** @param {string} groupId room id. */
  deleteGroup(groupId) {
    rmSync(join(this.root, 'groups', groupId), { recursive: true, force: true });
    this.groups.delete(groupId);
  }

  /**
   * Append one room message.
   * @param {string} groupId room id.
   * @param {object} message room message.
   */
  appendRoomMessage(groupId, message) {
    appendJsonlSync(join(this.root, 'groups', groupId, 'room.jsonl'), message);
  }

  /**
   * @param {string} groupId room id.
   * @param {number} [limit] newest rows.
   * @returns {object[]} run rows.
   */
  readRoom(groupId, limit = 100) {
    return readJsonlSync(join(this.root, 'groups', groupId, 'room.jsonl'), limit);
  }

  /**
   * Append one room-turn summary row.
   * @param {string} groupId room id.
   * @param {object} run turn summary.
   */
  appendGroupRun(groupId, run) {
    appendJsonlSync(join(this.root, 'groups', groupId, 'runs.jsonl'), run);
  }

  /**
   * @param {string} groupId room id.
   * @param {number} [limit] newest rows.
   * @returns {object[]} room-turn summaries.
   */
  readGroupRuns(groupId, limit = 100) {
    return readJsonlSync(join(this.root, 'groups', groupId, 'runs.jsonl'), limit);
  }

  /**
   * Append one run row for a bot.
   * @param {string} botId bot id.
   * @param {object} run run result.
   */
  appendBotRun(botId, run) {
    appendJsonlSync(join(this.root, botId, 'runs.jsonl'), run);
  }

  /**
   * @param {string} botId bot id.
   * @param {number} [limit] newest rows.
   * @returns {object[]} run rows.
   */
  readBotRuns(botId, limit = 200) {
    return readJsonlSync(join(this.root, botId, 'runs.jsonl'), limit);
  }

  /* ------------------------------------------------------------------ memory */

  /** @param {string} botId bot id. @returns {string} memory file path. */
  memoryFile(botId) {
    return join(this.root, botId, 'memory', 'MEMORY.md');
  }

  /** @param {string} botId bot id. @returns {string} the memory text. */
  readMemory(botId) {
    return readTextSync(this.memoryFile(botId), '');
  }

  /**
   * @param {string} botId bot id.
   * @param {string} text complete memory text.
   */
  writeMemory(botId, text) {
    const normalized = String(text ?? '');
    const withHeader = normalized.startsWith('# ') ? normalized : `# ${botId} 的长期记忆\n\n${normalized}`;
    writeTextAtomicSync(this.memoryFile(botId), withHeader);
  }

  /** @returns {string} workspace-shared facts. */
  readSharedFacts() {
    return readTextSync(join(this.root, 'shared-facts.md'), '');
  }

  /** @param {string} text new shared-facts content. */
  writeSharedFacts(text) {
    writeTextAtomicSync(join(this.root, 'shared-facts.md'), String(text ?? ''));
  }

  /**
   * Append one dated line to a bot's daily log.
   * @param {string} botId bot id.
   * @param {string} text log text.
   * @param {string} dateKey local day key.
   */
  appendDailyLog(botId, text, dateKey) {
    const file = join(this.root, botId, 'memory', `${dateKey}.md`);
    ensureDir(join(this.root, botId, 'memory'));
    const existing = readTextSync(file, '');
    const next = `${existing}${existing.trim() === '' ? '' : '\n'}- ${String(text).trim()}\n`;
    writeTextAtomicSync(file, next);
  }

  /**
   * Recent daily logs, newest first.
   * @param {string} botId bot id.
   * @param {number} [days] days to include.
   * @returns {Array<{day: string, text: string}>} log windows.
   */
  recentDailyLogs(botId, days = 3) {
    const dir = join(this.root, botId, 'memory');
    if (!existsSync(dir)) return [];
    const keys = [];
    for (let i = 0; i < days; i += 1) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const p = (n) => String(n).padStart(2, '0');
      keys.push(`${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`);
    }
    return keys
      .map((day) => ({ day, text: readTextSync(join(dir, `${day}.md`), '') }))
      .filter((entry) => entry.text.trim() !== '');
  }

  /**
   * Build the memory block injected into this bot's prompt.
   * @param {string} botId bot id.
   * @param {number} [budget] character budget.
   * @returns {{text: string, chars: number, truncated: boolean}} block.
   */
  renderMemory(botId, budget = MEMORY_BUDGET_CHARS) {
    return renderMemoryBlock(
      {
        memory: this.readMemory(botId),
        shared: this.readSharedFacts(),
        daily: this.recentDailyLogs(botId),
      },
      budget,
    );
  }

  /** @param {string} botId bot id. @returns {number} memory bytes. */
  memoryBytes(botId) {
    const file = this.memoryFile(botId);
    try {
      return statSync(file).size;
    } catch {
      return 0;
    }
  }
}

/**
 * Keep config keys that are not part of the editable surface.
 * @param {object} config current config.
 * @returns {object} config with defaults filled.
 */
function maintenanceConfig(config) {
  return { ...defaultConfig(), ...(config ?? {}) };
}

/**
 * Every workspace store this plugin knows about.
 */
export class BotStoreHub {
  /**
   * @param {{workspaceRegistry?: object, workingDirectory?: object}} services host services.
   * @param {(level: string, message: string) => void} log logger.
   */
  constructor(services, log) {
    this.services = services;
    this.log = log;
    /** @type {Map<string, WorkspaceStore>} */
    this.stores = new Map();
  }

  /** Reload every registered workspace, keeping stores for disappeared paths. */
  refresh() {
    const registry = this.services.workspaceRegistry;
    if (registry === undefined || registry === null) {
      this.log('warn', 'dsh-grok-bot: workspaceRegistry is unavailable; no workspace can host bots');
      return;
    }
    for (const workspace of registry.list()) {
      /** @type {WorkspaceStore} */
      let store = this.stores.get(workspace.path);
      if (store === undefined) {
        store = new WorkspaceStore(workspace, this.log);
        this.stores.set(workspace.path, store);
      } else {
        store.workspace = workspace;
        store.id = workspace.id;
        store.title = workspace.title;
      }
      try {
        store.load();
      } catch (error) {
        this.log('warn', `dsh-grok-bot: could not load workspace ${workspace.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * @param {string} path workspace path.
   * @returns {WorkspaceStore | undefined} the store.
   */
  byPath(path) {
    return this.stores.get(path);
  }

  /**
   * @param {string} workspaceId host workspace id.
   * @returns {WorkspaceStore | undefined} the store.
   */
  byId(workspaceId) {
    for (const store of this.stores.values()) {
      if (store.id === workspaceId) return store;
    }
    return undefined;
  }

  /** @returns {WorkspaceStore[]} every loaded store. */
  list() {
    return [...this.stores.values()];
  }

  /**
   * Resolve the store a create request targets.
   * @param {{workspaceId?: string, workspacePath?: string}} input placement.
   * @returns {WorkspaceStore} the target store.
   */
  resolveStore(input) {
    if (typeof input?.workspacePath === 'string' && input.workspacePath !== '') {
      const store = this.stores.get(input.workspacePath) ?? this.byId(input.workspacePath);
      if (store !== undefined) return store;
    }
    if (typeof input?.workspaceId === 'string') {
      const store = this.byId(input.workspaceId);
      if (store !== undefined) return store;
    }
    const primary = this.list().filter((store) => !store.missing);
    if (primary.length > 0) return primary[0];
    for (const store of this.list()) return store;
    throw new Error('no workspace is registered; create a workspace before creating a bot');
  }

  /**
   * Find the bot bound to a session.
   * @param {string} sessionId session id.
   * @returns {{store: WorkspaceStore, bot: object} | undefined} the owner.
   */
  findBySession(sessionId) {
    for (const store of this.list()) {
      for (const bot of store.listBots()) {
        if (bot.sessionId === sessionId) return { store, bot };
      }
    }
    return undefined;
  }

  /**
   * @param {string} botId bot id.
   * @returns {{store: WorkspaceStore, bot: object} | undefined} the owner.
   */
  findById(botId) {
    for (const store of this.list()) {
      const bot = store.getBot(botId);
      if (bot !== undefined) return { store, bot };
    }
    return undefined;
  }

  /**
   * Snapshot consumed by the Web panel and the Bot engine.
   * @returns {object} the full state payload.
   */
  state() {
    const workspaces = this.list().map((store) => store.summary());
    const bots = [];
    for (const store of this.list()) {
      for (const bot of store.listBots()) {
        bots.push({
          ...bot,
          workspacePath: store.path,
          workspaceTitle: store.title,
          memoryBytes: store.memoryBytes(bot.id),
          routineCount: bot.routines.length,
        });
      }
    }
    const latestBotAt = new Map();
    for (const bot of bots) {
      const at = Date.parse(bot.createdAt);
      if (!Number.isFinite(at)) continue;
      const previous = latestBotAt.get(bot.workspacePath);
      if (previous === undefined || at > previous) latestBotAt.set(bot.workspacePath, at);
    }
    workspaces.sort((left, right) => {
      const leftAt = latestBotAt.get(left.path) ?? -1;
      const rightAt = latestBotAt.get(right.path) ?? -1;
      if (leftAt !== rightAt) return rightAt - leftAt;
      return String(left.title ?? '').localeCompare(String(right.title ?? ''), 'en', { sensitivity: 'base', numeric: true });
    });
    const groups = [];
    for (const store of this.list()) {
      for (const group of store.groups.values()) groups.push(group);
    }
    const configs = this.list().map((store) => ({ workspacePath: store.path, config: store.config }));
    const sessions = {};
    for (const bot of bots) {
      if (typeof bot.sessionId === 'string') sessions[bot.sessionId] = { botId: bot.id, workspacePath: bot.workspacePath };
    }
    return { ok: true, at: new Date().toISOString(), workspaces, bots, groups, configs, sessions };
  }
}

/**
 * @param {string} dir absolute directory.
 * @returns {string} its final segment.
 */
export function directoryName(dir) {
  return basename(dir);
}
