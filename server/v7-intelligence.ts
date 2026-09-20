import type { FundamentalContext } from "./replacement-intelligence";
import type { MarketSeries } from "./integrations";
import type { WorkflowZone } from "./multitimeframe-workflow";

export const V7_INTELLIGENCE_VERSION = "v7-intelligence" as const;
export const V7_GENERATION_MODE = "V7_INTELLIGENCE" as const;
export const V7_SIGNAL_TIMEFRAMES = ["15MIN", "5MIN"] as const;
export const V7_HIERARCHY = ["1W", "1D", "4H", "1H", "15M"] as const;
export const V7_SESSION = { startHourUtc: 8, endHourUtc: 17 } as const;
export const V7_ASSETS = ["XAU/USD", "BTC/USD", "EUR/USD", "GBP/USD"] as const;

export type V7Asset = (typeof V7_ASSETS)[number];
export type V7Direction = "BUY" | "SELL";
export type V7ChannelStatus = "QUALIFIED" | "WAITING";

export type V7LiveQuote = {
  asset: string;
  price: number;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  fetchedAt: string;
  providerTimestamp?: string | null;
};

export type V7Freshness = {
  ok: boolean;
  quoteAgeMs: number | null;
  candleAgeMs: number | null;
  spread: number | null;
  reasons: string[];
};

export type V7ChannelResult = {
  channel: `V7_${"XAU" | "BTC" | "EUR" | "GBP"}`;
  asset: V7Asset;
  timeframe: string;
  status: V7ChannelStatus;
  direction: V7Direction | "NEUTRAL";
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  confidence: number;
  confluenceScore: number;
  waitReason: string | null;
  sourcePath: "CHANNEL_SIGNAL";
  ordinaryNewsPolicy: "ADDITIVE_ONLY";
  freshness: V7Freshness;
  confirmations: string[];
  zones: WorkflowZone[];
  rationale: string;
};

const HARD_QUOTE_AGE_MS = 15_000;
const HARD_XAU_QUOTE_AGE_MS = 15_000;
const HARD_XAG_QUOTE_AGE_MS = 30_000;
const HARD_CANDLE_LAG_MS = 15 * 60_000 + 60_000;

