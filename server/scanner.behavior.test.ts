import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculateMarketContext } from "./market-context";

const { fetchMarketSeriesBatch, generateScannerDecisions, sendTelegramMessage, recordTelegramDelivery, createStrategyDecision, createPaperTradeAdjustment, hasTelegramDelivery, listOpenCurrentV5Signals, listFailedOutcomeDeliveries, listResolvedSignalsMissingOutcomeDelivery, getSettings, hasRecentStrategyDecision, hasOpenGeneratedSignal, getEntryLocatorState, saveEntryLocatorState, listV5ZoneHistory, upsertV5ZoneHistory, updateStrategyEngineStatus, recordStrategyEngineHealth, getActiveIntelligenceVersion, buildBoundedRuleText, activateIntelligenceVersion, listIntelligenceComponents, listStrategyRules, listAcceptedStrategyLessons, createIntelligenceVersion, createIntelligenceComponent, claimOwnerAlert, markOwnerAlertNotified, insert, select, db } = vi.hoisted(() => {
  const fetchMarketSeriesBatch = vi.fn(async () => { throw new Error("Twelve Data quota exhausted"); });
  const generateScannerDecisions = vi.fn();
  const createStrategyDecision = vi.fn(async (input: any) => ({ id: 99, ...input }));
  const getSettings = vi.fn(async () => ({ setupCooldownMinutes: 30 }));
  const hasRecentStrategyDecision = vi.fn(async () => false);
  const hasOpenGeneratedSignal = vi.fn(async () => false);
  const listOpenCurrentV5Signals = vi.fn(async () => []);
  const listFailedOutcomeDeliveries = vi.fn(async () => []);
  const listResolvedSignalsMissingOutcomeDelivery = vi.fn(async () => []);
  const hasTelegramDelivery = vi.fn(async () => false);
  const createPaperTradeAdjustment = vi.fn(async () => 1);
  const claimOwnerAlert = vi.fn(async () => false);
  const markOwnerAlertNotified = vi.fn(async () => undefined);
  const getEntryLocatorState = vi.fn(async () => undefined);
  const saveEntryLocatorState = vi.fn(async (input: any) => input);
  const listV5ZoneHistory = vi.fn(async () => []);
  const upsertV5ZoneHistory = vi.fn(async () => undefined);
  const updateStrategyEngineStatus = vi.fn();
  const recordStrategyEngineHealth = vi.fn();
  const getActiveIntelligenceVersion = vi.fn(async () => ({ id: 1, versionLabel: "forex-trading-combined-document-v2" }));
  const buildBoundedRuleText = vi.fn((rules: Array<{ title?: string | null; content?: string | null }>, maxChars = 60_000) => rules.map((rule) => `## ${rule.title ?? "Saved strategy rule"}\n${rule.content ?? ""}`).join("\n\n").slice(0, maxChars));
  const activateIntelligenceVersion = vi.fn();
  const listIntelligenceComponents = vi.fn(async () => []);
  const listStrategyRules = vi.fn(async () => [{ id: 1, title: "Rules", content: "Use confirmation." }]);
  const listAcceptedStrategyLessons = vi.fn(async () => []);
  const createIntelligenceVersion = vi.fn(async (input: any) => ({ id: 1, ...input }));
  const createIntelligenceComponent = vi.fn();
  const sendTelegramMessage = vi.fn();
  const recordTelegramDelivery = vi.fn();
  const insert = vi.fn();
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => []),
    })),
  }));
  const db = { select, insert, update: vi.fn() };
  return { fetchMarketSeriesBatch, generateScannerDecisions, sendTelegramMessage, recordTelegramDelivery, createStrategyDecision, createPaperTradeAdjustment, hasTelegramDelivery, listOpenCurrentV5Signals, listFailedOutcomeDeliveries, listResolvedSignalsMissingOutcomeDelivery, getSettings, hasRecentStrategyDecision, hasOpenGeneratedSignal, getEntryLocatorState, saveEntryLocatorState, listV5ZoneHistory, upsertV5ZoneHistory, updateStrategyEngineStatus, recordStrategyEngineHealth, getActiveIntelligenceVersion, buildBoundedRuleText, activateIntelligenceVersion, listIntelligenceComponents, listStrategyRules, listAcceptedStrategyLessons, createIntelligenceVersion, createIntelligenceComponent, claimOwnerAlert, markOwnerAlertNotified, insert, select, db };
});

