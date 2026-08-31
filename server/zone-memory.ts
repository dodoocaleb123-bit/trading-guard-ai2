import type { WorkflowZone } from "./multitimeframe-workflow";

export type ZoneLifecycle = "ACTIVE" | "WEAKENED" | "INVALIDATED";

export type PersistedZoneMemory = {
  id?: number;
  userId?: number;
  asset: string;
  timeframe: string;
  zoneKey: string;
  zoneKind: WorkflowZone["kind"];
  lower: number;
  upper: number;
  reactions: number;
  displacement: number;
  fresh: boolean;
  weakFor: string;
  lifecycle: ZoneLifecycle;
  observationCount: number;
  retestCount: number;
  firstSeenAt: Date | string;
  lastSeenAt: Date | string;
  lastCandleAt: Date | string | null;
  lastRetestedAt: Date | string | null;
  evidenceJson: string;
};

function numeric(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asTime(value: Date | string | null | undefined) {
  const time = value == null ? NaN : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function buildZoneKey(zone: Pick<WorkflowZone, "kind" | "timeframe" | "lower" | "upper">) {
  return `${zone.kind}:${zone.timeframe}:${zone.lower.toFixed(8)}:${zone.upper.toFixed(8)}`;
}

function overlapRatio(left: Pick<WorkflowZone, "lower" | "upper">, right: Pick<WorkflowZone, "lower" | "upper">) {
  const overlap = Math.max(0, Math.min(left.upper, right.upper) - Math.max(left.lower, right.lower));
  const smallerWidth = Math.max(Math.min(left.upper - left.lower, right.upper - right.lower), 1e-12);
  return overlap / smallerWidth;
}

function isMatchingZone(left: PersistedZoneMemory, right: WorkflowZone) {
  if (left.zoneKind !== right.kind || left.timeframe !== right.timeframe) return false;
  const width = Math.max(left.upper - left.lower, right.upper - right.lower, 1e-12);
  return overlapRatio(left, right) >= 0.5 || (Math.abs(left.lower - right.lower) <= width * 0.5 && Math.abs(left.upper - right.upper) <= width * 0.5);
}

function isBreached(zone: { zoneKind?: WorkflowZone["kind"]; kind?: WorkflowZone["kind"]; lower: number; upper: number }, currentPrice: number) {
  const kind = zone.zoneKind ?? zone.kind;
  return kind === "DEMAND" ? currentPrice < zone.lower : currentPrice > zone.upper;
}

function isTouched(zone: Pick<PersistedZoneMemory, "lower" | "upper">, currentPrice: number) {
  return currentPrice >= zone.lower && currentPrice <= zone.upper;
}

export function reconcileZoneMemory(input: {
  prior: PersistedZoneMemory[];
  observed: WorkflowZone[];
  asset: string;
  timeframe: string;
  currentPrice: number;
  candleAt: Date | string;
  observedAt: Date | string;
}) {
  const expectedTimeframe = input.timeframe.toUpperCase();
  const observed = input.observed
    .filter((zone) => zone.timeframe.toUpperCase() === expectedTimeframe)
    .map((zone) => ({ ...zone, timeframe: input.timeframe }));
  const used = new Set<number>();
  const next: PersistedZoneMemory[] = [];

  for (const zone of observed) {
    const priorIndex = input.prior.findIndex((candidate, index) => !used.has(index) && candidate.lifecycle !== "INVALIDATED" && isMatchingZone(candidate, zone));
    const prior = priorIndex >= 0 ? input.prior[priorIndex] : undefined;
    if (priorIndex >= 0) used.add(priorIndex);
    const touched = isTouched(zone, input.currentPrice);
    const lastCandleAt = prior?.lastCandleAt ?? null;
    const isNewCandle = asTime(lastCandleAt) !== asTime(input.candleAt);
    const retestCount = (prior?.retestCount ?? 0) + (touched && isNewCandle ? 1 : 0);
    next.push({
      ...prior,
      asset: input.asset,
      timeframe: input.timeframe,
      zoneKey: prior?.zoneKey ?? buildZoneKey(zone),
      zoneKind: zone.kind,
      lower: zone.lower,
      upper: zone.upper,
      reactions: zone.reactions,
      displacement: zone.displacement,
      fresh: zone.fresh,
      weakFor: zone.weakFor.join(","),
      lifecycle: isBreached(zone, input.currentPrice) ? "INVALIDATED" : "ACTIVE",
      observationCount: (prior?.observationCount ?? 0) + 1,
      retestCount,
      firstSeenAt: prior?.firstSeenAt ?? input.observedAt,
      lastSeenAt: input.observedAt,
      lastCandleAt: input.candleAt,
      lastRetestedAt: touched && isNewCandle ? input.observedAt : prior?.lastRetestedAt ?? null,
      evidenceJson: JSON.stringify({ kind: "V5_ZONE_OBSERVATION", asset: input.asset, timeframe: input.timeframe, zone, currentPrice: input.currentPrice, observedAt: input.observedAt, candleAt: input.candleAt }),
    });
  }

  input.prior.forEach((prior, index) => {
    if (used.has(index)) return;
    const lifecycle = prior.lifecycle === "INVALIDATED" || isBreached(prior, input.currentPrice) ? "INVALIDATED" : "WEAKENED";
    next.push({ ...prior, lifecycle });
  });

  return next.sort((left, right) => asTime(right.lastSeenAt) - asTime(left.lastSeenAt));
}

export function toWorkflowZone(record: Pick<PersistedZoneMemory, "zoneKind" | "lower" | "upper" | "reactions" | "displacement" | "fresh" | "weakFor" | "timeframe" | "lifecycle">): WorkflowZone | null {
  if (record.lifecycle === "INVALIDATED") return null;
  const displacement = numeric(record.displacement);
  return { kind: record.zoneKind, lower: numeric(record.lower), upper: numeric(record.upper), reactions: numeric(record.reactions), displacement, fresh: Boolean(record.fresh), weakFor: record.weakFor ? record.weakFor.split(",").filter((value): value is "BUY" | "SELL" => value === "BUY" || value === "SELL") : [], timeframe: record.timeframe, source: displacement === 0 ? "STRUCTURAL" : "DISPLACEMENT" };
}
