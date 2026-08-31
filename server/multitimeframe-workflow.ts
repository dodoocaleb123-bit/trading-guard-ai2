import type { IntelligenceDecisionTrace } from "./intelligence";
import type { MarketContext } from "./market-context";
import type { FundamentalContext, ReplacementDecision, ReplacementKnowledgeModel } from "./replacement-intelligence";
import { evaluateReplacementIntelligence } from "./replacement-intelligence";

type Candle = { datetime?: string; open: number; high: number; low: number; close: number; volume?: number };
export type WorkflowSeries = { interval: string; values: Array<Record<string, unknown>>; close: number; marketContext: MarketContext | null };
export type WorkflowZone = { kind: "SUPPLY" | "DEMAND"; lower: number; upper: number; reactions: number; displacement: number; fresh: boolean; weakFor: Array<"BUY" | "SELL">; timeframe: string; source?: "DISPLACEMENT" | "STRUCTURAL"; };

type Confirmation = { kind: "REJECTION" | "ENGULFING" | "CHoCH" | "NONE"; direction: "BUY" | "SELL" | "NEUTRAL"; observation: string; timeframe: string };

export type HierarchicalWorkflow = {
  eligible: boolean;
  status: "QUALIFIED" | "WAITING";
  direction: "BUY" | "SELL" | "NEUTRAL";
  dominant4h: "BUY" | "SELL" | "NEUTRAL";
  trend1h: "BUY" | "SELL" | "NEUTRAL";
  protected4hInvalidated: boolean;
  zones: WorkflowZone[];
  activeZone: WorkflowZone | null;
  targetZone: WorkflowZone | null;
  confirmation: Confirmation;
  targetBoundary: number | null;
  targetDistance: number | null;
  riskDistance: number | null;
  riskReward: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  geometryValid: boolean;
  geometryReason: string;
  explanation: string;
};

function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function parse(values: Array<Record<string, unknown>>): Candle[] {
  return values.flatMap((raw) => {
    const open = number(raw.open); const high = number(raw.high); const low = number(raw.low); const close = number(raw.close);
    if ([open, high, low, close].some((value) => value == null)) return [];
    return [{ datetime: typeof raw.datetime === "string" ? raw.datetime : undefined, open: open!, high: Math.max(open!, high!, low!, close!), low: Math.min(open!, high!, low!, close!), close: close!, volume: number(raw.volume) ?? undefined }];
  });
}
function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function round(value: number, digits = 6) { const factor = 10 ** digits; return Math.round(value * factor) / factor; }
function precision(asset?: string) { return asset === "BTC/USD" ? 2 : asset === "XAU/USD" ? 4 : 5; }
function pipSize(asset: string) { return asset === "BTC/USD" ? 1 : asset === "XAU/USD" ? 0.01 : 0.0001; }
function overlapRatioForWorkflowZones(left: Pick<WorkflowZone, "lower" | "upper">, right: Pick<WorkflowZone, "lower" | "upper">) {
  const overlap = Math.max(0, Math.min(left.upper, right.upper) - Math.max(left.lower, right.lower));
  const smallerWidth = Math.max(Math.min(left.upper - left.lower, right.upper - right.lower), 1e-12);
  return overlap / smallerWidth;
}

function directionFromStructure(context: MarketContext | null | undefined): "BUY" | "SELL" | "NEUTRAL" {
  if (context?.marketStructure === "RISING") return "BUY";
  if (context?.marketStructure === "FALLING") return "SELL";
  return "NEUTRAL";
}
function range(candle: Candle) { return Math.max(candle.high - candle.low, 0); }
function body(candle: Candle) { return Math.abs(candle.close - candle.open); }
function averageRange(candles: Candle[]) { return average(candles.slice(-20).map(range)); }