vi.mock("./db", () => ({
  getDb: vi.fn(async () => db),
  listStrategyRules,
  listAcceptedStrategyLessons,
  getActiveIntelligenceVersion,
  buildBoundedRuleText,
  ENTRY_LOCATOR_V5_GENERATION_MODE: "ENTRY_LOCATOR_V5",
  activateIntelligenceVersion,
  listIntelligenceComponents,
  createIntelligenceVersion,
  createIntelligenceComponent,
  getAllRulesText: vi.fn(async () => "Use confirmation."),
  createStrategyDecision,
  getSettings,
  hasRecentStrategyDecision,
  hasOpenGeneratedSignal,
  getEntryLocatorState,
  saveEntryLocatorState,
  updateStrategyEngineStatus,
  recordStrategyEngineHealth,
  getRelevantRulesText: vi.fn(async () => "## Rules\nUse confirmation."),
  createStrategyRule: vi.fn(),
  recordTelegramDelivery,
  createPaperTradeAdjustment,
  hasTelegramDelivery,
  listOpenCurrentV5Signals,
  listFailedOutcomeDeliveries,
  listResolvedSignalsMissingOutcomeDelivery,
  claimOwnerAlert,
  markOwnerAlertNotified,
  listV5ZoneHistory,
  upsertV5ZoneHistory,
}));

vi.mock("./entry-locator", () => ({
  hasBreakoutConfirmationTransition: vi.fn(() => false),
  countStrongSetupIndicators: vi.fn(() => 2),
  advanceEntryLocator: vi.fn(({ observation }: any) => ({ ready: true, reason: "Test locator ready", selectedObservation: observation, state: { status: "WAITING", snapshotCount: 2, lastSnapshotAt: observation.observedAt, lastEmittedFingerprint: null, snapshots: [observation], waitReason: "Test locator ready" } })),
  markEntryLocatorEmitted: vi.fn((state: any, fingerprint: string) => ({ ...state, status: "EMITTED", lastEmittedFingerprint: fingerprint })),
}));
vi.mock("./official-macro", () => ({
  fetchOfficialMacroContext: vi.fn(async () => ({ status: "UNAVAILABLE", bias: "NEUTRAL", summary: "Test macro context unavailable", eventRisk: "NORMAL", interestRateDifferential: null, observations: [], fetchedAt: new Date().toISOString(), stale: true })),
}));

vi.mock("./integrations", () => ({
  fetchMarketSeriesBatch,
  fetchMarketSnapshot: vi.fn(),
  fetchStrategyRulesFromSupabase: vi.fn(async () => []),
  forensicAnalysis: vi.fn(),
  formatApprovedTelegramMessage: vi.fn(() => "approved"),
  formatAuditResult: vi.fn(() => "audit"),
  formatPaperTradeAdjustmentTelegramMessage: vi.fn(() => "adjustment"),
  generateScannerDecisions,
  mirrorToSupabase: vi.fn(),
  sendTelegramMessage,
}));

import { attachSetupIndicators, compactStrategyContext, isEligibleContradictoryReplacement, marketIntervalForSignalTimeframe, safelyEvaluateBaselineIntelligence, scanAllUsers, scanUser, shouldNotifyScannerSignal } from "./scanner";

const series = (symbol: string, interval: "5min" | "15min" | "1h" | "4h") => {
  const values = [{ open: "0.9", high: "1.1", low: "0.8", close: "1" }, { open: "1.9", high: "2.1", low: "1.8", close: "2" }, { open: "2.9", high: "3.1", low: "2.8", close: "3" }];
  return { symbol, interval, values, close: 3, trend: "UP" as const, marketContext: calculateMarketContext(values), fetchedAt: new Date().toISOString() };
};

