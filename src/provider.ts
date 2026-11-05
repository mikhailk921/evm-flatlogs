import { FetchFn, ProviderResult, RpcLog } from "./scan.js";

export class ProviderError extends Error {}
export class ProviderLimitError extends ProviderError {}

export interface RpcLogsParams {
  address?: string | string[];
  topics?: (string | string[] | null)[];
  fromBlock?: string;
  toBlock?: string;
}

export interface EthGetLogsOptions {
  address?: string | string[];
  topics?: (string | string[] | null)[];
  fromBlock?: number;
  toBlock?: number;
  maxRangeBlocks?: number;
  blockTarget?: number;
  retries?: number;
  timeoutMs?: number;
}

function toHex(n: number): string {
  return "0x" + n.toString(16);
}

async function rpcCall(
  url: string,
  method: string,
  params: unknown[],
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new ProviderError(`HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      result?: unknown;
      error?: { message?: string; code?: number };
    };
    if (json.error) {
      const msg = json.error.message ?? "rpc error";
      // Provider-specific code for "query exceeds max block range" / limit.
      if (/(maximum|range|limit|too many|5000|10000)/i.test(msg) || json.error.code === -32005) {
        throw new ProviderLimitError(msg);
      }
      throw new ProviderError(msg);
    }
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeLogs(raw: unknown): RpcLog[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((l) => {
    const r = l as Record<string, unknown>;
    return {
      address: String(r.address ?? ""),
      topics: Array.isArray(r.topics) ? (r.topics as string[]) : [],
      data: String(r.data ?? "0x"),
      blockNumber: String(r.blockNumber ?? ""),
      transactionHash: String(r.transactionHash ?? ""),
      transactionIndex: String(r.transactionIndex ?? ""),
      logIndex: String(r.logIndex ?? ""),
      blockHash: r.blockHash ? String(r.blockHash) : undefined,
      removed: Boolean(r.removed),
    };
  });
}

/**
 * Build a JSON-RPC `eth_getLogs` fetch function bound to a provider URL.
 * FetchFn's coverage-safety (range caps, truncation) is the caller's job to
 * enforce via `validateBlockRange` + adaptive splitting.
 */
export function jsonRpcFetch(
  url: string,
  opts: {
    address?: string | string[];
    topics?: (string | string[] | null)[];
    retries?: number;
    timeoutMs?: number;
  } = {},
): FetchFn {
  const retries = opts.retries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  return async (fromBlock: number, toBlock: number): Promise<ProviderResult> => {
    const params: RpcLogsParams = {
      fromBlock: toHex(fromBlock),
      toBlock: toHex(toBlock),
    };
    if (opts.address !== undefined) params.address = opts.address;
    if (opts.topics !== undefined) params.topics = opts.topics;

    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const raw = await rpcCall(url, "eth_getLogs", [params], timeoutMs);
        return { logs: normalizeLogs(raw), status: "complete" };
      } catch (err) {
        // Limit errors signal a range-cap violation: bubble immediately so the
        // adaptive scanner splits the interval instead of wasting retries on it.
        if (err instanceof ProviderLimitError) throw err;
        // Generic transport/HTTP errors: retry a bounded number of times.
        lastErr = err;
        if (attempt >= retries) throw err;
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      }
    }
    throw lastErr;
  };
}

export { toHex };