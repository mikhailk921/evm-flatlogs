import { describe, expect, it } from "vitest";
import { costParity, formatResult } from "../src/calculator.js";

describe("costParity", () => {
  it("computes flat monthly cost from events", () => {
    const r = costParity({
      scansPerMonth: 1000,
      cuPerScan: 1000,
      costPerMCU: 0.52,
      flatPricePerMEvents: 5,
      eventsPerScan: 500,
    });
    // CU: 1,000,000 CU total at $0.52/1M = $0.52/mo (CU is cheap at 1k/mo volume)
    expect(r.cuCostMonthly).toBeCloseTo(0.52, 2);
    // Flat: 500,000 events/mo at $5/1M = $2.5/mo
    expect(r.flatEventsMonthly).toBe(500_000);
    expect(r.flatCostMonthly).toBeCloseTo(2.5, 2);
    // At this low volume flat looks worse; the calculator should reflect that honestly.
    expect(r.savingsMonthly).toBeCloseTo(-1.98, 2);
    expect(r.multiplier).toBeCloseTo(0.21, 1);
  });

  it("handles zero flat price without division blow-up", () => {
    const r = costParity({
      scansPerMonth: 100,
      cuPerScan: 500,
      costPerMCU: 0.52,
      flatPricePerMEvents: 0,
      eventsPerScan: 100,
    });
    expect(r.flatCostMonthly).toBe(0);
  });
});

describe("formatResult", () => {
  it("renders deterministic text", () => {
    const text = formatResult(
      costParity({
        scansPerMonth: 1000,
        cuPerScan: 1000,
        costPerMCU: 0.52,
        flatPricePerMEvents: 5,
        eventsPerScan: 500,
      }),
    );
    expect(text).toContain("$0.52");
    expect(text).toContain("$2.50");
  });
});