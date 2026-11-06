import { getAddress, keccak256, parseUnits, toBytes, type Address } from "viem";

const addressOf = (label: string): Address =>
  getAddress(keccak256(toBytes(`aegisdao:${label}`)).slice(0, 42));

export const CHAIN_ID = 31337;
export const CHAIN_NAME = "local-dev";
export const PROPOSAL_ID = "AIP-042";
export const PROPOSAL_TITLE = "Ecosystem Growth Grant — GrowthLabs × Developer Guild";
export const PROPOSER_NAME = "Nova Labs";
export const USDC_DECIMALS = 6;
export const USDC_SYMBOL = "USDC";
export const TREASURY_BALANCE = parseUnits("1200000", USDC_DECIMALS);
export const MAX_UINT256 = 2n ** 256n - 1n;
export const TIMELOCK_SECONDS = 48 * 60 * 60;

export const ADDRESSES = {
  usdc: addressOf("usdc"),
  treasuryProxy: addressOf("treasury-proxy"),
  treasuryImplV2: addressOf("treasury-impl-v2"),
  maliciousImpl: addressOf("malicious-impl"),
  executor: addressOf("intent-lock-executor"),
  guardian: addressOf("guardian-council"),
  proposer: addressOf("nova-labs-multisig"),
  novaMain: addressOf("nova-main"),
  novaTreasury: addressOf("nova-treasury"),
  novaOps: addressOf("nova-ops"),
  growthLabs: addressOf("growthlabs-multisig"),
  glDeployer: addressOf("growthlabs-deployer"),
  developerGuild: addressOf("developer-guild"),
  treasuryOps: addressOf("treasury-ops"),
  attacker: addressOf("attacker"),
  funderX: addressOf("funder-x"),
  multicall: addressOf("multicall"),
} as const;

export const ENTITY_LABELS: Record<string, { label: string; kind: "token" | "contract" | "wallet" | "multisig" }> = {
  [ADDRESSES.usdc.toLowerCase()]: { label: "USDC", kind: "token" },
  [ADDRESSES.treasuryProxy.toLowerCase()]: { label: "TreasuryProxy", kind: "contract" },
  [ADDRESSES.treasuryImplV2.toLowerCase()]: { label: "TreasuryImplV2", kind: "contract" },
  [ADDRESSES.maliciousImpl.toLowerCase()]: { label: "UnknownImpl", kind: "contract" },
  [ADDRESSES.executor.toLowerCase()]: { label: "IntentLockExecutor", kind: "contract" },
  [ADDRESSES.guardian.toLowerCase()]: { label: "GuardianCouncil", kind: "multisig" },
  [ADDRESSES.proposer.toLowerCase()]: { label: "Nova Labs", kind: "multisig" },
  [ADDRESSES.novaMain.toLowerCase()]: { label: "Nova Main", kind: "wallet" },
  [ADDRESSES.novaTreasury.toLowerCase()]: { label: "Nova Treasury", kind: "wallet" },
  [ADDRESSES.novaOps.toLowerCase()]: { label: "Nova Ops (undisclosed)", kind: "wallet" },
  [ADDRESSES.growthLabs.toLowerCase()]: { label: "GrowthLabs Multisig", kind: "multisig" },
  [ADDRESSES.glDeployer.toLowerCase()]: { label: "GrowthLabs Deployer", kind: "wallet" },
  [ADDRESSES.developerGuild.toLowerCase()]: { label: "Developer Guild", kind: "multisig" },
  [ADDRESSES.treasuryOps.toLowerCase()]: { label: "TreasuryOps", kind: "multisig" },
  [ADDRESSES.attacker.toLowerCase()]: { label: "Unrecognized wallet", kind: "wallet" },
  [ADDRESSES.funderX.toLowerCase()]: { label: "Funder X", kind: "wallet" },
  [ADDRESSES.multicall.toLowerCase()]: { label: "Multicall3", kind: "contract" },
};

