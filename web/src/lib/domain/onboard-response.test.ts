import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isNumber } from "./guards";
import { OnboardApiError, OnboardShapeError, loadOrProblem, readOnboardResponse } from "./onboard-response";

describe("readOnboardResponse", () => {
  it("returns the checked body of a 2xx response", () => {
    assert.equal(readOnboardResponse(200, "/x", "42", isNumber), 42);
  });

  it("throws an API error carrying the status for a non-2xx response", () => {
    assert.throws(() => readOnboardResponse(404, "/api/astronauts/a1/status", "nope", isNumber), (error) => error instanceof OnboardApiError && error.isNotFound);
    assert.throws(() => readOnboardResponse(500, "/x", "boom", isNumber), (error) => error instanceof OnboardApiError && error.status === 500 && !error.isNotFound);
  });

  it("throws a shape error naming the path for the wrong shape or for non-JSON", () => {
    assert.throws(() => readOnboardResponse(200, "/x", '"42"', isNumber), (error) => error instanceof OnboardShapeError && error.path === "/x");
    assert.throws(() => readOnboardResponse(200, "/x", "<html>", isNumber), OnboardShapeError);
  });
});

describe("loadOrProblem (the status: failures shown inline, decision 16)", () => {
  it("reports a 404 as a problem, not as an empty status", async () => {
    const loaded = await loadOrProblem(async () => { throw new OnboardApiError(404, "/api/astronauts/a1/status", ""); });
    assert.deepEqual(loaded, { ok: false, problem: "the onboard server answered HTTP 404 for /api/astronauts/a1/status" });
  });

  it("rethrows a shape error so a changed response is not mistaken for a server outage", async () => {
    await assert.rejects(loadOrProblem(async () => { throw new OnboardShapeError("/status"); }), OnboardShapeError);
  });
});
