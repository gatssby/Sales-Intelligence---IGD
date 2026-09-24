import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);

test("System One health reports a missing local Vercel key without failing", async () => {
  const { stdout } = await run("npm", ["run", "system-one:health"], {
    env: { ...process.env, AI_GATEWAY_API_KEY: "", JEV_API_KEY: "" },
  });
  assert.match(stdout, /missing_ai_gateway_api_key/);
});
