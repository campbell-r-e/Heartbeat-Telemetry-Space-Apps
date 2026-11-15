// Small runtime type guards for checking onboard-server responses at the boundary, so a changed
// response shape fails loudly where it enters instead of deep inside rendering.

export type Guard<T> = (value: unknown) => value is T;

/**
 * Every member of a string union, from a record keyed by that union: the compiler rejects the record
 * when a member is missing, so the list stays complete when the union grows.
 */
export function keysOf<K extends string>(record: Record<K, unknown>): K[] {
  return Object.keys(record) as K[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const isString: Guard<string> = (value): value is string => typeof value === "string";
export const isNumber: Guard<number> = (value): value is number => typeof value === "number" && Number.isFinite(value);
export const isBoolean: Guard<boolean> = (value): value is boolean => typeof value === "boolean";

export function nullable<T>(guard: Guard<T>): Guard<T | null> {
  return (value): value is T | null => value === null || guard(value);
}

/** A field that may be missing (undefined) or hold a value of the guarded type. */
export function optional<T>(guard: Guard<T>): Guard<T | undefined> {
  return (value): value is T | undefined => value === undefined || guard(value);
}

export function arrayOf<T>(guard: Guard<T>): Guard<T[]> {
  return (value): value is T[] => Array.isArray(value) && value.every(guard);
}

export function oneOf<T extends string>(values: readonly T[]): Guard<T> {
  return (value): value is T => typeof value === "string" && (values as readonly string[]).includes(value);
}

export function recordOf<T>(guard: Guard<T>): Guard<Record<string, T>> {
  return (value): value is Record<string, T> => isRecord(value) && Object.values(value).every(guard);
}

/** An object whose every listed field passes its guard; extra fields are allowed. */
export function shape<T>(fields: { [K in keyof T]-?: Guard<T[K]> }): Guard<T> {
  return (value): value is T => isRecord(value) && Object.entries(fields).every(([key, guard]) => (guard as Guard<unknown>)(value[key]));
}
