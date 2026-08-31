import { describe, expect, it } from "vitest";
import {
  shouldUseDeterministicZoneFallback,
  formatWhiteAiZoneFallback,
} from "./routers";

describe("White AI persisted zone evidence", () => {
  it("uses the deterministic path for White AI zone questions", () => {
    expect(shouldUseDeterministicZoneFallback("WHITE", true, { found: true })).toBe(true);
    expect(shouldUseDeterministicZoneFallback("CHERRY", true, { found: true })).toBe(false);
    expect(shouldUseDeterministicZoneFallback("WHITE", false, { found: true })).toBe(false);
    expect(shouldUseDeterministicZoneFallback("WHITE", true, null)).toBe(false);
  });

  it("returns recorded levels without inventing approximate counts", () => {
    const answer = formatWhiteAiZoneFallback({
      asset: "BTC/USD",
      timeframe: "1H",
      found: true,
      status: "WAITING",
      snapshotCount: 3,
      historicalZoneCount: 1,
      lastSnapshotAt: "2026-08-31T12:00:00.000Z",
      observedAt: "2026-08-31T12:00:00.000Z",
      breakoutState: "WITHIN_RANGE",
      nextResistance: 80000,
      nextSupport: 77000,
      targetBoundary: 79000,
      supportZone: { lower: 77000, upper: 77500 },
      resistanceZone: { lower: 79500, upper: 80000 },
      zones: [{ kind: "DEMAND", lower: 77000, upper: 77500, timeframe: "1H", reactions: 2, fresh: true }],
      supportingComponents: [],
      indicatorEvidence: [],
      waitReason: "No confirmation",
    });

    expect(answer).toContain("DEMAND 77000–77500");
    expect(answer).toContain("reactions 2");
    expect(answer).not.toContain("~");
    expect(answer).not.toContain("approximate");
  });
});
