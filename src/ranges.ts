export interface BlockRange {
  fromBlock: number;
  toBlock: number;
}

/**
 * Validate a block range: integers, non-negative, correct order, within hard cap.
 * Mirrors validate_block_range from the POC-02 Python engine.
 */
export function validateBlockRange(
  fromBlock: number,
  toBlock: number,
  maxBlocks: number,
): void {
  if (!Number.isInteger(fromBlock) || !Number.isInteger(toBlock)) {
    throw new Error("from/to block must be integers");
  }
  if (fromBlock < 0 || toBlock < 0) {
    throw new Error("block numbers cannot be negative");
  }
  if (toBlock < fromBlock) {
    throw new Error(`to_block ${toBlock} < from_block ${fromBlock}`);
  }
  const width = toBlock - fromBlock + 1;
  if (width > maxBlocks) {
    throw new Error(`block range ${width} blocks exceeds hard cap ${maxBlocks} per run`);
  }
}

/** Split a block interval into two roughly-equal halves. */
export function splitInterval(fromBlock: number, toBlock: number): BlockRange[] {
  const width = toBlock - fromBlock + 1;
  if (width <= 1) {
    return [{ fromBlock, toBlock }];
  }
  const mid = fromBlock + Math.floor(width / 2);
  const left = { fromBlock, toBlock: mid - 1 };
  const right = { fromBlock: mid, toBlock };
  const out: BlockRange[] = [];
  if (left.toBlock >= left.fromBlock) out.push(left);
  if (right.toBlock >= right.fromBlock) out.push(right);
  return out;
}