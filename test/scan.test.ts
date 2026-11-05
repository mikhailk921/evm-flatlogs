import { describe, expect, it } from "vitest";
import { adaptiveScan, FetchFn, ProviderResult } from "../src/scan.js";

function makeFetch(fn: (from: number, to: number) => ProviderResult): FetchFn {
  return async (from, to) => fn(from, to);
}

describe("adaptiveScan", () => {
  it("covers full range with a single complete call", async () => {
    let calls = 0;
    const scan = await adaptiveScan(
      makeFetch((from, to) => {
        calls++;
        return {
          logs: [{ address: "0x", topics: ["0x00"], data: "0x", blockNumber: String(from), transactionHash: "0x", transactionIndex: "0x0", logIndex: "0x0" }],
        };
      }),
      0,
      10,
    );
    expect(calls).toBe(1);
    expect(scan.allCovered).toBe(true);
    expect(scan.logs.length).toBe(1);
  });

  it("splits a truncated interval and covers both halves", async () => {
    const seen: string[] = [];
    const scan = await adaptiveScan(
      makeFetch((from, to) => {
        const key = `${from}-${to}`;
        seen.push(key);
        if (from === 0 && to === 9) {
          // Simulate provider cap: single-block logs only above the cap.
          return { logs: [], truncated: true };
        }
        return { logs: [], status: "complete" };
      }),
      0,
      9,
    );
    expect(scan.allCovered).toBe(true);
    expect(seen.length).toBeGreaterThan(2);
  });

  it("stops splitting a single block that still exceeds the cap", async () => {
    const scan = await adaptiveScan(
      makeFetch(() => ({ logs: [], truncated: true })),
      5,
      5,
    );
    expect(scan.allCovered).toBe(false);
    expect(scan.incompleteIntervals[0].status).toBe("truncated_unsplit");
  });

  it("enforces the request budget", async () => {
    const scan = await adaptiveScan(
      makeFetch(() => ({ logs: [], truncated: true })),
      0,
      1000,
      { maxRequests: 4 },
    );
    expect(scan.reachedRequestBudget).toBe(true);
    expect(scan.incompleteIntervals.length).toBeGreaterThan(0);
  });
});