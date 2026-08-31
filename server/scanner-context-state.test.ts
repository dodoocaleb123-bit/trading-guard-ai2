import { describe, expect, it } from "vitest";
import { buildContextOnlyState, buildPersistedZoneEvidence, parseMarketSeriesCandleAt } from "./scanner";
import type { MarketSeries } from "./integrations";

const makeSeries = (interval: "1h" | "4h", datetime?: string): MarketSeries => ({
  symbol: "EUR/USD",
  interval,
  values: [{ datetime: datetime ?? "2026-08-28 00:00:00", open: "1.1", high: "1.2", low: "1.0", close: "1.15" }],
  close: 1.15,
  trend: "UP",
  fetchedAt: "2026-08-28T00:00:05.000Z",
  marketContext: null,
});

describe("v5 context-only timeframe state", () => {
  it("uses the latest candle timestamp when recording a context refresh", () => {
    expect(parseMarketSeriesCandleAt(makeSeries("1h")).toISOString()).toBe("2026-08-28T00:00:00.000Z");
  });

  it("persists derived zone evidence while keeping the refresh context-only", () => {
    const series = {
      ...makeSeries("4h", "2026-08-28 04:00:00"),
      values: [
        { datetime: "2026-08-27 00:00:00", open: "100", high: "100.4", low: "99.6", close: "100" },
        { datetime: "2026-08-27 04:00:00", open: "100", high: "100.4", low: "99.6", close: "100" },
        { datetime: "2026-08-27 08:00:00", open: "99.5", high: "100", low: "99", close: "99.5" },
        { datetime: "2026-08-27 12:00:00", open: "99.5", high: "102", low: "99.4", close: "101.5" },
        { datetime: "2026-08-27 16:00:00", open: "101", high: "101.3", low: "99.8", close: "100.2" },
        { datetime: "2026-08-27 20:00:00", open: "100.2", high: "100.8", low: "99.7", close: "100" },
        { datetime: "2026-08-28 00:00:00", open: "100", high: "100.6", low: "99.8", close: "100.1" },
        { datetime: "2026-08-28 04:00:00", open: "100.1", high: "100.7", low: "99.9", close: "100.2" },
        { datetime: "2026-08-28 08:00:00", open: "100.2", high: "100.8", low: "99.9", close: "100.3" },
        { datetime: "2026-08-28 12:00:00", open: "100.3", high: "100.9", low: "99.9", close: "100.4" },
      ],
      close: 100.4,
      marketContext: {
        supportResistance: { supportZone: [99, 99.5], resistanceZone: [101.5, 102], support: 99, resistance: 102 },
        marketStructure: "RISING",
        breakoutState: "WITHIN_RANGE",
        nextSupport: 98.5,
        nextResistance: 103,
        volatility: { atr: 1, atrPercent: 1, regime: "STABLE" },
        sampleSize: 10,
      } as any,
    };
    const evidence = buildPersistedZoneEvidence({ asset: "BTC/USD", timeframe: "4H", series });
    expect(evidence.kind).toBe("V5_ZONE_REFRESH");
    expect(evidence.zones.some((zone) => zone.kind === "DEMAND" && zone.timeframe === "4h")).toBe(true);
    expect(evidence.supportZone).toEqual([99, 99.5]);
    expect(evidence.resistanceZone).toEqual([101.5, 102]);
  });

  it("retains validated structural support and resistance as demand and supply zones when displacement is absent", () => {
    const series = {
      ...makeSeries("4h", "2026-08-28 04:00:00"),
      values: Array.from({ length: 10 }, (_, index) => ({
        datetime: `2026-08-27 ${String(index).padStart(2, "0")}:00:00`,
        open: String(100 + (index % 2) * 0.1),
        high: "101",
        low: "99",
        close: String(100 + (index % 2) * 0.1),
      })),
      close: 100,
      marketContext: {
        supportResistance: { supportZone: [99, 99.4], resistanceZone: [100.6, 101], support: 99, resistance: 101 },
        marketStructure: "RANGE_BOUND",
        breakoutState: "WITHIN_RANGE",
        nextSupport: null,
        nextResistance: null,
        volatility: { atr: 2, atrPercent: 2, regime: "STABLE" },
        sampleSize: 10,
      } as any,
    };
    const evidence = buildPersistedZoneEvidence({ asset: "EUR/USD", timeframe: "4H", series });
    expect(evidence.zones).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "DEMAND", lower: 99, upper: 99.4, timeframe: "4h" }),
      expect.objectContaining({ kind: "SUPPLY", lower: 100.6, upper: 101, timeframe: "4h" }),
    ]));
  });

  it("increments refresh count and clears emission-only metrics", () => {
    const state = buildContextOnlyState({
      asset: "XAU/USD",
      timeframe: "4H",
      series: makeSeries("4h"),
      previousSnapshotCount: 8,
    });
    expect(state).toMatchObject({
      status: "WAITING",
      snapshotCount: 9,
      lastDirection: null,
      lastConfidence: null,
      lastConfluence: null,
      lastEmittedAt: null,
    });
    expect(JSON.parse(state.stateJson)).toMatchObject({
      contextOnly: true,
      asset: "XAU/USD",
      timeframe: "4H",
      kind: "V5_ZONE_REFRESH",
      zones: [],
    });
    expect(JSON.parse(state.evidenceJson)).toMatchObject({
      kind: "V5_CONTEXT_REFRESH",
      zoneEvidence: { asset: "XAU/USD", timeframe: "4H", zones: [] },
    });
    expect(JSON.parse(state.stateJson).waitReason).toContain("not eligible for signal emission");
  });
});

