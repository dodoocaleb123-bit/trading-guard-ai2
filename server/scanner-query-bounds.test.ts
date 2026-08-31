import { describe, expect, it } from "vitest";
import { SCANNER_DASHBOARD_LIMIT, SCANNER_DELIVERY_LIMIT, SCANNER_SMOKE_LIMIT } from "./db";

describe("scanner query bounds", () => {
  it("keeps dashboard reads bounded below the Render free-instance memory ceiling", () => {
    expect(SCANNER_DASHBOARD_LIMIT).toBeGreaterThan(0);
    expect(SCANNER_DASHBOARD_LIMIT).toBeLessThanOrEqual(24);
    expect(SCANNER_SMOKE_LIMIT).toBeLessThanOrEqual(48);
    expect(SCANNER_DELIVERY_LIMIT).toBeLessThanOrEqual(100);
  });

  it("keeps smoke checks tighter than the full decision-ledger view", () => {
    expect(SCANNER_SMOKE_LIMIT).toBeGreaterThanOrEqual(SCANNER_DASHBOARD_LIMIT);
    expect(SCANNER_SMOKE_LIMIT).toBeLessThan(100);
  });
});
