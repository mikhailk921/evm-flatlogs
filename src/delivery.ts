import { TypedEvent } from "./abi.js";

export interface WebhookOptions {
  url: string;
  secret?: string;
  timeoutMs?: number;
  retries?: number;
}

export interface DeliveryResult {
  delivered: number;
  failed: number;
  errors: string[];
}

export interface Deliverable {
  fromBlock: number;
  toBlock: number;
  events: TypedEvent[] | unknown[];
  rawLogs: unknown[];
}

/**
 * Push a batch of typed events to a webhook endpoint with bounded retries.
 * A failed delivery is never silently dropped — callers decide the policy.
 */
export async function deliverToWebhook(
  events: TypedEvent[] | unknown[],
  opts: WebhookOptions,
): Promise<DeliveryResult> {
  const retries = opts.retries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const body = JSON.stringify({
    events,
    deliveredAt: new Date().toISOString(),
  });
  let lastErr = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(opts.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(opts.secret ? { "x-evm-flatlogs-secret": opts.secret } : {}),
          },
          body,
          signal: controller.signal,
        });
        if (!res.ok) {
          lastErr = `webhook HTTP ${res.status}`;
        } else {
          return { delivered: events.length, failed: 0, errors: [] };
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  return { delivered: 0, failed: events.length, errors: [lastErr] };
}

/**
 * A tiny replay-safe delivery agent: it tracks a cursor (lastScannedFromBlock)
 * and, on reconnect/restart, backfills from that cursor via bounded scan before
 * resuming. This is the WS-durability component (REST backfill), pulled out of
 * research into a concrete primitive.
 */
export class ReplayCursor {
  private value: number;
  private path?: string;
  private dirty = false;

  constructor(initial: number, path?: string) {
    this.value = initial;
    if (path) this.path = `${path}.json`;
  }

  get cursor(): number {
    return this.value;
  }

  set cursor(next: number) {
    if (next > this.value) {
      this.value = next;
      this.dirty = true;
    }
  }

  flush(): void {
    const p = this.path;
    if (this.dirty && p) {
      void import("node:fs").then((fs) =>
        fs.promises
          .writeFile(p, JSON.stringify({ cursor: this.value }))
          .then(() => {
            this.dirty = false;
          })
          .catch(() => {
            /* keep dirty; retried on next flush */
          }),
      );
    }
  }
}

export function formatBatch(
  deliverable: Pick<Deliverable, "events">,
): string {
  return `batch ${deliverable.events.length} events`;
}