#!/usr/bin/env node
/**
 * Cost-parity calculator: "how much do my eth_getLogs cost on a CU provider
 * vs a flat per-event price?" — the lead-magnet for evm-flatlogs.
 *
 * Pure, deterministic, no network. Units are ESTIMATES anchored to OBSERVED
 * comparables from research (S-019/B-010/E-13/E-029): eth_getLogs wide-range
 * 500-2000+ CU vs eth_blockNumber ~1 CU; Alchemy ~$0.52/1M CU; flat providers
 * ~1 RU/request. Users override inputs.
 */
export interface ParityInput {
  /** Number of bounded-range eth_getLogs calls per month. */
  scansPerMonth: number;
  /** CU consumed by one wide-range call on a weighted provider. */
  cuPerScan: number;
  /** $ per 1M CU on the weighted provider. */
  costPerMCU: number;
  /** USD per 1M events on the flat tier (evm-flatlogs style). */
  flatPricePerMEvents: number;
  /** Estimated average events returned per scan. */
  eventsPerScan: number;
}

export interface ParityResult {
  cuCostMonthly: number;
  cuCostPerScan: number;
  flatCostMonthly: number;
  flatEventsMonthly: number;
  savingsMonthly: number;
  multiplier: number;
}

export function costParity(input: ParityInput): ParityResult {
  const cuCostPerScan = input.scansPerMonth === 0 ? 0 : (input.cuPerScan * input.costPerMCU) / 1_000_000;
  const cuCostMonthly = input.scansPerMonth * cuCostPerScan;
  const flatEventsMonthly = input.scansPerMonth * input.eventsPerScan;
  const flatCostMonthly = input.flatPricePerMEvents === 0 ? 0 : (flatEventsMonthly / 1_000_000) * input.flatPricePerMEvents;
  const savingsMonthly = cuCostMonthly - flatCostMonthly;
  const multiplier = flatCostMonthly > 0 ? cuCostMonthly / flatCostMonthly : (cuCostMonthly > 0 ? Infinity : 0);
  return {
    cuCostPerScan,
    cuCostMonthly,
    flatEventsMonthly,
    flatCostMonthly,
    savingsMonthly,
    multiplier,
  };
}

export function formatResult(r: ParityResult): string {
  const lines = [
    "evm-flatlogs cost-parity (estimates)",
    "----------------------------------",
    `CU cost per scan:        $${r.cuCostPerScan.toFixed(4)}`,
    `Your eth_getLogs/mo:     $${r.cuCostMonthly.toFixed(2)}`,
    `Flat per-event/mo:       $${r.flatCostMonthly.toFixed(2)}`,
    `Events/mo:               ${r.flatEventsMonthly.toLocaleString()}`,
    `Savings/mo (CU vs flat): $${r.savingsMonthly.toFixed(2)}`,
    `Cost multiplier:         ${Number.isFinite(r.multiplier) ? r.multiplier.toFixed(1) + "x more on CU" : "flat $0 → n/a"}`,
  ];
  return lines.join("\n");
}

export const DEFAULTS: ParityInput = {
  scansPerMonth: 1000,
  cuPerScan: 1000,
  costPerMCU: 0.52,
  flatPricePerMEvents: 5,
  eventsPerScan: 500,
};