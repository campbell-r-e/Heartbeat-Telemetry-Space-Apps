import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rejectionResult } from "./action-result";
import { OnboardApiError, OnboardShapeError } from "./domain/onboard-response";

describe("rejectionResult (how a failed dashboard write is reported)", () => {
  it("turns an onboard server rejection into a message for the form", () => {
    assert.deepEqual(rejectionResult(new OnboardApiError(401, "/api/astronauts/a1/checkins", "")), {
      ok: false,
      message: "The onboard server refused this (HTTP 401). Please try again.",
    });
  });

  it("adds the server's own explanation when it gives one", () => {
    const body = JSON.stringify({ error: "invalid_transition", message: "an alert can be acknowledged while new" });
    assert.deepEqual(rejectionResult(new OnboardApiError(409, "/api/ground/alerts/x/acknowledge", body)), {
      ok: false,
      message: "The onboard server refused this (HTTP 409): an alert can be acknowledged while new.",
    });
  });

  it("rethrows anything else so the error page reports it", () => {
    assert.throws(() => rejectionResult(new OnboardShapeError("/x")), OnboardShapeError);
    assert.throws(() => rejectionResult(new TypeError("fetch failed")), TypeError);
  });
});
