// Checks that parsed JSON has the shape the code relies on, so a bad data file fails with the
// file and the first bad entry named, instead of loading undefined values. The field checks are
// typed against the interface they assert, so an interface field without a check does not compile.

export type Check = (value: unknown) => boolean;

/** One check per field of T, optional fields included (a missing field fails the type check). */
export type FieldChecks<T> = { [K in keyof T]-?: Check };

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const isString: Check = (v) => typeof v === "string";
export const isNumber: Check = (v) => typeof v === "number" && Number.isFinite(v);
export const isInteger: Check = (v) => Number.isInteger(v);
export const isTime: Check = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));
export const orNull = (check: Check): Check => (v) => v === null || check(v);
export const optional = (check: Check): Check => (v) => v === undefined || check(v);
export const isStringMap: Check = (v) => isRecord(v) && Object.values(v).every(isString);
export const isNumberPair: Check = (v) => Array.isArray(v) && v.length === 2 && v.every(isNumber);

export function fail(file: string, where: string, problem: string): never {
  throw new Error(`${file}: ${where} ${problem}`);
}

/** Checks `value` is an array whose every entry has T's fields; names the first bad entry. */
export function checkArray<T>(file: string, where: string, value: unknown, fields: FieldChecks<T>): asserts value is T[] {
  if (!Array.isArray(value)) fail(file, where, "is not an array");
  value.forEach((entry, i) => checkObject<T>(file, `${where}[${i}]`, entry, fields));
}

/** Checks `value` is an array whose every entry passes `check`, which must hold only for a T; names the first bad entry. */
export function checkEach<T>(file: string, where: string, value: unknown, check: Check): asserts value is T[] {
  if (!Array.isArray(value)) fail(file, where, "is not an array");
  value.forEach((entry, i) => checkValue<T>(file, `${where}[${i}]`, entry, check));
}

/** Checks `value` is an object with T's fields. */
export function checkObject<T>(file: string, where: string, value: unknown, fields: FieldChecks<T>): asserts value is T {
  if (!isRecord(value)) fail(file, where, "is not an object");
  for (const [key, check] of Object.entries<Check>(fields)) {
    checkValue(file, `${where}.${key}`, value[key], check);
  }
}

/** Checks one value with `check`, which must hold only for a T. */
export function checkValue<T>(file: string, where: string, value: unknown, check: Check): asserts value is T {
  if (!check(value)) fail(file, where, `has an unexpected value: ${JSON.stringify(value)}`);
}

/** The top-level array `key` of a JSON object, checked to hold T's fields in every entry. */
export function arrayField<T>(file: string, json: unknown, key: string, fields: FieldChecks<T>): T[] {
  const value = field(file, json, key);
  checkArray<T>(file, key, value, fields);
  return value;
}

/** The top-level `key` of a JSON object. */
export function field(file: string, json: unknown, key: string): unknown {
  if (!isRecord(json)) fail(file, "the top level", "is not an object");
  return json[key];
}
