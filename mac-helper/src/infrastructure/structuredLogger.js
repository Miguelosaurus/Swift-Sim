// @ts-check
import { SystemClock } from "./systemClock.js";

/** @typedef {import("./ports.js").Clock} Clock */
/** @typedef {import("./ports.js").LogFields} LogFields */
/** @typedef {import("./ports.js").LogLevel} LogLevel */
/** @typedef {import("./ports.js").Logger} Logger */
/** @typedef {(line: string) => void} LogWriter */

const LEVELS = new Set(["debug", "info", "warn", "error"]);
const EVENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SENSITIVE_FIELD_PATTERN = /(?:authorization|cookie|credential|invite|password|private.?key|secret|token)/i;
const MAX_DEPTH = 6;
const MAX_COLLECTION_ENTRIES = 100;
const MAX_STRING_LENGTH = 4_096;
const REDACTED = "[REDACTED]";

/** @implements {Logger} */
export class StructuredLogger {
  /**
   * @param {{ writer?: LogWriter, clock?: Clock, fields?: LogFields }} [options]
   */
  constructor({
    writer = defaultWriter,
    clock = new SystemClock(),
    fields = {},
  } = {}) {
    if (typeof writer !== "function") throw new TypeError("Logger writer must be a function.");
    this.writer = writer;
    this.clock = clock;
    this.fields = Object.freeze({ ...fields });
  }

  /** @param {LogLevel} level @param {string} event @param {LogFields} [fields] */
  log(level, event, fields = {}) {
    if (!LEVELS.has(level)) throw new RangeError("Logger level is invalid.");
    if (typeof event !== "string" || !EVENT_PATTERN.test(event)) {
      throw new TypeError("Logger event must be a bounded structured identifier.");
    }
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      throw new TypeError("Logger fields must be an object.");
    }
    const combined = { ...this.fields, ...fields };
    const record = {
      timestamp: this.clock.now().toISOString(),
      level,
      event,
      fields: sanitizeValue(combined, "fields", 0, new WeakSet()),
    };
    try {
      this.writer(JSON.stringify(record));
    } catch {
      // Logging must never change the outcome of the operation being observed.
    }
  }

  /** @param {LogFields} fields */
  child(fields) {
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      throw new TypeError("Child logger fields must be an object.");
    }
    return new StructuredLogger({
      writer: this.writer,
      clock: this.clock,
      fields: { ...this.fields, ...fields },
    });
  }
}

/**
 * @param {unknown} value
 * @param {string} key
 * @param {number} depth
 * @param {WeakSet<object>} seen
 * @returns {unknown}
 */
function sanitizeValue(value, key, depth, seen) {
  if (SENSITIVE_FIELD_PATTERN.test(key)) return REDACTED;
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return truncate(value.replace(/[\r\n]+/g, " "));
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined") return "[undefined]";
  if (typeof value === "function" || typeof value === "symbol") return `[${typeof value}]`;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "[invalid date]" : value.toISOString();
  if (value instanceof Error) {
    const code = errorCode(value);
    return code ? { name: value.name, code } : { name: value.name };
  }
  if (depth >= MAX_DEPTH) return "[depth limited]";
  if (!value || typeof value !== "object") return truncate(String(value));
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const result = value
        .slice(0, MAX_COLLECTION_ENTRIES)
        .map((item) => sanitizeValue(item, "item", depth + 1, seen));
      if (value.length > MAX_COLLECTION_ENTRIES) result.push("[truncated]");
      return result;
    }
    const result = {};
    const entries = Object.entries(value).slice(0, MAX_COLLECTION_ENTRIES);
    for (const [entryKey, entryValue] of entries) {
      result[entryKey] = sanitizeValue(entryValue, entryKey, depth + 1, seen);
    }
    if (Object.keys(value).length > MAX_COLLECTION_ENTRIES) result.__truncated = true;
    return result;
  } finally {
    seen.delete(value);
  }
}

/** @param {string} value */
function truncate(value) {
  return value.length <= MAX_STRING_LENGTH
    ? value
    : `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]`;
}

/** @param {Error} error */
function errorCode(error) {
  if (!("code" in error)) return "";
  const code = error.code;
  return typeof code === "string" || typeof code === "number" ? String(code) : "";
}

/** @param {string} line */
function defaultWriter(line) {
  process.stderr.write(`${line}\n`);
}
