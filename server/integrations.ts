import axios from "axios";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { invokeLLM } from "./_core/llm";
import { ENV } from "./_core/env";
import { calculateMarketContext, type MarketContext } from "./market-context";
import type { IntelligenceDecisionTrace } from "./intelligence";
import type { FundamentalContext, ReplacementDecision } from "./replacement-intelligence";

export type MarketSnapshot = {
  symbol: string;
  price: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  change?: number;
  fetchedAt: string;
  interval?: "5min" | "15min" | "1h" | "4h";
  trend?: "UP" | "DOWN";
  values?: Array<Record<string, unknown>>;
  marketContext?: MarketContext | null;
  fundamentalContext?: FundamentalContext & { observations?: Array<{ source: string; series: string; value: number; observedAt: string }>; fetchedAt?: string; stale?: boolean };
  intelligenceSeed?: {
    direction: "BUY" | "SELL";
    entry: number;
    stopLoss: number;
    takeProfit: number;
    confidence: number;
    confluenceScore: number;
    ruleEvidence: string[];
    ruleFindings: Array<{ title: string; stance: "BUY" | "SELL" | "NEUTRAL"; weight: number }>;
    adjustments: string;
    decisionTrace: IntelligenceDecisionTrace;
  };
  replacementIntelligence?: ReplacementDecision;
};

const missingSupabaseMirrorTables = new Set<string>();

const supabaseHeaders = () => ({
  apikey: ENV.supabaseAnonKey,
  Authorization: `Bearer ${ENV.supabaseAnonKey}`,
  "Content-Type": "application/json",
});

