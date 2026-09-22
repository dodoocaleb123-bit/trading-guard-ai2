import type { MarketSeries } from "./integrations";
import type { V7Asset, V7ChannelResult, V7Freshness } from "./v7-intelligence";

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
type Plan = { direction: "BUY" | "SELL"; entry: number; stopLoss: number; takeProfit: number; confidence: number; confluenceScore: number; confirmations: string[]; reasons: string[]; regime: string };

function candles(series?: MarketSeries | null): Candle[] {
  return (series?.values ?? []).map((raw: any, index) => ({
    time: Date.parse(String(raw.datetime ?? "")) || index,
    open: Number(raw.open), high: Number(raw.high), low: Number(raw.low), close: Number(raw.close),
  })).filter(c => [c.open, c.high, c.low, c.close].every(Number.isFinite));
}
function atr(cs: Candle[], period = 14) {
  if (cs.length < period + 1) return null;
  const trs = cs.slice(1).map((c, i) => Math.max(c.high - c.low, Math.abs(c.high - cs[i].close), Math.abs(c.low - cs[i].close)));
  const values = trs.slice(-period);
  return values.reduce((a, b) => a + b, 0) / values.length;
}
function direction(series?: MarketSeries | null): "BUY" | "SELL" | null {
  const cs = candles(series);
  if (cs.length < 12) return null;
  const recent = cs.slice(-6), prior = cs.slice(-12, -6);
  const recentHigh = Math.max(...recent.map(c => c.high)), priorHigh = Math.max(...prior.map(c => c.high));
  const recentLow = Math.min(...recent.map(c => c.low)), priorLow = Math.min(...prior.map(c => c.low));
  if (recentHigh > priorHigh && recentLow > priorLow) return "BUY";
  if (recentHigh < priorHigh && recentLow < priorLow) return "SELL";
  return null;
}
function range(series?: MarketSeries | null) {
  const cs = candles(series);
  if (cs.length < 20) return null;
  const window = cs.slice(-40);
  return { low: Math.min(...window.map(c => c.low)), high: Math.max(...window.map(c => c.high)) };
}
function latest(series?: MarketSeries | null) { const cs = candles(series); return cs.at(-1) ?? null; }
function fmt(n: number) { return Number(n.toFixed(8)); }
function bodyMedian(cs: Candle[]) {
  const values = cs.slice(-21, -1).map(c => Math.abs(c.close - c.open)).sort((a, b) => a - b);
  return values.length ? values[Math.floor(values.length / 2)] : null;
}
function sweepAndBos(series: MarketSeries | null | undefined, wanted: "BUY" | "SELL") {
  const cs = candles(series);
  if (cs.length < 20) return { sweep: false, bos: false, retracement: false, extreme: null as number | null };
  const recent = cs.slice(-8), prior = cs.slice(-20, -8);
  const priorLow = Math.min(...prior.map(c => c.low)), priorHigh = Math.max(...prior.map(c => c.high));
  const sweep = wanted === "BUY" ? recent.some(c => c.low < priorLow && c.close > priorLow) : recent.some(c => c.high > priorHigh && c.close < priorHigh);
  const pivot = cs.slice(-6, -1);
  const level = wanted === "BUY" ? Math.max(...pivot.map(c => c.high)) : Math.min(...pivot.map(c => c.low));
  const last = cs.at(-1)!;
  const bos = wanted === "BUY" ? last.close > level && last.close > last.open : last.close < level && last.close < last.open;
  const post = cs.slice(-4);
  const displacementClose = wanted === "BUY" ? Math.max(...post.map(c => c.close)) : Math.min(...post.map(c => c.close));
  const zoneMid = wanted === "BUY" ? (level + displacementClose) / 2 : (level + displacementClose) / 2;
  const retracement = wanted === "BUY" ? last.low <= zoneMid && last.close >= zoneMid : last.high >= zoneMid && last.close <= zoneMid;
  const extreme = wanted === "BUY" ? Math.min(...recent.map(c => c.low)) : Math.max(...recent.map(c => c.high));
  return { sweep, bos, retracement, extreme };
}
function choosePlan(directionWanted: "BUY" | "SELL", series: MarketSeries | null | undefined, bufferMultiplier: number, confirmations: string[], extraConfluence = 0): Plan | null {
  const cs = candles(series), last = latest(series), rangeValue = range(series), volatility = atr(cs);
  if (!last || !rangeValue || !volatility) return null;
  const event = sweepAndBos(series, directionWanted);
  if (!event.sweep || !event.bos || !event.retracement || event.extreme == null) return null;
  const buffer = volatility * bufferMultiplier;
  const entry = last.close;
  const stopLoss = directionWanted === "BUY" ? event.extreme - buffer : event.extreme + buffer;
  const opposing = directionWanted === "BUY" ? rangeValue.high : rangeValue.low;
  const risk = Math.abs(entry - stopLoss), reward = Math.abs(opposing - entry);
  if (!risk || reward / risk < 2) return null;
  return { direction: directionWanted, entry: fmt(entry), stopLoss: fmt(stopLoss), takeProfit: fmt(opposing), confidence: Math.min(94, 68 + extraConfluence * 5), confluenceScore: Math.min(95, 55 + extraConfluence * 8), confirmations: [...confirmations, "liquidity sweep", "body-close BOS/CHoCH", "retracement into confirmation area", `final RR ${fmt(reward / risk)}`], reasons: [], regime: `${directionWanted}_SWEEP_BOS_RETRACE` };
}
function wait(input: ChannelInput, reasons: string[], confirmations: string[] = []): V7ChannelResult {
  return { channel: `V7_${input.asset.slice(0, 3)}` as V7ChannelResult["channel"], asset: input.asset, timeframe: input.timeframe, status: "WAITING", direction: "NEUTRAL", entry: null, stopLoss: null, takeProfit: null, riskReward: null, confidence: 0, confluenceScore: 0, waitReason: reasons.join("; "), sourcePath: "CHANNEL_SIGNAL", ordinaryNewsPolicy: "ADDITIVE_ONLY", freshness: input.freshness, confirmations, zones: [], rationale: `WAIT: ${reasons.join("; ")}` };
}
function qualified(input: ChannelInput, plan: Plan): V7ChannelResult {
  const riskReward = Number((Math.abs(plan.takeProfit - plan.entry) / Math.abs(plan.entry - plan.stopLoss)).toFixed(2));
  return { channel: `V7_${input.asset.slice(0, 3)}` as V7ChannelResult["channel"], asset: input.asset, timeframe: input.timeframe, status: "QUALIFIED", direction: plan.direction, entry: plan.entry, stopLoss: plan.stopLoss, takeProfit: plan.takeProfit, riskReward, confidence: plan.confidence, confluenceScore: plan.confluenceScore, waitReason: null, sourcePath: "CHANNEL_SIGNAL", ordinaryNewsPolicy: "ADDITIVE_ONLY", freshness: input.freshness, confirmations: plan.confirmations, zones: [], rationale: `${input.asset} independent channel: ${plan.confirmations.join(", ")}. News is additive-only and did not alter this channel.` };
}

