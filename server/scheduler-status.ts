export type CallbackStatus = "HEALTHY" | "CALLBACK_REACHED_WITH_ERROR" | "CALLBACK_NOT_REACHED" | "SCHEDULER_UNAVAILABLE" | "NOT_CONFIGURED";

export type SchedulerJobSnapshot = {
  taskUid: string;
  name: string;
  cronExpression: string;
  callbackPath: string;
  callbackMethod: string;
  isEnable: boolean;
  createdAt?: string | null;
  lastExecutedAt?: string | null;
  nextExecutionAt?: string | null;
};

const SCANNER_CALLBACK_PATH = "/api/scheduled/trading-guard-scanner";
const SCANNER_TASK_PREFIX = "trading-guard-scanner";
export const SCANNER_RUN_LEASE_MS = 110_000;

export function isStaleScannerRun(run: { status: string; startedAt: Date | string }, now = new Date()) {
  if (run.status !== "RUNNING") return false;
  const startedAt = new Date(run.startedAt).getTime();
  return Number.isFinite(startedAt) && now.getTime() - startedAt >= SCANNER_RUN_LEASE_MS;
}

export function hasRepeatedScannerFailures(runs: Array<{ status: string }>, threshold = 2) {
  return runs.filter((run) => run.status === "FAILED").length >= threshold;
}

export function selectScannerSchedulerJob(storedTaskUid: string | null | undefined, jobs: SchedulerJobSnapshot[]) {
  const exact = storedTaskUid ? jobs.find((job) => job.taskUid === storedTaskUid) ?? null : null;
  if (exact) return { job: exact, taskUid: exact.taskUid, reconciled: false };

  const candidates = jobs
    .filter((job) => job.isEnable && job.callbackPath === SCANNER_CALLBACK_PATH && job.name.startsWith(SCANNER_TASK_PREFIX))
    .sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });

  if (candidates.length !== 1) return { job: null, taskUid: storedTaskUid ?? null, reconciled: false };
  const replacement = candidates[0];
  return { job: replacement, taskUid: replacement.taskUid, reconciled: true };
}

export type ScannerCadenceRun = {
  id?: number;
  runKey: string;
  taskUid: string;
  startedAt: Date | string;
  finishedAt?: Date | string | null;
  status: string;
  duplicateCallbacks?: number | null;
  createdSignals?: number | string | null;
  trackedSignals?: number | string | null;
  adjustments?: number | string | null;
  marketData?: "available" | "unavailable" | "not-run" | string | null;
  error?: string | null;
};

export type ScannerRunClassification = "COMPLETED" | "COMPLETED_WITH_DUPLICATES" | "PROVIDER_UNAVAILABLE" | "FAILED";

export type ScannerProviderIssue = {
  provider: "Twelve Data";
  intervals: string[];
  at: Date | string;
  source: "EXTERNAL_TRIGGER" | "HEARTBEAT";
  message: string;
  statusCode?: number;
  severity: "TRANSIENT" | "QUOTA" | "OTHER";
};

export type ScannerTimeframeHealth = {
  interval: "15min" | "1h" | "4h";
  status: "AVAILABLE" | "UNAVAILABLE" | "NOT_RECORDED";
  at: Date | string | null;
};

const REQUIRED_MARKET_INTERVALS = ["15min", "1h", "4h"] as const;

function timeframeHealthFromRun(run: ScannerCadenceRun | null): ScannerTimeframeHealth[] {
  if (!run) return REQUIRED_MARKET_INTERVALS.map((interval) => ({ interval, status: "NOT_RECORDED", at: null }));
  const at = run.finishedAt ?? run.startedAt ?? null;
  if (run.status === "SUCCEEDED" && run.marketData === "available") {
    return REQUIRED_MARKET_INTERVALS.map((interval) => ({ interval, status: "AVAILABLE", at }));
  }
  const error = String(run.error ?? "");
  const unavailable = new Set(Array.from(error.matchAll(/Twelve Data (5min|15min|1h|4h) unavailable/gi)).map((match) => match[1].toLowerCase()));
  return REQUIRED_MARKET_INTERVALS.map((interval) => ({
    interval,
    status: unavailable.has(interval) ? "UNAVAILABLE" : "NOT_RECORDED",
    at: unavailable.has(interval) ? at : null,
  }));
}

function providerIssueFromRun(run: ScannerCadenceRun): ScannerProviderIssue | null {
  if (run.marketData !== "unavailable") return null;
  const error = String(run.error ?? "").trim();
  const intervals = Array.from(new Set(Array.from(error.matchAll(/Twelve Data (5min|15min|1h|4h) unavailable/gi)).map((match) => match[1].toLowerCase())));
  const statusCodeMatch = error.match(/status code (\d{3})/i);
  const statusCode = statusCodeMatch ? Number(statusCodeMatch[1]) : undefined;
  return {
    provider: "Twelve Data",
    intervals: intervals.length ? intervals : ["15min", "1h"],
    at: run.startedAt,
    source: run.taskUid === "external-cron-job" ? "EXTERNAL_TRIGGER" : "HEARTBEAT",
    message: error || "Market data was unavailable after the configured Twelve Data failover path.",
    ...(statusCode ? { statusCode } : {}),
    severity: statusCode === 429 ? "QUOTA" : statusCode === 408 || statusCode === 425 || statusCode === 500 || statusCode === 502 || statusCode === 503 || statusCode === 504 || statusCode === 522 ? "TRANSIENT" : "OTHER",
  };
}

