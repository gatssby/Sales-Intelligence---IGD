import assert from "node:assert/strict";
import test from "node:test";

import { parsePocFailRequest } from "../lib/poc-request-validation";

test("POC fail request accepts bounded string identifiers and an explicit boolean retry policy", () => {
  assert.deepEqual(
    parsePocFailRequest({ workerId: "worker-1", jobId: "00000000-0000-0000-0000-000000000001", errorCode: "timeout", retryable: true }),
    { workerId: "worker-1", jobId: "00000000-0000-0000-0000-000000000001", errorCode: "timeout", retryable: true },
  );
});

test("POC fail request rejects truthy retry values and malformed error codes", () => {
  assert.equal(parsePocFailRequest({ workerId: "worker-1", jobId: "job", errorCode: "timeout", retryable: "false" }), null);
  assert.equal(parsePocFailRequest({ workerId: "worker-1", jobId: "job", errorCode: "", retryable: false }), null);
});
