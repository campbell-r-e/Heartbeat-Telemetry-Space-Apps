import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ONE_YEAR_S, endOfUtcDay, parseClockMinutes, startOfUtcDay } from "./time";

describe("time helpers", () => {
  it("finds midnight UTC at both ends of the day", () => {
    assert.equal(startOfUtcDay(Date.parse("2026-11-14T19:22:00Z")), Date.parse("2026-11-14T00:00:00Z"));
    assert.equal(endOfUtcDay(Date.parse("2026-11-14T19:22:00Z")), Date.parse("2026-11-15T00:00:00Z"));
  });

  it("parses HH:MM and rejects anything else", () => {
    assert.equal(parseClockMinutes("09:30"), 570);
    assert.equal(parseClockMinutes("24:00"), null);
    assert.equal(parseClockMinutes("9:30"), null);
    assert.equal(parseClockMinutes("12:60"), null);
  });
});

describe("ONE_YEAR_S", () => {
  it("is a year of seconds", () => {
    assert.equal(ONE_YEAR_S, 31_536_000);
  });
});
