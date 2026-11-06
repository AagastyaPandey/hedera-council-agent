import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

interface ErrorDef {
  signature: string;
  contract: string;
  title: string;
  explanation: string;
}

const ERROR_DEFINITIONS: ErrorDef[] = [
  // ActionDecoder errors
  {
    signature: "BadCalldataLength(uint256,uint256)",
    contract: "ActionDecoder",
    title: "Malformed Calldata Length",
    explanation: "The calldata byte length does not match the expected ABI specification for this action.",
  },
  {
    signature: "SelectorNotAllowed(bytes4,bytes4)",
    contract: "ActionDecoder",
    title: "Unapproved Function Selector",
    explanation: "The calldata calls a function selector that does not match the committed intent rule.",
  },
  {
    signature: "UnauthorizedRecipient(address,address)",
    contract: "ActionDecoder",
    title: "Unauthorized Recipient Address",
    explanation: "The transaction recipient does not match the counterparty committed in the proposal intent.",
  },
  {
    signature: "ExceedsSpendLimit(uint256,uint256)",
    contract: "ActionDecoder",
    title: "Spend Limit Exceeded",
    explanation: "The execution amount exceeds the maximum ceiling authorized by the committed intent rule.",
  },
  {
    signature: "UnlimitedApprovalNotCommitted(address)",
    contract: "ActionDecoder",
    title: "Unlimited Approval Rejected",
    explanation: "Calldata requested type(uint256).max approval which was not explicitly approved in the intent.",
  },
  {
    signature: "UnauthorizedImplementation(address,address)",
    contract: "ActionDecoder",
    title: "Unauthorized Upgrade Implementation",
    explanation: "The proposed upgrade target implementation address was not approved in the committed intent.",
  },
  {
    signature: "CodeHashMismatch(bytes32,bytes32)",
    contract: "ActionDecoder",
    title: "Implementation Bytecode Hash Mismatch",
    explanation: "The extcodehash of the upgrade implementation does not match the cryptographic hash committed in intent.",
  },
  {
    signature: "UnauthorizedNewOwner(address,address)",
    contract: "ActionDecoder",
    title: "Unauthorized Ownership Transfer",
    explanation: "The recipient of ownership transfer does not match the authorized address in the intent.",
  },
  {
    signature: "MulticallChildCountMismatch(uint8,uint256)",
    contract: "ActionDecoder",
    title: "Multicall Inner Call Count Mismatch",
    explanation: "The multicall payload contains a different number of inner calls than the committed child rules.",
  },
  {
    signature: "MulticallDepthExceeded(uint256)",
    contract: "ActionDecoder",
    title: "Multicall Recursion Limit Exceeded",
    explanation: "Multicall nesting exceeds the maximum allowed recursion depth of 2.",
  },
  {
    signature: "UnauthorizedTarget(address,address)",
    contract: "ActionDecoder",
    title: "Unauthorized Target Contract",
    explanation: "The call target contract address does not match the committed intent rule target.",
  },
  {
    signature: "UnknownActionKind(uint8)",
    contract: "ActionDecoder",
    title: "Unknown Action Kind",
    explanation: "The specified action kind does not correspond to any valid ActionKind enum value.",
  },

  // IntentLockExecutor errors
  {
    signature: "NotGovernor(address)",
    contract: "IntentLockExecutor",
    title: "Caller Not Authorized Governor",
    explanation: "Only the designated IntentGovernor contract can queue proposals in the executor.",
  },
  {
    signature: "NotGuardian(address)",
    contract: "IntentLockExecutor",
    title: "Caller Not Guardian",
    explanation: "Only the guardian key / Sentinel can call halt() on a queued proposal.",
  },
  {
    signature: "AlreadyQueued(bytes32)",
    contract: "IntentLockExecutor",
    title: "Proposal Already Queued",
    explanation: "A proposal with this commitment has already been queued.",
  },
  {
    signature: "NotQueued(bytes32)",
    contract: "IntentLockExecutor",
    title: "Proposal Not Queued",
    explanation: "The specified commitment is not currently in the Queued state.",
  },
  {
    signature: "TimelockNotExpired(uint256,uint256)",
    contract: "IntentLockExecutor",
    title: "Timelock Delay Not Expired",
    explanation: "The timelock delay has not yet elapsed. Execution is rejected until block.timestamp >= eta.",
  },
  {
    signature: "DelayOutOfRange(uint256,uint256,uint256)",
    contract: "IntentLockExecutor",
    title: "Timelock Delay Out of Bounds",
    explanation: "The proposed timelock delay is less than minDelay or greater than maxDelay.",
  },
  {
    signature: "CommitmentMismatch(bytes32,bytes32)",
    contract: "IntentLockExecutor",
    title: "Execution Commitment Mismatch",
    explanation: "The recomputed commitment from submitted actions and rules does not match the voted commitment.",
  },
  {
    signature: "IntentHashMismatch(bytes32,bytes32)",
    contract: "IntentLockExecutor",
    title: "Intent Hash Mismatch",
    explanation: "keccak256(abi.encode(rules)) does not match the intentHash bound into the proposal commitment.",
  },
  {
    signature: "VersionSuperseded(uint256,bytes32,bytes32)",
    contract: "IntentLockExecutor",
    title: "Proposal Version Superseded",
    explanation: "The proposal version voted on has been superseded by a newer version in the ProposalRegistry.",
  },
  {
    signature: "ProposalNotInState(uint8,uint8)",
    contract: "IntentLockExecutor",
    title: "Invalid Proposal State",
    explanation: "The proposal is not in the required state for this operation (e.g., executing before queuing or after execution).",
  },
  {
    signature: "ActionExecutionFailed(uint256,address,bytes)",
    contract: "IntentLockExecutor",
    title: "Action Call Reverted",
    explanation: "An external call to the target contract reverted during execution.",
  },
  {
    signature: "PostConditionFailed(string,bytes)",
    contract: "IntentLockExecutor",
    title: "Invariant Post-Condition Failed",
    explanation: "An invariant check failed after executing the proposal actions.",
  },
  {
    signature: "RuleLengthMismatch(uint256,uint256)",
    contract: "IntentLockExecutor",
    title: "Action Count Does Not Match Top-Level Rules",
    explanation: "The number of submitted actions does not match the top-level rules in the intent.",
  },

  // DisclosureRegistry errors
  {
    signature: "DisclosureAlreadySubmitted(uint256)",
    contract: "DisclosureRegistry",
    title: "Disclosure Already Submitted",
    explanation: "A conflict-of-interest disclosure has already been registered for this proposal.",
  },
  {
    signature: "NoDisclosureFound(uint256)",
    contract: "DisclosureRegistry",
    title: "Missing Disclosure",
    explanation: "No conflict-of-interest disclosure has been submitted for this proposal.",
  },
  {
    signature: "InvalidSignature()",
    contract: "DisclosureRegistry",
    title: "Invalid EIP-712 Signature",
    explanation: "The cryptographic signature on the disclosure does not recover to the proposer address.",
  },
  {
    signature: "NonceMismatch(uint256,uint256)",
    contract: "DisclosureRegistry",
    title: "Disclosure Nonce Mismatch",
    explanation: "The provided nonce does not match the current nonce for the proposer (replay prevention).",
  },
  {
    signature: "ChallengeWindowClosed(uint256)",
    contract: "DisclosureRegistry",
    title: "Challenge Window Expired",
    explanation: "The time window for submitting challenges against this disclosure has closed.",
  },
  {
    signature: "ChallengeWindowOpen(uint256)",
    contract: "DisclosureRegistry",
    title: "Challenge Window Still Active",
    explanation: "Bond cannot be reclaimed while the challenge window is still active.",
  },
  {
    signature: "ChallengeAlreadyVerified(uint256)",
    contract: "DisclosureRegistry",
    title: "Challenge Already Verified",
    explanation: "This challenge has already been reviewed and verified.",
  },
  {
    signature: "NotVerifier(address)",
    contract: "DisclosureRegistry",
    title: "Caller Not Authorized Verifier",
    explanation: "Only the designated verifier/guardian address can verify COI challenges.",
  },
  {
    signature: "InvalidChallengeIndex(uint256)",
    contract: "DisclosureRegistry",
    title: "Invalid Challenge Index",
    explanation: "The requested challenge index does not exist for this proposal.",
  },

  // IntentGovernor errors
  {
    signature: "InvalidState(uint8,uint8)",
    contract: "IntentGovernor",
    title: "Governor Invalid State Transition",
    explanation: "The proposal state does not permit the requested lifecycle operation.",
  },
  {
    signature: "NotProposer(address,address)",
    contract: "IntentGovernor",
    title: "Caller Not Proposer",
    explanation: "Only the original author / proposer of this proposal can perform this action.",
  },
  {
    signature: "NoDisclosure(uint256)",
    contract: "IntentGovernor",
    title: "Voting Blocked: Disclosure Required",
    explanation: "Voting cannot open until a valid conflict-of-interest disclosure is registered.",
  },
  {
    signature: "DisclosureChallenged(uint256)",
    contract: "IntentGovernor",
    title: "Voting Blocked: Disclosure Flagged",
    explanation: "Voting cannot open because an undisclosed link was challenged and verified.",
  },
  {
    signature: "AlreadyVoted(address)",
    contract: "IntentGovernor",
    title: "Duplicate Vote Cast",
    explanation: "This voter address has already cast a vote on this proposal.",
  },
  {
    signature: "VotingNotOpen(uint256)",
    contract: "IntentGovernor",
    title: "Voting Period Not Active",
    explanation: "Voting is either not yet open or the voting period deadline has passed.",
  },
  {
    signature: "VotingStillOpen(uint256)",
    contract: "IntentGovernor",
    title: "Voting Still Active",
    explanation: "Cannot finalize the vote until the voting period has fully elapsed.",
  },
  {
    signature: "InsufficientVotingPower(address)",
    contract: "IntentGovernor",
    title: "Zero Voting Power",
    explanation: "The voter holds zero governance tokens at the snapshot block.",
  },
  {
    signature: "QuorumNotReached(uint256,uint256)",
    contract: "IntentGovernor",
    title: "Quorum Not Reached",
    explanation: "The total votes cast did not meet the minimum quorum threshold.",
  },
  {
    signature: "BadSignature()",
    contract: "IntentGovernor + IntentLockExecutor",
    title: "Invalid EIP-712 Signature",
    explanation: "The signature does not recover to the expected voter for this governor, or guardian for this executor.",
  },
  {
    signature: "SignatureExpired(uint256)",
    contract: "IntentGovernor + IntentLockExecutor",
    title: "EIP-712 Signature Expired",
    explanation: "The signed payload is past its deadline.",
  },
  {
    signature: "NonceUsed(address,uint256)",
    contract: "IntentGovernor + IntentLockExecutor",
    title: "EIP-712 Nonce Already Used",
    explanation: "The signed nonce is not the current on-chain nonce. The payload was replayed or is out of order.",
  },
];

export function generateErrorsMap() {
  const map: Record<
    string,
    {
      signature: string;
      contract: string;
      title: string;
      explanation: string;
    }
  > = {};

  for (const def of ERROR_DEFINITIONS) {
    const selector = ethers.id(def.signature).slice(0, 10);
    map[selector] = {
      signature: def.signature,
      contract: def.contract,
      title: def.title,
      explanation: def.explanation,
    };
  }

  const outDir = path.join(__dirname, "../packages/shared");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outPath = path.join(outDir, "errors.json");
  fs.writeFileSync(outPath, JSON.stringify(map, null, 2), "utf8");
  console.log(`Generated ${Object.keys(map).length} error definitions to ${outPath}`);
  return map;
}

if (require.main === module) {
  generateErrorsMap();
}
