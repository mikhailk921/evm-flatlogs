import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";

export class AbiDecodeError extends Error {}

export interface AbiEventInput {
  name?: string;
  type: string;
  indexed?: boolean;
  components?: AbiEventInput[];
}

export interface AbiEvent {
  type: "event";
  name: string;
  anonymous?: boolean;
  inputs?: AbiEventInput[];
}

export interface DecodedValue {
  name?: string;
  type: string;
  value: unknown;
}

export interface TypedEvent {
  name: string;
  topic0: string;
  signature: string;
  address: string;
  args: DecodedValue[];
  blockNumber?: number;
  blockHash?: string;
  txHash?: string;
  logIndex?: number;
  removed?: boolean;
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^0x[0-9a-fA-F]*$/.test(hex)) throw new AbiDecodeError(`malformed hex: ${hex}`);
  const body = hex.slice(2);
  if (body.length % 2 !== 0) throw new AbiDecodeError(`odd-length hex: ${hex}`);
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** keccak256 of an event signature, e.g. "Transfer(address,address,uint256)". */
export function eventTopic0(signature: string): string {
  const hash = keccak_256(new TextEncoder().encode(signature));
  return "0x" + bytesToHex(hash);
}

/** Build the canonical signature string from an ABI event input list. */
export function eventSignature(abiEvent: AbiEvent): string {
  const parts = (abiEvent.inputs ?? []).map((input) => {
    if (input.components && input.components.length > 0) {
      const nested = input.components
        .map((c) => c.type + (c.type.endsWith("[]") ? "" : ""))
        .join(",");
      const base = input.type.replace(/(\[\])+$/, "");
      return `${base}(${nested})${input.type.endsWith("[]") ? "[]" : ""}`;
    }
    return input.type;
  });
  return `${abiEvent.name}(${parts.join(",")})`;
}

function stripDynamic(type: string): string {
  return type.replace(/(\[\])+$/, "");
}

function isDynamic(type: string): boolean {
  return type.endsWith("[]") || type === "bytes" || type === "string";
}

function decodeUintFromBytes(data: Uint8Array, offset: number): string {
  const end = offset + 32;
  if (end > data.length) {
    throw new AbiDecodeError(`uint out of range at ${offset}`);
  }
  const slice = data.slice(offset, end);
  let hex = bytesToHex(slice);
  return BigInt("0x" + hex).toString();
}

function decodeBoolFromBytes(data: Uint8Array, offset: number): boolean {
  const v = BigInt(decodeUintFromBytes(data, offset));
  return v !== BigInt(0);
}

function decodeAddressFromBytes(data: Uint8Array, offset: number): string {
  const end = offset + 32;
  if (end > data.length) throw new AbiDecodeError(`address out of range at ${offset}`);
  const slice = data.slice(offset + 12, end);
  return "0x" + bytesToHex(slice);
}

function decodeTopic(topic: string, type: string): unknown {
  const bytes = hexToBytes(topic);
  const base = stripDynamic(type);
  if (base === "address") return decodeAddressFromBytes(bytes, 0);
  if (base === "bool") return decodeBoolFromBytes(bytes, 0);
  if (base === "bytes" || base === "string") {
    // Indexed dynamic types hash their value; we can only surface the raw hash.
    return topic;
  }
  if (/^uint\d*$/.test(base) || /^int\d*$/.test(base)) {
    return decodeUintFromBytes(bytes, 0);
  }
  // Fixed bytes / any other indexed scalar-bearing type: return raw topic.
  return topic;
}

function wordCount(type: string): number {
  const base = stripDynamic(type);
  if (isDynamic(type)) return 1;
  if (/^(uint|int)\d*$/.test(base)) return 1;
  if (base === "address" || base === "bool") return 1;
  if (/^bytes\d+$/.test(base)) return 1;
  if (/^fixed/.test(base) || /^ufixed/.test(base)) return 1;
  if (base.startsWith("(")) {
    // tuple — approximate; tuple decode handled in decodeTuple
    return 1;
  }
  return 1;
}

function decodeTuple(
  data: Uint8Array,
  components: AbiEventInput[],
  offset: number,
): DecodedValue[] {
  const out: DecodedValue[] = [];
  let cursor = offset;
  const headSizes = components.map((c) => wordCount(c.type));
  const fixedBytes = headSizes.reduce((a, b) => a + b, 0);
  const headsEnd = offset + fixedBytes * 32;
  let dynamicTailOffset = offset + fixedBytes * 32;

  components.forEach((comp, i) => {
    const cp = headSizes[i];
    if (isDynamic(comp.type)) {
      const rel = Number(BigInt(decodeUintFromBytes(data, cursor)));
      out.push({ name: comp.name, type: comp.type, value: readDynamic(data, comp.type, headsEnd + rel) });
      cursor += 32;
    } else if (comp.components && comp.components.length > 0) {
      const rel = Number(BigInt(decodeUintFromBytes(data, cursor)));
      const nested = decodeTuple(data, comp.components, headsEnd + rel);
      out.push({ name: comp.name, type: comp.type, value: nested });
      cursor += 32;
      void dynamicTailOffset;
    } else {
      out.push({ name: comp.name, type: comp.type, value: readFixed(data, comp.type, cursor) });
      cursor += 32;
    }
  });
  void dynamicTailOffset;
  return out;
}

