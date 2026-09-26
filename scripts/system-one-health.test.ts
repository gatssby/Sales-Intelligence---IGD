import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);

test("System One health reports missing TypeSafe configuration without probing live availability", async () => {
  const { stdout } = await run("npm", ["run", "system-one:health"], {
    env: { ...process.env, AI_GATEWAY_API_KEY: "", JEV_API_KEY: "", TYPESAFE_API_KEY: "", JEV_TRANSPORT: "typesafe-direct" },
  });
  assert.match(stdout, /missing_typesafe_api_key/);
  assert.doesNotMatch(stdout, /"jevStatus"/);
});
