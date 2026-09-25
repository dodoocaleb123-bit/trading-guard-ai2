import type { MarketSeries } from "./integrations";
import type { V7Asset, V7ChannelResult, V7Freshness, V7RuleAudit } from "./v7-intelligence";

type Candle = { time: number; open: number; high: number; low: number; close: number };
type ChannelInput = {
  asset: V7Asset;
  timeframe: string;
  weekly?: MarketSeries | null;
  daily?: MarketSeries | null;
  h4?: MarketSeries | null;
  h1?: MarketSeries | null;
  m15?: MarketSeries | null;
  m5?: MarketSeries | null;
  freshness: V7Freshness;
  sessionOpen: boolean;
  xagDirection?: "BUY" | "SELL" | null;
  xagFresh?: boolean;
};
type Plan = {
  direction: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  confluenceScore: number;
  confirmations: string[];
  zones: V7ChannelResult["zones"];
  rationale: string;
};
type StructuralEvidence = {
  sweep: boolean;
  bos: boolean;
  retracement: boolean;
  extreme: number | null;
  level: number | null;
  zoneLow: number | null;
  zoneHigh: number | null;
};

function candles(series?: MarketSeries | null): Candle[] {
  return (series?.values ?? []).map((raw: any, index) => ({
    time: Date.parse(String(raw.datetime ?? "")) || index,
    open: Number(raw.open), high: Number(raw.high), low: Number(raw.low), close: Number(raw.close),
  })).filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite));
}
function fmt(value: number) { return Number(value.toFixed(8)); }
function latest(series?: MarketSeries | null) { return candles(series).at(-1) ?? null; }
function atr(cs: Candle[], period = 14) {
  if (cs.length < period + 1) return null;
  const trs = cs.slice(1).map((c, i) => Math.max(c.high - c.low, Math.abs(c.high - cs[i].close), Math.abs(c.low - cs[i].close)));
  const values = trs.slice(-period);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function bodyMedian(cs: Candle[]) {
  const values = cs.slice(-21, -1).map((c) => Math.abs(c.close - c.open)).sort((a, b) => a - b);
  return values.length ? values[Math.floor(values.length / 2)] : null;
}
function direction(series?: MarketSeries | null): "BUY" | "SELL" | null {
  const cs = candles(series);
  if (cs.length < 12) return null;
  const recent = cs.slice(-6), prior = cs.slice(-12, -6);
  const recentHigh = Math.max(...recent.map((c) => c.high)), priorHigh = Math.max(...prior.map((c) => c.high));
  const recentLow = Math.min(...recent.map((c) => c.low)), priorLow = Math.min(...prior.map((c) => c.low));
  if (recentHigh > priorHigh && recentLow > priorLow) return "BUY";
  if (recentHigh < priorHigh && recentLow < priorLow) return "SELL";
  return null;
}
function bounds(series?: MarketSeries | null, lookback = 40) {
  const cs = candles(series);
  if (cs.length < 12) return null;
  const window = cs.slice(-lookback);
  return { low: Math.min(...window.map((c) => c.low)), high: Math.max(...window.map((c) => c.high)) };
}
function location(series: MarketSeries | null | undefined, wanted: "BUY" | "SELL", fraction = 0.5) {
  const range = bounds(series);
  const last = latest(series);
  if (!range || !last || range.high <= range.low) return false;
  const level = range.low + (range.high - range.low) * fraction;
  return wanted === "BUY" ? last.close <= level : last.close >= level;
}
function htfAligned(input: ChannelInput, wanted: "BUY" | "SELL", includeWeekly = true) {
  const series = includeWeekly ? [input.weekly, input.daily, input.h4, input.h1] : [input.daily, input.h4, input.h1];
  const values = series.map(direction);
  return values.every((value) => value === wanted);
}
function sweepBosRetracement(series: MarketSeries | null | undefined, wanted: "BUY" | "SELL", lookback = 24): StructuralEvidence {
  const cs = candles(series);
  if (cs.length < Math.max(20, lookback)) return { sweep: false, bos: false, retracement: false, extreme: null, level: null, zoneLow: null, zoneHigh: null };
  const recent = cs.slice(-8), prior = cs.slice(-lookback, -8);
  const priorLow = Math.min(...prior.map((c) => c.low)), priorHigh = Math.max(...prior.map((c) => c.high));
  const sweep = wanted === "BUY"
    ? recent.some((c) => c.low < priorLow && c.close > priorLow)
    : recent.some((c) => c.high > priorHigh && c.close < priorHigh);
  const pivot = cs.slice(-7, -1);
  const level = wanted === "BUY" ? Math.max(...pivot.map((c) => c.high)) : Math.min(...pivot.map((c) => c.low));
  const last = cs.at(-1)!;
  const bos = wanted === "BUY" ? last.close > level && last.close > last.open : last.close < level && last.close < last.open;
  const displacement = cs.slice(-5);
  const displacementClose = wanted === "BUY" ? Math.max(...displacement.map((c) => c.close)) : Math.min(...displacement.map((c) => c.close));
  const zoneLow = Math.min(level, displacementClose), zoneHigh = Math.max(level, displacementClose);
  const retracement = wanted === "BUY" ? last.low <= (zoneLow + zoneHigh) / 2 && last.close >= zoneLow : last.high >= (zoneLow + zoneHigh) / 2 && last.close <= zoneHigh;
  return { sweep, bos, retracement, extreme: wanted === "BUY" ? Math.min(...recent.map((c) => c.low)) : Math.max(...recent.map((c) => c.high)), level, zoneLow, zoneHigh };
}
function planFromEvidence(wanted: "BUY" | "SELL", execution: MarketSeries | null | undefined, targetSeries: MarketSeries | null | undefined, evidence: StructuralEvidence, bufferMultiplier: number, confirmations: string[], rationale: string, extraConfluence = 0): Plan | null {
  const cs = candles(execution), last = latest(execution), volatility = atr(cs), targetRange = bounds(targetSeries ?? execution);
  if (!last || !volatility || evidence.extreme == null || !targetRange || !evidence.sweep || !evidence.bos || !evidence.retracement) return null;
  const buffer = volatility * bufferMultiplier;
  const entry = last.close;
  const stopLoss = wanted === "BUY" ? evidence.extreme - buffer : evidence.extreme + buffer;
  const takeProfit = wanted === "BUY" ? targetRange.high : targetRange.low;
  const risk = Math.abs(entry - stopLoss), reward = Math.abs(takeProfit - entry);
  if (!(risk > 0) || reward / risk < 2) return null;
  const zone = evidence.zoneLow != null && evidence.zoneHigh != null ? [{
    kind: wanted === "BUY" ? "DEMAND" : "SUPPLY", lower: fmt(evidence.zoneLow), upper: fmt(evidence.zoneHigh), reactions: 1, displacement: 1, fresh: true, weakFor: [wanted === "BUY" ? "SELL" : "BUY"], timeframe: execution?.interval ?? "execution", source: "DISPLACEMENT",
  } satisfies V7ChannelResult["zones"][number]] : [];
  return { direction: wanted, entry: fmt(entry), stopLoss: fmt(stopLoss), takeProfit: fmt(takeProfit), confidence: Math.min(94, 70 + extraConfluence * 4), confluenceScore: Math.min(95, 58 + extraConfluence * 7), confirmations: [...confirmations, "meaningful liquidity sweep", "body-close BOS/CHoCH", "retracement into the new confirmation zone", `nearest opposing structural target`, `final RR ${fmt(reward / risk)}`], zones: zone, rationale };
}
function wait(input: ChannelInput, reasons: string[], confirmations: string[] = [], ruleAudit?: V7RuleAudit[]): V7ChannelResult {
  return { channel: `V7_${input.asset.slice(0, 3)}` as V7ChannelResult["channel"], asset: input.asset, timeframe: input.timeframe, status: "WAITING", direction: "NEUTRAL", entry: null, stopLoss: null, takeProfit: null, riskReward: null, confidence: 0, confluenceScore: 0, waitReason: reasons.join("; "), sourcePath: "CHANNEL_SIGNAL", ordinaryNewsPolicy: "ADDITIVE_ONLY", freshness: input.freshness, confirmations, zones: [], rationale: `WAIT: ${reasons.join("; ")}`, ruleAudit };
}
function qualified(input: ChannelInput, plan: Plan): V7ChannelResult {
  const riskReward = Number((Math.abs(plan.takeProfit - plan.entry) / Math.abs(plan.entry - plan.stopLoss)).toFixed(2));
  return { channel: `V7_${input.asset.slice(0, 3)}` as V7ChannelResult["channel"], asset: input.asset, timeframe: input.timeframe, status: "QUALIFIED", direction: plan.direction, entry: plan.entry, stopLoss: plan.stopLoss, takeProfit: plan.takeProfit, riskReward, confidence: plan.confidence, confluenceScore: plan.confluenceScore, waitReason: null, sourcePath: "CHANNEL_SIGNAL", ordinaryNewsPolicy: "ADDITIVE_ONLY", freshness: input.freshness, confirmations: plan.confirmations, zones: plan.zones, rationale: plan.rationale };
}
function baseChecks(input: ChannelInput, required: Array<[string, MarketSeries | null | undefined]>) {
  const reasons = [...input.freshness.reasons];
  if (!input.sessionOpen) reasons.push("outside configured 08:00–17:00 UTC entry session");
  for (const [name, series] of required) if (!series) reasons.push(`${name} data unavailable`);
  return reasons;
}
function evaluateXau(input: ChannelInput): V7ChannelResult {
  const reasons = baseChecks(input, [["Daily", input.daily], ["4H", input.h4], ["1H", input.h1], ["15M", input.m15], ["5M", input.m5]]);
  if (!input.xagFresh || !input.xagDirection) reasons.push("XAG/USD confirmation is stale, unavailable, or missing");
  if (reasons.length) return wait(input, reasons);
  const wanted = direction(input.m15);
  if (!wanted || direction(input.m5) !== wanted || (!htfAligned(input, wanted, false))) return wait(input, ["XAU requires Daily/4H context with supportive 1H/15M/5M direction"]);
  if (input.xagDirection !== wanted) return wait(input, ["XAG/USD direction contradicts XAU/USD"]);
  const cs = candles(input.m5), median = bodyMedian(cs), volatility = atr(cs);
  if (!median || !volatility || Math.abs(cs.at(-1)!.close - cs.at(-1)!.open) < 1.5 * median) return wait(input, ["XAU strong displacement standard not met"]);
  if (!location(input.m15, wanted, 0.65)) return wait(input, ["price has not reached the XAU 15M POI inside the active range"]);
  const evidence = sweepBosRetracement(input.m5, wanted);
  const plan = planFromEvidence(wanted, input.m5, input.m15, evidence, 0.35, ["XAU 15M POI", "5M sweep/rejection", "XAG/USD directional confirmation"], "XAU/USD channel: Daily/4H context → 1H/15M alignment → 15M POI → 5M sweep, displacement, BOS, deep retracement → structural levels. News is additive-only.", 1);
  return plan ? qualified(input, plan) : wait(input, ["XAU POI, liquidity sweep, 5M confirmation, retracement, or realistic 1:2 target is incomplete"]);
}
function evaluateBtc(input: ChannelInput): V7ChannelResult {
  const reasons = baseChecks(input, [["1W", input.weekly], ["1D", input.daily], ["4H", input.h4], ["1H", input.h1], ["15M", input.m15]]);
  if (input.timeframe !== "15MIN") reasons.push("BTC/USD native signal timeframe is 15MIN; 5MIN may only refine an existing 15MIN setup");
  const wanted = direction(input.m15);
  const weeklyBias = wanted ? direction(input.weekly) === wanted : null;
  const dailyBias = wanted ? direction(input.daily) === wanted : null;
  const h4Location = wanted ? location(input.h4, wanted, 0.5) : null;
  const emptyEvidence: StructuralEvidence = { sweep: false, bos: false, retracement: false, extreme: null, level: null, zoneLow: null, zoneHigh: null };
  const h1Evidence = wanted ? sweepBosRetracement(input.h1, wanted) : emptyEvidence;
  const evidence = wanted ? sweepBosRetracement(input.m15, wanted) : emptyEvidence;
  const premiumDiscount = wanted ? location(input.m15, wanted, 0.25) : null;
  const audit = (rr: V7RuleAudit[]): V7RuleAudit[] => rr;
  const baseAudit = audit([
    { label: "1W bias", status: weeklyBias == null ? "NOT_TESTED" : weeklyBias ? "PASS" : "FAIL" },
    { label: "1D bias", status: dailyBias == null ? "NOT_TESTED" : dailyBias ? "PASS" : "FAIL" },
    { label: "4H location", status: h4Location == null ? "NOT_TESTED" : h4Location ? "PASS" : "FAIL" },
    { label: "1H activation", status: h1Evidence.bos ? "PASS" : "FAIL" },
    { label: "15M BOS", status: evidence.bos ? "PASS" : "FAIL" },
    { label: "15M retracement", status: evidence.bos ? (evidence.retracement ? "PASS" : "FAIL") : "NOT_REACHED" },
    { label: "Premium/discount", status: premiumDiscount == null ? "NOT_TESTED" : premiumDiscount ? "PASS" : "FAIL" },
  ]);
  if (reasons.length) return wait(input, reasons, [], baseAudit.concat({ label: "Minimum RR 1:2", status: "NOT_TESTED" }, { label: "Final decision", status: "NOT_REACHED" }));
  if (!wanted || !htfAligned(input, wanted, true)) return wait(input, ["BTC 1W/1D/4H/1H context is not aligned"], [], baseAudit.concat({ label: "Minimum RR 1:2", status: "NOT_TESTED" }, { label: "Final decision", status: "NOT_REACHED" }));
  if (!h1Evidence.bos) return wait(input, ["BTC 1H activation level has not broken"], [], baseAudit.concat({ label: "Minimum RR 1:2", status: "NOT_TESTED" }, { label: "Final decision", status: "NOT_REACHED" }));
  if (!premiumDiscount) return wait(input, [wanted === "BUY" ? "BTC price is not in the preferred 0–25% discount zone" : "BTC price is not in the preferred 75–100% premium zone"], [], baseAudit.concat({ label: "Minimum RR 1:2", status: "NOT_TESTED" }, { label: "Final decision", status: "NOT_REACHED" }));
  const plan = planFromEvidence(wanted, input.m15, input.m15, evidence, 0.15, ["BTC 1H activation", "15M native structural break", "preferred premium/discount location", "5M refinement is optional"], "BTC/USD channel: 1W/1D/4H context → 1H activation → meaningful location → 15M BOS/CHoCH → pullback/retest → structural target. BTC is news-data-free.");
  if (!plan) return wait(input, ["BTC 15M sweep, BOS, retracement, structural target, or realistic 1:2 target is incomplete"], [], baseAudit.concat({ label: "Minimum RR 1:2", status: "FAIL" }, { label: "Final decision", status: "WAIT" }));
  return { ...qualified(input, plan), ruleAudit: baseAudit.concat({ label: "Minimum RR 1:2", status: plan ? "PASS" : "FAIL" }, { label: "Final decision", status: "PASS" }) };
}
function evaluateEur(input: ChannelInput): V7ChannelResult {
  const reasons = baseChecks(input, [["1W", input.weekly], ["1D", input.daily], ["4H", input.h4], ["1H", input.h1], ["15M", input.m15]]);
  if (input.timeframe !== "15MIN") reasons.push("EUR/USD native signal timeframe is 15MIN");
  if (reasons.length) return wait(input, reasons);
  const wanted = direction(input.m15);
  if (!wanted || !htfAligned(input, wanted, true)) return wait(input, ["EUR 1W/1D/4H/1H context is not aligned"]);
  if (!location(input.m15, wanted, 0.5)) return wait(input, [wanted === "BUY" ? "EUR price is not below premium/discount midpoint" : "EUR price is not above premium/discount midpoint"]);
  const evidence = sweepBosRetracement(input.m15, wanted);
  const plan = planFromEvidence(wanted, input.m15, input.m15, evidence, 0.15, ["EUR premium/discount location", "15M liquidity sweep", "15M CHoCH/BOS", "confirmation entry after retracement"], "EUR/USD channel: 1W/1D/4H/1H bias → meaningful location → liquidity sweep → 15M CHoCH/BOS → retracement → structural target. News is additive-only.");
  return plan ? qualified(input, plan) : wait(input, ["EUR liquidity sweep, 15M CHoCH/BOS, retracement, structural target, or realistic 1:2 target is incomplete"]);
}
function evaluateGbp(input: ChannelInput): V7ChannelResult {
  const reasons = baseChecks(input, [["Daily", input.daily], ["4H", input.h4], ["1H", input.h1], ["15M", input.m15], ["5M", input.m5]]);
  if (input.timeframe !== "5MIN") reasons.push("GBP/USD native execution timeframe is 5MIN");
  if (reasons.length) return wait(input, reasons);
  const wanted = direction(input.m5);
  if (!wanted || !htfAligned(input, wanted, false) || direction(input.m15) !== wanted) return wait(input, ["GBP Daily/4H/1H/15M/5M narrative is not aligned"]);
  if (!location(input.m15, wanted, 0.6)) return wait(input, ["GBP price has not reached a meaningful higher-timeframe POI"]);
  const evidence = sweepBosRetracement(input.m5, wanted);
  const plan = planFromEvidence(wanted, input.m5, input.m5, evidence, 0.15, ["GBP higher-timeframe POI", "5M liquidity sweep", "5M body-close market shift/BOS", "new 5M imbalance/order-block zone", "deep corrective retracement"], "GBP/USD channel: Daily/4H/1H narrative → POI → liquidity sweep → 5M BOS → new imbalance/order-block zone → deep retracement → structural target. News is additive-only.");
  return plan ? qualified(input, plan) : wait(input, ["GBP 5M sweep, new imbalance/order-block zone, deep retracement, structural target, or realistic 1:2 target is incomplete"]);
}

export function evaluateV7AssetChannel(input: ChannelInput): V7ChannelResult {
  if (input.asset === "XAU/USD") return evaluateXau(input);
  if (input.asset === "BTC/USD") return evaluateBtc(input);
  if (input.asset === "EUR/USD") return evaluateEur(input);
  return evaluateGbp(input);
}

export type V7NewsEventCandidate = { asset: Exclude<V7Asset, "BTC/USD">; eventId: string; eventTitle: string; eventTime: string; direction: "BUY" | "SELL"; entry: number; stopLoss: number; takeProfit: number; riskReward: number; confidence: number; confluenceScore: number; evidence: string[]; rationale: string };

export function evaluateV7NewsEvent(input: { asset: Exclude<V7Asset, "BTC/USD">; event: { title: string; date: string; actual?: string; forecast?: string; impact: string }; m5?: MarketSeries | null; freshness: V7Freshness; now?: Date }): V7NewsEventCandidate | null {
  const now = (input.now ?? new Date()).getTime(), eventAt = Date.parse(input.event.date);
  if (!Number.isFinite(eventAt) || !input.event.actual || input.event.impact.toUpperCase() !== "HIGH" || Math.abs(now - eventAt) > 60 * 60_000 || !input.freshness.ok) return null;
  const last = latest(input.m5), volatility = atr(candles(input.m5));
  if (!last || !volatility) return null;
  const directionWanted = last.close > last.open ? "BUY" : "SELL";
  const evidence = sweepBosRetracement(input.m5, directionWanted);
  const plan = planFromEvidence(directionWanted, input.m5, input.m5, evidence, 0.15, ["released high-impact event", "initial reaction", "liquidity sweep", "strong displacement", "5M BOS/CHoCH", "retracement into POI"], "NEWS_EVENT_SIGNAL uses the event as a catalyst and requires price-action confirmation; headline alone did not determine direction.", 1);
  if (!plan) return null;
  return { asset: input.asset, eventId: `${input.asset}:${input.event.title}:${input.event.date}`, eventTitle: input.event.title, eventTime: input.event.date, direction: plan.direction, entry: plan.entry, stopLoss: plan.stopLoss, takeProfit: plan.takeProfit, riskReward: Number((Math.abs(plan.takeProfit - plan.entry) / Math.abs(plan.entry - plan.stopLoss)).toFixed(2)), confidence: plan.confidence, confluenceScore: plan.confluenceScore, evidence: plan.confirmations, rationale: `NEWS_EVENT_SIGNAL for ${input.event.title}; actual ${input.event.actual}, forecast ${input.event.forecast ?? "—"}; price-action confirmation completed. Headline alone was not used.` };
}

export { candles as v7Candles, direction as v7Direction, atr as v7Atr };

export const v7ChannelContract = {
  XAU: ["daily-or-4h-context", "1h-15m-alignment", "15m-poi", "5m-sweep-displacement-bos-retracement", "xag-confirmation"],
  BTC: ["1w-1d-4h-context", "1h-activation", "15m-native-break-and-retest", "discount-premium-location", "5m-optional"],
  EUR: ["1w-1d-4h-1h-context", "premium-discount-location", "15m-sweep-choch-bos-retracement"],
  GBP: ["daily-4h-1h-context", "higher-timeframe-poi", "5m-sweep-bos-new-zone-deep-retracement"],
} as const;
