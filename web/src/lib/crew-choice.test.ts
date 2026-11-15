import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Astronaut } from "@heartbeat/shared";
import { chooseAstronaut } from "./crew-choice";

describe("chooseAstronaut (crew picker, decision 13)", () => {
  const astronaut = (id: string): Astronaut => ({ id, name: id, watchId: null, age: null, sex: null, massKg: null, heightM: null });
  const crew = [astronaut("a1"), astronaut("a2")];

  it("defaults to the first astronaut", () => {
    assert.equal(chooseAstronaut(crew, undefined)?.id, "a1");
  });

  it("uses the remembered astronaut while they are on the crew", () => {
    assert.equal(chooseAstronaut(crew, "a2")?.id, "a2");
    assert.equal(chooseAstronaut(crew, "gone")?.id, "a1");
  });

  it("is null for an empty crew", () => {
    assert.equal(chooseAstronaut([], "a1"), null);
  });
});
