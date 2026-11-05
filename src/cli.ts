#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { adaptiveScan } from "./scan.js";
import { jsonRpcFetch } from "./provider.js";
import { decodeLog, AbiEvent } from "./abi.js";

interface CliOptions {
  rpcUrl: string;
  address?: string;
  from?: number;
  to?: number;
  webhook?: string;
  abiPath?: string;
}

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  console.error(usage());
  process.exit(1);
}

function usage(): string {
  return [
    "usage: evm-flatlogs --rpc <URL> [options]",
    "",
    "Required:",
    "  --rpc <url>        JSON-RPC endpoint (supports archive ranges)",
    "Options:",
    "  --address <addr>   contract address filter (default: all)",
    "  --from <block>     start block (default: latest - 1000)",
    "  --to <block>       end block (default: latest)",
    "  --abi <path>       path to JSON ABI (default: ERC-20 Transfer/Approval)",
    "  --webhook <url>    POST typed events here instead of stdout",
    "  --ethBlockNumber   resolve head via eth_blockNumber",
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {} as CliOptions;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--rpc":
        opts.rpcUrl = next() ?? fail("--rpc requires a value");
        break;
      case "--address":
        opts.address = next();
        break;
      case "--from":
        opts.from = Number(next());
        break;
      case "--to":
        opts.to = Number(next());
        break;
      case "--webhook":
        opts.webhook = next();
        break;
      case "--abi":
        opts.abiPath = next();
        break;
      default:
        fail(`unknown option: ${a}`);
    }
  }
  if (!opts.rpcUrl) fail("--rpc is required");
  return opts;
}

async function readAbi(path?: string): Promise<AbiEvent[]> {
  if (!path) {
    return [
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
  }
  const raw = JSON.parse(await readFile(path, "utf8"));
  return raw.filter((e: AbiEvent) => e.type === "event");
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const abiEvents = await readAbi(opts.abiPath);

  // Resolve head block if not provided.
  let head = opts.to;
  if (head === undefined) {
    const res = (await (
      await fetch(opts.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
      })
    ).json()) as { result?: string };
    head = Number(BigInt(res.result ?? "0x0"));
  }
  const from = opts.from ?? head - 1000;

  const fetchLogs = jsonRpcFetch(opts.rpcUrl, { address: opts.address });
  const scan = await adaptiveScan(fetchLogs, from, head, {
    maxRequests: 100,
    deadline: Date.now() + 300_000,
  });

  interface OutRow {
    name?: string;
    topic0?: string;
    address?: string;
    blockNumber?: number;
    txHash?: string;
    logIndex?: number;
    args?: unknown;
  }

  const rows: OutRow[] = [];
  for (const l of scan.logs) {
    let decoded;
    try {
      decoded = decodeLog(l, abiEvents);
    } catch {
      continue; // uninteresting event for the loaded ABI
    }
    rows.push({
      name: decoded.name,
      address: decoded.address,
      blockNumber: decoded.blockNumber,
      txHash: decoded.txHash,
      logIndex: decoded.logIndex,
      args: decoded.args.map((a) => ({ [a.name ?? a.type]: a.value })),
    });
  }

  const summary: Record<string, unknown> = {
    from,
    to: head,
    requestCount: scan.requestCount,
    allCovered: scan.allCovered,
    rawLogs: scan.logs.length,
    decodedEvents: rows.length,
  };

  if (opts.webhook) {
    const res = await fetch(opts.webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summary, events: rows }),
    });
    if (!res.ok) {
      throw new Error(`webhook failed: HTTP ${res.status}`);
    }
    console.log(JSON.stringify(summary));
    return;
  }

  console.log("summary: " + JSON.stringify(summary));
  console.log("events (first 20, JSONL):");
  rows.slice(0, 20).forEach((r) => console.log(JSON.stringify(r)));
  if (rows.length > 20) console.log(`... +${rows.length - 20} more`);
}

main().catch((e) => {
  console.error("fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});