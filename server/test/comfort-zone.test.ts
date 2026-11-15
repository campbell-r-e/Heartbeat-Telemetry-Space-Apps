import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMFORT_ZONE, insideComfortZone, insideConvexPolygon, withinComfortZoneMargin, zoneWithMargin,
} from "../src/domain/status/comfort-zone.ts";

const point = (tempC: number, rhPct: number) => ({ tempC, rhPct });
const MARGIN_C = 2;
const MARGIN_RH = 10;
const withinMargin = (tempC: number, rhPct: number) => withinComfortZoneMargin(point(tempC, rhPct), MARGIN_C, MARGIN_RH);

describe("the [V2 6012] temperature + humidity zone", () => {
  it("includes its four corners and its edges", () => {
    for (const corner of COMFORT_ZONE) assert.ok(insideComfortZone(corner), JSON.stringify(corner));
    assert.ok(insideComfortZone(point(22, 75)), "top edge");
    assert.ok(insideComfortZone(point(23, 25)), "bottom edge");
  });

  it("is a slanted four-corner shape, not a rectangle", () => {
    assert.ok(insideComfortZone(point(26.5, 30)), "warm and dry is inside");
    assert.ok(!insideComfortZone(point(26.5, 70)), "warm and humid is outside");
    assert.ok(insideComfortZone(point(18.2, 70)), "cool and humid is inside");
    assert.ok(!insideComfortZone(point(18.2, 30)), "cool and dry is outside");
  });

  it("excludes points just past each edge", () => {
    assert.ok(!insideComfortZone(point(22, 75.01)));
    assert.ok(!insideComfortZone(point(23, 24.99)));
    assert.ok(!insideComfortZone(point(17.99, 75)));
    assert.ok(!insideComfortZone(point(27.01, 25)));
  });

  it("holds the real ISS cabin readings that lie inside", () => {
    assert.ok(insideComfortZone(point(24.35, 45.7)));
  });
});

describe("the 2 °C / 10% RH alert margin", () => {
  it("reaches exactly 10% RH above and below the zone", () => {
    assert.ok(withinMargin(22, 85));
    assert.ok(!withinMargin(22, 85.01));
    assert.ok(withinMargin(23, 15));
    assert.ok(!withinMargin(23, 14.99));
  });

  it("reaches exactly 2 °C beyond the left and right corners", () => {
    assert.ok(withinMargin(16, 75));
    assert.ok(!withinMargin(15.99, 75));
    assert.ok(withinMargin(29, 25));
    assert.ok(!withinMargin(29.01, 25));
  });

  it("allows both margins at once at a corner", () => {
    assert.ok(withinMargin(16, 85));
    assert.ok(!withinMargin(15.99, 85.01));
  });

  it("is the zone grown by the margins: it holds every corner moved by both margins", () => {
    const grown = zoneWithMargin(COMFORT_ZONE, MARGIN_C, MARGIN_RH);
    for (const { tempC, rhPct } of COMFORT_ZONE) {
      for (const [dt, dh] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        assert.ok(insideConvexPolygon(point(tempC + dt * MARGIN_C, rhPct + dh * MARGIN_RH), grown));
      }
    }
  });
});
