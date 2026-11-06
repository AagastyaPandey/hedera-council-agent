import { ethers } from "ethers";

export type TraceCallType =
  | "CALL"
  | "DELEGATECALL"
  | "CALLCODE"
  | "STATICCALL"
  | "CREATE"
  | "CREATE2";

/**
 * A normalized call frame.
 *
 * For DELEGATECALL/CALLCODE, execution context (`to`) is the calling contract,
 * while `codeTarget` is the address whose code actually ran.
 */
export interface TraceCall {
  type: TraceCallType;
  from: string;
  to: string;
  codeTarget?: string;
  depth: number;
}

export interface TokenTransfer {
  token: string;
  from: string;
  to: string;
  amount?: bigint;
}

export interface TokenApproval {
  token: string;
  owner: string;
  spender: string;
  amount?: bigint;
}

export interface StorageWrite {
  contract: string;
  slot: string;
  value: string;
  depth: number;
}

export interface NormalizedTrace {
  source: "callTracer" | "structLogs";
  calls: TraceCall[];
  delegateCalls: TraceCall[];
  tokenTransfers: TokenTransfer[];
  tokenApprovals: TokenApproval[];
  storageWrites: StorageWrite[];
  failed: boolean;
  returnValue: string;
}

const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
const APPROVAL_TOPIC = ethers.id("Approval(address,address,uint256)");

const CALL_OPS = new Set([
  "CALL",
  "DELEGATECALL",
  "CALLCODE",
  "STATICCALL",
  "CREATE",
  "CREATE2",
]);

/** Minimal JSON-RPC surface needed by the tracer (Hardhat's provider has it). */
export interface TraceProvider {
  send(method: string, params: any[]): Promise<any>;
}

/**
 * Fetch a trace for a mined transaction.
 *
 * Tries the standard callTracer first (Geth/Anvil). Hardhat's EDR only
 * implements the default struct-log tracer and rejects the `tracer`
 * parameter, so we fall back to rebuilding call frames, events and storage
 * writes from struct logs.
 */
export async function getCallTrace(
  provider: TraceProvider,
  txHash: string,
  txFrom: string,
  txTo: string
): Promise<NormalizedTrace | undefined> {
  try {
    const raw = await provider.send("debug_traceTransaction", [
      txHash,
      { tracer: "callTracer", tracerConfig: { withLog: true } },
    ]);
    if (raw && typeof raw === "object" && raw.type) {
      return normalizeCallTracer(raw, txFrom, txTo);
    }
  } catch {
    // Tracer unsupported by this node; use struct logs below.
  }

  try {
    const raw = await provider.send("debug_traceTransaction", [txHash]);
    return normalizeStructLogs(raw, txFrom, txTo);
  } catch {
    return undefined;
  }
}

/**
 * Trace a call that is expected to revert without mining it (`debug_traceCall`).
 * Used when a sandbox transaction reverts, so the report still carries evidence.
 */
export async function getTraceForCall(
  provider: TraceProvider,
  call: { from: string; to: string; data: string; gas?: string },
  blockTag: string = "latest"
): Promise<NormalizedTrace | undefined> {
  try {
    const raw = await provider.send("debug_traceCall", [
      call,
      blockTag,
      { tracer: "callTracer", tracerConfig: { withLog: true } },
    ]);
    if (raw && typeof raw === "object" && raw.type) {
      return normalizeCallTracer(raw, call.from, call.to);
    }
  } catch {
    // Tracer unsupported by this node; use struct logs below.
  }

  try {
    const raw = await provider.send("debug_traceCall", [call, blockTag]);
    return normalizeStructLogs(raw, call.from, call.to);
  } catch {
    return undefined;
  }
}

function normalizeCallTracer(
  root: any,
  txFrom: string,
  txTo: string
): NormalizedTrace {
  const calls: TraceCall[] = [];
  const tokenTransfers: TokenTransfer[] = [];
  const tokenApprovals: TokenApproval[] = [];

  const walk = (frame: any, depth: number, parentContext: string) => {
    const type = normalizeCallType(frame.type);
    const rawFrom = normalizeAddress(frame.from) ?? parentContext;
    const rawTo = normalizeAddress(frame.to) ?? parentContext;

    let context = rawTo;
    let codeTarget: string | undefined = rawTo;
    if (type === "DELEGATECALL" || type === "CALLCODE") {
      context = rawFrom;
      codeTarget = rawTo;
    }

    calls.push({
      type,
      from: depth === 1 ? txFrom : rawFrom,
      to: depth === 1 ? txTo : context,
      codeTarget,
      depth,
    });

    const logs = Array.isArray(frame.logs) ? frame.logs : [];
    for (const log of logs) {
      const address = normalizeAddress(log.address);
      if (!address) continue;
      const topics: string[] = Array.isArray(log.topics) ? log.topics.map(String) : [];
      parseEvent(address, topics, String(log.data ?? "0x"), tokenTransfers, tokenApprovals);
    }

    const children = Array.isArray(frame.calls) ? frame.calls : [];
    for (const child of children) {
      walk(child, depth + 1, context);
    }
  };

  walk(root, 1, txFrom);

  return {
    source: "callTracer",
    calls,
    delegateCalls: calls.filter(
      (c) => c.type === "DELEGATECALL" || c.type === "CALLCODE"
    ),
    tokenTransfers,
    tokenApprovals,
    storageWrites: [],
    failed: Boolean(root.error),
    returnValue: typeof root.returnValue === "string" ? root.returnValue : "0x",
  };
}

