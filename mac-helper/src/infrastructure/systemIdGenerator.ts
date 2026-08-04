import { randomBytes, randomUUID } from "node:crypto";
import type { IdGenerator } from "./ports.js";

const MAX_TOKEN_BYTES = 4_096;

export class SystemIdGenerator implements IdGenerator {
  randomUUID(): string {
    return randomUUID();
  }

  randomToken(bytes: number): string {
    if (!Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_TOKEN_BYTES) {
      throw new RangeError(`Token byte count must be an integer from 1 to ${MAX_TOKEN_BYTES}.`);
    }
    return randomBytes(bytes).toString("base64url");
  }
}
