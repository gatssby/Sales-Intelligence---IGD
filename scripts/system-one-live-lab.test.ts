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
        answers: {
          discovery: { type: "choice", choice: "high", confidence: 0.9, probabilities: { low: 0.05, medium: 0.05, high: 0.9 } },
          price_objection: { type: "noul", noul: 0.9 },
          next_step: { type: "noul", noul: 0.9 },
          intent: { type: "score", score: 2.8, confidence: 0.8, probabilities: [0.02, 0.03, 0.05, 0.8, 0.1], legend: { "0": "1", "1": "2", "2": "3", "3": "4", "4": "5" } },
        },
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
    assert.match(output, /Model: sales-decision/);
    assert.match(output, /HTTP status: local/);
    assert.match(output, /Usage \.+ Input tokens: 0  Output tokens: 0/);
    assert.match(output, /Probabilities: \{"low":0.05,"medium":0.05,"high":0.9\}/);
    assert.match(body, /"questions"/);
    assert.match(body, /"discovery"/);
    assert.match(body, /"intent":\{"type":"score","instructions":"Rate the synthetic buyer intent from one to five.","levels":\["1","2","3","4","5"\]\}/);
    assert.match(body, /"low":"No clear business pain was identified/);
    assert.doesNotMatch(body, /weak/);
    assert.doesNotMatch(body, /transcript|email|api[_ -]?key|secret/i);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