function buildStructuralRangeZones(series: WorkflowSeries, asset: string, candles: Candle[]): WorkflowZone[] {
  const support = series.marketContext?.supportResistance.supportZone;
  const resistance = series.marketContext?.supportResistance.resistanceZone;
  const candidates: Array<{ kind: WorkflowZone["kind"]; bounds: [number, number] }> = [
    { kind: "DEMAND", bounds: support ?? [0, 0] },
    { kind: "SUPPLY", bounds: resistance ?? [0, 0] },
  ];
  return candidates.flatMap(({ kind, bounds }) => {
    const lower = Math.min(Number(bounds[0]), Number(bounds[1]));
    const upper = Math.max(Number(bounds[0]), Number(bounds[1]));
    if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower) return [];
    const reactions = candles.filter((candle) => candle.low <= upper && candle.high >= lower).length;
    if (reactions < 2) return [];
    return [{ kind, lower: round(lower, precision(asset)), upper: round(upper, precision(asset)), reactions, displacement: 0, fresh: reactions <= 3, weakFor: [], timeframe: series.interval, source: "STRUCTURAL" } satisfies WorkflowZone];
  });
}

export function detectWorkflowZones(series: WorkflowSeries, asset: string): WorkflowZone[] {
  const candles = parse(series.values);
  if (candles.length < 8) return [];
  const avgRange = averageRange(candles);
  if (avgRange <= 0) return [];
  const zones: WorkflowZone[] = [];
  for (let index = 2; index < candles.length - 2; index += 1) {
    const base = candles[index];
    const next = candles[index + 1];
    const baseRange = range(base);
    if (baseRange > avgRange * 1.15 || range(next) < avgRange * 1.15) continue;
    const bullishDisplacement = next.close > base.high && next.close - base.high >= avgRange;
    const bearishDisplacement = next.close < base.low && base.low - next.close >= avgRange;
    if (!bullishDisplacement && !bearishDisplacement) continue;
    const lower = Math.min(base.open, base.close, base.low);
    const upper = Math.max(base.open, base.close, base.high);
    const kind = bullishDisplacement ? "DEMAND" : "SUPPLY";
    const reactions = candles.slice(index + 2).filter((candle) => candle.low <= upper && candle.high >= lower).length;
    const displacement = bullishDisplacement ? next.close - upper : lower - next.close;
    if (reactions < 2) continue;
    const weakFor = kind === "DEMAND" && candles.slice(index + 2).some((candle) => candle.close < lower)
      ? ["BUY" as const]
      : kind === "SUPPLY" && candles.slice(index + 2).some((candle) => candle.close > upper)
        ? ["SELL" as const]
        : [];
    const zone: WorkflowZone = { kind, lower: round(lower, precision(asset)), upper: round(upper, precision(asset)), reactions, displacement: round(displacement, precision(asset)), fresh: reactions <= 3, weakFor, timeframe: series.interval, source: "DISPLACEMENT" };
    if (!zones.some((existing) => existing.kind === zone.kind && Math.abs(existing.lower - zone.lower) <= avgRange * 0.2 && Math.abs(existing.upper - zone.upper) <= avgRange * 0.2)) zones.push(zone);
  }
  const structuralZones = buildStructuralRangeZones(series, asset, candles);
  const combined = [...zones, ...structuralZones].filter((zone, index, all) => all.findIndex((candidate) => candidate.kind === zone.kind && Math.abs(candidate.lower - zone.lower) <= avgRange * 0.2 && Math.abs(candidate.upper - zone.upper) <= avgRange * 0.2) === index);
  return combined.slice(-12);
}

