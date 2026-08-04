export type Validator<T> = (value: unknown) => value is T;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.length > 0;
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

export function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isString);
}

export function hasString(record: Record<string, unknown>, key: string): boolean {
  return isNonEmptyString(record[key]);
}

export function hasStringValue(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key) && isString(record[key]);
}

export function hasOptionalString(record: Record<string, unknown>, key: string): boolean {
  return !hasOwn(record, key) || isString(record[key]);
}

export function hasOptionalNumber(record: Record<string, unknown>, key: string): boolean {
  return !hasOwn(record, key) || isFiniteNumber(record[key]);
}

export function hasOptionalNullableNumber(record: Record<string, unknown>, key: string): boolean {
  return !hasOwn(record, key) || record[key] === null || isFiniteNumber(record[key]);
}

export function hasOptionalBoolean(record: Record<string, unknown>, key: string): boolean {
  return !hasOwn(record, key) || isBoolean(record[key]);
}

export function hasOptionalStringArray(record: Record<string, unknown>, key: string): boolean {
  return !hasOwn(record, key) || isStringArray(record[key]);
}

export function hasOptionalRecord(record: Record<string, unknown>, key: string): boolean {
  return !hasOwn(record, key) || isRecord(record[key]);
}

export function hasNumber(record: Record<string, unknown>, key: string): boolean {
  return isFiniteNumber(record[key]);
}

export function hasBoolean(record: Record<string, unknown>, key: string): boolean {
  return isBoolean(record[key]);
}

export function hasLiteral<T extends string>(
  record: Record<string, unknown>,
  key: string,
  values: readonly T[],
): record is Record<string, unknown> & Record<typeof key, T> {
  const value = record[key];
  return isString(value) && values.includes(value as T);
}

export function parseContract<T>(value: unknown, validator: Validator<T>, label: string): T {
  if (!validator(value)) {
    throw new TypeError(`Invalid ${label} contract`);
  }
  return value;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}
