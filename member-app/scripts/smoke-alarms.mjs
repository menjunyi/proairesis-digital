export const PRODUCTION_ALARM_LOGICAL_IDS = [
  "FailedWorkAlarm",
  "GenerationQueueAgeAlarm",
  "GenerationQueueBacklogAlarm",
  "RecommendationQueueAgeAlarm",
  "RecommendationQueueBacklogAlarm",
  "LambdaErrorAlarm",
  "LambdaThrottleAlarm",
  "ApiServerErrorAlarm",
  "DynamoThrottleAlarm",
  "ReconciliationAlarm",
  "GenerationRepairFailureAlarm",
  "DailyRefreshHeartbeatAlarm",
  "BillingReconciliationHeartbeatAlarm",
  "GenerationRepairHeartbeatAlarm",
];

export const HEARTBEAT_BOOTSTRAPS = [
  { logicalId: "DailyRefreshHeartbeatAlarm", kind: "feed-refresh" },
  { logicalId: "BillingReconciliationHeartbeatAlarm", kind: "billing-reconciliation" },
  { logicalId: "GenerationRepairHeartbeatAlarm", kind: "generation-repair" },
];

export function resolveAlarmNames(stackResources, check) {
  const physicalByLogical = new Map(
    (stackResources ?? []).map((item) => [item.LogicalResourceId, item.PhysicalResourceId]),
  );
  const byLogicalId = new Map(
    PRODUCTION_ALARM_LOGICAL_IDS.map((logicalId) => [logicalId, physicalByLogical.get(logicalId)]),
  );
  check(
    [...byLogicalId.values()].every(Boolean),
    "One or more production alarm resources are missing",
  );
  return byLogicalId;
}

export function verifyAlarmContracts({ alarms, namesByLogicalId, alarmTopicArn, check }) {
  const alarmNames = [...namesByLogicalId.values()];
  check(alarms.length === alarmNames.length, "One or more production alarms could not be read");
  for (const name of alarmNames) {
    const alarm = alarms.find((item) => item.AlarmName === name);
    check(
      alarm?.ActionsEnabled === true && alarm.AlarmActions?.includes(alarmTopicArn),
      `Alarm ${name} does not notify the production alert topic`,
    );
  }
}

export function heartbeatBootstrapPlan(alarms, namesByLogicalId) {
  return HEARTBEAT_BOOTSTRAPS.flatMap(({ logicalId, kind }) => {
    const alarmName = namesByLogicalId.get(logicalId);
    const alarm = alarms.find((item) => item.AlarmName === alarmName);
    return alarm?.StateValue === "OK" ? [] : [{ logicalId, alarmName, kind }];
  });
}

export function verifyHeartbeatInvocation(response, expectedVersion, kind, check) {
  check(response?.StatusCode === 200, `The ${kind} heartbeat bootstrap did not return HTTP 200`);
  check(!response?.FunctionError, `The ${kind} heartbeat bootstrap returned a function error`);
  check(response?.ExecutedVersion === expectedVersion,
    `The ${kind} heartbeat bootstrap did not execute on the protected live version`);
  const bytes = Buffer.from(response?.Payload ?? []);
  check(bytes.length > 0 && bytes.length <= 512 * 1024,
    `The ${kind} heartbeat bootstrap response size is invalid`);
  let payload;
  try { payload = JSON.parse(bytes.toString("utf8")); } catch {}
  check(payload && typeof payload === "object" && !payload.errorMessage,
    `The ${kind} heartbeat bootstrap returned invalid JSON`);
  return payload;
}

export function alarmsOutsideOk(alarms, alarmNames) {
  return alarmNames.filter((name) =>
    alarms.find((item) => item.AlarmName === name)?.StateValue !== "OK");
}

const defaultClock = {
  now: () => Date.now(),
  sleep: (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)),
};

export async function waitForAlarmsOk({
  readAlarms,
  alarmNames,
  timeoutMs = 8 * 60 * 1000,
  pollMs = 15_000,
  clock = defaultClock,
  onPoll = () => {},
}) {
  const deadline = clock.now() + timeoutMs;
  let polls = 0;
  while (true) {
    const alarms = await readAlarms();
    polls += 1;
    const pending = alarmsOutsideOk(alarms, alarmNames);
    if (!pending.length) return { alarms, pending, polls, timedOut: false };
    if (clock.now() >= deadline) return { alarms, pending, polls, timedOut: true };
    onPoll({ pendingCount: pending.length, polls });
    await clock.sleep(Math.min(pollMs, Math.max(0, deadline - clock.now())));
  }
}

export function postLoadAlarmCheckAt(completedAt, { periodMs = 300_000, ingestionGraceMs = 90_000 } = {}) {
  const completedMs = new Date(completedAt).getTime();
  if (!Number.isFinite(completedMs)) throw new Error("Load completion timestamp is invalid");
  return new Date((Math.floor(completedMs / periodMs) + 1) * periodMs + ingestionGraceMs).toISOString();
}

export async function waitUntil({ deadline, clock = defaultClock, pollMs = 30_000, onPoll = () => {} }) {
  const deadlineMs = new Date(deadline).getTime();
  if (!Number.isFinite(deadlineMs)) throw new Error("Wait deadline is invalid");
  let polls = 0;
  while (clock.now() < deadlineMs) {
    polls += 1;
    onPoll({ remainingMs: deadlineMs - clock.now(), polls });
    await clock.sleep(Math.min(pollMs, deadlineMs - clock.now()));
  }
  return { polls };
}

export function alarmHistoryTransitionsToAlarm(historyItems, startedAt) {
  const startedMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startedMs)) throw new Error("Alarm-history start timestamp is invalid");
  return (historyItems ?? []).filter((item) => {
    const timestamp = new Date(item.Timestamp).getTime();
    if (!Number.isFinite(timestamp) || timestamp < startedMs) return false;
    try {
      return JSON.parse(item.HistoryData ?? "null")?.newState?.stateValue === "ALARM";
    } catch {
      return false;
    }
  });
}