export async function mirrorToSupabase(table: string, payload: Record<string, unknown>) {
  if (!ENV.supabaseUrl || !ENV.supabaseAnonKey) return null;
  try {
    const response = await axios.post(`${ENV.supabaseUrl}/${table}`, payload, {
      headers: { ...supabaseHeaders(), Prefer: "return=representation" },
      timeout: 12000,
    });
    return Array.isArray(response.data) ? response.data[0] : response.data;
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    if (status === 404) {
      if (!missingSupabaseMirrorTables.has(table)) {
        missingSupabaseMirrorTables.add(table);
        console.info(`[Supabase] Optional mirror table unavailable: ${table}; primary application persistence remains authoritative.`);
      }
      return null;
    }
    console.warn(`[Supabase] Could not mirror ${table}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

export async function fetchStrategyRulesFromSupabase() {
  if (!ENV.supabaseUrl || !ENV.supabaseAnonKey) return [];
  try {
    const response = await axios.get(`${ENV.supabaseUrl}/strategy_rules`, {
      headers: supabaseHeaders(),
      params: { select: "*", order: "created_at.desc", limit: 100 },
      timeout: 12000,
    });
    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    console.warn("[Supabase] Could not load strategy rules:", error instanceof Error ? error.message : error);
    return [];
  }
}

export async function extractStrategyText(buffer: Buffer, mimeType: string, fileName: string) {
  if (mimeType.includes("pdf") || fileName.toLowerCase().endsWith(".pdf")) {
    const parser = new PDFParse({ data: buffer });
    const parsed = await parser.getText();
    await parser.destroy();
    return parsed.text.trim();
  }
  if (mimeType.includes("word") || mimeType.includes("document") || fileName.toLowerCase().endsWith(".docx")) {
    const parsed = await mammoth.extractRawText({ buffer });
    return parsed.value.trim();
  }
  return buffer.toString("utf8").trim();
}

const symbolMap: Record<string, string> = {
  "EUR/USD": "EUR/USD",
  "EURUSD": "EUR/USD",
  "GBP/USD": "GBP/USD",
  "GBPUSD": "GBP/USD",
  "XAU/USD": "XAU/USD",
  XAUUSD: "XAU/USD",
  "BTC/USD": "BTC/USD",
  BTCUSD: "BTC/USD",
};

export function normalizeAsset(asset: string) {
  const key = asset.toUpperCase().replace(/\s+/g, "");
  return symbolMap[key] ?? symbolMap[asset.toUpperCase()] ?? asset.toUpperCase();
}

export type TwelveDataAssetGroup = "EUR_XAU" | "GBP_BTC" | "ALL";

export function twelveDataAssetGroupForAsset(asset: string): TwelveDataAssetGroup {
  const normalized = normalizeAsset(asset);
  if (normalized === "EUR/USD" || normalized === "XAU/USD") return "EUR_XAU";
  if (normalized === "GBP/USD" || normalized === "BTC/USD") return "GBP_BTC";
  return "ALL";
}

export function twelveDataAssetGroupForAssets(assets: readonly string[]): TwelveDataAssetGroup {
  const groups = new Set(assets.map(twelveDataAssetGroupForAsset));
  if (groups.size === 1) return Array.from(groups)[0] ?? "ALL";
  return "ALL";
}

export function twelveDataKeySlotIndexesForGroup(group: TwelveDataAssetGroup): number[] {
  if (group === "EUR_XAU") return [0, 1, 2, 6];
  if (group === "GBP_BTC") return [3, 4, 5, 7];
  return [0, 1, 2, 3, 4, 5, 6, 7];
}

export function twelveDataKeySlotIndexesForAssets(assets: readonly string[]): number[] {
  return twelveDataKeySlotIndexesForGroup(twelveDataAssetGroupForAssets(assets));
}

function twelveDataKeyPoolForAssets(assets: readonly string[]) {
  const group = twelveDataAssetGroupForAssets(assets);
  const slots = ENV.twelveDataApiKeySlots ?? [];
  const selected = twelveDataKeySlotIndexesForAssets(assets).map((index) => slots[index]).filter((key): key is string => Boolean(key));
  if (selected.length) return selected;
  if (group !== "ALL") throw new Error(`Twelve Data ${group} key pool is not configured`);
  return ENV.twelveDataApiKeys.length ? ENV.twelveDataApiKeys : [ENV.twelveDataApiKey].filter(Boolean);
}

let twelveDataCursorByPool: Record<TwelveDataAssetGroup, number> = { EUR_XAU: 0, GBP_BTC: 0, ALL: 0 };

export function reserveTwelveDataKeyStart(keyCount: number, cursor: number) {
  if (keyCount <= 0) return { startIndex: 0, nextCursor: 0 };
  const startIndex = ((cursor % keyCount) + keyCount) % keyCount;
  return { startIndex, nextCursor: (startIndex + 1) % keyCount };
}

export function isTwelveDataFailoverError(error: unknown, payload?: any) {
  const status = (error as any)?.response?.status ?? (error as any)?.status;
  const code = payload?.code ?? (error as any)?.response?.data?.code;
  const errorCode = String((error as any)?.code ?? "");
  const message = String(payload?.message ?? (error as any)?.response?.data?.message ?? (error as any)?.message ?? "");
  return status === 401 || status === 403 || status === 429 || code === 401 || code === 403 || code === 429 || errorCode === "ECONNABORTED" || errorCode === "ETIMEDOUT" || /credit|quota|rate.?limit|too many requests|timeout/i.test(message);
}

export function hasCompleteTwelveDataBatch(payload: any, symbols: readonly string[]) {
  return symbols.every(symbol => {
    const values = payload?.[symbol]?.values;
    return Array.isArray(values) && values.length >= 3;
  });
}

async function requestTwelveData(path: string, params: Record<string, string | number>, timeout: number, assets: readonly string[] = [], isUsableResponse?: (payload: any) => boolean) {
  const keys = twelveDataKeyPoolForAssets(assets);
  if (!keys.length) throw new Error("Twelve Data is not configured");
  let lastError: unknown;
  const pool = twelveDataAssetGroupForAssets(assets);
  const reservation = reserveTwelveDataKeyStart(keys.length, twelveDataCursorByPool[pool]);
  twelveDataCursorByPool[pool] = reservation.nextCursor;
  for (let attempt = 0; attempt < keys.length; attempt += 1) {
    const index = (reservation.startIndex + attempt) % keys.length;
    const key = keys[index];
    try {
      const response = await axios.get(path, { params: { ...params, apikey: key }, timeout });
      if (isTwelveDataFailoverError(undefined, response.data) || response.status === 401 || response.status === 403 || response.status === 429) {
        lastError = new Error(response.data?.message ?? `Twelve Data key ${index + 1} unavailable`);
        continue;
      }
      if (isUsableResponse && !isUsableResponse(response.data)) {
        lastError = new Error(`Twelve Data key ${index + 1} returned an incomplete response`);
        continue;
      }
      return response;
    } catch (error) {
      if (!isTwelveDataFailoverError(error)) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("All configured Twelve Data keys are unavailable");
}

export async function fetchMarketSnapshot(asset: string, interval = "15min") {
  const symbol = normalizeAsset(asset);
  const response = await requestTwelveData("https://api.twelvedata.com/quote", { symbol, interval }, 15000, [symbol]);
  if (response.data?.status === "error") throw new Error(response.data.message ?? "Market data unavailable");
  const quote = response.data;
  const price = Number(quote.close ?? quote.price ?? quote.previous_close);
  if (!Number.isFinite(price)) throw new Error("Market provider returned no usable price");
  return {
    symbol,
    price,
    open: Number(quote.open),
    high: Number(quote.high),
    low: Number(quote.low),
    close: Number(quote.close),
    change: Number(quote.percent_change),
    fetchedAt: new Date().toISOString(),
  } satisfies MarketSnapshot;
}

export type MarketSeries = {
  symbol: string;
  interval: "5min" | "15min" | "1h" | "4h";
  values: Array<Record<string, unknown>>;
  close: number;
  trend: "UP" | "DOWN";
  fetchedAt: string;
  marketContext: MarketContext | null;
};

function parseMarketSeries(symbol: string, interval: "5min" | "15min" | "1h" | "4h", payload: any): MarketSeries {
  if (payload?.status === "error") throw new Error(payload.message ?? "OHLCV data unavailable");
  const values = Array.isArray(payload?.values) ? payload.values : [];
  if (values.length < 3) throw new Error("Not enough OHLCV data for timeframe");
  const last = values[values.length - 1];
  const prior = values[values.length - 2];
  const close = Number(last.close);
  const priorClose = Number(prior.close);
  if (!Number.isFinite(close) || !Number.isFinite(priorClose)) throw new Error("OHLCV data has no usable close price");
  return { symbol, interval, values, close, trend: close >= priorClose ? "UP" : "DOWN", fetchedAt: new Date().toISOString(), marketContext: calculateMarketContext(values) };
}

export async function fetchMarketSeries(asset: string, interval: "5min" | "15min" | "1h" | "4h") {
  const symbol = normalizeAsset(asset);
  const response = await requestTwelveData("https://api.twelvedata.com/time_series", { symbol, interval, outputsize: 200, order: "ASC", timezone: "UTC" }, 15000, [symbol]);
  return parseMarketSeries(symbol, interval, response.data);
}

export async function fetchMarketSeriesBatch(assets: readonly string[], interval: "5min" | "15min" | "1h" | "4h") {
  const symbols = assets.map(normalizeAsset);
  const startedAt = Date.now();
  console.info(`[Market] Twelve Data batch started interval=${interval} assets=${symbols.length} at=${new Date(startedAt).toISOString()}`);
  try {
    const response = await requestTwelveData("https://api.twelvedata.com/time_series", { symbol: symbols.join(","), interval, outputsize: 200, order: "ASC", timezone: "UTC" }, 20000, symbols, (payload) => hasCompleteTwelveDataBatch(payload, symbols));
    if (response.data?.status === "error") throw new Error(response.data.message ?? "OHLCV batch unavailable");
    const result = new Map<string, MarketSeries>();
    for (const symbol of symbols) {
      const payload = response.data?.[symbol];
      if (!payload) continue;
      try {
        result.set(symbol, parseMarketSeries(symbol, interval, payload));
      } catch (error) {
        console.warn(`[Market] ${symbol} ${interval} skipped:`, error instanceof Error ? error.message : error);
      }
    }
    if (result.size !== symbols.length) {
      const missing = symbols.filter(symbol => !result.has(symbol));
      throw new Error(`Twelve Data returned incomplete ${interval} batch; missing usable series: ${missing.join(", ")}`);
    }
    console.info(`[Market] Twelve Data batch completed interval=${interval} assets=${symbols.length} series=${result.size} durationMs=${Date.now() - startedAt} at=${new Date().toISOString()}`);
    return result;
  } catch (error) {
    console.warn(`[Market] Twelve Data batch failed interval=${interval} assets=${symbols.length} durationMs=${Date.now() - startedAt}:`, error instanceof Error ? error.message : error);
    throw error;
  }
}

export function shouldNotifyApprovedAudit(verdict: string) {
  return verdict === "APPROVED";
}

export function formatDetailedApprovedTelegramMessage(input: {
  asset: string;
  timeframe: string;
  direction: string;
  entry: number | null | undefined;
  stopLoss: number | null | undefined;
  takeProfit: number | null | undefined;
  confidence: number;
  riskReward?: number | null;
  adjustments: string;
  ruleEvidence?: string[];
  confluenceScore?: number;
  decisionTrace?: IntelligenceDecisionTrace;
  fundamentalContext?: FundamentalContext & { observations?: Array<{ source: string; series: string; value: number; observedAt: string }>; fetchedAt?: string; stale?: boolean };
}) {
  const optional = (value: number | null | undefined) => value == null ? "—" : String(value);
  const trace = input.decisionTrace;
  const confluence = trace?.scoreSummary.confluenceScore ?? input.confluenceScore;
  const lines = [
    "TradingGuardAI · PAPER SIGNAL",
    `${input.direction} ${input.asset} · ${input.timeframe}`,
    "Validation: UNVALIDATED · Paper trading only",
    "",
    "Trade plan",
    `Entry: ${optional(input.entry)}`,
    `Stop loss: ${optional(input.stopLoss)}`,
    `Take profit: ${optional(input.takeProfit)}`,
    `Risk/reward: ${input.riskReward == null ? "—" : `1:${input.riskReward}`}`,
    `Confidence: ${input.confidence}%${confluence == null ? "" : ` · Confluence: ${confluence}%`}`,
    "",
    "Decision summary",
    input.adjustments,
  ];
  const macro = input.fundamentalContext;
  if (macro) {
    lines.push("", "Macro context", `Status: ${macro.status} · Bias: ${macro.bias}${macro.eventRisk ? ` · Event risk: ${macro.eventRisk}` : ""}`, `Summary: ${macro.summary}`);
    if (macro.observations?.length) lines.push("Official observations: ", ...macro.observations.slice(0, 4).map((observation) => `• ${observation.source} ${observation.series}: ${observation.value} (${observation.observedAt.slice(0, 10)})`));
    if (macro.fetchedAt) lines.push(`Fetched: ${macro.fetchedAt}`);
  }
  const rules = input.ruleEvidence ?? [];
  if (rules.length) lines.push("", "Source rules applied", ...rules.slice(0, 3).map((rule) => `• ${rule}`));
  if (trace) {
    lines.push(
      "",
      "Deterministic intelligence trace",
      `Supporting components: ${trace.supportingComponents.join("; ") || "None"}`,
      `Conflicting components: ${trace.conflictingComponents.join("; ") || "None"}`,
      `Score: BUY ${trace.scoreSummary.buyScore} vs SELL ${trace.scoreSummary.sellScore}`,
      `Level derivation: ${trace.levelDerivation.stopLoss} ${trace.levelDerivation.takeProfit}`,
    );
  }
  return lines.join("\n");
}

export function formatApprovedTelegramMessage(input: { asset: string; timeframe: string; direction: string; entry: number | null | undefined; stopLoss: number | null | undefined; takeProfit: number | null | undefined; confidence: number; riskReward?: number | null; adjustments?: string; ruleEvidence?: string[]; fundamentalContext?: FundamentalContext; confluenceScore?: number; decisionTrace?: IntelligenceDecisionTrace; generationSource?: "ENTRY_LOCATOR" }) {
  const optional = (value: number | null | undefined) => value == null ? "—" : String(value);
  const trace = input.decisionTrace;
  const confluence = trace?.scoreSummary.confluenceScore ?? input.confluenceScore;
  const score = trace ? `Score: BUY ${trace.scoreSummary.buyScore} vs SELL ${trace.scoreSummary.sellScore}` : "Score: unavailable";
  const sourceLabel = "HIERARCHICAL WORKFLOW · ENTRY LOCATOR";
  return [
    input.direction,
    `${input.asset} · ${input.timeframe}`,
    `Entry: ${optional(input.entry)}`,
    `Stop loss: ${optional(input.stopLoss)}`,
    `Take profit: ${optional(input.takeProfit)}`,
    `Risk/reward: ${input.riskReward == null ? "—" : `1:${input.riskReward}`}`,
    `Confidence: ${input.confidence}%${confluence == null ? "" : ` · Confluence: ${confluence}%`}`,
    score,
    `Paper only · UNVALIDATED · ${sourceLabel}`,
  ].join("\n");
}

function escapeTelegramHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

export function formatOutcomeTelegramMessage(input: { asset: string; timeframe: string; direction: string; status: "WIN" | "LOSS"; entry: number | string; stopLoss: number | string; takeProfit: number | string; closePrice: number; signalId: number; note?: string; generationSource?: "ENTRY_LOCATOR" }) {
  return [
    input.status,
    input.direction,
    `${input.asset} · ${input.timeframe}`,
    `Entry: ${input.entry}`,
    `Paper only · UNVALIDATED · ENTRY LOCATOR`,
  ].join("\n");
}

export function formatOutcomeCorrectionTelegramMessage(input: { asset: string; timeframe: string; direction: string; entry: number | string; signalId: number; reason: string }) {
  return [
    "OUTCOME CORRECTION",
    `${input.direction} ${input.asset} · ${input.timeframe}`,
    `Entry: ${input.entry} · Signal #${input.signalId}`,
    "The earlier WIN notification was incorrect and has been retracted.",
    "The paper signal remains OPEN/PENDING; no take-profit touch was confirmed.",
    input.reason,
    "Paper only · UNVALIDATED · No live order changed",
  ].join("\n");
}

export function formatPaperTradeContradictionWarningTelegramMessage(input: { signalId: number; asset: string; timeframe: string; originalDirection: string; observedDirection: string; currentPrice: number; confidence: number; confluenceScore: number; reason: string }) {
  const safe = (value: string) => escapeTelegramHtml(value);
  return [
    "TradingGuardAI · PAPER WARNING",
    `Original: ${safe(input.originalDirection)} ${safe(input.asset)} · ${safe(input.timeframe)} · Signal #${input.signalId}`,
    "Paper only · UNVALIDATED · No live order changed",
    "",
    `Contradicting v5 direction: ${safe(input.observedDirection)}`,
    `Current price: ${input.currentPrice} · Confidence: ${input.confidence}% · Confluence: ${input.confluenceScore}%`,
    "The opposing setup is strong, but it did not pass the replacement Entry Locator and exact 1:2/1:3 geometry gates.",
    "Review the original paper setup; no replacement signal was issued.",
  ].join("\n");
}

export function formatPaperTradeAdjustmentTelegramMessage(input: { signalId: number; asset: string; timeframe: string; originalDirection: string; observedDirection: string; currentPrice: number; confidence: number; confluenceScore: number; action: string; reason: string; evidence: { opposingIndicators: string[]; supportingComponents: string[]; conflictingComponents: string[]; suggestedStopLoss?: number } }) {
  const safe = (value: string) => escapeTelegramHtml(value);
  const lines = [
    "TradingGuardAI · PAPER ADJUSTMENT",
    `Original: ${safe(input.originalDirection)} ${safe(input.asset)} · ${safe(input.timeframe)} · Signal #${input.signalId}`,
    "Paper only · UNVALIDATED · No live order changed",
    "",
    "Contradiction detected",
    `Current v5 direction: ${safe(input.observedDirection)}`,
    `Current price: ${input.currentPrice}`,
    `Confidence: ${input.confidence}% · Confluence: ${input.confluenceScore}%`,
    `Action: ${safe(input.action.replaceAll("_", " "))}`,
    safe(input.reason),
  ];
  if (input.evidence.opposingIndicators.length) lines.push("", "Opposing indicators", ...input.evidence.opposingIndicators.slice(0, 6).map((item) => `• ${safe(item)}`));
  if (input.evidence.suggestedStopLoss != null) lines.push("", `Suggested paper stop adjustment: ${input.evidence.suggestedStopLoss}`);
  if (input.evidence.supportingComponents.length) lines.push("", "Current supporting components", ...input.evidence.supportingComponents.slice(0, 6).map((item) => `• ${safe(item)}`));
  if (input.evidence.conflictingComponents.length) lines.push("", "Current conflicting components", ...input.evidence.conflictingComponents.slice(0, 6).map((item) => `• ${safe(item)}`));
  return lines.join("\n");
}

export function formatPaperTradeUpgradeTelegramMessage(input: { signalId: number; replacementSignalId: number; asset: string; timeframe: string; direction: string; entry: number | string; stopLoss: number | string; takeProfit: number | string; confidence: number; riskReward?: number | null; confluenceScore: number; reason: string; improvements: string[] }) {
  const safe = (value: string) => escapeTelegramHtml(value);
  return [
    "TradingGuardAI · PAPER SETUP UPGRADE",
    `Original signal #${input.signalId} · Replacement thesis #${input.replacementSignalId}`,
    `${safe(input.direction)} ${safe(input.asset)} · ${safe(input.timeframe)}`,
    "Paper only · UNVALIDATED · No live order changed",
    "",
    "Stronger setup detected",
    `Entry: ${input.entry}`,
    `Stop loss: ${input.stopLoss}`,
    `Take profit: ${input.takeProfit}`,
    `Risk/reward: ${input.riskReward == null ? "—" : `1:${input.riskReward}`}`,
    `Confidence: ${input.confidence}% · Confluence: ${input.confluenceScore}%`,
    safe(input.reason),
    ...(input.improvements.length ? ["", "Why this setup is stronger", ...input.improvements.slice(0, 6).map((item) => `• ${safe(item)}`)] : []),
    "",
    "The original paper signal is preserved for audit history and marked SUPERSEDED; only the replacement thesis remains active.",
  ].join("\n");
}

export function formatReasonTelegramMessage(input: {
  signalId: number;
  asset: string;
  timeframe: string;
  direction: string;
  entry: number | string;
  stopLoss: number | string;
  takeProfit: number | string;
  confidence: number | string;
  rationale?: string | null;
  intelligenceVersion?: string | null;
  intelligenceComponents?: string | null;
  marketRegime?: string | null;
  marketSnapshot?: string | null;
}) {
  const lines = [
    "TradingGuardAI · REASON",
    `${input.direction} ${input.asset} · ${input.timeframe} · Signal #${input.signalId}`,
    "Paper only · UNVALIDATED",
    "",
    "Decision details",
    input.rationale?.trim() || "No stored rationale was available for this signal.",
    `Intelligence: ${input.intelligenceVersion ?? "unknown"}`,
    `Confidence: ${input.confidence}%`,
    `Market regime: ${input.marketRegime ?? "unknown"}`,
  ];
  try {
    const components = JSON.parse(input.intelligenceComponents ?? "[]");
    if (Array.isArray(components) && components.length) lines.push("", "Source-linked components", ...components.filter((item) => typeof item === "string").slice(0, 8).map((item) => `• ${item}`));
  } catch {
    // Preserve the response even if an older signal has malformed component metadata.
  }
  try {
    const snapshot = JSON.parse(input.marketSnapshot ?? "{}");
    const macro = snapshot?.fundamentalContext;
    if (macro) {
      lines.push("", "Macro context", `Status: ${macro.status ?? "UNKNOWN"} · Bias: ${macro.bias ?? "NEUTRAL"}`, macro.summary ?? "No macro summary stored.");
      if (Array.isArray(macro.observations) && macro.observations.length) lines.push(...macro.observations.slice(0, 6).map((observation: any) => `• ${observation.source} ${observation.series}: ${observation.value} (${String(observation.observedAt ?? "").slice(0, 10)})`));
      if (Array.isArray(macro.calendarEvents) && macro.calendarEvents.length) {
        lines.push(`Calendar events: ${macro.calendarStatus ?? "UNKNOWN"}`);
        lines.push(...macro.calendarEvents.slice(0, 6).map((event: any) => `• ${event.country} ${event.impact}: ${event.title} (${String(event.date ?? "").replace("T", " ").slice(0, 16)} UTC; forecast ${event.forecast || "—"}; previous ${event.previous || "—"})`));
      }
    }
    if (snapshot?.replacementIntelligence?.decisionTrace?.scoreSummary) {
      const score = snapshot.replacementIntelligence.decisionTrace.scoreSummary;
      lines.push("", "Deterministic score", `BUY ${score.buyScore} vs SELL ${score.sellScore}`, `Confluence: ${score.confluenceScore}%`);
    }
  } catch {
    // Older snapshots may not be JSON; the stored rationale remains the source of truth.
  }
  return lines.join("\n");
}

export type TelegramAsset = "EUR/USD" | "XAU/USD" | "GBP/USD" | "BTC/USD";

function telegramDestination(asset?: string) {
  if (asset === "EUR/USD" || asset === "XAU/USD" || asset === "GBP/USD") {
    const configured = ENV.telegramAssetBots[asset];
    return { token: configured.token, chatId: configured.groupChatId || configured.chatId };
  }
  return { token: ENV.telegramBotToken, chatId: ENV.telegramGroupChatId || ENV.telegramChatId };
}

export async function sendTelegramMessage(text: string, asset?: string, options?: { replyToMessageId?: string }): Promise<{ delivered: boolean; telegramMessageId?: string; error?: string }> {
  const destination = telegramDestination(asset);
  if (!destination.token || !destination.chatId) return { delivered: false, error: `${asset ?? "BTC/USD"} Telegram credentials are not configured` };
  const endpoint = `https://api.telegram.org/bot${destination.token}/sendMessage`;
  const replyParameters = options?.replyToMessageId && Number.isInteger(Number(options.replyToMessageId))
    ? { reply_parameters: { message_id: Number(options.replyToMessageId) } }
    : {};
  const postMessage = (extra: typeof replyParameters) => axios.post<{ ok?: boolean; result?: { message_id?: number }; description?: string }>(endpoint, {
    chat_id: destination.chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  }, { timeout: 12000 });
  const notificationKind = text.includes("PAPER SETUP UPGRADE") ? "upgrade" : text.includes("PAPER ADJUSTMENT") ? "adjustment" : text.includes("PAPER WARNING") ? "warning" : text.includes("OUTCOME CORRECTION") ? "correction" : text.includes("· REASON") ? "reason" : text.startsWith("WIN\n") || text.startsWith("LOSS\n") ? "outcome" : "signal";
  try {
    const response = await postMessage(replyParameters);
    const telegramMessageId = response.data.result?.message_id != null ? String(response.data.result.message_id) : undefined;
    console.info(`[Telegram] ${asset ?? "BTC/USD"} ${notificationKind} notification delivered${Object.keys(replyParameters).length ? " as reply" : ""}`);
    return { delivered: true, telegramMessageId };
  } catch (error) {
    const status = Number((error as any)?.response?.status);
    const providerMessage = (error as any)?.response?.data?.description;
    if (Object.keys(replyParameters).length && status === 400) {
      try {
        const fallbackResponse = await postMessage({});
        const telegramMessageId = fallbackResponse.data.result?.message_id != null ? String(fallbackResponse.data.result.message_id) : undefined;
        console.info(`[Telegram] ${asset ?? "BTC/USD"} ${notificationKind} notification delivered without reply fallback after HTTP 400`);
        return { delivered: true, telegramMessageId };
      } catch (fallbackError) {
        const fallbackMessage = (fallbackError as any)?.response?.data?.description ?? (fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
        const message = `reply HTTP 400${providerMessage ? ` (${providerMessage})` : ""}; standalone fallback failed: ${fallbackMessage}`;
        console.warn(`[Telegram] Could not send ${asset ?? "BTC/USD"} notification:`, message);
        return { delivered: false, error: message };
      }
    }
    const message = providerMessage ?? (error instanceof Error ? error.message : String(error));
    console.warn(`[Telegram] Could not send ${asset ?? "BTC/USD"} notification:`, message);
    return { delivered: false, error: message };
  }
}

export function gateAuditDecision(result: {
  verdict: "APPROVED" | "DENIED";
  confidence: number;
  adjustments: string;
  asset?: string;
  timeframe?: string;
  direction?: "BUY" | "SELL";
  entry?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  ruleEvidence?: string[];
  ruleFindings?: Array<{ title: string; stance: "BUY" | "SELL" | "NEUTRAL"; weight: number }>;
}, rules: string) {
  const evidence = Array.isArray(result.ruleEvidence)
    ? result.ruleEvidence.filter((title) => typeof title === "string" && title.trim() && rules.includes(title.trim())).slice(0, 8)
    : [];
  const hasValidLevels = [result.entry, result.stopLoss, result.takeProfit].every((value) => typeof value === "number" && Number.isFinite(value));
  const direction = result.direction;
  const levelsAreDirectional = direction === "BUY"
    ? Number(result.stopLoss) < Number(result.entry) && Number(result.takeProfit) > Number(result.entry)
    : direction === "SELL"
      ? Number(result.stopLoss) > Number(result.entry) && Number(result.takeProfit) < Number(result.entry)
      : false;
  const findings = Array.isArray(result.ruleFindings)
    ? result.ruleFindings.filter((finding) => finding && typeof finding.title === "string" && rules.includes(finding.title.trim()) && ["BUY", "SELL", "NEUTRAL"].includes(finding.stance)).slice(0, 8)
    : [];
  const buyScore = findings.filter((finding) => finding.stance === "BUY").reduce((sum, finding) => sum + Math.max(1, Math.min(5, Number(finding.weight) || 1)), 0);
  const sellScore = findings.filter((finding) => finding.stance === "SELL").reduce((sum, finding) => sum + Math.max(1, Math.min(5, Number(finding.weight) || 1)), 0);
  const totalDirectionalScore = buyScore + sellScore;
  const dominantScore = Math.max(buyScore, sellScore);
  const confluenceScore = totalDirectionalScore ? Math.round((dominantScore / totalDirectionalScore) * 100) : 0;
  const paperReady = Boolean(direction && hasValidLevels && levelsAreDirectional);
  return {
    ...result,
    verdict: paperReady ? "APPROVED" as const : "DENIED" as const,
    ruleEvidence: evidence,
    ruleFindings: findings,
    confluenceScore,
    validationStatus: "UNVALIDATED" as const,
    adjustments: paperReady
      ? `Evidence gate disabled by configuration. Directional paper outcome generated; validation remains UNVALIDATED. ${result.adjustments}`
      : `No paper outcome generated because the directional entry, stop loss, and take profit are incomplete or geometrically invalid. ${result.adjustments}`,
  };
}

export function formatAuditResult(result: { verdict: "APPROVED" | "DENIED"; confidence: number; adjustments: string; ruleEvidence?: string[]; confluenceScore?: number; validationStatus?: string }, market: MarketSnapshot) {
  const evidence = result.ruleEvidence?.length ? `\n\nRules applied:\n${result.ruleEvidence.map((rule) => `- ${rule}`).join("\n")}` : "";
  const confluence = typeof result.confluenceScore === "number" ? `\n\nConfluence score: ${result.confluenceScore}%` : "";
  return `${result.verdict === "APPROVED" ? "TRADE APPROVED" : "TRADE DENIED"}\n\nConfidence level: ${result.confidence}%\n\nValidation status: ${result.validationStatus ?? "UNVALIDATED"}\n\nAdjustments: ${result.adjustments}${confluence}${evidence}\n\nLive ${market.symbol}: ${market.price}`;
}

export async function auditWithLLM(input: {
  tradeSignal: string;
  rules: string;
  market: MarketSnapshot;
}) {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: "You are TradingGuardAI. You never guarantee profit, never place trades, and must not use an evidence approval gate. Use the supplied strategy intelligence and market snapshot to choose the better-supported BUY or SELL direction, provide complete directional levels, and return valid JSON only. Rule citations and findings are explanatory metadata, not approval prerequisites.",
      },
      {
        role: "user",
        content: `Use the supplied PDF-derived trading intelligence and raw market data to determine the better-supported possible trade outcome. Always choose BUY or SELL when a complete directional outcome can be formed; do not return DENIED merely because citations are limited or signals conflict. Derive entry, stop loss, and take profit from the intelligence and observed market conditions. Context:\n${input.tradeSignal}\n\nPDF-derived strategy intelligence:\n${input.rules}\n\nRaw market data and derived snapshot:\n${JSON.stringify(input.market)}\n\nCitations and findings are explanatory metadata; do not invent citations.`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "trade_audit",
        strict: true,
        schema: {
          type: "object",
          properties: {
            verdict: { type: "string", enum: ["APPROVED", "DENIED"] },
            confidence: { type: "number", minimum: 0, maximum: 100 },
            adjustments: { type: "string" },
            asset: { type: "string" },
            timeframe: { type: "string" },
            direction: { type: "string", enum: ["BUY", "SELL"] },
            entry: { type: ["number", "null"] },
            stopLoss: { type: ["number", "null"] },
            takeProfit: { type: ["number", "null"] },
            ruleEvidence: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 8 },
            ruleFindings: { type: "array", items: { type: "object", properties: { title: { type: "string" }, stance: { type: "string", enum: ["BUY", "SELL", "NEUTRAL"] }, weight: { type: "number", minimum: 1, maximum: 5 } }, required: ["title", "stance", "weight"], additionalProperties: false }, minItems: 0, maxItems: 8 },
          },
          required: ["verdict", "confidence", "adjustments", "asset", "timeframe", "direction", "entry", "stopLoss", "takeProfit", "ruleEvidence", "ruleFindings"],
          additionalProperties: false,
        },
      },
    },
  });
  const content = response.choices?.[0]?.message?.content;
  const parsed = JSON.parse(typeof content === "string" ? content : "{}");
  return gateAuditDecision(parsed, input.rules);
}