function protected4hIsInvalidated(series: WorkflowSeries | undefined, inferred: "BUY" | "SELL" | "NEUTRAL") {
  if (!series || inferred === "NEUTRAL") return false;
  const candles = parse(series.values);
  const swingHighs: number[] = [];
  const swingLows: number[] = [];
  for (let index = 2; index < candles.length - 2; index += 1) {
    const current = candles[index];
    if (current.high > candles[index - 1].high && current.high > candles[index - 2].high && current.high >= candles[index + 1].high && current.high >= candles[index + 2].high) swingHighs.push(current.high);
    if (current.low < candles[index - 1].low && current.low < candles[index - 2].low && current.low <= candles[index + 1].low && current.low <= candles[index + 2].low) swingLows.push(current.low);
  }
  const latestClose = candles.at(-1)?.close;
  if (latestClose == null) return false;
  const protectedLow = swingLows.at(-1);
  const protectedHigh = swingHighs.at(-1);
  return inferred === "BUY" ? protectedLow != null && latestClose < protectedLow : protectedHigh != null && latestClose > protectedHigh;
}

function detectConfirmation(series: WorkflowSeries, direction: "BUY" | "SELL", timeframe: string): Confirmation {
  const candles = parse(series.values);
  if (candles.length < 4) return { kind: "NONE", direction: "NEUTRAL", observation: "Not enough confirmation candles.", timeframe };
  const current = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const currentBody = body(current);
  const currentRange = range(current);
  const upperWick = current.high - Math.max(current.open, current.close);
  const lowerWick = Math.min(current.open, current.close) - current.low;
  const recentBodies = candles.slice(-4, -1).map(body);
  const averageBody = average(recentBodies);
  const rejection = direction === "BUY"
    ? lowerWick > averageBody && currentBody <= currentRange * 0.25 && current.close >= current.open
    : upperWick > averageBody && currentBody <= currentRange * 0.25 && current.close <= current.open;
  if (rejection) return { kind: "REJECTION", direction, observation: `${direction} rejection candle has a wick longer than the recent average body and a body no larger than 25% of its range.`, timeframe };
  const engulfing = direction === "BUY"
    ? current.close > current.open && previous.close < previous.open && current.open <= previous.close && current.close >= previous.open
    : current.close < current.open && previous.close > previous.open && current.open >= previous.close && current.close <= previous.open;
  if (engulfing) return { kind: "ENGULFING", direction, observation: `${direction} candle body completely engulfs the previous candle body.`, timeframe };
  const prior = candles.slice(-6, -2);
  const priorHigh = Math.max(...prior.map((candle) => candle.high));
  const priorLow = Math.min(...prior.map((candle) => candle.low));
  const choch = direction === "BUY" ? current.close > priorHigh : current.close < priorLow;
  if (choch) return { kind: "CHoCH", direction, observation: `${direction} confirmation candle body closed beyond the recent protected swing candidate.`, timeframe };
  return { kind: "NONE", direction: "NEUTRAL", observation: `No qualifying ${direction} rejection, engulfing, or CHoCH confirmation on the selected entry timeframe.`, timeframe };
}

function enrichContext(context: MarketContext | null, series: WorkflowSeries[], current: WorkflowSeries) {
  if (!context) return null;
  const directions = series.map((item) => directionFromStructure(item.marketContext));
  const currentDirection = directionFromStructure(current.marketContext);
  const nonNeutral = directions.filter((direction) => direction !== "NEUTRAL");
  const aligned = nonNeutral.length > 1 && nonNeutral.every((direction) => direction === nonNeutral[0]);
  return { ...context, multiTimeframeAlignment: { companionInterval: series.filter((item) => item !== current).map((item) => item.interval).join(",") || "NONE", structure: aligned ? "ALIGNED" as const : nonNeutral.length ? "MIXED" as const : "UNAVAILABLE" as const, momentum: currentDirection === directionFromStructure(series[0]?.marketContext) ? "ALIGNED" as const : "MIXED" as const, breakout: "MIXED" as const } };
}

export type V5GeometryCheck = { valid: boolean; reason: string; riskDistance: number; targetDistance: number; riskReward: number | null };

