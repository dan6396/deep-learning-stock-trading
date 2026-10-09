import { test } from "node:test";
import assert from "node:assert/strict";
import { createInterceptionTracker } from "./cdp-browser.mjs";

const invalid = () => Object.assign(new Error("Invalid InterceptionId."), { code: -32602 });
const context = { targetId: "page-A", session: "page-websocket", requestId: "fetch-A", networkId: "network-A", method: "Fetch.continueRequest" };
test("confirmed same-request cancellation is retained as protocol-race evidence", async () => {
  const tracker = createInterceptionTracker(20);
  tracker.loadingFailed({ requestId: "network-A", canceled: true, errorText: "net::ERR_ABORTED" });
  assert.equal(await tracker.failed(invalid(), context), true);
  assert.equal(tracker.cancelled[0].loadingFailed.requestId, "network-A");
  assert.equal(tracker.errors.length, 0);
});
test("cancellation event arriving after the command error is correlated", async () => {
  const tracker = createInterceptionTracker(50), result = tracker.failed(invalid(), context);
  tracker.loadingFailed({ requestId: "network-A", canceled: true });
  assert.equal(await result, true);
});
test("missing or different network cancellation remains an error", async () => {
  const tracker = createInterceptionTracker(1);
  tracker.loadingFailed({ requestId: "network-B", canceled: true });
  assert.equal(await tracker.failed(invalid(), context), false);
  assert.equal(await tracker.failed(invalid(), { ...context, networkId: undefined }), false);
  assert.equal(tracker.errors.length, 2);
});
test("non-cancelled loading failure and unrelated CDP errors remain errors", async () => {
  const tracker = createInterceptionTracker(1);
  tracker.loadingFailed({ requestId: "network-A", canceled: false, errorText: "net::ERR_FAILED" });
  assert.equal(await tracker.failed(invalid(), context), false);
  tracker.loadingFailed({ requestId: "network-A", canceled: true });
  assert.equal(await tracker.failed(new Error("CDP timeout"), context), false);
  assert.equal(tracker.cancelled.length, 0);
});