const allSeries = () => new Map([
  ["EUR/USD", series("EUR/USD", "15min")],
  ["XAU/USD", series("XAU/USD", "15min")],
  ["GBP/USD", series("GBP/USD", "15min")],
  ["BTC/USD", series("BTC/USD", "15min")],
]);

describe("scanner context bounds", () => {
  it("preserves detected setup indicators for contradiction monitoring", () => {
    const indicators = [{ id: "structure-uptrend", direction: "BUY" as const, strength: "STRONG" }];
    const decision = attachSetupIndicators({ direction: "BUY" as const, market: { close: 100 } }, indicators);
    expect(decision.setupIndicators).toEqual(indicators);
    expect(decision.market.setupIndicators).toEqual(indicators);
  });

  it("requires locator readiness and an allowed exact ratio for contradiction replacements", () => {
    const base = { verdict: "APPROVED", contradictionLocatorReady: true, entry: 100, stopLoss: 98, takeProfit: 104, decisionTrace: { levelDerivation: { selectedRiskReward: 2 } } };
    expect(isEligibleContradictoryReplacement(base)).toBe(true);
    expect(isEligibleContradictoryReplacement({ ...base, verdict: "SKIPPED" })).toBe(false);
    expect(isEligibleContradictoryReplacement({ ...base, contradictionLocatorReady: false })).toBe(false);
    expect(isEligibleContradictoryReplacement({ ...base, decisionTrace: { levelDerivation: { selectedRiskReward: 1 } } })).toBe(false);
  });

  it("keeps a baseline no-direction result recoverable for the v5 cycle", () => {
    const context = calculateMarketContext([
      { open: "0.9", high: "1.1", low: "0.8", close: "1" },
      { open: "1.9", high: "2.1", low: "1.8", close: "2" },
      { open: "2.9", high: "3.1", low: "2.8", close: "3" },
    ])!;
    const result = safelyEvaluateBaselineIntelligence({ asset: "EUR/USD", close: 3, interval: "15min", values: [], marketContext: context }, { id: "forex-trading-combined-document-v3", sourceDocument: "test", nodes: [], decisionPolicy: "test", learningPolicy: "test" });
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.decision).toBeUndefined();
    expect(result.error).toContain("No directional setup indicators detected");
  });

  it("limits the strategy context to the configured prompt budget", () => {
    expect(compactStrategyContext("a".repeat(20_000), "b".repeat(20_000), 24_000)).toHaveLength(24_000);
    expect(compactStrategyContext("a".repeat(20_000), "b".repeat(20_000), 24_000).startsWith("a".repeat(100))).toBe(true);
  });
});