export function validateV5Geometry(asset: string, entry: number, direction: "BUY" | "SELL", levels: { stopLoss: number; takeProfit: number | null; riskDistance: number; targetDistance: number | null; riskReward: number | null }, atr: number): V5GeometryCheck {
  const minimumRiskDistance = Math.max(pipSize(asset) * 10, atr * 0.25);
  const maximumTargetDistance = Math.max(pipSize(asset) * 300, atr * 30);
  const maximumRiskReward = 20;
  const riskDistance = Math.abs(entry - levels.stopLoss);
  const targetDistance = levels.takeProfit == null ? 0 : Math.abs(entry - levels.takeProfit);
  const directionValid = direction === "BUY" ? levels.stopLoss < entry && (levels.takeProfit == null || levels.takeProfit > entry) : levels.stopLoss > entry && (levels.takeProfit == null || levels.takeProfit < entry);
  const valid = directionValid && Number.isFinite(riskDistance) && riskDistance >= minimumRiskDistance && Number.isFinite(targetDistance) && targetDistance > 0 && targetDistance <= maximumTargetDistance && levels.riskReward != null && Number.isFinite(levels.riskReward) && levels.riskReward > 0 && levels.riskReward <= maximumRiskReward;
  const reason = valid
    ? "Structural geometry is directionally valid and within the configured volatility bounds."
    : !directionValid
      ? "Structural geometry is on the wrong side of the entry for the selected direction."
      : riskDistance < minimumRiskDistance
        ? `Stop distance ${Number(riskDistance.toFixed(4))} is too tight; minimum is ${Number(minimumRiskDistance.toFixed(4))} for current volatility.`
        : targetDistance <= 0 || !Number.isFinite(targetDistance)
          ? "Take-profit distance is missing or non-positive."
          : targetDistance > maximumTargetDistance
            ? `Target distance ${Number(targetDistance.toFixed(4))} is too far; maximum is ${Number(maximumTargetDistance.toFixed(4))} for current volatility.`
            : levels.riskReward != null && levels.riskReward > maximumRiskReward
              ? `Risk-to-reward ${levels.riskReward} is too extreme; maximum is 1:${maximumRiskReward}.`
              : "Risk-to-reward geometry is not finite or positive.";
  return { valid, reason, riskDistance, targetDistance, riskReward: levels.riskReward };
}

function buildLevels(asset: string, entry: number, direction: "BUY" | "SELL", activeZone: WorkflowZone, targetZone: WorkflowZone | null, confirmation: Confirmation, atr: number) {
  const p = precision(asset);
  const buffer = Math.max(atr * 0.15, entry * 0.0001);
  const confirmationCandles = targetZone ? [] : [];
  void confirmationCandles;
  const structuralStop = direction === "BUY" ? activeZone.lower - buffer : activeZone.upper + buffer;
  const confirmationStop = direction === "BUY" ? entry - Math.max(atr * 0.25, buffer) : entry + Math.max(atr * 0.25, buffer);
  const stopLoss = direction === "BUY" ? Math.min(structuralStop, confirmationStop) : Math.max(structuralStop, confirmationStop);
  const target = targetZone ? (direction === "BUY" ? targetZone.lower - buffer : targetZone.upper + buffer) : null;
  if (target == null) return { stopLoss: Number(stopLoss.toFixed(p)), takeProfit: null, targetDistance: null, riskDistance: Number(Math.abs(entry - stopLoss).toFixed(p)), riskReward: null, targetBoundary: null };
  const targetDistance = Math.abs(target - entry);
  const riskDistance = Math.abs(entry - stopLoss);
  return { stopLoss: Number(stopLoss.toFixed(p)), takeProfit: Number(target.toFixed(p)), targetDistance: Number(targetDistance.toFixed(p)), riskDistance: Number(riskDistance.toFixed(p)), riskReward: riskDistance > 0 ? Number((targetDistance / riskDistance).toFixed(2)) : null, targetBoundary: Number(target.toFixed(p)) };
}