function htf(input: ChannelInput, wanted: "BUY" | "SELL") {
  return [input.weekly, input.daily, input.h4, input.h1].filter(Boolean).map(direction).filter(Boolean).every(value => value === wanted);
}

export function evaluateV7AssetChannel(input: ChannelInput): V7ChannelResult {
  const reasons = [...input.freshness.reasons];
  if (!input.sessionOpen) reasons.push("outside 08:00–17:00 UTC entry session");
  if (input.asset === "BTC/USD" && input.timeframe !== "15MIN") reasons.push("BTC/USD native signal timeframe is 15MIN");
  if (!input.m5 || !input.m15 || !input.h1 || !input.h4 || !input.daily || !input.weekly) reasons.push("required 1W/1D/4H/1H/15M/5M hierarchy data unavailable");
  if (input.asset === "XAU/USD" && (!input.xagFresh || !input.xagDirection)) reasons.push("XAG/USD confirmation is stale, unavailable, or missing");
  if (reasons.length) return wait(input, reasons);
  const m15Direction = direction(input.m15), m5Direction = direction(input.m5);
  if (!m15Direction || !m5Direction || m15Direction !== m5Direction) return wait(input, ["15M and 5M directional structure is not aligned"]);
  if (!htf(input, m15Direction)) return wait(input, ["1W/1D/4H/1H higher-timeframe structure is not aligned"]);
  if (input.asset === "XAU/USD" && input.xagDirection !== m15Direction) return wait(input, ["XAG/USD direction contradicts XAU/USD"]);
  const cs = candles(input.m5), last = latest(input.m5), volatility = atr(cs), median = bodyMedian(cs);
  if (!last || !volatility || !median) return wait(input, ["insufficient execution candles"]);
  if (input.asset === "XAU/USD" && (Math.abs(last.close - last.open) < 1.5 * median || last.high - last.low < volatility)) return wait(input, ["XAU displacement standard not met"]);
  if (input.asset === "GBP/USD" && input.timeframe !== "5MIN") return wait(input, ["GBP/USD native execution is 5MIN"]);
  const plan = choosePlan(m15Direction, input.asset === "GBP/USD" ? input.m5 : input.m15, input.asset === "XAU/USD" ? 0.35 : 0.15, [
    input.asset === "BTC/USD" ? "1H activation and 15M native setup" : input.asset === "EUR/USD" ? "premium/discount location" : input.asset === "GBP/USD" ? "5M POI and deep retracement" : "15M POI and XAG correlation",
  ], input.asset === "XAU/USD" ? 1 : 0);
  if (!plan) return wait(input, ["required POI, sweep, displacement/BOS, retracement, or realistic 1:2 target is not complete"]);
  return qualified(input, plan);
}

