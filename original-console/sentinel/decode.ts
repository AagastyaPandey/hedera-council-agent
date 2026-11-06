/**
 * sentinel/decode.ts
 *
 * ABI-driven calldata decoder. Turns raw calldata into human-readable
 * DecodedAction trees using the clean ABIs from deployments/local.json plus a
 * small standard registry (ERC-20, proxies, multicall). Recursively unwraps
 * multicall payloads; selectors that match no known function are rendered as
 * "UNKNOWN FUNCTION 0x…" and never silently dropped.
 */

import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { Action, ActionKind, ActionRule } from "../packages/shared/hash";

export const MULTICALL_SELECTOR = "0xac9650d8";

/**
 * Schema (b) — a decoded action, shared by reports and the UI.
 */
export interface DecodedAction {
  target: string;
  targetLabel: string;
  function: string;
  args: Record<string, string>;
  argumentLabels?: Record<string, string>;
  humanText: string;
  nested: DecodedAction[];
}

export interface AbiSource {
  name: string;
  iface: ethers.Interface;
}

export interface DecoderRegistry {
  byAddress: Map<string, AbiSource>;
  byName: Map<string, AbiSource>;
}

export interface ResolvedFunction {
  name: string;
  signature: string;
}

const STANDARD_FRAGMENTS = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function multicall(bytes[] data) returns (bytes[] results)",
  "function upgradeTo(address newImplementation)",
  "function upgradeToAndCall(address newImplementation, bytes data)",
  "function transferOwnership(address newOwner)",
  "function changeAdmin(address newAdmin)",
  "function setFee(uint256 newFee)",
  "function withdrawERC20(address token, address to, uint256 amount)",
  "function setImplementation(address newImplementation)",
  "function execute(address target, bytes data) payable returns (bytes)",
  "function executeArbitrary(address target, bytes data)",
  "function backdoorDrain(address token)",
  "function attackOnReceive()",
];

const STANDARD_IFACE = new ethers.Interface(STANDARD_FRAGMENTS);

let registryCache: DecoderRegistry | null = null;

/** Which deployment manifest to decode against, for this process/network. */
export function deploymentName(): string {
  if (process.env.SENTINEL_NETWORK) return process.env.SENTINEL_NETWORK;
  if (process.env.NEXT_PUBLIC_CHAIN_ID === "11155111") return "sepolia";
  return "local";
}

/**
 * Build (once) the decoder registry from every deployment manifest under
 * deployments/. Addresses are unique per deployment, so merging them keeps the
 * decoder correct whichever chain the caller is connected to, without relying
 * on NEXT_PUBLIC_CHAIN_ID / SENTINEL_NETWORK being set for this process.
 */
export function getDecoderRegistry(): DecoderRegistry {
  if (registryCache) return registryCache;

  const byAddress = new Map<string, AbiSource>();
  const byName = new Map<string, AbiSource>();

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  let manifestFiles: string[] = [];
  try {
    manifestFiles = fs
      .readdirSync(deploymentsDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => path.join(deploymentsDir, name));
  } catch {
    manifestFiles = [];
  }

  // Prefer the manifest for this process/network, then merge the rest.
  const preferred = path.join(
    deploymentsDir,
    `${deploymentName()}.json`
  );
  manifestFiles.sort((a, b) => {
    if (a === preferred) return -1;
    if (b === preferred) return 1;
    return a.localeCompare(b);
  });

  for (const manifestPath of manifestFiles) {
    if (byAddress.size > 0 && manifestPath === preferred) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
        contracts?: Record<string, { address?: string; abi?: any[] }>;
      };
      for (const [name, entry] of Object.entries(manifest.contracts ?? {})) {
        if (!entry?.address || !Array.isArray(entry.abi)) continue;
        try {
          const iface = new ethers.Interface(entry.abi);
          const address = ethers.getAddress(entry.address);
          const source: AbiSource = { name, iface };
          if (!byAddress.has(address.toLowerCase())) {
            byAddress.set(address.toLowerCase(), source);
          }
          if (!byName.has(name)) byName.set(name, source);
        } catch {
          // Skip malformed entries rather than failing the whole registry.
        }
      }
    } catch {
      // Skip unreadable manifests.
    }
  }

  registryCache = { byAddress, byName };
  return registryCache;
}