export type ScannerDecisionCandidate = {
  asset: string;
  timeframe: string;
  market: MarketSnapshot;
};

export function parseStructuredContent(content: unknown): any {
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.filter((part: any) => part && part.type === "text" && typeof part.text === "string").map((part: any) => part.text).join("\n")
      : "";
  const trimmed = text.trim();
  if (!trimmed) return {};

  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (fenced) candidates.push(fenced.trim());
  const firstObject = trimmed.indexOf("{");
  const lastObject = trimmed.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) candidates.push(trimmed.slice(firstObject, lastObject + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next provider-compatible wrapper shape.
    }
  }
  return {};
}

export async function generateScannerDecisions(input: { candidates: ScannerDecisionCandidate[]; rules: string }) {
  if (!input.candidates.length) return Object.assign([], { metrics: { snapshots: 0, completeResponses: 0, retries: 0 } });
  const batchSize = 1;
  const batches = Array.from({ length: Math.ceil(input.candidates.length / batchSize) }, (_, index) => input.candidates.slice(index * batchSize, index * batchSize + batchSize));
  const results: Array<{ decisions: any[]; retries: number }> = [];
  for (let index = 0; index < batches.length; index += 4) {
    results.push(...await Promise.all(batches.slice(index, index + 4).map((candidates) => generateScannerDecisionBatch({ candidates, rules: input.rules }))));
  }
  return Object.assign(results.flatMap((result) => result.decisions), {
    metrics: {
      snapshots: input.candidates.length,
      completeResponses: input.candidates.length,
      retries: results.reduce((total, result) => total + result.retries, 0),
    },
  });
}

