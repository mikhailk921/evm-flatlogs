import { BlockRange, splitInterval, validateBlockRange } from "./ranges.js";

export const MAX_REQUEST_BUDGET = 100;

export interface ProviderResult {
  logs: RpcLog[];
  truncated?: boolean;
  status?: string;
}

export interface RpcLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  transactionIndex: string;
  logIndex: string;
  blockHash?: string;
  removed?: boolean;
}

export type FetchFn = (
  fromBlock: number,
  toBlock: number,
  requestIndex: number,
) => Promise<ProviderResult>;

export type IntervalStatus =
  | "complete"
  | "truncated_unsplit"
  | "error"
  | "budget_exhausted"
  | "wallclock";

export interface IntervalResult {
  fromBlock: number;
  toBlock: number;
  complete: boolean;
  status: IntervalStatus;
  error?: string;
  logs?: RpcLog[];
  requestIndex?: number;
}

export interface ScanResult {
  requestCount: number;
  coveredIntervals: IntervalResult[];
  incompleteIntervals: IntervalResult[];
  logs: RpcLog[];
  errors: string[];
  reachedRequestBudget: boolean;
  allCovered: boolean;
}

export function newScanResult(): ScanResult {
  return {
    requestCount: 0,
    coveredIntervals: [],
    incompleteIntervals: [],
    logs: [],
    errors: [],
    reachedRequestBudget: false,
    allCovered: true,
  };
}

/**
 * Split `[fromBlock, toBlock]` adaptively until coverage is complete or the
 * request budget/wall-clock deadline runs out. A truncated or errored response
 * is never accepted as complete; partial logs are discarded before splitting so
 * coverage accounting stays honest. Ported from POC-02 `adaptive_scan`.
 */
export async function adaptiveScan(
  fetchFn: FetchFn,
  fromBlock: number,
  toBlock: number,
  opts: {
    maxRequests?: number;
    deadline?: number;
  } = {},
): Promise<ScanResult> {
  const maxRequests = opts.maxRequests ?? MAX_REQUEST_BUDGET;
  const scan = newScanResult();
  const pending: BlockRange[] = [{ fromBlock, toBlock }];
  const deadline = opts.deadline;

  while (pending.length > 0) {
    if (scan.requestCount >= maxRequests) {
      for (const r of pending) {
        scan.incompleteIntervals.push({
          ...r,
          complete: false,
          status: "budget_exhausted",
        });
        scan.allCovered = false;
      }
      scan.reachedRequestBudget = true;
      break;
    }
    if (deadline !== undefined && Date.now() >= deadline) {
      for (const r of pending) {
        scan.incompleteIntervals.push({
          ...r,
          complete: false,
          status: "wallclock",
        });
        scan.allCovered = false;
      }
      break;
    }

    const { fromBlock: fb, toBlock: tb } = pending.shift()!;
    const requestIndex = scan.requestCount;
    let result: ProviderResult;
    try {
      result = await fetchFn(fb, tb, requestIndex);
    } catch (err) {
      scan.requestCount += 1;
      const msg = err instanceof Error ? err.message : String(err);
      scan.errors.push(`[${fb},${tb}] error: ${msg}`);
      handleSplitOrSingle(scan, pending, fb, tb, `error: ${msg}`);
      continue;
    }
    scan.requestCount += 1;

    if (result.truncated || result.status === "truncated") {
      if (tb === fb) {
        scan.incompleteIntervals.push({
          fromBlock: fb,
          toBlock: tb,
          complete: false,
          status: "truncated_unsplit",
          error: "single block exceeds provider cap",
        });
        scan.allCovered = false;
      } else {
        for (const part of splitInterval(fb, tb)) {
          pending.push(part);
        }
      }
      continue;
    }

    scan.coveredIntervals.push({
      fromBlock: fb,
      toBlock: tb,
      complete: true,
      status: "complete",
      logs: result.logs,
      requestIndex,
    });
    scan.logs.push(...result.logs);
  }

  return scan;
}

function handleSplitOrSingle(
  scan: ScanResult,
  pending: BlockRange[],
  fb: number,
  tb: number,
  reason: string,
): void {
  if (tb === fb) {
    scan.incompleteIntervals.push({
      fromBlock: fb,
      toBlock: tb,
      complete: false,
      status: "error",
      error: reason,
    });
    scan.allCovered = false;
  } else {
    for (const part of splitInterval(fb, tb)) {
      pending.push(part);
    }
  }
}

export { validateBlockRange };