import { describe, expect, it } from "vitest";
import { splitInterval, validateBlockRange } from "../src/ranges.js";

describe("splitInterval", () => {
  it("splits a range into two roughly-equal halves", () => {
    expect(splitInterval(100, 105)).toEqual([
      { fromBlock: 100, toBlock: 102 },
      { fromBlock: 103, toBlock: 105 },
    ]);
  });

  it("returns single range when width <= 1", () => {
    expect(splitInterval(100, 100)).toEqual([{ fromBlock: 100, toBlock: 100 }]);
  });
});

describe("validateBlockRange", () => {
  it("rejects inverted ranges", () => {
    expect(() => validateBlockRange(5, 3, 1000)).toThrow("to_block");
  });
  it("rejects ranges above hard cap", () => {
    expect(() => validateBlockRange(0, 2000, 1000)).toThrow("hard cap");
  });
});