import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scriptPath = new URL("./setup-laya-local.sh", import.meta.url);

test("Laya setup prepares only the source and stops before the model download", async () => {
  const script = await readFile(scriptPath, "utf8");
  assert.match(script, /git clone https:\/\/github\.com\/afshinm\/laya-mps\.git/);
  assert.match(script, /LAYA_MPS_REV:-cdbf19e1aa5bd763ce4777d7a915849510514349/);
  assert.match(script, /git checkout --detach "\$laya_rev"/);
  assert.match(script, /serve\.sh --memory reduced --device mps --port 8000/);
  assert.doesNotMatch(script, /uv sync|laya-mps doctor/);
});
