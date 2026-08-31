import { describe, expect, it } from "vitest";
import { buildCallbackStatus, hasRepeatedScannerFailures, isStaleScannerRun, selectScannerSchedulerJob, type SchedulerJobSnapshot } from "./scheduler-status";
import { buildScannerRunKey } from "./db";

const job: SchedulerJobSnapshot = {
  taskUid: "task-123",
  name: "trading-guard-scanner",
  cronExpression: "0 */5 * * * *",
  callbackPath: "/api/scheduled/trading-guard-scanner",
  callbackMethod: "POST",
  isEnable: true,
  createdAt: "2026-08-23T01:00:00.000Z",
  lastExecutedAt: "2026-08-23T02:00:00.000Z",
  nextExecutionAt: "2026-08-23T02:05:00.000Z",
};

describe("repeated scanner failures", () => {
  it("requires two failed app-side runs before alerting", () => {
    expect(hasRepeatedScannerFailures([{ status: "SUCCEEDED" }, { status: "FAILED" }])).toBe(false);
    expect(hasRepeatedScannerFailures([{ status: "FAILED" }, { status: "FAILED" }])).toBe(true);
  });
});

describe("scanner run lease", () => {
  it("reclaims a RUNNING row after the callback lease expires", () => {
    const startedAt = new Date("2026-08-27T23:25:00.000Z");
    expect(isStaleScannerRun({ status: "RUNNING", startedAt }, new Date("2026-08-27T23:26:50.000Z"))).toBe(true);
    expect(isStaleScannerRun({ status: "RUNNING", startedAt }, new Date("2026-08-27T23:26:49.000Z"))).toBe(false);
    expect(isStaleScannerRun({ status: "SUCCEEDED", startedAt }, new Date("2026-08-27T23:30:00.000Z"))).toBe(false);
  });
});

describe("scanner run key", () => {
  it("is stable within a five-minute UTC bucket", () => {
    const first = buildScannerRunKey("task-123", new Date("2026-08-23T02:00:01.000Z"));
    const retry = buildScannerRunKey("task-123", new Date("2026-08-23T02:04:59.000Z"));
    const next = buildScannerRunKey("task-123", new Date("2026-08-23T02:05:00.000Z"));
    expect(retry).toBe(first);
    expect(next).not.toBe(first);
  });
});

describe("scheduler job selection", () => {
  it("keeps the exact stored scanner task when it is still registered", () => {
    const result = selectScannerSchedulerJob(job.taskUid, [job]);
    expect(result.job?.taskUid).toBe(job.taskUid);
    expect(result.reconciled).toBe(false);
  });

  it("reconciles a stale stored task to the sole active scanner task", () => {
    const replacement = { ...job, taskUid: "task-replacement", name: "trading-guard-scanner-recovery-20260823-v2", createdAt: "2026-08-23T03:00:00.000Z" };
    const result = selectScannerSchedulerJob("removed-task", [replacement]);
    expect(result.job?.taskUid).toBe("task-replacement");
    expect(result.taskUid).toBe("task-replacement");
    expect(result.reconciled).toBe(true);
  });

  it("does not guess when multiple active scanner tasks exist", () => {
    const first = { ...job, taskUid: "task-first" };
    const second = { ...job, taskUid: "task-second", name: "trading-guard-scanner-recovery-20260823-v2" };
    const result = selectScannerSchedulerJob("removed-task", [first, second]);
    expect(result.job).toBeNull();
    expect(result.taskUid).toBe("removed-task");
    expect(result.reconciled).toBe(false);
  });
});

