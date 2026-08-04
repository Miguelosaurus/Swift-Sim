// @ts-check
import { randomBytes, randomUUID } from "node:crypto";

/** @typedef {import("./ports.js").IdGenerator} IdGenerator */

const MAX_TOKEN_BYTES = 4_096;

/** @implements {IdGenerator} */
export class SystemIdGenerator {
  /** @returns {string} */
  randomUUID() {
    return randomUUID();
  }

  /**
   * @param {number} bytes
   * @returns {string}
   */
  randomToken(bytes) {
    if (!Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_TOKEN_BYTES) {
      throw new RangeError(`Token byte count must be an integer from 1 to ${MAX_TOKEN_BYTES}.`);
    }
    return randomBytes(bytes).toString("base64url");
  }
}