export function evaluateHierarchicalWorkflow(input: { asset: string; timeframe: string; primary: WorkflowSeries; series4h?: WorkflowSeries; series1h?: WorkflowSeries;   series15m?: WorkflowSeries;
  series5m?: WorkflowSeries; priorZones?: WorkflowZone[];
  fundamentalContext?: FundamentalContext; acceptedLessons?: Array<{ id: number; outcome: "WIN" | "LOSS" | "INVALIDATED"; lessonJson: string }> }, model: ReplacementKnowledgeModel): ReplacementDecision & { workflow: HierarchicalWorkflow } {
  const hierarchy = [input.series4h, input.series1h, input.series15m, input.timeframe.toUpperCase() === "5MIN" ? input.series5m : undefined].filter((series): series is WorkflowSeries => Boolean(series));
  const enrichedContext = enrichContext(input.primary.marketContext, hierarchy, input.primary);
  if (!enrichedContext) throw new Error(`No market context available for ${input.asset} ${input.timeframe}.`);
  const baseline = evaluateReplacementIntelligence({ asset: input.asset, close: input.primary.close, interval: input.primary.interval, values: input.primary.values, marketContext: enrichedContext, fundamentalContext: input.fundamentalContext, acceptedLessons: input.acceptedLessons }, model);
  const inferred4h = directionFromStructure(input.series4h?.marketContext);
  const protected4hInvalidated = protected4hIsInvalidated(input.series4h, inferred4h);
  const dominant4h = protected4hInvalidated ? "NEUTRAL" as const : inferred4h;
  const trend1h = directionFromStructure(input.series1h?.marketContext);
  const workingDirection = dominant4h !== "NEUTRAL" ? dominant4h : trend1h !== "NEUTRAL" ? trend1h : baseline.direction;
  const detectedZones = hierarchy.flatMap((series) => detectWorkflowZones(series, input.asset));
  const historicalZones = (input.priorZones ?? []).filter((historical) => !detectedZones.some((current) => current.kind === historical.kind && current.timeframe === historical.timeframe && overlapRatioForWorkflowZones(current, historical) >= 0.5));
  const zones = [...detectedZones, ...historicalZones].slice(-48);
  const currentPrice = input.primary.close;
  const activeZone = zones.filter((zone) => !zone.weakFor.includes(workingDirection) && currentPrice >= zone.lower && currentPrice <= zone.upper).sort((left, right) => (left.timeframe === input.timeframe ? -1 : 1) - (right.timeframe === input.timeframe ? -1 : 1))[0] ?? null;
  const normalizedTimeframe = input.timeframe.toUpperCase();
  const confirmationSeries = normalizedTimeframe === "1H" ? input.series15m ?? input.primary : input.series5m ?? input.series15m ?? input.primary;
  const confirmation = detectConfirmation(confirmationSeries, workingDirection, confirmationSeries.interval);
  const targetZones = zones.filter((zone) => zone.source !== "STRUCTURAL" && zone.kind === (workingDirection === "BUY" ? "SUPPLY" : "DEMAND") && !zone.weakFor.includes(workingDirection) && (workingDirection === "BUY" ? zone.lower > currentPrice : zone.upper < currentPrice)).sort((left, right) => Math.abs((workingDirection === "BUY" ? left.lower : left.upper) - currentPrice) - Math.abs((workingDirection === "BUY" ? right.lower : right.upper) - currentPrice));
  const targetZone = targetZones[0] ?? null;
  const minimumTargetDistance = pipSize(input.asset) * 30;
  const targetFarEnough = targetZone != null && Math.abs((workingDirection === "BUY" ? targetZone.lower : targetZone.upper) - currentPrice) >= minimumTargetDistance;
  const levels = activeZone && targetFarEnough ? buildLevels(input.asset, currentPrice, workingDirection, activeZone, targetZone, confirmation, enrichedContext.volatility.atr) : null;
  const geometry = levels ? validateV5Geometry(input.asset, currentPrice, workingDirection, levels, enrichedContext.volatility.atr) : null;
  const confirmationReady = confirmation.direction === workingDirection && confirmation.kind !== "NONE";
  const eligible = Boolean(!protected4hInvalidated && activeZone && targetZone && targetFarEnough && levels?.takeProfit != null && geometry?.valid && confirmationReady && (workingDirection === dominant4h || dominant4h === "NEUTRAL"));
  const status: HierarchicalWorkflow["status"] = eligible ? "QUALIFIED" : "WAITING";
  const explanation = eligible
    ? `${workingDirection} setup qualified through 4H ${dominant4h}, 1H ${trend1h}, ${zones.length} validated grouped-base zones, ${confirmation.kind} confirmation on ${confirmation.timeframe}, and the next opposing ${targetZone?.kind.toLowerCase()} zone. Structural target remains primary; actual ratio is ${levels?.riskReward == null ? "unavailable" : `1:${levels.riskReward}`}.`
    : `Waiting: ${protected4hInvalidated ? "protected 4H swing invalidated; " : ""}${!activeZone ? "no valid active supply/demand zone at current price; " : ""}${!targetZone || !targetFarEnough ? "no suitable opposing zone at least 30 pips away; " : ""}${geometry && !geometry.valid ? `${geometry.reason} ` : ""}${!confirmationReady ? "no qualifying rejection, engulfing, or CHoCH confirmation; " : ""}${dominant4h !== "NEUTRAL" && workingDirection !== dominant4h ? "lower timeframe conflicts with 4H bias; " : ""}`.replace(/; $/, ".");
  const levelDerivation = { entry: "Close of the selected 15M/5M confirmation candle or latest primary close.", stopLoss: levels ? `Farther structural invalidation beyond the active ${activeZone?.kind.toLowerCase()} zone with buffer; stop=${levels.stopLoss}.` : "No structural stop until a valid active zone is found.", takeProfit: levels ? `Near edge of next opposing ${targetZone?.kind.toLowerCase()} zone with clearance; target=${levels.takeProfit}.` : "No opposing structural target available.", riskDistance: levels?.riskDistance ?? 0, riskReward: levels?.riskReward ?? 0, selectedRiskReward: levels?.riskReward ?? null, geometryMode: input.timeframe === "1H" ? "BREAKOUT_NEXT_ZONE" as const : "RANGE_OPPOSING_ZONE" as const };
  const workflow: HierarchicalWorkflow = { eligible, status, direction: workingDirection, dominant4h, trend1h, protected4hInvalidated, zones, activeZone, targetZone, confirmation, targetBoundary: levels?.targetBoundary ?? null, targetDistance: levels?.targetDistance ?? null, riskDistance: levels?.riskDistance ?? null, riskReward: levels?.riskReward ?? null, stopLoss: levels?.stopLoss ?? null, takeProfit: levels?.takeProfit ?? null, geometryValid: geometry?.valid ?? false, geometryReason: geometry?.reason ?? "No complete structural geometry available.", explanation };
  const decisionTrace: IntelligenceDecisionTrace = { ...baseline.decisionTrace, scoreSummary: { ...baseline.decisionTrace.scoreSummary, dominantDirection: workingDirection }, levelDerivation };
  return { ...baseline, direction: workingDirection, entry: currentPrice, stopLoss: levels?.stopLoss ?? baseline.stopLoss, takeProfit: levels?.takeProfit ?? baseline.takeProfit, riskReward: levels?.riskReward ?? 0, marketRegime: `${dominant4h}/${trend1h}/${input.timeframe}/${status}`, adjustments: `${explanation} Existing confidence/confluence safeguards remain active.`, decisionTrace, workflow, setupIndicators: [...baseline.setupIndicators, { id: "hierarchical-zones", family: "LEVELS", direction: workingDirection, strength: eligible ? "STRONG" : "CONTEXT", observation: `${zones.length} grouped-base supply/demand zones evaluated across 4H, 1H, 15M, and the selected execution timeframe.`, contribution: eligible ? 3 : 0, source: { document: "Forex trading.docx", section: "Supply and demand workflow", passage: "Use larger timeframes for context and lower timeframes for execution around real zones." } }] };
}
