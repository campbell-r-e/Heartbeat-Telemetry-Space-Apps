import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readConfig } from "../src/config.ts";

const TOKEN = { HEARTBEAT_TOKEN: "test-token" };

describe("readConfig", () => {
  it("defaults the port to 4000 and reads a valid PORT", () => {
    assert.equal(readConfig(TOKEN).port, 4000);
    assert.equal(readConfig({ ...TOKEN, PORT: "8080" }).port, 8080);
    assert.equal(readConfig({ ...TOKEN, PORT: "1" }).port, 1);
    assert.equal(readConfig({ ...TOKEN, PORT: "65535" }).port, 65535);
  });

  it("rejects a PORT that is not a whole number from 1 to 65535", () => {
    for (const PORT of ["abc", "", "0", "65536", "4000.5", "-1"]) {
      assert.throws(() => readConfig({ ...TOKEN, PORT }), /PORT/, `PORT=${JSON.stringify(PORT)}`);
    }
  });

  it("defaults HOST to 0.0.0.0 when unset and refuses an empty HOST", () => {
    assert.equal(readConfig(TOKEN).host, "0.0.0.0");
    assert.equal(readConfig({ ...TOKEN, HOST: "127.0.0.1" }).host, "127.0.0.1");
    assert.throws(() => readConfig({ ...TOKEN, HOST: "" }), /HOST/);
  });

  it("requires HEARTBEAT_TOKEN", () => {
    assert.throws(() => readConfig({}), /HEARTBEAT_TOKEN/);
  });
});