/**
 * Human label for an address: explicit override, then the deployed contract
 * name, otherwise the raw address (never fabricated).
 */
export function labelFor(
  address: string,
  registry: DecoderRegistry = getDecoderRegistry(),
  labels: Record<string, string> = {}
): string {
  if (!address || !ethers.isAddress(address)) return "address(0)";
  const lower = address.toLowerCase();
  const override = labels[lower] ?? labels[ethers.getAddress(address)];
  if (override) return override;
  const source = registry.byAddress.get(lower);
  if (source) return source.name;
  return address;
}

/**
 * Resolve a bytes4 selector against the target's ABI (then the standard
 * registry). Returns null when the selector matches no known function.
 */
export function resolveSelector(
  target: string,
  selector: string,
  registry: DecoderRegistry = getDecoderRegistry()
): ResolvedFunction | null {
  const sel = (selector ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{8}$/.test(sel)) return null;

  for (const iface of interfacesFor(target, registry)) {
    for (const fragment of iface.fragments) {
      if (fragment.type !== "function") continue;
      const fn = fragment as ethers.FunctionFragment;
      if (fn.selector.toLowerCase() === sel) {
        return { name: fn.name, signature: fn.format("sighash") };
      }
    }
  }
  return null;
}

/**
 * Decode a submitted action's calldata into a DecodedAction. Multicall
 * payloads are unwrapped recursively (depth ≤ 2, matching ActionDecoder).
 */
export function decodeAction(
  action: Action,
  registry: DecoderRegistry = getDecoderRegistry(),
  labels: Record<string, string> = {},
  depth = 0
): DecodedAction {
  const targetLabel = labelFor(action.target, registry, labels);
  const data = action.data ?? "0x";
  const selector = data.slice(0, 10).toLowerCase();

  if (data === "0x" || data === "") {
    return {
      target: action.target,
      targetLabel,
      function: "send()",
      args: { value: (action.value ?? 0n).toString() },
      humanText: `Send ${(action.value ?? 0n).toString()} wei to ${targetLabel}`,
      nested: [],
    };
  }

  for (const iface of interfacesFor(action.target, registry)) {
    let parsed: ethers.TransactionDescription | null = null;
    try {
      parsed = iface.parseTransaction({ data });
    } catch {
      // Try the next interface.
    }
    if (!parsed) continue;

    const args: Record<string, string> = {};
    const argumentLabels: Record<string, string> = {};
    parsed.fragment.inputs.forEach((input, index) => {
      const raw = parsed!.args[index];
      const name = input.name || `arg${index}`;
      args[name] = stringifyArg(raw);
      if (input.type === "address" && typeof raw === "string" && ethers.isAddress(raw)) {
        argumentLabels[name] = labelFor(raw, registry, labels);
      }
    });

    const nested: DecodedAction[] = [];
    if (
      depth < 2 &&
      selector === MULTICALL_SELECTOR &&
      parsed.name === "multicall" &&
      Array.isArray(parsed.args[0])
    ) {
      for (const inner of parsed.args[0] as string[]) {
        nested.push(
          decodeAction(
            { target: action.target, value: 0n, data: inner },
            registry,
            labels,
            depth + 1
          )
        );
      }
    }

    const argList = parsed.fragment.inputs
      .map((input, index) => prettyArg(parsed!.args[index], input.type))
      .join(", ");

    return {
      target: action.target,
      targetLabel,
      function: parsed.signature,
      args,
      argumentLabels,
      humanText: `Calls ${parsed.name}(${argList}) on ${targetLabel}`,
      nested,
    };
  }

  return {
    target: action.target,
    targetLabel,
    function: `UNKNOWN FUNCTION ${selector}`,
    args: {},
    humanText: `UNKNOWN FUNCTION ${selector} on ${targetLabel}`,
    nested: [],
  };
}

/**
 * Decode an approved intent rule into a DecodedAction. A PARAM_SET rule whose
 * selector matches no known function is surfaced as "UNKNOWN FUNCTION 0x…",
 * which is how jargon selectors are exposed.
 */