function parseAt(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const parsed = new Date(normalized).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function latestCompletedCandleAt(series: Pick<MarketSeries, "values" | "fetchedAt">): number | null {
  const latest = series.values.at(-1);
  return parseAt(latest?.datetime) ?? parseAt(series.fetchedAt);
}

export function isWithinV7Session(date = new Date()) {
  const hour = date.getUTCHours();
  return hour >= V7_SESSION.startHourUtc && hour < V7_SESSION.endHourUtc;
}

export function calculateV7Freshness(input: { asset: string; series?: Pick<MarketSeries, "values" | "fetchedAt"> | null; quote?: V7LiveQuote | null; now?: Date; requireSpread?: boolean }): V7Freshness {
  const nowMs = (input.now ?? new Date()).getTime();
  const quoteFetched = input.quote?.providerTimestamp ? parseAt(input.quote.providerTimestamp) : parseAt(input.quote?.fetchedAt);
  const candleAt = input.series ? latestCompletedCandleAt(input.series) : null;
  const quoteAgeMs = quoteFetched == null ? null : Math.max(0, nowMs - quoteFetched);
  const candleAgeMs = candleAt == null ? null : Math.max(0, nowMs - candleAt);
  const reasons: string[] = [];
  const quoteLimit = input.asset === "XAU/USD" ? HARD_XAU_QUOTE_AGE_MS : HARD_QUOTE_AGE_MS;
  if (!input.quote || !Number.isFinite(input.quote.price)) reasons.push("live quote unavailable");
  else if (quoteAgeMs == null || quoteAgeMs > quoteLimit) reasons.push(`quote age exceeds ${quoteLimit / 1000}s`);
  if (!input.series || candleAgeMs == null || candleAgeMs > HARD_CANDLE_LAG_MS) reasons.push("latest completed execution candle is stale or unavailable");
  if (input.requireSpread !== false && (!input.quote || input.quote.bid == null || input.quote.ask == null || input.quote.spread == null || input.quote.spread <= 0)) reasons.push("live bid/ask spread unavailable");
  return { ok: reasons.length === 0, quoteAgeMs, candleAgeMs, spread: input.quote?.spread ?? null, reasons };
}

export function finalRiskReward(entry: number | null, stopLoss: number | null, takeProfit: number | null) {
  if (![entry, stopLoss, takeProfit].every((value) => value != null && Number.isFinite(value))) return null;
  const risk = Math.abs(Number(entry) - Number(stopLoss));
  const reward = Math.abs(Number(takeProfit) - Number(entry));
  return risk > 0 ? Number((reward / risk).toFixed(2)) : null;
}

export function qualifiesV7RiskGeometry(direction: string, entry: number | null, stopLoss: number | null, takeProfit: number | null) {
  if (direction !== "BUY" && direction !== "SELL") return false;
  if (![entry, stopLoss, takeProfit].every((value) => value != null && Number.isFinite(value))) return false;
  const directional = direction === "BUY" ? Number(stopLoss) < Number(entry) && Number(takeProfit) > Number(entry) : Number(stopLoss) > Number(entry) && Number(takeProfit) < Number(entry);
  const rr = finalRiskReward(entry, stopLoss, takeProfit);
  return directional && rr != null && rr >= 2;
}

function channelName(asset: V7Asset): V7ChannelResult["channel"] {
  return `V7_${asset.slice(0, 3).replace("/", "")}` as V7ChannelResult["channel"];
}

/**
 * Adapt the existing structural detector into the v7 contract. The detector is
 * deliberately not allowed to invent a plan: provider freshness, session,
 * direction, complete levels, and final 1:2 geometry are all hard gates.
 * News is not inspected here; it is owned by the additive news path.
 */
export function buildV7ChannelResult(input: {
  asset: V7Asset;
  timeframe: string;
  base: { direction?: string; entry?: number | null; stopLoss?: number | null; takeProfit?: number | null; confidence?: number; confluenceScore?: number; adjustments?: string; ruleEvidence?: string[]; zones?: WorkflowZone[]; fundamentalContext?: FundamentalContext | null };
  freshness: V7Freshness;
  strategyQualified?: boolean;
  sessionOpen?: boolean;
  confirmations?: string[];
}): V7ChannelResult {
  const direction = input.base.direction === "BUY" || input.base.direction === "SELL" ? input.base.direction : "NEUTRAL";
  const rr = finalRiskReward(input.base.entry ?? null, input.base.stopLoss ?? null, input.base.takeProfit ?? null);
  const reasons = [...input.freshness.reasons];
  if (input.sessionOpen === false) reasons.push("outside the configured 08:00–17:00 UTC entry session");
  if (direction === "NEUTRAL") reasons.push("asset channel has no directional structure");
  if (input.asset === "BTC/USD" && input.timeframe !== "15MIN") reasons.push("BTC/USD native signal timeframe is 15MIN; 5MIN may only refine an existing 15MIN setup");
  if (input.strategyQualified === false) reasons.push("asset-specific channel workflow is not qualified");
  if (!qualifiesV7RiskGeometry(direction, input.base.entry ?? null, input.base.stopLoss ?? null, input.base.takeProfit ?? null)) reasons.push("complete structural levels with final RR >= 1:2 are not available");
  const qualified = reasons.length === 0;
  const rationale = qualified
    ? `${input.asset} channel qualified a ${direction} setup from its own structural workflow. News remains additive and did not block this ordinary channel decision. Final RR is 1:${rr}.`
    : `WAIT: ${reasons.join("; ")}. No missing quote, spread, news, zone, or level evidence was fabricated.`;
  return {
    channel: channelName(input.asset), asset: input.asset, timeframe: input.timeframe, status: qualified ? "QUALIFIED" : "WAITING", direction,
    entry: qualified ? input.base.entry ?? null : null, stopLoss: qualified ? input.base.stopLoss ?? null : null, takeProfit: qualified ? input.base.takeProfit ?? null : null,
    riskReward: qualified ? rr : null, confidence: qualified ? Number(input.base.confidence ?? 0) : 0, confluenceScore: qualified ? Number(input.base.confluenceScore ?? 0) : 0,
    waitReason: qualified ? null : reasons.join("; "), sourcePath: "CHANNEL_SIGNAL", ordinaryNewsPolicy: "ADDITIVE_ONLY", freshness: input.freshness,
    confirmations: input.confirmations ?? input.base.ruleEvidence ?? [], zones: input.base.zones ?? [], rationale,
  };
}

export function v7NewsEligibleAssets(): V7Asset[] { return ["XAU/USD", "EUR/USD", "GBP/USD"]; }
export function isBtcNewsExcluded(asset: string) { return asset === "BTC/USD"; }
export function v7NewsObservationWindowMinutes(asset: string) { return asset === "XAU/USD" ? 60 : 60; }

export const V7_FRESHNESS_LIMITS = { xauQuoteMs: HARD_XAU_QUOTE_AGE_MS, xagQuoteMs: HARD_XAG_QUOTE_AGE_MS, quoteMs: HARD_QUOTE_AGE_MS, candleLagMs: HARD_CANDLE_LAG_MS } as const;
