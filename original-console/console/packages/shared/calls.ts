import { encodeFunctionData, type Address, type Hex } from "viem";
import { erc20Abi, multicallAbi, ownableAbi, proxyAbi } from "./abi";
import type { ActionKind, ActionSpec, Intent } from "./schemas";

export type EncodableCall = {
  kind: ActionKind;
  target: Address;
  counterparty: Address;
  amount?: string;
  maxAmount?: string;
  children?: EncodableCall[];
  variant?: string;
  extraData?: Hex;
  rawCalldata?: Hex;
  note?: string;
};

export type ConcreteCall = {
  target: Address;
  value: bigint;
  data: Hex;
  note?: string;
};

function amountOf(call: EncodableCall): bigint {
  return BigInt(call.maxAmount ?? call.amount ?? "0");
}

export function encodeCall(call: EncodableCall): Hex {
  switch (call.kind) {
    case "ERC20_TRANSFER":
      return encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [call.counterparty, amountOf(call)],
      });
    case "ERC20_APPROVE":
      return encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [call.counterparty, amountOf(call)],
      });
    case "UPGRADE":
      if (call.variant === "upgradeToAndCall") {
        return encodeFunctionData({
          abi: proxyAbi,
          functionName: "upgradeToAndCall",
          args: [call.counterparty, call.extraData ?? "0x"],
        });
      }
      return encodeFunctionData({
        abi: proxyAbi,
        functionName: "upgradeTo",
        args: [call.counterparty],
      });
    case "OWNERSHIP_TRANSFER":
      return encodeFunctionData({
        abi: ownableAbi,
        functionName: "transferOwnership",
        args: [call.counterparty],
      });
    case "MULTICALL": {
      const children = (call.children ?? []).map((child) => ({
        target: child.target,
        data: encodeCall(child),
      }));
      return encodeFunctionData({
        abi: multicallAbi,
        functionName: "multicall",
        args: [children],
      });
    }
    case "PARAM_SET":
      if (!call.rawCalldata) throw new Error("PARAM_SET requires rawCalldata in this demo");
      return call.rawCalldata;
    default:
      throw new Error(`Unsupported action kind: ${call.kind}`);
  }
}

export function buildConcreteCalls(calls: EncodableCall[]): ConcreteCall[] {
  return calls.map((call) => ({
    target: call.target,
    value: 0n,
    data: encodeCall(call),
    note: call.note,
  }));
}

export function buildApprovedCalls(intent: Intent): ConcreteCall[] {
  return intent.actions.map((action: ActionSpec) => ({
    target: action.target,
    value: 0n,
    data: encodeCall(action),
    note: action.label,
  }));
}
