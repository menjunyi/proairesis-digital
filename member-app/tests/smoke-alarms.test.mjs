import test from "node:test";
import assert from "node:assert/strict";
import {
  HEARTBEAT_BOOTSTRAPS,
  alarmHistoryTransitionsToAlarm,
  alarmsOutsideOk,
  heartbeatBootstrapPlan,
  postLoadAlarmCheckAt,
  verifyHeartbeatInvocation,
  waitForAlarmsOk,
  waitUntil,
} from "../scripts/smoke-alarms.mjs";

const namesByLogicalId = new Map(
  HEARTBEAT_BOOTSTRAPS.map(({ logicalId }) => [logicalId, `physical-${logicalId}`]),
);

test("heartbeat bootstrap plans only heartbeat alarms that are not OK", () => {
  const alarms = HEARTBEAT_BOOTSTRAPS.map(({ logicalId }, index) => ({
    AlarmName: namesByLogicalId.get(logicalId),
    StateValue: index === 0 ? "OK" : index === 1 ? "INSUFFICIENT_DATA" : "ALARM",
  }));
  assert.deepEqual(
    heartbeatBootstrapPlan(alarms, namesByLogicalId).map((item) => item.kind),
    ["billing-reconciliation", "generation-repair"],
  );
});

test("current alarm checks reject ALARM, insufficient-data, and missing alarms", () => {
  const expected = ["healthy", "alarming", "waiting", "missing"];
  const alarms = [
    { AlarmName: "healthy", StateValue: "OK" },
    { AlarmName: "alarming", StateValue: "ALARM" },
    { AlarmName: "waiting", StateValue: "INSUFFICIENT_DATA" },
  ];
  assert.deepEqual(alarmsOutsideOk(alarms, expected), ["alarming", "waiting", "missing"]);
});

test("heartbeat alarm polling succeeds after bounded state convergence and reports timeout", async () => {
  let now = 0;
  const clock = {
    now: () => now,
    sleep: async (milliseconds) => { now += milliseconds; },
  };
  let reads = 0;
  const alarmNames = ["heartbeat-a", "heartbeat-b"];
  const converged = await waitForAlarmsOk({
    alarmNames,
    timeoutMs: 1_000,
    pollMs: 100,
    clock,
    readAlarms: async () => {
      reads += 1;
      return alarmNames.map((AlarmName) => ({
        AlarmName,
        StateValue: reads >= 3 ? "OK" : "INSUFFICIENT_DATA",
      }));
    },
  });
  assert.equal(converged.timedOut, false);
  assert.equal(converged.polls, 3);

  now = 0;
  const timedOut = await waitForAlarmsOk({
    alarmNames,
    timeoutMs: 250,
    pollMs: 100,
    clock,
    readAlarms: async () => alarmNames.map((AlarmName) => ({ AlarmName, StateValue: "ALARM" })),
  });
  assert.equal(timedOut.timedOut, true);
  assert.deepEqual(timedOut.pending, alarmNames);
  assert.equal(now, 250);
});

test("heartbeat invocation must run the protected version without a function error", () => {
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const passing = {
    StatusCode: 200,
    ExecutedVersion: "7",
    Payload: Buffer.from(JSON.stringify({ queued: 0 })),
  };
  assert.deepEqual(verifyHeartbeatInvocation(passing, "7", "feed-refresh", check), { queued: 0 });
  assert.throws(() => verifyHeartbeatInvocation({ ...passing, ExecutedVersion: "6" }, "7", "feed-refresh", check),
    /protected live version/);
  assert.throws(() => verifyHeartbeatInvocation({ ...passing, FunctionError: "Unhandled" }, "7", "feed-refresh", check),
    /function error/);
  assert.throws(() => verifyHeartbeatInvocation({ ...passing, Payload: Buffer.from("not-json") }, "7", "feed-refresh", check),
    /invalid JSON/);
});

test("post-load wait reaches the next five-minute boundary plus ingestion grace", async () => {
  const completedAt = "2026-10-19T00:04:40.000Z";
  const deadline = postLoadAlarmCheckAt(completedAt);
  assert.equal(deadline, "2026-10-19T00:06:30.000Z");
  let now = new Date(completedAt).getTime();
  const waits = [];
  await waitUntil({
    deadline,
    pollMs: 30_000,
    clock: {
      now: () => now,
      sleep: async (milliseconds) => { waits.push(milliseconds); now += milliseconds; },
    },
  });
  assert.equal(now, new Date(deadline).getTime());
  assert.ok(waits.every((milliseconds) => milliseconds <= 30_000));
});

test("alarm history detects a transient ALARM transition after load started", () => {
  const startedAt = "2026-10-19T00:00:00.000Z";
  const history = [
    { Timestamp: "2026-10-18T23:59:59.000Z", HistoryData: JSON.stringify({ newState: { stateValue: "ALARM" } }) },
    { Timestamp: "2026-10-19T00:01:00.000Z", HistoryData: JSON.stringify({ newState: { stateValue: "OK" } }) },
    { Timestamp: "2026-10-19T00:02:00.000Z", HistoryData: JSON.stringify({ newState: { stateValue: "ALARM" } }) },
    { Timestamp: "2026-10-19T00:03:00.000Z", HistoryData: "not-json" },
  ];
  assert.deepEqual(alarmHistoryTransitionsToAlarm(history, startedAt), [history[2]]);
});
