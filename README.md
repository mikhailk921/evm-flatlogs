# evm-flatlogs

**Predictable `eth_getLogs`. No CU explosion.**

> Source: [github.com/mikhailk921/evm-flatlogs](https://github.com/mikhailk921/evm-flatlogs)
> Bugs & feature requests: [open an issue](https://github.com/mikhailk921/evm-flatlogs/issues)

A bounded, typed EVM event-delivery engine. It splits a block range adaptively
so a request never blows a provider's credit cap, ABI-decodes events for you,
and pushes them to your webhook/stream — at a flat, predictable price per event
instead of per-credit.

> This is the free/OSS core of a planned managed tier. The engine works on your
> own RPC, your own webhook, and your own blocks. No accounts, no gatekeeping,
> no indexed wallet/NFT/portfolio queries. Your app decides what the events mean.

## Why this exists

`eth_getLogs` is the most expensive method on credit-priced RPC providers.

| Workload | Cost model | Typical cost |
|----------|-----------|--------------|
| Wide-range `eth_getLogs` on weighted CU providers | pay per **credit (CU)** | **500–2,000+ CU** per call |
| Same workload, ABI-parsed, delivered to your webhook | **evm-flatlogs, flat per event** | a flat predictable bill |

Some providers (Chainstack, BlockPI) price flat per request; heavy ones
(Alchemy, dRPC, GetBlock, Helius) price per credit/event. A bounded scanner
means one logically-bounded query is split into the smallest number of
complete calls — so a CU-priced provider never bills you an exponential
blow-up on a wide range.

`evm-flatlogs` is the wedge: **flat, typed, and predictable** where incumbents
price per-CU and per-credit, and don't parse the events for you on EVM.

## Install

```bash
npm install evm-flatlogs
```

> **ESM only.** This package ships ES modules and is consumed via `import`
> (or `node --input-type=module` / `"type":"module"`). It is **not**
> loadable with CommonJS `require()`. Use the CLI bins if you are not on ESM.

## Quickstart (CLI)

```bash
npm i -g evm-flatlogs
evm-flatlogs --rpc https://your-rpc.example --address 0xToken \
  --from 18000000 --to 18000100
```

Prints typed `Transfer`/`Approval` events decoded from the ABI (defaults to
ERC-20 Transfer + Approval). Point `--webhook <url>` to push them instead.

## Library API

### One-shot bounded scan

```ts
import { adaptiveScan, jsonRpcFetch, decodeLog } from "evm-flatlogs";

const fetchLogs = jsonRpcFetch(RPC_URL, { address: USDC });
const scan = await adaptiveScan(fetchLogs, 18_000_000, 18_000_100, {
  maxRequests: 100,          // hard request budget
  deadline: Date.now() + 60_000, // hard wall-clock stop
});
// scan.allCovered === true means no block gap was skipped.
// scan.logs are raw RPC logs; ABI-decode the ones you care about:
const transfers = scan.logs
  .map((l) => decodeLog(l, myAbiEvents))
  .filter((e) => e.name === "Transfer");
```

`adaptiveScan` never accepts a truncated or errored response as complete. If a
provider caps a range it splits it until either every sub-range is complete or
a single block still exceeds the cap (reported `incompleteIntervals`, never
silently skipped).

### Continuous stream with restart backfill

```ts
import { runStream } from "evm-flatlogs";

await runStream({
  rpcUrl: RPC_URL,
  address: USDC,
  abiEventSignatures: ["Transfer(address,address,uint256)"],
  webhookUrl: "https://my-app.example/events",
  cursorPath: "./cursor.json",      // persists position across restarts
  startBlock: 18_000_000,
  pollIntervalMs: 5_000,
  maxBlocksPerPoll: 100,
}, {
  onBatch: ({ fromBlock, toBlock, eventCount }) => console.log({ fromBlock, toBlock, eventCount }),
  onError: (e) => console.error(e),
});
```

`runStream` polls the head, bounded-scans from the persisted cursor, filters to
your events, and delivers each batch to your webhook. On restart it resumes
from the checkpoint (REST backfill) — the WS-durability property without a
fragile live WebSocket connection.

## Scope

- Bounded `eth_getLogs` + ABI parse + deliver to the customer's webhook/stream.
- NO indexed wallet/NFT/portfolio/balance queries.
- NO paid reports, benchmarks, or third-party ratings.
- NO accounts, telemetry, or gating. Fully self-hosted OSS.

## Reporting issues & contributing

Found a bug or missing a bounded-scan edge case? Open an issue on
[github.com/mikhailk921/evm-flatlogs](https://github.com/mikhailk921/evm-flatlogs/issues).
Contributions (more ABIs, provider edge cases, tests) are welcome.

## License

MIT