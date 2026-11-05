#!/usr/bin/env node
import { costParity, DEFAULTS, formatResult } from "./calculator.js";

function parseArgs(argv: string[]): Partial<typeof DEFAULTS> {
  const out: Partial<typeof DEFAULTS> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const num = () => Number(argv[++i]);
    const key = a.replace(/^--/, "") as keyof typeof DEFAULTS;
    if (key in DEFAULTS) out[key] = num();
  }
  return out;
}

console.log(formatResult(costParity({ ...DEFAULTS, ...parseArgs(process.argv.slice(2)) })));