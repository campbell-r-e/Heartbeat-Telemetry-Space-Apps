// Every rule's title and three-part message must match the approved set (message audit,
// 2026-11-14, docs/message-audit-2026-11-14.md), so wording cannot drift silently. A deliberate
// change updates test/fixtures/approved-messages.json in the same commit, for review.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { RULES } from "../src/domain/rules/catalog.ts";

const approved: Record<string, { title: string; what: string; why: string; do: string }> = JSON.parse(
  readFileSync(new URL("./fixtures/approved-messages.json", import.meta.url), "utf8"),
);

describe("approved messages", () => {
  it("covers exactly the rules in the catalog", () => {
    assert.deepEqual(RULES.map((r) => r.id).sort(), Object.keys(approved).sort());
  });

  it("matches every rule's title, what, why and do", () => {
    for (const rule of RULES) assert.deepEqual({ title: rule.title, ...rule.message }, approved[rule.id], rule.id);
  });

  it("says the alert was sent, not received, and drops the claims the audit removed", () => {
    const all = JSON.stringify(approved);
    for (const removed of ["has been notified", "fluid shift", "2 hours a day", "slows thinking", "dehydration", "at this time"]) {
      assert.ok(!all.includes(removed), removed);
    }
  });
});
