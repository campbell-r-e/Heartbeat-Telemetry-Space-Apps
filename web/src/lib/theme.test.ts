import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { otherTheme, parseTheme } from "./theme";

describe("theme", () => {
  it("is dark unless light was chosen", () => {
    assert.equal(parseTheme("light"), "light");
    assert.equal(parseTheme(undefined), "dark");
    assert.equal(parseTheme("purple"), "dark");
  });

  it("toggles between the two", () => {
    assert.equal(otherTheme("dark"), "light");
    assert.equal(otherTheme("light"), "dark");
  });
});
