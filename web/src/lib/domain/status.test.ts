import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NO_STATUS_LOOK, areaReason, areaStatus, attentionItems, statusLook } from "./status";
import { evaluationFixture as evaluation, statusFixture } from "./test-fixtures";

const status = statusFixture({ radiation: "alert", mind: "watch", cabin: "normal", gravity: null }, [
  evaluation("old-watch", "watch", "2026-11-14T01:00:00Z"),
  evaluation("spike", "alert", "2026-11-14T02:00:00Z"),
  evaluation("mood", "watch", "2026-11-14T03:00:00Z", "mind"),
  evaluation("ok", "normal", "2026-11-14T04:00:00Z", "cabin"),
]);

describe("statusLook", () => {
  it("gives every status a symbol as well as a tone", () => {
    assert.deepEqual([statusLook("normal").symbol, statusLook("watch").symbol, statusLook("alert").symbol], ["●", "▲", "■"]);
  });

  it("uses the neutral No status look for null", () => {
    assert.equal(statusLook(null), NO_STATUS_LOOK);
    assert.equal(NO_STATUS_LOOK.label, "No status");
  });
});

describe("without a status", () => {
  it("has no area status, reason or attention items", () => {
    assert.equal(areaStatus(null, "vitals"), null);
    assert.equal(areaReason(null, "vitals"), null);
    assert.deepEqual(attentionItems(null), []);
  });
});

describe("attentionItems", () => {
  it("lists alerts above watches, newest first, and leaves out normal", () => {
    assert.deepEqual(attentionItems(status).map((e) => e.ruleId), ["spike", "mood", "old-watch"]);
  });

  it("can be limited to one area", () => {
    assert.deepEqual(attentionItems(status, "mind").map((e) => e.ruleId), ["mood"]);
  });
});

describe("areaStatus and areaReason", () => {
  it("read each area's status; an unrated or missing area has none", () => {
    assert.equal(areaStatus(status, "radiation"), "alert");
    assert.equal(areaStatus(status, "gravity"), null);
    assert.equal(areaStatus(status, "nutrition"), null);
  });

  it("show the server's reason for an unrated area", () => {
    const withReason = { ...status, areas: [{ area: "vitals" as const, status: null, reason: "Baseline needs more days" }] };
    assert.equal(areaReason(withReason, "vitals"), "Baseline needs more days");
  });
});