function normalizeStructLogs(
  raw: any,
  txFrom: string,
  txTo: string
): NormalizedTrace {
  const logs: any[] = Array.isArray(raw?.structLogs) ? raw.structLogs : [];
  const calls: TraceCall[] = [
    { type: "CALL", from: txFrom, to: txTo, codeTarget: txTo, depth: 1 },
  ];
  const tokenTransfers: TokenTransfer[] = [];
  const tokenApprovals: TokenApproval[] = [];
  const storageWrites: StorageWrite[] = [];

  const addressAtDepth: string[] = [];
  addressAtDepth[1] = txTo;

  for (const log of logs) {
    const depth = Number(log.depth) || 1;
    const stack: string[] = Array.isArray(log.stack) ? log.stack.map(String) : [];
    const op = String(log.op ?? "");
    const context = addressAtDepth[depth] ?? txTo;

    if (CALL_OPS.has(op)) {
      if (op === "CREATE" || op === "CREATE2") {
        // Created address is not on the stack; keep the depth map safe.
        addressAtDepth[depth + 1] = "";
        continue;
      }
      if (stack.length < 2) continue;

      const codeTarget = stackAddress(stack[stack.length - 2]);
      let callTo = codeTarget;
      if (op === "DELEGATECALL" || op === "CALLCODE") {
        callTo = context;
      }

      addressAtDepth[depth + 1] = callTo;
      calls.push({
        type: normalizeCallType(op),
        from: context,
        to: callTo,
        codeTarget,
        depth: depth + 1,
      });
      continue;
    }

    if (op.startsWith("LOG")) {
      const topicCount = Number(op.slice(3));
      if (!Number.isInteger(topicCount) || stack.length < topicCount + 2) continue;

      const topics: string[] = [];
      for (let i = 0; i < topicCount; i++) {
        topics.push("0x" + stack[stack.length - 3 - i]);
      }

      const memory = Array.isArray(log.memory) ? log.memory.map(String) : [];
      // LOGn pops mstart (top), then msize, then topics.
      const data = readMemory(memory, stack[stack.length - 1], stack[stack.length - 2]);
      parseEvent(context, topics, data, tokenTransfers, tokenApprovals);
      continue;
    }

    if (op === "SSTORE" && stack.length >= 2) {
      storageWrites.push({
        contract: context,
        slot: "0x" + stack[stack.length - 1].toLowerCase().padStart(64, "0"),
        value: "0x" + stack[stack.length - 2].toLowerCase().padStart(64, "0"),
        depth,
      });
    }
  }

  return {
    source: "structLogs",
    calls,
    delegateCalls: calls.filter(
      (c) => c.type === "DELEGATECALL" || c.type === "CALLCODE"
    ),
    tokenTransfers,
    tokenApprovals,
    storageWrites,
    failed: Boolean(raw?.failed),
    returnValue: typeof raw?.returnValue === "string" ? raw.returnValue : "0x",
  };
}

function parseEvent(
  contract: string,
  topics: string[],
  data: string,
  transfers: TokenTransfer[],
  approvals: TokenApproval[]
): void {
  const topic0 = topics[0]?.toLowerCase();
  if (!topic0) return;

  if (topic0 === TRANSFER_TOPIC && topics.length >= 3) {
    transfers.push({
      token: contract,
      from: topicAddress(topics[1]),
      to: topicAddress(topics[2]),
      amount: decodeUint256(data),
    });
    return;
  }

  if (topic0 === APPROVAL_TOPIC && topics.length >= 3) {
    approvals.push({
      token: contract,
      owner: topicAddress(topics[1]),
      spender: topicAddress(topics[2]),
      amount: decodeUint256(data),
    });
  }
}

function readMemory(memory: string[], offsetHex: string, sizeHex: string): string {
  let offset: number;
  let size: number;
  try {
    offset = Number(BigInt("0x" + offsetHex));
    size = Number(BigInt("0x" + sizeHex));
  } catch {
    return "0x";
  }
  if (!Number.isFinite(offset) || !Number.isFinite(size) || size <= 0) return "0x";

  const hex = memory.join("");
  const start = offset * 2;
  const end = start + size * 2;
  if (start >= hex.length) return "0x";
  return "0x" + hex.slice(start, end);
}

function decodeUint256(data: string): bigint | undefined {
  if (!data || data === "0x" || data.length < 66) return undefined;
  try {
    return BigInt(data.slice(0, 66));
  } catch {
    return undefined;
  }
}

function stackAddress(value: string): string {
  const hex = value.toLowerCase().replace(/^0x/, "").padStart(40, "0");
  return ethers.getAddress("0x" + hex.slice(-40));
}

function topicAddress(topic: string): string {
  const hex = topic.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  return ethers.getAddress("0x" + hex.slice(-40));
}

function normalizeAddress(value: unknown): string | undefined {
  if (typeof value !== "string" || !ethers.isAddress(value)) return undefined;
  return ethers.getAddress(value);
}

function normalizeCallType(value: unknown): TraceCallType {
  const type = String(value ?? "CALL").toUpperCase();
  if (
    type === "CALL" ||
    type === "DELEGATECALL" ||
    type === "CALLCODE" ||
    type === "STATICCALL" ||
    type === "CREATE" ||
    type === "CREATE2"
  ) {
    return type;
  }
  return "CALL";
}