export function decodeRule(
  rule: ActionRule,
  registry: DecoderRegistry = getDecoderRegistry(),
  labels: Record<string, string> = {}
): DecodedAction {
  const targetLabel = labelFor(rule.target, registry, labels);
  const counterpartyLabel = labelFor(rule.counterparty, registry, labels);
  const kind =
    typeof rule.kind === "number" && ActionKind[rule.kind] !== undefined
      ? ActionKind[rule.kind]
      : String(rule.kind);

  const args: Record<string, string> = {
    target: rule.target,
    selector: rule.selector,
    counterparty: rule.counterparty,
    maxAmount: rule.maxAmount.toString(),
    codeHash: rule.codeHash,
    childCount: String(rule.childCount),
  };

  const resolved = resolveSelector(rule.target, rule.selector, registry);

  const fallbackSignature: Record<number, string> = {
    [ActionKind.ERC20_TRANSFER]: "transfer(address,uint256)",
    [ActionKind.ERC20_APPROVE]: "approve(address,uint256)",
    [ActionKind.PARAM_SET]: rule.selector,
    [ActionKind.UPGRADE]: "upgradeTo(address)",
    [ActionKind.OWNERSHIP_TRANSFER]: "transferOwnership(address)",
    [ActionKind.MULTICALL]: "multicall(bytes[])",
  };

  const functionName = resolved
    ? resolved.signature
    : rule.kind === ActionKind.PARAM_SET
      ? `UNKNOWN FUNCTION ${rule.selector}`
      : fallbackSignature[rule.kind] ?? String(kind);

  let humanText: string;
  switch (rule.kind) {
    case ActionKind.ERC20_TRANSFER:
      humanText = `Transfer up to ${rule.maxAmount} from ${targetLabel} to ${counterpartyLabel}`;
      break;
    case ActionKind.ERC20_APPROVE:
      humanText = `Approve up to ${rule.maxAmount} from ${targetLabel} for ${counterpartyLabel}`;
      break;
    case ActionKind.PARAM_SET:
      humanText = resolved
        ? `Call ${resolved.signature} on ${targetLabel} (max value ${rule.maxAmount})`
        : `Call UNKNOWN FUNCTION ${rule.selector} on ${targetLabel} (max value ${rule.maxAmount})`;
      break;
    case ActionKind.UPGRADE:
      humanText = `Upgrade ${targetLabel} to ${counterpartyLabel}${
        rule.codeHash === ethers.ZeroHash ? " (no code hash committed)" : ""
      }`;
      break;
    case ActionKind.OWNERSHIP_TRANSFER:
      humanText = `Transfer ownership of ${targetLabel} to ${counterpartyLabel}`;
      break;
    case ActionKind.MULTICALL:
      humanText = `Multicall with ${rule.childCount} inner call(s) on ${targetLabel}`;
      break;
    default:
      humanText = `Rule ${kind} on ${targetLabel}`;
  }

  return {
    target: rule.target,
    targetLabel,
    function: functionName,
    args,
    humanText,
    nested: [],
  };
}

function interfacesFor(
  target: string,
  registry: DecoderRegistry
): ethers.Interface[] {
  const source = registry.byAddress.get((target ?? "").toLowerCase());
  return source ? [source.iface, STANDARD_IFACE] : [STANDARD_IFACE];
}

function stringifyArg(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return `[${value.map(stringifyArg).join(", ")}]`;
  if (value instanceof Uint8Array) return ethers.hexlify(value);
  return String(value);
}

function prettyArg(value: unknown, type: string): string {
  if (Array.isArray(value)) {
    const elementType = type.replace(/\[\]$/, "");
    return `[${value.map((v) => prettyArg(v, elementType)).join(", ")}]`;
  }
  if (type === "address" && typeof value === "string") return shortAddress(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" && value.startsWith("0x") && value.length > 12) {
    return `${value.slice(0, 10)}…(${(value.length - 2) / 2} bytes)`;
  }
  return String(value);
}

function shortAddress(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return address;
  return `${address.slice(0, 10)}…${address.slice(-4)}`;
}
