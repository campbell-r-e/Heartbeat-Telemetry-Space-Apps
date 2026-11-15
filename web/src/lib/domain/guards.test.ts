import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { arrayOf, isNumber, isString, keysOf, nullable, oneOf, optional, shape } from "./guards";

describe("guards", () => {
  it("list every member of a union from a record keyed by it", () => {
    assert.deepEqual(keysOf<"a" | "b">({ a: true, b: true }), ["a", "b"]);
  });

  it("check shapes, allowing extra fields, nulls and missing optionals where declared", () => {
    const isPoint = shape<{ x: number; label: string | null; note?: string }>({ x: isNumber, label: nullable(isString), note: optional(isString) });
    assert.equal(isPoint({ x: 1, label: null, extra: true }), true);
    assert.equal(isPoint({ x: "1", label: null }), false);
    assert.equal(arrayOf(oneOf(["a", "b"] as const))(["a", "c"]), false);
  });
});
