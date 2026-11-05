import { describe, expect, it } from "vitest";
import {
  AbiEvent,
  decodeLog,
  eventSignature,
  eventTopic0,
} from "../src/abi.js";

const ERC20_ABI: AbiEvent[] = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Approval",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "spender", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
];

const TRANSFER_SIG = "Transfer(address,address,uint256)";

function topic0(sig: string): string {
  return eventTopic0(sig);
}

function addr(value: string): string {
  const clean = value.replace(/^0x/, "").toLowerCase();
  return "0x" + clean.padStart(64, "0");
}

function uint256(value: bigint | number): string {
  const hex = BigInt(value).toString(16).padStart(64, "0");
  return "0x" + hex;
}

describe("eventSignature / eventTopic0", () => {
  it("computes the canonical signature and a 32-byte topic0", () => {
    expect(eventSignature(ERC20_ABI[0])).toBe(TRANSFER_SIG);
    expect(topic0(TRANSFER_SIG)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("decodeLog (ERC-20 Transfer)", () => {
  it("decodes indexed addresses and non-indexed amount", () => {
    const from = "0x1111111111111111111111111111111111111111";
    const to = "0x2222222222222222222222222222222222222222";
    const value = 123456789n;

    const topic0Val = topic0(TRANSFER_SIG);
    const log = decodeLog(
      {
        address: "0xToken",
        topics: [topic0Val, addr(from), addr(to)],
        data: uint256(value),
        blockNumber: "0x10",
        transactionHash: "0xabc",
        logIndex: "0x0",
      },
      ERC20_ABI,
    );

    expect(log.name).toBe("Transfer");
    expect(log.args).toHaveLength(3);
    const [f, t, v] = log.args;
    expect(f.value).toBe(from.toLowerCase());
    expect(t.value).toBe(to.toLowerCase());
    expect(BigInt(String(v.value))).toBe(value);
    expect(log.blockNumber).toBe(16);
  });
});