async function generateScannerDecisionBatch(input: { candidates: ScannerDecisionCandidate[]; rules: string }) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: "You are TradingGuardAI. You MUST return exactly one directional judgment for EVERY supplied raw market candidate. Never omit a candidate and never return NEUTRAL as the direction: choose BUY or SELL using the complete strategy-rule library and raw OHLCV data, then generate entry, stop loss, and take profit. Mark the judgment APPROVED only when the supplied evidence gate is satisfied; otherwise return DENIED with the chosen BUY or SELL direction and a precise explanation. Never place trades, never guarantee profit, cite exact rule titles, and return valid JSON only.",
      },
      {
        role: "user",
        content: `Generate exactly one BUY or SELL decision for each raw market candidate—exactly ${input.candidates.length} decisions total. Do not return an empty decisions array, do not omit candidates, and do not use NEUTRAL as the direction. Derive the directional judgment and risk levels from the complete strategy rules, raw OHLCV candles, and the deterministic market-context features. Use the context to assess market structure, volatility regime, latest and recent candle behavior, support/resistance zones, momentum, breakout state, and opposing-timeframe context. Treat the raw candles as the source of truth and use derived features as transparent calculations, not as invented chart facts. If evidence is weak or conflicting, still choose the better-supported BUY or SELL direction, return DENIED, and explain the evidence weakness. Complete strategy rules:\n${input.rules}\n\nRaw market candidates with detailed deterministic context:\n${JSON.stringify(input.candidates)}`,
      },
    ],
    maxTokens: 2048,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "scanner_trade_decisions",
        strict: true,
        schema: {
          type: "object",
          properties: {
            decisions: {
              type: "array",
              minItems: input.candidates.length,
              maxItems: 8,
              items: {
                type: "object",
                properties: {
                  asset: { type: "string" },
                  timeframe: { type: "string" },
                  verdict: { type: "string", enum: ["APPROVED", "DENIED"] },
                  confidence: { type: "number", minimum: 0, maximum: 100 },
                  adjustments: { type: "string" },
                  direction: { type: "string", enum: ["BUY", "SELL"] },
                  entry: { type: ["number", "null"] },
                  stopLoss: { type: ["number", "null"] },
                  takeProfit: { type: ["number", "null"] },
                  ruleEvidence: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 8 },
                  ruleFindings: { type: "array", items: { type: "object", properties: { title: { type: "string" }, stance: { type: "string", enum: ["BUY", "SELL", "NEUTRAL"] }, weight: { type: "number", minimum: 1, maximum: 5 } }, required: ["title", "stance", "weight"], additionalProperties: false }, minItems: 0, maxItems: 8 },
                },
                required: ["asset", "timeframe", "verdict", "confidence", "adjustments", "direction", "entry", "stopLoss", "takeProfit", "ruleEvidence", "ruleFindings"],
                additionalProperties: false,
              },
            },
          },
          required: ["decisions"],
          additionalProperties: false,
        },
      },
    },
      });
      const content = response.choices?.[0]?.message?.content;
      const parsed = parseStructuredContent(content);
      let modelDecisions = Array.isArray(parsed.decisions) ? parsed.decisions : [];
      if (modelDecisions.length === 0 && input.candidates.every((candidate) => candidate.market.intelligenceSeed)) {
        modelDecisions = input.candidates.map((candidate) => ({
          asset: candidate.asset,
          timeframe: candidate.timeframe,
          verdict: "APPROVED",
          confidence: candidate.market.intelligenceSeed!.confidence,
          adjustments: `${candidate.market.intelligenceSeed!.adjustments} Model explanation was unavailable; direction and levels came from the compiled executable intelligence version.`,
          direction: candidate.market.intelligenceSeed!.direction,
          entry: candidate.market.intelligenceSeed!.entry,
          stopLoss: candidate.market.intelligenceSeed!.stopLoss,
          takeProfit: candidate.market.intelligenceSeed!.takeProfit,
          ruleEvidence: candidate.market.intelligenceSeed!.ruleEvidence,
          ruleFindings: candidate.market.intelligenceSeed!.ruleFindings,
          decisionTrace: candidate.market.intelligenceSeed!.decisionTrace,
        }));
      }
      const expectedKeys = new Set(input.candidates.map((candidate) => `${candidate.asset}:${candidate.timeframe}`));
      const returnedKeys = new Set(modelDecisions.map((decision: any) => `${decision.asset}:${decision.timeframe}`));
      const missing = Array.from(expectedKeys).filter((key) => !returnedKeys.has(key));
      const duplicates = modelDecisions.length !== returnedKeys.size;
      if (missing.length || duplicates || modelDecisions.length !== input.candidates.length) {
        throw new Error(`Strategy engine returned incomplete structured decisions (expected ${input.candidates.length}, received ${modelDecisions.length}, missing ${missing.join(", ") || "none"}).`);
      }
      const byDecisionKey = new Map<string, any>(modelDecisions.map((decision: any) => [`${decision.asset}:${decision.timeframe}`, decision] as [string, any]));
      return {
        decisions: input.candidates.map((candidate) => {
          const decision = byDecisionKey.get(`${candidate.asset}:${candidate.timeframe}`);
          if (!decision) throw new Error(`Strategy engine omitted ${candidate.asset} ${candidate.timeframe}.`);
          const seed = candidate.market.intelligenceSeed;
          const seededDecision = seed ? {
            ...decision,
            direction: seed.direction,
            entry: seed.entry,
            stopLoss: seed.stopLoss,
            takeProfit: seed.takeProfit,
            confidence: Math.max(Number(decision.confidence) || 0, seed.confidence),
            ruleEvidence: Array.isArray(decision.ruleEvidence) && decision.ruleEvidence.length >= 3 ? decision.ruleEvidence : seed.ruleEvidence,
            ruleFindings: Array.isArray(decision.ruleFindings) && decision.ruleFindings.length >= 3 ? decision.ruleFindings : seed.ruleFindings,
            decisionTrace: seed.decisionTrace,
            adjustments: `${seed.adjustments} ${decision.adjustments ?? ""}`.trim(),
          } : decision;
          const gated = gateAuditDecision(seededDecision, input.rules);
          return { ...gated, asset: candidate.asset, timeframe: candidate.timeframe, market: candidate.market };
        }),
        retries: attempt - 1,
      };
    } catch (error) {
      lastError = error;
      if (attempt === 2) break;
    }
  }
  throw new Error(`Strategy engine failed after one retry: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function buildDirectionalFallback(candidate: ScannerDecisionCandidate) {
  const direction = candidate.market.trend === "UP" ? "BUY" : "SELL";
  const entry = Number((candidate.market.close ?? candidate.market.price).toFixed(5));
  const risk = Number((entry * 0.0012).toFixed(5));
  return { asset: candidate.asset, timeframe: candidate.timeframe, verdict: "DENIED" as const, confidence: 0, adjustments: "The strategy engine returned no structured judgment for this snapshot; a directional BUY/SELL placeholder was created for audit visibility and is not Telegram-eligible.", direction, entry, stopLoss: direction === "BUY" ? entry - risk : entry + risk, takeProfit: direction === "BUY" ? entry + risk * 2 : entry - risk * 2, ruleEvidence: [], ruleFindings: [] };
}

/* legacy normalization retained below for source compatibility */
export function normalizeScannerDecisionResults(input: { candidates: ScannerDecisionCandidate[]; rules: string }, parsed: any) {
  const byKey = new Map(input.candidates.map((candidate) => [`${candidate.asset}:${candidate.timeframe}`, candidate]));
  return (Array.isArray(parsed.decisions) ? parsed.decisions : []).flatMap((decision: any) => {
    const candidate = byKey.get(`${decision.asset}:${decision.timeframe}`);
    if (!candidate) return [];
    const gated = gateAuditDecision(decision, input.rules);
    return [{ ...gated, asset: candidate.asset, timeframe: candidate.timeframe, market: candidate.market }];
  });
}

export type ForensicFinding = { rootCause: string; lesson: string; guardrail: string };

export function normalizeForensicFinding(raw: unknown): ForensicFinding {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const text = (value: unknown, fallback: string) => typeof value === "string" && value.trim() ? value.trim() : fallback;
  return {
    rootCause: text(source.rootCause, "Forensic analysis returned no root-cause detail; review the structured signal evidence against the post-entry candle."),
    lesson: text(source.lesson, "Do not promote this loss into active intelligence until the structured evidence is reviewed."),
    guardrail: text(source.guardrail, "Keep this lesson advisory and require repeated paper evidence before changing qualification rules."),
  };
}

export async function forensicAnalysis(signal: { asset: string; direction: string; entry: string; stopLoss: string; takeProfit: string }, market: MarketSnapshot, rules: string) {
  const response = await invokeLLM({
    messages: [
      { role: "system", content: "You are a trading post-mortem analyst. Identify the most likely rule or market-condition failure without claiming certainty. Return concise JSON." },
      { role: "user", content: `A signal lost. Signal: ${JSON.stringify(signal)}. Market at review: ${JSON.stringify(market)}. Rules: ${rules}` },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "loss_forensics",
        strict: true,
        schema: {
          type: "object",
          properties: { rootCause: { type: "string" }, lesson: { type: "string" }, guardrail: { type: "string" } },
          required: ["rootCause", "lesson", "guardrail"],
          additionalProperties: false,
        },
      },
    },
  });
  const content = response.choices?.[0]?.message?.content;
    return normalizeForensicFinding(parseStructuredContent(content));
}


