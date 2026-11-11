/**
 * dsh-grok-bot — small host-side helpers shared by every subsystem.
 *
 * Everything a Bot keeps is a plain file under the workspace, so the helpers
 * here are deliberately boring: atomic JSON writes (tmp + rename), JSONL
 * appends, synchronous reads for prompt assembly, and a per-key write queue.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Ensure one directory exists.
 * @param {string} dir absolute directory path.
 */
export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

/**
 * Read one text file, returning the fallback when it is absent or unreadable.
 * @param {string} file absolute path.
 * @param {string} [fallback] value when the file cannot be read.
 * @returns {string} file text.
 */
export function readTextSync(file, fallback = '') {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

/**
 * Read and parse one JSON file.
 * @param {string} file absolute path.
 * @param {any} [fallback] value when the file is absent or invalid.
 * @returns {any} parsed value.
 */
export function readJsonSync(file, fallback = undefined) {
  const text = readTextSync(file, '');
  if (text.trim() === '') return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/**
 * Replace one file atomically: write a sibling temp file, then rename it into
 * place. A reader therefore always observes either the old or the new content.
 * @param {string} file absolute path.
 * @param {string} text file content.
 */
export function writeTextAtomicSync(file, text) {
  ensureDir(dirname(file));
  const tmp = `${file}.tmp-${randomUUID()}`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, file);
}

/**
 * Atomically persist one JSON document with two-space indentation.
 * @param {string} file absolute path.
 * @param {unknown} value JSON-serializable value.
 */
export function writeJsonAtomicSync(file, value) {
  writeTextAtomicSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Append one JSON line to a JSONL file.
 * @param {string} file absolute path.
 * @param {unknown} row JSON-serializable row.
 */
export function appendJsonlSync(file, row) {
  ensureDir(dirname(file));
  appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8');
}

/**
 * Read the last `limit` rows of a JSONL file, skipping malformed lines.
 * @param {string} file absolute path.
 * @param {number} [limit] newest rows to keep.
 * @returns {any[]} parsed rows in file order.
 */
export function readJsonlSync(file, limit = 200) {
  const text = readTextSync(file, '');
  if (text.trim() === '') return [];
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  const slice = limit > 0 ? lines.slice(-limit) : lines;
  const rows = [];
  for (const line of slice) {
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* skip a torn line */
    }
  }
  return rows;
}

/** @returns {string} a freshly identified opaque id. */
export function newId() {
  return randomUUID();
}

/**
 * Clip text to a maximum length, appending an ellipsis when it was cut.
 * @param {string} text source text.
 * @param {number} max maximum characters.
 * @returns {string} clipped text.
 */
export function clip(text, max) {
  const value = typeof text === 'string' ? text : String(text ?? '');
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

/** @returns {string} the current time as an ISO string. */
export function nowIso() {
  return new Date().toISOString();
}

/**
 * @param {number} [ms] epoch milliseconds.
 * @returns {string} the local calendar day key (`YYYY-MM-DD`).
 */
export function localDateKey(ms = Date.now()) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * @param {number} [ms] epoch milliseconds.
 * @returns {string} local wall-clock `HH:MM`.
 */
export function localHHMM(ms = Date.now()) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * @param {number} [ms] epoch milliseconds.
 * @returns {string} local wall-clock text with seconds and zone offset.
 */
export function localStamp(ms = Date.now()) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} (${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)})`;
}

/**
 * Serialize operations per key: each key sees at most one running task and
 * later tasks start in call order.
 */
export class KeyedQueue {
  constructor() {
    /** @type {Map<string, Promise<void>>} */
    this.tails = new Map();
  }

  /**
   * Run `task` after every earlier task for `key` settled.
   * @template T
   * @param {string} key serialization key.
   * @param {() => T | Promise<T>} task work to run.
   * @returns {Promise<T>} the task result.
   */
  run(key, task) {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(task, task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}

/**
 * Join a workspace-relative path so callers never depend on separators.
 * @param {string} root absolute root.
 * @param {...string} parts path segments.
 * @returns {string} joined path.
 */
export function under(root, ...parts) {
  return join(root, ...parts);
}

/**
 * Test whether a path exists.
 * @param {string} file absolute path.
 * @returns {boolean} existence.
 */
export function exists(file) {
  return existsSync(file);
}
