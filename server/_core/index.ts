import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { sdk } from "./sdk";
import { ENV } from "./env";
import { scanAllUsers } from "../scanner";
import { isAuthorizedScannerCron, isCronAuthenticationFailure, isExternalScannerTriggerAuthorized } from "../scheduled";
import { sendWeeklyStrategySummary } from "../weekly-summary";
import { handleTelegramWebhookUpdate, isTelegramWebhookAuthorized } from "../telegram-webhook";
import { finishScannerRun, listRecentScannerRuns, startScannerRun } from "../db";
import { hasRepeatedScannerFailures } from "../scheduler-status";
import { notifyOwner } from "./notification";

const EXTERNAL_SCANNER_TASK_UID = "external-cron-job";

async function executeScannerRun(taskUid: string, source: string) {
  let runId: number | null = null;
  try {
    const run = await startScannerRun(taskUid);
    runId = run.row?.id ?? null;
    if (run.duplicate) {
      console.info(`[Scanner] Duplicate ${source} callback suppressed for run ${run.row?.runKey ?? "unknown"}.`);
      return { ok: true, duplicate: true, runId };
    }
    const result = await scanAllUsers();
    await finishScannerRun(runId!, { status: "SUCCEEDED", usersProcessed: result.users, createdSignals: result.created, trackedSignals: result.tracked, adjustments: result.adjustments, marketData: result.marketData, error: result.marketDataError ?? null });
    console.info(`[Scanner] ${source} run complete: users=${result.users} created=${result.created} tracked=${result.tracked} adjustments=${result.adjustments} marketData=${result.marketData}`);
    return { ok: true, runId, ...result };
  } catch (error) {
    if (runId) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await finishScannerRun(runId, { status: "FAILED", marketData: "unavailable", error: errorMessage });
      const recentRuns = await listRecentScannerRuns(taskUid, 3);
      const failureThresholdReached = hasRepeatedScannerFailures(recentRuns);
      const thresholdJustCrossed = recentRuns[0]?.status === "FAILED" && recentRuns[1]?.status === "FAILED" && recentRuns[2]?.status !== "FAILED";
      if (failureThresholdReached && thresholdJustCrossed) {
        const delivered = await notifyOwner({ title: "Trading Guard AI scanner failures", content: `Two consecutive app-side scanner runs failed for ${source} task ${taskUid}. Latest error: ${errorMessage}. Review the trigger execution history and the scanner callback run ledger.` });
        console.warn(`[Scanner] Repeated-failure owner alert ${delivered ? "delivered" : "unavailable"}.`);
      }
    }
    throw error;
  }
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && ENV.frontendOrigin && origin === ENV.frontendOrigin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.get("/healthz", (_req, res) => res.json({ ok: true, service: "trading-guard-ai" }));
  app.post("/api/telegram/webhook", async (req, res) => {
    if (!isTelegramWebhookAuthorized(req.headers as Record<string, string | string[] | undefined>)) return res.status(401).json({ error: "unauthorized" });
    try {
      const result = await handleTelegramWebhookUpdate(req.body);
      return res.json({ ok: true, ...result });
    } catch (error) {
      console.error("[TelegramWebhook] Update handling failed:", error);
      return res.status(500).json({ error: "webhook processing failed" });
    }
  });
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.post("/api/scheduled/weekly-strategy-summary", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!isAuthorizedScannerCron(user)) return res.status(403).json({ error: "cron-only" });
      const result = await sendWeeklyStrategySummary();
      console.info(`[WeeklySummary] Scheduled run complete: decisions=${result.decisions ?? 0} delivery=${result.delivery ?? result.skipped ?? "none"}`);
      return res.json(result);
    } catch (error) {
      if (isCronAuthenticationFailure(error)) return res.status(403).json({ error: "cron-only" });
      return res.status(500).json({ error: error instanceof Error ? error.message : "weekly summary failed", timestamp: new Date().toISOString() });
    }
  });
  app.post("/api/scheduled/trading-guard-scanner", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!isAuthorizedScannerCron(user)) return res.status(403).json({ error: "cron-only" });
      return res.json(await executeScannerRun(user.taskUid!, "Heartbeat"));
    } catch (error) {
      if (isCronAuthenticationFailure(error)) return res.status(403).json({ error: "cron-only" });
      return res.status(500).json({ error: error instanceof Error ? error.message : "scanner failed", timestamp: new Date().toISOString() });
    }
  });
  app.get("/api/external/trading-guard-scanner/health", (req, res) => {
    if (!isExternalScannerTriggerAuthorized(req.headers["x-scanner-trigger-secret"], ENV.externalScannerTriggerSecret)) return res.status(403).json({ error: "external-trigger-only" });
    return res.json({ ok: true, externalTrigger: true });
  });
  app.post("/api/external/trading-guard-scanner", async (req, res) => {
    if (!isExternalScannerTriggerAuthorized(req.headers["x-scanner-trigger-secret"], ENV.externalScannerTriggerSecret)) return res.status(403).json({ error: "external-trigger-only" });
    // cron-job.org allows at most 30 seconds. Market ingestion and the four
    // v7 channels can legitimately take longer, so acknowledge the authorized
    // callback immediately and let the existing run ledger record completion.
    void executeScannerRun(EXTERNAL_SCANNER_TASK_UID, "External trigger").catch((error) => {
      console.error("[Scanner] Asynchronous external trigger failed:", error);
    });
    return res.status(202).json({ ok: true, accepted: true, source: "External trigger", message: "Scanner run accepted; completion is recorded in Monitoring." });
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