function readDynamic(
  data: Uint8Array,
  type: string,
  offset: number,
): unknown {
  const base = stripDynamic(type);
  const len = Number(BigInt(decodeUintFromBytes(data, offset)));
  const elemStart = offset + 32;
  if (len > (data.length - elemStart) / 32) {
    throw new AbiDecodeError(`dynamic element length overflow for ${type}`);
  }
  if (type === "string") {
    const slice = data.slice(elemStart, elemStart + len);
    try {
      return new TextDecoder().decode(slice);
    } catch {
      return bytesToHex(slice);
    }
  }
  if (type === "bytes") {
    return "0x" + bytesToHex(data.slice(elemStart, elemStart + len));
  }
  const elemType = base;
  const arr: unknown[] = [];
  for (let i = 0; i < len; i++) {
    const pos = elemStart + i * 32;
    if (isDynamic(elemType) || (elemType.startsWith("("))) {
      const rel = Number(BigInt(decodeUintFromBytes(data, pos)));
      arr.push(readDynamic(data, elemType, elemStart + rel));
    } else {
      arr.push(readFixed(data, elemType, pos));
    }
  }
  return arr;
}

function readFixed(data: Uint8Array, type: string, offset: number): unknown {
  const base = stripDynamic(type);
  if (base === "address") return decodeAddressFromBytes(data, offset);
  if (base === "bool") return decodeBoolFromBytes(data, offset);
  if (/^(uint|int)\d*$/.test(base)) return decodeUintFromBytes(data, offset);
  if (/^bytes\d+$/.test(base)) {
    const n = parseInt(base.slice(5), 10);
    return "0x" + bytesToHex(data.slice(offset + 32 - n, offset + 32));
  }
  if (type.startsWith("(")) {
    // won't reach here in practice (tuples routed to decodeTuple)
    return bytesToHex(data.slice(offset, offset + 32));
  }
  return bytesToHex(data.slice(offset, offset + 32));
}

export interface DecodeLogInput {
  address: string;
  topics: string[];
  data: string;
  blockNumber?: string | number;
  blockHash?: string;
  transactionHash?: string;
  logIndex?: string | number;
  transactionIndex?: string | number;
  removed?: boolean;
  chainId?: number;
}

function decodeEventInputs(
  data: Uint8Array,
  inputs: AbiEventInput[],
  topics: string[],
): DecodedValue[] {
  const indexed = inputs.filter((i) => i.indexed);
  const nonIndexed = inputs.filter((i) => !i.indexed);
  const out: DecodedValue[] = [];
  let topicCursor = 1;

  for (const input of indexed) {
    const topic = topics[topicCursor];
    if (topic === undefined) {
      throw new AbiDecodeError(`missing topic for indexed ${input.name ?? input.type}`);
    }
    if (input.components && input.components.length > 0) {
      // Indexed tuple/hash-cased — surface raw topic.
      out.push({ name: input.name, type: input.type, value: topic });
    } else {
      out.push({ name: input.name, type: input.type, value: decodeTopic(topic, input.type) });
    }
    topicCursor++;
  }

  let dataOffset = 0;
  const headSizes = nonIndexed.map((i) => wordCount(i.type));
  const fixedCount = headSizes.reduce((a, b) => a + b, 0);
  const headsEnd = 0 + fixedCount * 32;

  nonIndexed.forEach((input, i) => {
    if (isDynamic(input.type)) {
      const rel = Number(BigInt(decodeUintFromBytes(data, dataOffset)));
      out.push({ name: input.name, type: input.type, value: readDynamic(data, input.type, headsEnd + rel) });
      dataOffset += 32;
    } else if (input.components && input.components.length > 0) {
      const rel = Number(BigInt(decodeUintFromBytes(data, dataOffset)));
      out.push({ name: input.name, type: input.type, value: decodeTuple(data, input.components, headsEnd + rel) });
      dataOffset += 32;
    } else {
      out.push({ name: input.name, type: input.type, value: readFixed(data, input.type, dataOffset) });
      dataOffset += 32;
    }
  });

  return out;
}

/** Find a matching ABI event by topic0, decode it into a TypedEvent. */
export function decodeLog(
  log: DecodeLogInput,
  abiEvents: AbiEvent[],
  chainId = 1,
): TypedEvent {
  const topics = log.topics.map((t) => t.toLowerCase());
  const topic0 = topics[0];
  const ev = abiEvents.find((e) => {
    if (e.anonymous && !topics[0]) return true;
    return eventTopic0(eventSignature(e)).toLowerCase() === topic0;
  });
  if (!ev) throw new AbiDecodeError(`no ABI event matches topic0 ${topic0}`);

  const data = hexToBytes(log.data || "0x");
  const args = decodeEventInputs(data, ev.inputs ?? [], topics);

  const toNum = (v?: string | number): number | undefined => {
    if (v === undefined) return undefined;
    if (typeof v === "number") return v;
    return Number(BigInt(v));
  };

  return {
    name: ev.name,
    topic0: topics[0],
    signature: eventSignature(ev),
    address: log.address.toLowerCase(),
    args,
    blockNumber: toNum(log.blockNumber),
    blockHash: log.blockHash,
    txHash: log.transactionHash,
    logIndex: toNum(log.logIndex),
    removed: log.removed,
  };
}

/** Filter events out of a raw RpcLog list that don't match any ABI event. */
export function filterKnownEvents(logs: DecodeLogInput[], abiEvents: AbiEvent[]): string[] {
  const t0s = new Set(abiEvents.map((e) => eventTopic0(eventSignature(e)).toLowerCase()));
  return logs.map((l) => l.topics[0]?.toLowerCase()).filter((t) => t && t0s.has(t));
}

export { keccak_256, bytesToHex };