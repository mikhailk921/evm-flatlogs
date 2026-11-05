import { adaptiveScan, FetchFn, RpcLog, ScanResult } from "./scan.js";
import { deliverToWebhook, ReplayCursor } from "./delivery.js";
import { eventTopic0 } from "./abi.js";
import { ProviderLimitError } from "./provider.js";

export interface StreamOptions {
  /** JSON-RPC URL. */
  rpcUrl: string;
  /** eth_getLogs address filter. */
  address?: string | string[];
  /** Restrict delivered events to these topic0s (from your ABI). */
  topics?: (string | string[] | null)[];
  /** ABI event signatures to filter for delivery (optional, overrides topics). */
  abiEventSignatures?: string[];
  /** Deliver each completed batch to this webhook. */
  webhookUrl: string;
  /** Poll head every N ms. */
  pollIntervalMs?: number;
  /** Max blocks processed per poll (bounded scan window). */
  maxBlocksPerPoll?: number;
  /** Checkpoint file path (persists cursor across restarts). */
  cursorPath?: string;
  /** Start block if no checkpoint exists. */
  startBlock: number;
  webhookSecret?: string;
  /** Bounded scan request budget per poll. */
  maxRequestsPerPoll?: number;
}

export interface StreamEvents {
  onBatch?: (info: { fromBlock: number; toBlock: number; eventCount: number }) => void;
  onError?: (err: Error) => void;
}

/**
 * Continuous bounded-scan stream: polls the head, bounded-scans from the
 * persisted cursor, filters to the requested events, and delivers each batch to
 * a webhook. On restart it resumes from the checkpoint (REST backfill), which
 * is the WS-durability property made concrete without a live WS connection.
 */
export async function runStream(
  opts: StreamOptions,
  hooks: StreamEvents = {},
  signal?: AbortSignal,
): Promise<void> {
  const pollIntervalMs = opts.pollIntervalMs ?? 5_000;
  const maxBlocksPerPoll = opts.maxBlocksPerPoll ?? 100;
  const cursor = new ReplayCursor(opts.startBlock, opts.cursorPath);

  const topicFilter =
    opts.topics ??
    (opts.abiEventSignatures
      ? opts.abiEventSignatures.map((s) => eventTopic0(s))
      : undefined);
  const fetchLogs: FetchFn = async (from, to) => {
    const params: Record<string, unknown> = {
      fromBlock: "0x" + from.toString(16),
      toBlock: "0x" + to.toString(16),
    };
    if (opts.address !== undefined) params.address = opts.address;
    if (topicFilter !== undefined) params.topics = topicFilter;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(opts.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getLogs", params: [params], id: 1 }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { result?: RpcLog[]; error?: { message?: string } };
      if (json.error) throw new Error(json.error.message ?? "rpc error");
      return { logs: json.result ?? [], status: "complete" };
    } catch (err) {
      // Limit errors bubble to the scanner so it splits the interval.
      if (err instanceof Error && /(maximum|range|limit|too many|5000|10000|exceed)/i.test(err.message)) {
        throw new ProviderLimitError(err.message);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

  while (!signal?.aborted) {
    const latest = await headBlock(opts.rpcUrl);
    if (latest === null) {
      hooks.onError?.(new Error("could not resolve head"));
    } else {
      const toBlock = latest;
      const fromBlock = Math.min(cursor.cursor, Math.max(cursor.cursor, toBlock - maxBlocksPerPoll + 1));
      if (toBlock >= cursor.cursor) {
        const scan: ScanResult = await adaptiveScan(fetchLogs, fromBlock, toBlock, {
          maxRequests: opts.maxRequestsPerPoll ?? 100,
        });
        if (!scan.allCovered) {
          hooks.onError?.(new Error(`incomplete scan [${fromBlock},${toBlock}]: ${scan.incompleteIntervals.length} gaps`));
        }
        // Deliver events that match the topic filter.
        const keep = scan.logs.filter((l) => l.topics[0] && shouldKeep(l, topicFilter));
        cursor.cursor = toBlock + 1;
        cursor.flush();
        if (keep.length > 0 && opts.webhookUrl) {
          const res = await deliverToWebhook(keep, {
            url: opts.webhookUrl,
            secret: opts.webhookSecret,
          });
          if (res.failed > 0) hooks.onError?.(new Error(`webhook delivery failed: ${res.errors.join("; ")}`));
        }
        hooks.onBatch?.({ fromBlock, toBlock, eventCount: keep.length });
      }
    }
    await sleep(pollIntervalMs, signal);
  }
}

function shouldKeep(log: RpcLog, topics?: (string | string[] | null)[]): boolean {
  if (!topics) return true;
  const t0 = log.topics[0].toLowerCase();
  return topics.some((t) => {
    if (Array.isArray(t)) return t.some((x) => x.toLowerCase() === t0);
    if (t === null) return true;
    return t.toLowerCase() === t0;
  });
}

async function headBlock(rpcUrl: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
      signal: controller.signal,
    });
    const json = (await res.json()) as { result?: string };
    return json.result ? Number(BigInt(json.result)) : null;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
}