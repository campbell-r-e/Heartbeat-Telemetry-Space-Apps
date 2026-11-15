// Reading untrusted form fields in server actions. Each returns null for anything invalid.

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const POSITIVE_INT_PATTERN = /^[1-9]\d*$/;

/** A plain id (letters, digits, "-" and "_"), as the server uses for astronauts and foods. */
export function parseId(raw: FormDataEntryValue | null): string | null {
  return typeof raw === "string" && ID_PATTERN.test(raw) ? raw : null;
}

/**
 * An optional id field: `{ value: null }` when left out or empty, `{ value }` for a plain id, and
 * null for anything else (refused, never quietly dropped).
 */
export function parseOptionalId(raw: FormDataEntryValue | null): { value: string | null } | null {
  if (raw === null || raw === "") return { value: null };
  const id = parseId(raw);
  return id === null ? null : { value: id };
}

/** Text with at least one visible character, trimmed (the server trims and checks it again). */
export function parseText(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  return text === "" ? null : text;
}

/**
 * An optional number field: `{ value: null }` when left empty, `{ value }` for a number, and null for
 * anything else. Ranges are the server's to check; it answers 400 with the reason.
 */
export function parseOptionalNumber(raw: FormDataEntryValue | null): { value: number | null } | null {
  if (raw === null || (typeof raw === "string" && raw.trim() === "")) return { value: null };
  if (typeof raw !== "string") return null;
  const value = Number(raw.trim());
  return Number.isFinite(value) ? { value } : null;
}

/** One of `options`, or null. */
export function parseChoice<T extends string>(raw: FormDataEntryValue | null, options: readonly T[]): T | null {
  return options.find((option) => option === raw) ?? null;
}

/** A whole number of 1 or more. */
export function parsePositiveInt(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== "string" || !POSITIVE_INT_PATTERN.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}
