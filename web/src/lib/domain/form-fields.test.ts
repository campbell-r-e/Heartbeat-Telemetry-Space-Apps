import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseChoice, parseId, parseOptionalId, parseOptionalNumber, parsePositiveInt, parseText } from "./form-fields";

describe("form fields", () => {
  it("accept plain ids and reject path tricks", () => {
    assert.equal(parseId("scrambled-eggs"), "scrambled-eggs");
    assert.equal(parseId("../health"), null);
    assert.equal(parseId(null), null);
  });

  it("read an optional id as absent, an id, or refused when malformed", () => {
    assert.deepEqual(parseOptionalId(null), { value: null });
    assert.deepEqual(parseOptionalId(""), { value: null });
    assert.deepEqual(parseOptionalId("15"), { value: "15" });
    assert.equal(parseOptionalId("15/../acknowledge"), null);
  });

  it("accept text with a visible character, trimmed", () => {
    assert.equal(parseText("  Recheck SpO₂ in 5 min.  "), "Recheck SpO₂ in 5 min.");
    assert.equal(parseText("   "), null);
    assert.equal(parseText(null), null);
  });

  it("read an optional number as empty, a number, or invalid", () => {
    assert.deepEqual(parseOptionalNumber(""), { value: null });
    assert.deepEqual(parseOptionalNumber(null), { value: null });
    assert.deepEqual(parseOptionalNumber(" 72.5 "), { value: 72.5 });
    assert.equal(parseOptionalNumber("seventy"), null);
  });

  it("accept only a listed choice", () => {
    assert.equal(parseChoice("moon", ["iss", "moon"] as const), "moon");
    assert.equal(parseChoice("mars", ["iss", "moon"] as const), null);
    assert.equal(parseChoice(null, ["iss"] as const), null);
  });

  it("accept positive whole numbers only", () => {
    assert.equal(parsePositiveInt("42"), 42);
    for (const bad of ["0", "-1", "1.5", "01", "abc"]) assert.equal(parsePositiveInt(bad), null, bad);
  });
});
