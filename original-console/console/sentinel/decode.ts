import { decodeFunctionData, type Abi, type Address, type Hex } from "viem";
import { ENTITY_LABELS } from "../packages/shared/addresses";
import { erc20Abi, multicallAbi, ownableAbi, proxyAbi } from "../packages/shared/abi";
import type { ConcreteCall } from "../packages/shared/calls";
import { formatTokenAmount, shortAddress, shortHex } from "../packages/shared/format";
import type { DecodedAction } from "../packages/shared/schemas";

const KNOWN_ABIS: Abi[] = [erc20Abi, proxyAbi, ownableAbi, multicallAbi];

export function entityLabel(address: string): string {
  return ENTITY_LABELS[address.toLowerCase()]?.label ?? shortAddress(address);
}

function stringify(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(stringify).join(", ");
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, inner]) => `${key}: ${stringify(inner)}`)
      .join(", ");
  }
  return String(value);
}

function tryDecode(data: Hex): { functionName: string; args: readonly unknown[] } | null {
  for (const abi of KNOWN_ABIS) {
    try {
      const decoded = decodeFunctionData({ abi, data });
      const args = Array.isArray(decoded.args) ? decoded.args : [];
      return { functionName: String(decoded.functionName), args };
    } catch {
      // try the next registry entry
    }
  }
  return null;
}

function humanText(functionName: string, args: readonly unknown[], targetLabel: string): string {
  switch (functionName) {
    case "transfer":
      return `Transfers ${formatTokenAmount(args[1] as bigint)} USDC to ${entityLabel(
        args[0] as string,
      )} (${shortAddress(args[0] as string)})`;
    case "approve":
      return `Approves ${entityLabel(args[0] as string)} to spend ${formatTokenAmount(
        args[1] as bigint,
      )} USDC`;
    case "transferFrom":
      return `Moves ${formatTokenAmount(args[2] as bigint)} USDC from ${entityLabel(
        args[0] as string,
      )} to ${entityLabel(args[1] as string)}`;
    case "upgradeTo":
      return `Upgrades ${targetLabel} to implementation ${shortAddress(args[0] as string)}`;
    case "upgradeToAndCall":
      return `Upgrades ${targetLabel} to ${shortAddress(
        args[0] as string,
      )} and executes payload ${shortHex(args[1] as Hex, 4)}`;
    case "transferOwnership":
      return `Transfers ownership of ${targetLabel} to ${entityLabel(
        args[0] as string,
      )} (${shortAddress(args[0] as string)})`;
    case "multicall": {
      const calls = args[0] as readonly { target: string; data: string }[];
      return `Batches ${calls.length} call${calls.length === 1 ? "" : "s"} in one transaction`;
    }
    default:
      return `${functionName}(${args.map((value) => stringify(value)).join(", ")})`;
  }
}

export function decodeAction(call: ConcreteCall, depth = 0): DecodedAction {
  const selector = call.data.slice(0, 10) as Hex;
  const targetLabel = entityLabel(call.target);
  const decoded = tryDecode(call.data);

  if (!decoded) {
    return {
      target: call.target,
      targetLabel,
      function: "unknown",
      selector,
      args: { data: call.data },
      humanText: `UNKNOWN FUNCTION ${selector}`,
      nested: [],
      unknown: true,
      flag: "Selector is not in the local ABI registry.",
    };
  }

  const args = decoded.args;
  let nested: DecodedAction[] = [];
  if (decoded.functionName === "multicall" && depth < 3) {
    const calls = (args[0] ?? []) as readonly { target: Address; data: Hex }[];
    nested = calls.map((child) =>
      decodeAction({ target: child.target, value: 0n, data: child.data }, depth + 1),
    );
  }

  return {
    target: call.target,
    targetLabel,
    function: `${decoded.functionName}()`,
    selector,
    args: Object.fromEntries(args.map((value, index) => [`arg${index}`, stringify(value)])),
    humanText: humanText(decoded.functionName, args, targetLabel),
    nested,
  };
}

export function decodeBundle(calls: ConcreteCall[]): DecodedAction[] {
  return calls.map((call) => decodeAction(call));
}

export function extractMulticallChildren(call: ConcreteCall): { target: Address; data: Hex }[] {
  try {
    const decoded = decodeFunctionData({ abi: multicallAbi, data: call.data });
    const calls = (decoded.args as unknown as [readonly { target: Address; data: Hex }[]])[0] ?? [];
    return calls.map((child) => ({ target: child.target, data: child.data }));
  } catch {
    return [];
  }
}

export function flattenDecoded(
  actions: DecodedAction[],
  depth = 0,
): { action: DecodedAction; depth: number }[] {
  return actions.flatMap((action) => [
    { action, depth },
    ...flattenDecoded(action.nested, depth + 1),
  ]);
}
