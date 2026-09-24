import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);

test("live Laya lab sends typed decision questions without PII", async () => {
  let body = "";
  const server = createServer((request, response) => {
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        model: "sales-decision-v0.1",
        decisions: [
          { key: "discovery", value: "high", score: 0.9, confidence: 0.9, probabilities: { high: 0.9, medium: 0.1 }, evidence: [] },
          { key: "price_objection", value: true, score: 0.9, confidence: 0.9, probabilities: { yes: 0.9, no: 0.1 }, evidence: [] },
          { key: "next_step", value: true, score: 0.9, confidence: 0.9, probabilities: { yes: 0.9, no: 0.1 }, evidence: [] },
          { key: "intent", value: 4, score: 0.8, confidence: 0.8, probabilities: { "4": 0.8, "3": 0.2 }, evidence: [] },
        ],
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const { stdout: output } = await run("npm", ["run", "system-one:lab", "--", "--provider=laya", "--live", "--calls=1"], {
      env: { ...process.env, LAYA_BASE_URL: `http://127.0.0.1:${address.port}` },
    });
    assert.match(output, /LIVE ADAPTER/);
    assert.match(output, /Throughput: [0-9.]+ calls\/min \(measured\)/);
    assert.match(body, /"questions"/);
    assert.match(body, /"discovery"/);
    assert.match(body, /"low":"No clear business pain was identified/);
    assert.doesNotMatch(body, /weak/);
    assert.doesNotMatch(body, /transcript|email|api[_ -]?key|secret/i);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