describe("scanner paper routing with shared quality gate", () => {
  beforeEach(() => {
    hasOpenGeneratedSignal.mockReset();
    hasOpenGeneratedSignal.mockResolvedValue(false);
  });

  it("allows only approved outcomes to reach the notification branch", () => {
    expect(shouldNotifyScannerSignal("APPROVED")).toBe(true);
    expect(shouldNotifyScannerSignal("DENIED")).toBe(false);
  });

    it("requests all unresolved open v5 signals for strict Locator locking", async () => {
    fetchMarketSeriesBatch.mockResolvedValue(allSeries());
    generateScannerDecisions.mockResolvedValue([]);
    listOpenCurrentV5Signals.mockClear();

    await scanUser(1);

    expect(listOpenCurrentV5Signals).toHaveBeenCalledWith(1);
  });

  it("does not emit when an approved candidate lacks an explicit permitted v5 ratio", async () => {
    fetchMarketSeriesBatch.mockResolvedValue(allSeries());
    generateScannerDecisions.mockImplementation(async ({ candidates }: any) => candidates.map((candidate: any) => ({
      verdict: "APPROVED",
      confidence: 42,
      adjustments: "Generated from compiled PDF intelligence; no evidence gate",
      asset: candidate.asset,
      timeframe: candidate.timeframe,
      market: candidate.market,
      direction: "SELL",
      entry: 3,
      stopLoss: 3.1,
      takeProfit: 2.8,
      ruleEvidence: [],
      ruleFindings: [],
    })));
    insert.mockImplementation(() => [{ insertId: 42 }]);
    sendTelegramMessage.mockResolvedValue({ delivered: true, telegramMessageId: "7" });
    insert.mockClear();
    sendTelegramMessage.mockClear();
    recordTelegramDelivery.mockClear();

    const result = await scanUser(1);

    expect(result.created).toBe(0);
    expect(insert).not.toHaveBeenCalled();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(recordTelegramDelivery).not.toHaveBeenCalled();
    expect(recordTelegramDelivery.mock.calls.every(([input]: any[]) => input.kind === "SIGNAL" && input.status === "DELIVERED" && input.dedupeKey.startsWith("signal:"))).toBe(true);
    expect(createStrategyDecision).toHaveBeenCalled();
    expect(updateStrategyEngineStatus).toHaveBeenCalledWith(1, { status: "AVAILABLE" });
    expect(generateScannerDecisions).not.toHaveBeenCalled();
    expect(createStrategyDecision.mock.calls[0][0].marketSnapshot).toContain("replacementIntelligence");
    expect(createStrategyDecision.mock.calls[0][0].marketSnapshot).toContain("v3BaselineIntelligence");
  });

  it("reuses one shared Twelve Data window across users in a scheduled scan", async () => {
    select.mockImplementationOnce(() => ({ from: vi.fn(async () => [{ id: 1 }, { id: 2 }]) }));
    fetchMarketSeriesBatch.mockClear();
    fetchMarketSeriesBatch.mockResolvedValue(allSeries());
    insert.mockClear();

    const result = await scanAllUsers();

    expect(result.users).toBe(2);
    expect(fetchMarketSeriesBatch).toHaveBeenCalledTimes(8);
    expect(fetchMarketSeriesBatch).toHaveBeenCalledWith(["EUR/USD", "XAU/USD"], "5min");
    expect(fetchMarketSeriesBatch).toHaveBeenCalledWith(["GBP/USD", "BTC/USD"], "5min");
    expect(fetchMarketSeriesBatch).toHaveBeenCalledWith(["EUR/USD", "XAU/USD"], "4h");
    expect(fetchMarketSeriesBatch).toHaveBeenCalledWith(["GBP/USD", "BTC/USD"], "4h");
  });

  it("forwards every retrieved raw snapshot without scanner-side trend or cooldown filtering", async () => {
    const raw = allSeries();
    raw.set("EUR/USD", { ...series("EUR/USD", "15min"), trend: "SIDEWAYS" as any });
    fetchMarketSeriesBatch.mockResolvedValue(raw);
    generateScannerDecisions.mockResolvedValue([]);
    generateScannerDecisions.mockClear();
    createStrategyDecision.mockClear();

    const result = await scanUser(1);

    expect(result.created).toBe(0);
    expect(generateScannerDecisions).not.toHaveBeenCalled();
    expect(createStrategyDecision).toHaveBeenCalled();
    expect(createStrategyDecision.mock.calls.some(([input]: any[]) => input.marketSnapshot.includes('"trend":"SIDEWAYS"'))).toBe(true);
  });

  it("uses replacement intelligence without a separate model-service dependency", async () => {
    fetchMarketSeriesBatch.mockResolvedValue(allSeries());
    generateScannerDecisions.mockRejectedValue(new Error("LLM usage exhausted"));
    insert.mockClear();
    sendTelegramMessage.mockClear();
    recordTelegramDelivery.mockClear();

    const result = await scanUser(1);

    expect(result.created).toBe(0);
    expect(result.marketData).toBe("available");
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(recordTelegramDelivery).not.toHaveBeenCalled();
    expect(createStrategyDecision).toHaveBeenCalledWith(expect.objectContaining({ verdict: expect.stringMatching(/APPROVED|SKIPPED/) }));
  });

  it("ignores legacy v5 rows but suppresses overlapping current locator setups", async () => {
    fetchMarketSeriesBatch.mockResolvedValue(allSeries());
    hasOpenGeneratedSignal.mockImplementation(async (_userId: number, _asset: string, _timeframe: string, _version: string, generationMode?: string) => generationMode === "ENTRY_LOCATOR_V5");
    sendTelegramMessage.mockClear();
    insert.mockClear();

    const result = await scanUser(1);

    expect(result.created).toBe(0);
    expect(hasOpenGeneratedSignal).toHaveBeenCalledTimes(8);
    expect(hasOpenGeneratedSignal).toHaveBeenNthCalledWith(1, 1, expect.any(String), expect.any(String), "forex-trading-combined-document-v5", "ENTRY_LOCATOR_V5");
    expect(hasOpenGeneratedSignal).toHaveBeenNthCalledWith(8, 1, expect.any(String), expect.any(String), "forex-trading-combined-document-v5", "ENTRY_LOCATOR_V5");
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(hasOpenGeneratedSignal.mock.calls.every((call: unknown[]) => call[4] === "ENTRY_LOCATOR_V5")).toBe(true);
    hasOpenGeneratedSignal.mockResolvedValue(false);
  });

  it("skips a denied replacement outcome without creating a signal", async () => {
    fetchMarketSeriesBatch.mockResolvedValue(allSeries());
    generateScannerDecisions.mockResolvedValue([{ asset: "EUR/USD", timeframe: "15MIN", verdict: "DENIED", confidence: 40, adjustments: "Insufficient rule evidence", ruleEvidence: [], ruleFindings: [], market: series("EUR/USD", "15min") }]);
    insert.mockClear();
    sendTelegramMessage.mockClear();
    recordTelegramDelivery.mockClear();

    const result = await scanUser(1);

    expect(result.created).toBe(0);
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(recordTelegramDelivery).not.toHaveBeenCalled();
    expect(createStrategyDecision).toHaveBeenCalledWith(expect.objectContaining({ verdict: "SKIPPED", generatedDirection: null }));
  });
});