describe("callback status", () => {
  it("reports healthy when the app run follows the scheduler attempt", () => {
    const result = buildCallbackStatus({
      scannerEnabled: true,
      scheduleCronTaskUid: job.taskUid,
      schedulerJob: job,
      schedulerRegistryAvailable: true,
      strategyEngineStatus: "AVAILABLE",
      strategyEngineLastRunAt: "2026-08-23T02:00:02.000Z",
      now: new Date("2026-08-23T02:01:00.000Z"),
    });
    expect(result.status).toBe("HEALTHY");
    expect(result.label).toBe("CALLBACK HEALTHY");
  });

  it("reports a reached callback with an unavailable run distinctly", () => {
    const result = buildCallbackStatus({
      scannerEnabled: true,
      scheduleCronTaskUid: job.taskUid,
      schedulerJob: job,
      schedulerRegistryAvailable: true,
      strategyEngineStatus: "UNAVAILABLE",
      strategyEngineLastRunAt: "2026-08-23T02:00:02.000Z",
      now: new Date("2026-08-23T02:01:00.000Z"),
    });
    expect(result.status).toBe("CALLBACK_REACHED_WITH_ERROR");
    expect(result.label).toContain("CALLBACK REACHED");
    expect(result.diagnosis).toContain("reached the app");
  });

  it("reports a stale scheduler when the next execution window has passed", () => {
    const result = buildCallbackStatus({
      scannerEnabled: true,
      scheduleCronTaskUid: job.taskUid,
      schedulerJob: { ...job, nextExecutionAt: "2026-08-23T02:05:00.000Z" },
      schedulerRegistryAvailable: true,
      strategyEngineStatus: "AVAILABLE",
      strategyEngineLastRunAt: "2026-08-23T02:00:02.000Z",
      now: new Date("2026-08-23T02:08:00.000Z"),
    });
    expect(result.status).toBe("SCHEDULER_STALE");
    expect(result.label).toBe("SCHEDULER STALE");
    expect(result.diagnosis).toContain("current five-minute cycle is overdue");
  });

  it("reports callback not reached when the scheduler is newer than the app run", () => {
    const result = buildCallbackStatus({
      scannerEnabled: true,
      scheduleCronTaskUid: job.taskUid,
      schedulerJob: job,
      schedulerRegistryAvailable: true,
      strategyEngineStatus: "AVAILABLE",
      strategyEngineLastRunAt: "2026-08-23T00:25:27.000Z",
      now: new Date("2026-08-23T02:01:00.000Z"),
    });
    expect(result.status).toBe("CALLBACK_NOT_REACHED");
    expect(result.diagnosis).toContain("newer than the application’s last scan");
  });

  it("does not claim health when the scheduler registry cannot be read", () => {
    const result = buildCallbackStatus({
      scannerEnabled: true,
      scheduleCronTaskUid: job.taskUid,
      schedulerJob: null,
      schedulerRegistryAvailable: false,
      now: new Date("2026-08-23T02:01:00.000Z"),
    });
    expect(result.status).toBe("SCHEDULER_UNAVAILABLE");
  });

  it("reports an unconfigured or disabled scanner safely", () => {
    const unconfigured = buildCallbackStatus({ scannerEnabled: true, scheduleCronTaskUid: null, schedulerRegistryAvailable: true });
    expect(unconfigured.status).toBe("NOT_CONFIGURED");
    expect(unconfigured.label).toBe("NOT CONFIGURED");
    expect(unconfigured.diagnosis).toContain("No scanner Heartbeat task is stored");
    expect(buildCallbackStatus({ scannerEnabled: false, scheduleCronTaskUid: job.taskUid, schedulerJob: job, schedulerRegistryAvailable: true }).label).toBe("SCANNER DISABLED");
  });

  it("distinguishes a healthy external trigger from an empty Heartbeat configuration", () => {
    const result = buildCallbackStatus({
      scannerEnabled: true,
      scheduleCronTaskUid: null,
      schedulerRegistryAvailable: true,
      strategyEngineLastRunAt: "2026-08-31T20:55:36.000Z",
      now: new Date("2026-08-31T20:56:00.000Z"),
    });
    expect(result.status).toBe("NOT_CONFIGURED");
    expect(result.label).toBe("EXTERNAL TRIGGER ACTIVE");
    expect(result.diagnosis).toContain("recent scanner cycles are arriving through the configured external trigger");
  });
});
