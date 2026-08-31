import { describe, expect, it } from "vitest";
import { reconcileZoneMemory, toWorkflowZone, type PersistedZoneMemory } from "./zone-memory";
import type { WorkflowZone } from "./multitimeframe-workflow";

const zone: WorkflowZone = {
  kind: "DEMAND",
  lower: 1.1,
  upper: 1.105,
  reactions: 2,
  displacement: 0.01,
  fresh: false,
  weakFor: [],
  timeframe: "4H",
};

const prior: PersistedZoneMemory = {
  asset: "EUR/USD",
  timeframe: "4H",
  zoneKey: "DEMAND:4H:1.10000000:1.10500000",
  zoneKind: "DEMAND",
  lower: 1.1,
  upper: 1.105,
  reactions: 1,
  displacement: 0.009,
  fresh: true,
  weakFor: "",
  lifecycle: "ACTIVE",
  observationCount: 1,
  retestCount: 0,
  firstSeenAt: "2026-08-28T00:00:00.000Z",
  lastSeenAt: "2026-08-28T00:00:00.000Z",
  lastCandleAt: "2026-08-28T00:00:00.000Z",
  lastRetestedAt: null,
  evidenceJson: "{}",
};

describe("v5 zone memory", () => {
  it("preserves a zone identity and counts a new retest when the next candle touches it", () => {
    const next = reconcileZoneMemory({ prior: [prior], observed: [zone], asset: "EUR/USD", timeframe: "4H", currentPrice: 1.102, candleAt: "2026-08-28T04:00:00.000Z", observedAt: "2026-08-28T04:05:00.000Z" });
    expect(next).toHaveLength(1);
    expect(next[0].zoneKey).toBe(prior.zoneKey);
    expect(next[0].observationCount).toBe(2);
    expect(next[0].retestCount).toBe(1);
    expect(next[0].lifecycle).toBe("ACTIVE");
  });

  it("normalizes detector interval casing before persisting a newly observed zone", () => {
    const next = reconcileZoneMemory({ prior: [], observed: [{ ...zone, timeframe: "4h" }], asset: "EUR/USD", timeframe: "4H", currentPrice: 1.102, candleAt: "2026-08-28T04:00:00.000Z", observedAt: "2026-08-28T04:05:00.000Z" });
    expect(next).toHaveLength(1);
    expect(next[0].timeframe).toBe("4H");
    expect(next[0].zoneKey).toBe("DEMAND:4H:1.10000000:1.10500000");
  });

  it("keeps an unobserved zone as weakened instead of deleting it", () => {
    const next = reconcileZoneMemory({ prior: [prior], observed: [], asset: "EUR/USD", timeframe: "4H", currentPrice: 1.12, candleAt: "2026-08-28T04:00:00.000Z", observedAt: "2026-08-28T04:05:00.000Z" });
    expect(next[0].lifecycle).toBe("WEAKENED");
    expect(next[0].zoneKey).toBe(prior.zoneKey);
  });

  it("marks a breached zone invalidated and excludes it from workflow zones", () => {
    const next = reconcileZoneMemory({ prior: [prior], observed: [], asset: "EUR/USD", timeframe: "4H", currentPrice: 1.09, candleAt: "2026-08-28T04:00:00.000Z", observedAt: "2026-08-28T04:05:00.000Z" });
    expect(next[0].lifecycle).toBe("INVALIDATED");
    expect(toWorkflowZone(next[0])).toBeNull();
  });
});
