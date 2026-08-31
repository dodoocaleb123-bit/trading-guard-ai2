import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const homeSource = readFileSync(fileURLToPath(new URL("./Home.tsx", import.meta.url)), "utf8");

describe("dashboard terminology", () => {
  it("describes the scanner as a raw market-data collector", () => {
    expect(homeSource).toContain('title="Rose’s Eye On The Markets"');
    expect(homeSource).toContain("The external scheduler triggers collection of raw");
    expect(homeSource).toContain("Pause data collection");
  });

  it("describes the strategy-rules algorithm as the judgment and signal layer", () => {
    expect(homeSource).toContain("The strategy-rules algorithm analyzes that data and generates supported outcomes");
    expect(homeSource).toContain("The strategy-rules algorithm generates signals only when");
    expect(homeSource).toContain("strategy-engine judgments");
  });

  it("exposes the v5 Locator source controls and provenance labels", () => {
    expect(homeSource).toContain("V5 source performance");
    expect(homeSource).toContain("Filter source performance by asset");
    expect(homeSource).toContain("Filter source performance by timeframe");
    expect(homeSource).toContain("Entry Locator");
    expect(homeSource).not.toContain("Entry Forger");
  });

  it("configures live dashboard queries to refresh and refetch on focus", () => {
    expect(homeSource).toContain("const LIVE_QUERY_OPTIONS");
    expect(homeSource).toContain("refetchInterval: 60_000");
    expect(homeSource).toContain("refetchOnWindowFocus: true");
    expect(homeSource).toContain("trpc.signals.list.useQuery");
    expect(homeSource).toContain("trpc.scanner.health.useQuery");
  });

  it("exposes the dedicated White AI and Cherry AI chat surfaces", () => {
    expect(homeSource).toContain('assistant = "WHITE"');
    expect(homeSource).toContain('assistant="WHITE"');
    expect(homeSource).toContain('assistant="CHERRY"');
    expect(homeSource).toContain('path === "/cherry-ai"');
    expect(homeSource).toContain('{isCherry ? "Cherry AI" : "White AI"}');
    expect(homeSource).toContain("font-montserrat");
    expect(homeSource).toContain('assistantName={isCherry ? "Cherry AI" : "White AI"}');
    expect(homeSource).toContain('immersiveChat = path === "/chat-audit" || path === "/cherry-ai"');
    expect(homeSource).toContain('APP-AWARE CONVERSATIONS');
    expect(homeSource).toContain('INDEPENDENT TRADE REVIEW');
    expect(homeSource).toContain('aria-label="Open app navigation"');
    expect(homeSource).toContain('aria-label="Export conversation"');
    expect(homeSource).toContain('aria-label="Clear conversation"');
    expect(homeSource).not.toContain('Ask</Button>');
    expect(homeSource).not.toContain('Audit</Button>');
  });

  it("exposes the latest successful scanner-cycle freshness indicator", () => {
    expect(homeSource).toContain("trpc.scanner.cadence.useQuery");
    expect(homeSource).toContain("Scanner freshness");
    expect(homeSource).toContain("latestSuccessfulAt");
    expect(homeSource).toContain("Expected cadence:");
    expect(homeSource).toContain("Checking…");
    expect(homeSource).toContain("Scanner cadence could not be loaded.");
  });

  it("distinguishes candle time from scanner state-save time", () => {
    expect(homeSource).toContain("last candle");
    expect(homeSource).toContain("lastSnapshotAt");
    expect(homeSource).toContain("state saved");
    expect(homeSource).toContain("row.updatedAt");
  });

  it("exposes provider-quota warning details for unavailable scanner cycles", () => {
    expect(homeSource).toContain("Twelve Data quota or rate-limit warning");
    expect(homeSource).toContain("Latest affected interval");
    expect(homeSource).toContain("detected");
    expect(homeSource).toContain("latestProviderIssue.at");
    expect(homeSource).toContain("no v5 Entry Locator signal");
  });

  it("exposes the compact production health timeline", () => {
    expect(homeSource).toContain("Production health timeline");
    expect(homeSource).toContain("Data · {hasMarketData ? \"available\" : run.marketData === \"unavailable\" ? \"unavailable\" : \"not run\"}");
    expect(homeSource).toContain("v5 · {qualified ? `${run.createdSignals} qualified` : \"waiting\"}");
    expect(homeSource).toContain("Telegram · {qualified ? \"path started\" : \"not attempted\"}");
    expect(homeSource).toContain("Telegram is only attempted after v5 qualifies");
  });

  it("mounts the compact production timeline on the Scanner page and callback health on Monitoring", () => {
    expect(homeSource).toContain("<ScannerCadenceDiagnostics />");
    expect(homeSource).toContain("<CallbackStatusCard />");
    expect(homeSource).toContain("<MonitoringPage />");
    expect(homeSource).not.toContain("Activate 5-min schedule");
    expect(homeSource).toContain("External scheduler controls the collection cadence");
  });

  it("does not reintroduce scanner-decision wording in the revised pages", () => {
    expect(homeSource).not.toContain("scanner decisions");
    expect(homeSource).not.toContain("scanner candidates reference");
  });

  it("keeps only recommended operational cards after optional-card cleanup", () => {
    expect(homeSource).toContain("<EntryLocatorCard />");
    expect(homeSource).not.toContain("EntryForgerCard");
    expect(homeSource).toContain("Strategy-engine decision ledger");
    expect(homeSource).toContain("<ScannerCadenceDiagnostics />");
    expect(homeSource).not.toContain("<MacroStatusPanel");
    expect(homeSource).not.toContain("<V2V3Comparison");
    expect(homeSource).not.toContain("<LocatorOutcomeReviewCard");
    expect(homeSource).not.toContain("callbackStatus.useQuery");
    expect(homeSource).not.toContain("Scanner and Heartbeat");
    expect(homeSource).not.toContain("Signal discipline");
    expect(homeSource).not.toContain("Cooldown change history");
    expect(homeSource).not.toContain("Loss-learning review");
    expect(homeSource).not.toContain("How to read this page");
  });

  it("does not expose the retired Entry Forger interface or query", () => {
    expect(homeSource).not.toContain("trpc.intelligence.entryForger.useQuery");
    expect(homeSource).not.toContain("Entry Forger");
    expect(homeSource).not.toContain("EntryForgerCard");
  });

  it("exposes the v5 zone map, history freshness, and qualification trend", () => {
    expect(homeSource).toContain("V5 persistent zone inventory");
    expect(homeSource).toContain("Each asset has its own durable zone map");
    expect(homeSource).toContain("observationCount");
    expect(homeSource).toContain("retestCount");
    expect(homeSource).toContain("FRESH ·");
    expect(homeSource).toContain("AGING ·");
    expect(homeSource).toContain("STALE ·");
    expect(homeSource).toContain("Authenticated v5 production smoke");
    expect(homeSource).toContain("trpc.scanner.v5Smoke.useQuery");
    expect(homeSource).toContain("V5 qualification trend · last 24 hours");
    expect(homeSource).toContain("V5 qualified and waiting decisions by hour");
    expect(homeSource).toContain("4H, 1H, 15M, and 5M");
  });

  it("exposes the Scanner provider-quota warning when the latest cycle is unavailable", () => {
    expect(homeSource).toContain("const providerIssue = cadence.data?.latestProviderIssue");
    expect(homeSource).toContain("const providerOutageActive = Boolean(");
    expect(homeSource).toContain("Twelve Data quota or rate-limit warning");
    expect(homeSource).toContain("No new v5 signal is emitted from an incomplete cycle.");
    expect(homeSource).toContain("Check the configured Twelve Data failover keys");
  });

  it("exposes the latest scanner attempt separately from the last persisted v5 state", () => {
    expect(homeSource).toContain("const latestScannerAttempt = cadence.data?.lastRunAt");
    expect(homeSource).toContain("Latest scanner cycle:");
    expect(homeSource).toContain("Last v5 state update");
    expect(homeSource).toContain("did not write a new v5 snapshot");
    expect(homeSource).toContain("provider data was unavailable.");
  });

  it("keeps White AI and Cherry AI chat channels separate", () => {
    expect(homeSource).toContain("trpc.audit.history.useQuery({ channel: assistant }");
    expect(homeSource).toContain("clearConversation.mutate({ channel: assistant })");
    expect(homeSource).toContain('channel: "WHITE"');
    expect(homeSource).toContain("channel: assistant");
  });

  it("exposes the signal delivery status and orphan-state warnings", () => {
    expect(homeSource).toContain("Telegram delivery");
    expect(homeSource).toContain("ORPHANED STATE");
    expect(homeSource).toContain("No matching unresolved v5 signal exists; this state is not an active trade lock.");
    expect(homeSource).toContain("Signal exists, but no Telegram delivery record is available.");
    expect(homeSource).toContain("Delivered ${formatDateTime");
  });

  it("hides empty legacy analytics histories after the purge", () => {
    expect(homeSource).toContain("const visibleVersions = (stats.data?.versions ?? []).filter(");
    expect(homeSource).toContain("version.overall.generated > 0");
    expect(homeSource).toContain("const visibleVersions = (query.data?.versions ?? []).filter(");
    expect(homeSource).toContain("group.version === version");
    expect(homeSource).toContain("No persisted paper-signal records are available");
    expect(homeSource).not.toContain("<V2V3Comparison");
  });
});


describe("reference-matched chat shell", () => {
  it("keeps the immersive shell white and uses ash message/composer surfaces", () => {
    expect(homeSource).toContain("bg-white font-montserrat");
    expect(homeSource).toContain("bg-white px-3 sm:h-20");
    expect(homeSource).toContain("bg-black text-white");
  });
});