describe("scanner unavailable-market behavior", () => {
  it("skips all assets without inserting signals when OHLCV polling fails", async () => {
    fetchMarketSeriesBatch.mockImplementation(async () => { throw new Error("Twelve Data quota exhausted"); });
    insert.mockClear();
    updateStrategyEngineStatus.mockClear();
    recordStrategyEngineHealth.mockClear();

    const result = await scanUser(1);

    expect(result.created).toBe(0);
    expect(result.tracked).toBe(0);
    expect(result.marketData).toBe("unavailable");
    expect(result.marketDataError).toContain("Twelve Data market-data window failed");
    expect(result.marketDataError).toContain("15min unavailable");
    expect(result.marketDataError).toContain("1h unavailable");
    expect(updateStrategyEngineStatus).toHaveBeenCalledWith(1, { status: "UNAVAILABLE", error: "Twelve Data 15min unavailable: Twelve Data EUR_XAU group unavailable: Twelve Data quota exhausted | Twelve Data GBP_BTC group unavailable: Twelve Data quota exhausted | Twelve Data 1h unavailable: Twelve Data EUR_XAU group unavailable: Twelve Data quota exhausted | Twelve Data GBP_BTC group unavailable: Twelve Data quota exhausted | Twelve Data 4h unavailable: Twelve Data EUR_XAU group unavailable: Twelve Data quota exhausted | Twelve Data GBP_BTC group unavailable: Twelve Data quota exhausted" });
    expect(recordStrategyEngineHealth).toHaveBeenCalledWith(1, { snapshots: 0, completeResponses: 0, retries: 1, unavailableCycle: true });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("v5 signal timeframe policy", () => {
  it("maps each signal timeframe to its own tracking interval", () => {
    expect(marketIntervalForSignalTimeframe("5MIN")).toBe("5min");
    expect(marketIntervalForSignalTimeframe("15MIN")).toBe("15min");
    expect(marketIntervalForSignalTimeframe("1H")).toBe("1h");
  });

  it("emits only on 15MIN and 5MIN while keeping 1H context-only", async () => {
    const { V5_SIGNAL_TIMEFRAMES, isV5SignalTimeframe } = await import("./scanner");
    expect(V5_SIGNAL_TIMEFRAMES).toEqual(["15MIN", "5MIN"]);
    expect(isV5SignalTimeframe("15MIN")).toBe(true);
    expect(isV5SignalTimeframe("5MIN")).toBe(true);
    expect(isV5SignalTimeframe("1H")).toBe(false);
  });
});
