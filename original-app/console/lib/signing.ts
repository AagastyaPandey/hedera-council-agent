import { ethers } from "ethers";

export const GOVERNOR_DOMAIN = {
  name: "AegisIntentGovernor",
  version: "1",
} as const;

export const EXECUTOR_DOMAIN = {
  name: "AegisIntentLockExecutor",
  version: "1",
} as const;

export type VoteSupport = 0 | 1 | 2;

export type IntentVoteTypedDataInput = {
  chainId: number;
  verifyingContract: string;
  govId: ethers.BigNumberish;
  commitment: string;
  support: VoteSupport;
  briefHash: string;
  statement: string;
  nonce: ethers.BigNumberish;
  deadline: ethers.BigNumberish;
};

export type IntentHaltTypedDataInput = {
  chainId: number;
  verifyingContract: string;
  commitment: string;
  reportHash: string;
  reason: string;
  nonce: ethers.BigNumberish;
  deadline: ethers.BigNumberish;
};

export type IntentTypedData = {
  domain: ethers.TypedDataDomain;
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
};

const VOTE_TYPES = {
  IntentVote: [
    { name: "govId", type: "uint256" },
    { name: "commitment", type: "bytes32" },
    { name: "support", type: "uint8" },
    { name: "briefHash", type: "bytes32" },
    { name: "statement", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

const HALT_TYPES = {
  IntentHalt: [
    { name: "commitment", type: "bytes32" },
    { name: "reportHash", type: "bytes32" },
    { name: "reason", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

export function buildIntentVoteTypedData(
  input: IntentVoteTypedDataInput
): IntentTypedData {
  return {
    domain: {
      ...GOVERNOR_DOMAIN,
      chainId: input.chainId,
      verifyingContract: input.verifyingContract,
    },
    types: VOTE_TYPES,
    primaryType: "IntentVote",
    message: {
      govId: input.govId,
      commitment: input.commitment,
      support: input.support,
      briefHash: input.briefHash,
      statement: input.statement,
      nonce: input.nonce,
      deadline: input.deadline,
    },
  };
}

export function buildIntentHaltTypedData(
  input: IntentHaltTypedDataInput
): IntentTypedData {
  return {
    domain: {
      ...EXECUTOR_DOMAIN,
      chainId: input.chainId,
      verifyingContract: input.verifyingContract,
    },
    types: HALT_TYPES,
    primaryType: "IntentHalt",
    message: {
      commitment: input.commitment,
      reportHash: input.reportHash,
      reason: input.reason,
      nonce: input.nonce,
      deadline: input.deadline,
    },
  };
}

export function intentTypedDataDigest(typed: IntentTypedData): string {
  return ethers.TypedDataEncoder.hash(typed.domain, typed.types, typed.message);
}

export type StatementAction = {
  kind: string;
  amount?: string;
  token?: string;
  recipient?: string;
  target?: string;
  label?: string;
};

export function renderIntentStatement(
  title: string,
  actions: StatementAction[]
): string {
  const parts = actions.map((action) => {
    const amount = action.amount ? `${action.amount} ` : "";
    const token = action.token ? `${action.token} ` : "";
    const recipient = action.recipient ?? action.target ?? "the target";
    switch (action.kind) {
      case "ERC20_TRANSFER":
        return `transfer ${amount}${token}to ${recipient}`.replace(/\s+/g, " ");
      case "ERC20_APPROVE":
        return `approve ${amount}${token}for ${recipient}`.replace(/\s+/g, " ");
      case "UPGRADE":
        return `upgrade ${action.target ?? "the proxy"} to ${recipient}`;
      case "OWNERSHIP_TRANSFER":
        return `transfer ownership of ${action.target ?? "the contract"} to ${recipient}`;
      case "PARAM_SET":
        return `set parameters on ${action.target ?? "the module"}`;
      case "MULTICALL":
        return "execute a multicall";
      default:
        return action.label ?? action.kind.toLowerCase().replaceAll("_", " ");
    }
  });

  return `${title}: ${parts.join("; ")}.`;
}