export const FUNCTIONS = {
  transfer: { signature: "transfer(address,uint256)", selector: "0xa9059cbb" },
  approve: { signature: "approve(address,uint256)", selector: "0x095ea7b3" },
  upgradeTo: { signature: "upgradeTo(address)", selector: "0x3659cfe6" },
  upgradeToAndCall: { signature: "upgradeToAndCall(address,bytes)", selector: "0x4f1ef286" },
  transferOwnership: { signature: "transferOwnership(address)", selector: "0xf2fde38b" },
  multicall: { signature: "multicall((address,bytes)[])", selector: "0xcaa5c23f" },
} as const;

export const ERROR_DEFINITIONS = [
  { name: "CommitmentMismatch", signature: "CommitmentMismatch(bytes32,bytes32)", selector: "0xc9e0e757", text: "The submitted transaction does not match the approved commitment." },
  { name: "UnauthorizedRecipient", signature: "UnauthorizedRecipient(address)", selector: "0x4cc4c430", text: "The transfer recipient is not in the committed rules." },
  { name: "UnauthorizedSpender", signature: "UnauthorizedSpender(address)", selector: "0x7f6f388b", text: "The allowance spender is not in the committed rules." },
  { name: "ExceedsSpendLimit", signature: "ExceedsSpendLimit(uint256,uint256)", selector: "0xe74fc12b", text: "The amount exceeds the committed spend limit for this transfer." },
  { name: "ExceedsAllowance", signature: "ExceedsAllowance(uint256,uint256)", selector: "0x4d76f663", text: "The requested allowance exceeds the committed ceiling." },
  { name: "SelectorNotAuthorized", signature: "SelectorNotAuthorized(address,bytes4)", selector: "0x1420732b", text: "This function was never authorized by the commitment." },
  { name: "CodeHashMismatch", signature: "CodeHashMismatch(address,bytes32,bytes32)", selector: "0xd9d699e0", text: "The implementation bytecode does not match the approved code hash." },
  { name: "NestedCallNotAuthorized", signature: "NestedCallNotAuthorized(uint256,bytes)", selector: "0x1be76755", text: "A multicall child is not present in the commitment." },
  { name: "StaleVersion", signature: "StaleVersion(uint256,uint256)", selector: "0x79c7c8b5", text: "A superseded proposal version was submitted for execution." },
  { name: "AlreadyExecuted", signature: "AlreadyExecuted(uint256)", selector: "0x6a64e961", text: "This proposal version has already executed." },
  { name: "TimelockNotElapsed", signature: "TimelockNotElapsed(uint256,uint256)", selector: "0xaadd2910", text: "The timelock has not elapsed yet." },
  { name: "WrongChain", signature: "WrongChain(uint256,uint256)", selector: "0x24497bc3", text: "The commitment was issued for a different chain." },
  { name: "ReentrancyDetected", signature: "ReentrancyDetected()", selector: "0xc5f2be51", text: "A re-entrant call was detected during execution." },
  { name: "PostConditionViolated", signature: "PostConditionViolated(bytes32)", selector: "0x9079750e", text: "A post-condition reverted the transaction after the call." },
  { name: "GuardianHalted", signature: "GuardianHalted(bytes32)", selector: "0x24a7689c", text: "The guardian halted this proposal during the timelock." },
  { name: "UnknownSelector", signature: "UnknownSelector(bytes4)", selector: "0xc2a825f5", text: "The calldata selector is not recognized by the decoder." },
  { name: "ValueNotAllowed", signature: "ValueNotAllowed(uint256)", selector: "0xdf0089fd", text: "The transaction carries native value, which this proposal does not authorize." },
] as const;

export type ErrorName = (typeof ERROR_DEFINITIONS)[number]["name"];

export const ERROR_BY_NAME = Object.fromEntries(
  ERROR_DEFINITIONS.map((definition) => [definition.name, definition]),
) as Record<ErrorName, (typeof ERROR_DEFINITIONS)[number]>;

export const ERROR_BY_SELECTOR = Object.fromEntries(
  ERROR_DEFINITIONS.map((definition) => [definition.selector, definition]),
) as Record<string, (typeof ERROR_DEFINITIONS)[number]>;

export const DEMO_CLOCK = "2026-10-25T08:00:00.000Z";