export type V7NewsEventCandidate = { asset: Exclude<V7Asset, "BTC/USD">; eventId: string; eventTitle: string; eventTime: string; direction: "BUY" | "SELL"; entry: number; stopLoss: number; takeProfit: number; riskReward: number; confidence: number; confluenceScore: number; evidence: string[]; rationale: string };

export function evaluateV7NewsEvent(input: { asset: Exclude<V7Asset, "BTC/USD">; event: { title: string; date: string; actual?: string; forecast?: string; impact: string }; m5?: MarketSeries | null; freshness: V7Freshness; now?: Date }): V7NewsEventCandidate | null {
  const now = (input.now ?? new Date()).getTime(), eventAt = Date.parse(input.event.date);
  if (!Number.isFinite(eventAt) || !input.event.actual || input.event.impact.toUpperCase() !== "HIGH" || Math.abs(now - eventAt) > 60 * 60_000 || !input.freshness.ok) return null;
  const cs = candles(input.m5), last = latest(input.m5), volatility = atr(cs);
  if (!last || !volatility) return null;
  const bullish = last.close > last.open, directionWanted = bullish ? "BUY" : "SELL";
  const plan = choosePlan(directionWanted, input.m5, 0.15, ["released high-impact event", "initial reaction", "liquidity sweep", "strong displacement", "5M BOS/CHoCH", "retracement into POI"], 1);
  if (!plan) return null;
  return { asset: input.asset, eventId: `${input.asset}:${input.event.title}:${input.event.date}`, eventTitle: input.event.title, eventTime: input.event.date, direction: plan.direction, entry: plan.entry, stopLoss: plan.stopLoss, takeProfit: plan.takeProfit, riskReward: Number((Math.abs(plan.takeProfit - plan.entry) / Math.abs(plan.entry - plan.stopLoss)).toFixed(2)), confidence: plan.confidence, confluenceScore: plan.confluenceScore, evidence: plan.confirmations, rationale: `NEWS_EVENT_SIGNAL for ${input.event.title}; actual ${input.event.actual}, forecast ${input.event.forecast ?? "—"}; price-action confirmation completed. Headline alone was not used.` };
}

export { candles as v7Candles, direction as v7Direction, atr as v7Atr };