function classifyRun(run: ScannerCadenceRun): ScannerRunClassification {
  if (run.status === "FAILED") return "FAILED";
  if (run.marketData === "unavailable") return "PROVIDER_UNAVAILABLE";
  if (Number(run.duplicateCallbacks ?? 0) > 0) return "COMPLETED_WITH_DUPLICATES";
  return "COMPLETED";
}

export function summarizeScannerCadence(runs: ScannerCadenceRun[]) {
  const byRunKey = new Map<string, ScannerCadenceRun>();
  for (const run of runs) {
    const prior = byRunKey.get(run.runKey);
    if (!prior) {
      byRunKey.set(run.runKey, run);
      continue;
    }
    const earliest = new Date(run.startedAt).getTime() < new Date(prior.startedAt).getTime() ? run : prior;
    byRunKey.set(run.runKey, {
      ...earliest,
      duplicateCallbacks: Number(prior.duplicateCallbacks ?? 0) + Number(run.duplicateCallbacks ?? 0),
    });
  }
  const uniqueRows = Array.from(byRunKey.values()).sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  const providerIssues = uniqueRows.map(providerIssueFromRun).filter((issue): issue is ScannerProviderIssue => Boolean(issue));
  const successfulRows = uniqueRows.filter((run) => run.status === "SUCCEEDED" && run.marketData === "available");
  const latestSuccessful = successfulRows.at(-1) ?? null;
  const intervals = uniqueRows.slice(1).map((row, index) => (new Date(row.startedAt).getTime() - new Date(uniqueRows[index].startedAt).getTime()) / 60000);
  const firstAt = uniqueRows[0] ? new Date(uniqueRows[0].startedAt).getTime() : null;
  const lastAt = uniqueRows.at(-1) ? new Date(uniqueRows.at(-1)!.startedAt).getTime() : null;
  const observedWindows = firstAt == null || lastAt == null ? 0 : Math.floor((lastAt - firstAt) / (5 * 60 * 1000)) + 1;
  return {
    observedWindows,
    receivedCycles: uniqueRows.length,
    completedCycles: uniqueRows.filter((run) => run.status === "SUCCEEDED").length,
    failedCycles: uniqueRows.filter((run) => run.status === "FAILED").length,
    skippedWindows: Math.max(0, observedWindows - uniqueRows.length),
    duplicateSuppressed: runs.reduce((sum, run) => sum + Number(run.duplicateCallbacks ?? 0), 0),
    averageIntervalMinutes: intervals.length ? Math.round((intervals.reduce((sum, value) => sum + value, 0) / intervals.length) * 10) / 10 : null,
    lastRunAt: uniqueRows.at(-1)?.startedAt ?? null,
    lastSource: uniqueRows.at(-1) ? (uniqueRows.at(-1)!.taskUid === "external-cron-job" ? "EXTERNAL_TRIGGER" : "HEARTBEAT") : null,
    latestSuccessfulAt: latestSuccessful?.finishedAt ?? latestSuccessful?.startedAt ?? null,
    latestSuccessfulSource: latestSuccessful ? (latestSuccessful.taskUid === "external-cron-job" ? "EXTERNAL_TRIGGER" : "HEARTBEAT") : null,
    externalCycles: uniqueRows.filter((run) => run.taskUid === "external-cron-job").length,
    heartbeatCycles: uniqueRows.filter((run) => run.taskUid !== "external-cron-job").length,
    providerUnavailableCycles: providerIssues.length,
    providerUnavailableWindows: providerIssues.length,
    latestProviderIssue: providerIssues.at(-1) ?? null,
    latestTimeframeHealth: timeframeHealthFromRun(uniqueRows.at(-1) ?? null),
    runs: uniqueRows.slice(-12).reverse().map((run) => ({ ...run, classification: classifyRun(run) })),
  };
}

export type CallbackStatusInput = {
  scannerEnabled: boolean;
  scheduleCronTaskUid?: string | null;
  strategyEngineStatus?: string | null;
  strategyEngineLastRunAt?: Date | string | null;
  schedulerJob?: SchedulerJobSnapshot | null;
  schedulerRegistryAvailable: boolean;
  now?: Date;
};

const asDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function buildCallbackStatus(input: CallbackStatusInput) {
  const now = input.now ?? new Date();
  const appLastRunAt = asDate(input.strategyEngineLastRunAt);
  const schedulerLastAttemptAt = asDate(input.schedulerJob?.lastExecutedAt);
  const configuredTaskUid = input.scheduleCronTaskUid ?? null;

  if (!input.scannerEnabled || !configuredTaskUid) {
    const externalTriggerActive = Boolean(input.scannerEnabled && !configuredTaskUid && appLastRunAt);
    return {
      status: "NOT_CONFIGURED" as const,
      label: input.scannerEnabled
        ? externalTriggerActive ? "EXTERNAL TRIGGER ACTIVE" : "NOT CONFIGURED"
        : "SCANNER DISABLED",
      diagnosis: !input.scannerEnabled
        ? "The scanner is disabled in app settings."
        : externalTriggerActive
          ? "No per-account Heartbeat task is stored, but recent scanner cycles are arriving through the configured external trigger. The cadence diagnostics below are the source of truth for scanner health."
          : "No scanner Heartbeat task is stored for this account.",
      taskUid: configuredTaskUid,
      schedulerJob: input.schedulerJob ?? null,
      appLastRunAt,
      schedulerLastAttemptAt,
      nextExecutionAt: asDate(input.schedulerJob?.nextExecutionAt),
      minutesSinceApplicationRun: appLastRunAt ? Math.max(0, Math.round((now.getTime() - appLastRunAt.getTime()) / 60000)) : null,
    };
  }

  if (!input.schedulerRegistryAvailable || !input.schedulerJob) {
    return {
      status: "SCHEDULER_UNAVAILABLE" as const,
      label: "SCHEDULER UNAVAILABLE",
      diagnosis: "The scheduler registry could not confirm the stored Heartbeat task. No callback health claim is made.",
      taskUid: configuredTaskUid,
      schedulerJob: input.schedulerJob ?? null,
      appLastRunAt,
      schedulerLastAttemptAt,
      nextExecutionAt: asDate(input.schedulerJob?.nextExecutionAt),
      minutesSinceApplicationRun: appLastRunAt ? Math.max(0, Math.round((now.getTime() - appLastRunAt.getTime()) / 60000)) : null,
    };
  }

  const nextExecutionAt = asDate(input.schedulerJob.nextExecutionAt);
  const schedulerIsStale = Boolean(
    input.schedulerJob.isEnable &&
      nextExecutionAt &&
      nextExecutionAt.getTime() < now.getTime() - 120000,
  );

  if (schedulerIsStale) {
    return {
      status: "SCHEDULER_STALE" as const,
      label: "SCHEDULER STALE",
      diagnosis: "The enabled Heartbeat task has passed its next execution time without a newer scheduled attempt. The last application scan may be healthy historically, but the current five-minute cycle is overdue.",
      taskUid: configuredTaskUid,
      schedulerJob: input.schedulerJob,
      appLastRunAt,
      schedulerLastAttemptAt,
      nextExecutionAt,
      minutesSinceApplicationRun: appLastRunAt ? Math.max(0, Math.round((now.getTime() - appLastRunAt.getTime()) / 60000)) : null,
    };
  }

  const applicationWasReached = Boolean(
    appLastRunAt &&
      schedulerLastAttemptAt &&
      appLastRunAt.getTime() >= schedulerLastAttemptAt.getTime() - 120000 &&
      input.schedulerJob.isEnable,
  );

  if (applicationWasReached) {
    const runUnavailable = input.strategyEngineStatus === "UNAVAILABLE";
    return {
      status: runUnavailable ? "CALLBACK_REACHED_WITH_ERROR" as const : "HEALTHY" as const,
      label: runUnavailable ? "CALLBACK REACHED · RUN UNAVAILABLE" : "CALLBACK HEALTHY",
      diagnosis: runUnavailable
        ? "The callback reached the app, but the latest run could not obtain usable market data or complete its processing. No signal was created from that run."
        : "The latest scheduler attempt is reflected by a recent application scan.",
      taskUid: configuredTaskUid,
      schedulerJob: input.schedulerJob,
      appLastRunAt,
      schedulerLastAttemptAt,
      nextExecutionAt,
      minutesSinceApplicationRun: appLastRunAt ? Math.max(0, Math.round((now.getTime() - appLastRunAt.getTime()) / 60000)) : null,
    };
  }

  return {
    status: "CALLBACK_NOT_REACHED" as const,
    label: "CALLBACK NOT REACHED",
    diagnosis: schedulerLastAttemptAt
      ? "The scheduler recorded an attempt newer than the application’s last scan. The callback likely did not reach the app; the scheduler’s exact HTTP response is not available inside the app."
      : "The Heartbeat task is registered, but no scheduler attempt has been recorded yet.",
    taskUid: configuredTaskUid,
    schedulerJob: input.schedulerJob,
    appLastRunAt,
    schedulerLastAttemptAt,
    nextExecutionAt: asDate(input.schedulerJob.nextExecutionAt),
    minutesSinceApplicationRun: appLastRunAt ? Math.max(0, Math.round((now.getTime() - appLastRunAt.getTime()) / 60000)) : null,
  };
}
