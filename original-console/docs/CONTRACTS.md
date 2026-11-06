# Contracts

Reference for the on-chain side of AegisDAO IntentLock: what each contract does, where it
is deployed, the exact commitment that binds a vote to an action, and every custom error.

> Deployment data is generated, never hand-written. Each manifest in
> [`deployments/`](../deployments) contains the address, ABI, typed constructor arguments,
> deployment block and deploy transaction hash for every contract.

## Deployments

### Local Hardhat (chain 31337)

Latest recorded local run. Addresses change on every deployment from a fresh node — always
read `deployments/local.json` for the current ones.

| Contract | Address |
| :--- | :--- |
| MockUSDC | `0x5067457698Fd6Fa1C6964e416b3f42713513B3dD` |
| GovernanceToken | `0x18E317A7D70d8fBf8e6E893616b52390EbBdb629` |
| ProposalRegistry | `0x4b6aB5F819A515382B0dEB6935D793817bB4af28` |
| DisclosureRegistry | `0xCace1b78160AE76398F486c8a18044da0d66d86D` |
| IntentLockExecutor | `0xD5ac451B0c50B9476107823Af206eD814a2e2580` |
| IntentGovernor | `0xF8e31cb472bc70500f08Cd84917E5A1912Ec8397` |
| FeeModule | `0xc96304e3c037f81dA488ed9dEa1D8F2a48278a75` |
| TreasuryProxy | `0x34B40BA116d5Dec75548a9e9A8f15411461E8c70` |
| MaliciousImpl | `0xD0141E899a65C95a556fE2B27e5982A6DE7fDD7A` |
| ReentrantRecipient | `0x07882Ae1ecB7429a84f1D53048d35c4bB2056877` |
| VulnerableProxy | `0x22753E4264FDDc6181dc7cce468904A80a363E44` |

### Sepolia testnet (chain 11155111)

Deployed from this repository; the manifest records deployment block `11995518`.

| Contract | Address | Etherscan |
| :--- | :--- | :--- |
| MockUSDC | `0x875E3e6e170e015EaDeF85A84E07415AAD3ACcad` | [view](https://sepolia.etherscan.io/address/0x875E3e6e170e015EaDeF85A84E07415AAD3ACcad) |
| GovernanceToken | `0x7Ce32551bDE94f1f8a5BB30f91a532346Da6ae6b` | [view](https://sepolia.etherscan.io/address/0x7Ce32551bDE94f1f8a5BB30f91a532346Da6ae6b) |
| ProposalRegistry | `0xFa2e955fd4bCBE10917fD84b2948D7eDD33178C8` | [view](https://sepolia.etherscan.io/address/0xFa2e955fd4bCBE10917fD84b2948D7eDD33178C8) |
| DisclosureRegistry | `0xc2212bc1a808B5ff82a69Fddc7e0AF85C7e012f0` | [view](https://sepolia.etherscan.io/address/0xc2212bc1a808B5ff82a69Fddc7e0AF85C7e012f0) |
| IntentLockExecutor | `0xCde2c761F0b141AA8bb75473fC434C325C6b2B29` | [view](https://sepolia.etherscan.io/address/0xCde2c761F0b141AA8bb75473fC434C325C6b2B29) |
| IntentGovernor | `0x3Ea359A3470Fd9019a0a7aA1A14B3d42D5421C6a` | [view](https://sepolia.etherscan.io/address/0x3Ea359A3470Fd9019a0a7aA1A14B3d42D5421C6a) |
| FeeModule | `0x403b393f75CDE6E712A7De694BEd10eDF2983CaB` | [view](https://sepolia.etherscan.io/address/0x403b393f75CDE6E712A7De694BEd10eDF2983CaB) |
| TreasuryProxy | `0x1CA83A7DAA1b09dA7A4CAf7532456973D7E94bb3` | [view](https://sepolia.etherscan.io/address/0x1CA83A7DAA1b09dA7A4CAf7532456973D7E94bb3) |
| MaliciousImpl | `0x287fC53aA8701AE12D6b308bdeec40a0f165843E` | [view](https://sepolia.etherscan.io/address/0x287fC53aA8701AE12D6b308bdeec40a0f165843E) |
| ReentrantRecipient | `0x5f2Dd49BF5331997bd7FBc76De8d11cD22A6a0c8` | [view](https://sepolia.etherscan.io/address/0x5f2Dd49BF5331997bd7FBc76De8d11cD22A6a0c8) |
| VulnerableProxy | `0x3a66940EE5eb619cA31e969bDC8505a1Ef6c7454` | [view](https://sepolia.etherscan.io/address/0x3a66940EE5eb619cA31e969bDC8505a1Ef6c7454) |

Source verification is not recorded in the manifest. Run `npm run verify:sepolia` to publish
it; the script reads constructor arguments from the manifest and prints the Etherscan URLs.

## Contracts

| Contract | Purpose | Key functions | Notable properties |
| :--- | :--- | :--- | :--- |
| [`ProposalRegistry.sol`](../contracts/ProposalRegistry.sol) | Append-only, hash-chained proposal versions | `createProposal`, `addVersion`, `latestVersionHash`, `getVersionChain`, `verifyChain` | Versions are immutable; each new version commits `prevVersionHash`; anyone can recompute the chain from events |
| [`DisclosureRegistry.sol`](../contracts/DisclosureRegistry.sol) | Forced conflict-of-interest disclosure and challenges | `submitDisclosure` (EIP-712), `fileChallenge`, `verifyChallenge`, `hasDisclosure`, `isChallenged` | Governor cannot open voting without a disclosure; optional bond is slashed to a verified challenger |
| [`IntentGovernor.sol`](../contracts/IntentGovernor.sol) | Voting on a commitment, not a summary | `submitProposal`, `openVoting`, `castVote`, `voteWithBrief`, `voteBySig`, `finalizeVote`, `queueForExecution`, `syncFromExecutor` | Commitment is fixed when voting opens; informed-vote ratio; EIP-712 relayed votes (`IntentVote`) |
| [`IntentLockExecutor.sol`](../contracts/IntentLockExecutor.sol) | The hard gate: queue, verify, enforce, execute, halt | `queue`, `execute`, `halt`, `haltBySig`, `cancel`, `setGovernor` | Recomputed commitment + rule enforcement + timelock + `nonReentrant`; executed flag set before external calls; guardian can only halt |
| [`libs/ActionDecoder.sol`](../contracts/libs/ActionDecoder.sol) | Typed rule enforcement | `enforce`, `hashRules`, per-kind decoders | Only `call`; unknown selectors rejected; recursive multicall depth ≤ 2; bounded approvals |
| [`CommitmentHasher.sol`](../contracts/CommitmentHasher.sol) | Reference hasher used by parity tests | `hashActions`, `computeCommitment` | Byte-for-byte reference for the TypeScript implementation |
| Test helpers | Demo targets and attacks | `MockUSDC`, `FeeModule`, `TreasuryProxy`, `MaliciousImpl`, `ReentrantRecipient`, `VulnerableProxy`, `RevertingView` | Not part of the guarantee; used by the Red-Team Arena |

## The commitment

A vote authorizes this hash, and the executor recomputes it from the submitted bytes:

```solidity
commitment = keccak256(abi.encode(
    COMMIT_TYPEHASH,
    block.chainid,      // prevents cross-chain replay
    address(this),      // binds to this executor
    proposalId,
    version,
    versionHash,        // ties to the hash-chained registry entry
    actionsHash,        // exact targets, values, calldata hashes, in order
    intentHash,         // keccak256(abi.encode(rules)) — the stated intent
    disclosureHash      // the COI disclosure voters saw
));
```

- `actionsHash = keccak256(abi.encodePacked(leaves))`, where each leaf is
  `keccak256(abi.encode(target, value, keccak256(data)))`.
- Changing any field — a target, value, byte of calldata, rule, disclosure, version, chain or
  the executor address — changes the commitment, so execution fails.
- `intentHash == keccak256(abi.encode(rules))` is verified before any rule is trusted.

### A registry version

```solidity
struct Version {
    bytes32 prevVersionHash;            // 0x0 for v1
    bytes32 contentHash;                // hash of the proposal text
    bytes32 evidenceRoot;               // Merkle root of the evidence manifest
    bytes32 financialAssumptionsHash;
    bytes32 technicalAssessmentHash;
    bytes32 intentHash;                 // confirmed structured intent
    bytes32 disclosureHash;             // the disclosure voters saw
    uint64  timestamp;
    address author;
}
```

## State machines (real enum names)

**IntentGovernor.GovProposalState** — `Draft`, `DisclosurePending`, `VotingOpen`,
`Defeated`, `Passed`, `Queued`, `Executed`, `Halted`, `Cancelled`.

**IntentLockExecutor.ProposalState** — `Empty`, `Queued`, `Executed`, `Halted`, `Cancelled`.

The governor mirrors the executor through `syncFromExecutor`; the executor never reads the
governor's state to decide execution, so a governor bug cannot widen the gate.

## Custom errors

Every revert uses a named error with the violated constraint in its arguments. The catalog is
generated from the contracts (`npm run generate:errors`) into
[`packages/shared/errors.json`](../packages/shared/errors.json) and consumed by the Sentinel,
the preview and the console, so no layer re-implements error text.

| Error | Contract | Meaning |
| :--- | :--- | :--- |
| `BadCalldataLength(uint256,uint256)` | ActionDecoder | The calldata byte length does not match the expected ABI specification for this action. |
| `CodeHashMismatch(bytes32,bytes32)` | ActionDecoder | The extcodehash of the upgrade implementation does not match the cryptographic hash committed in intent. |
| `ExceedsSpendLimit(uint256,uint256)` | ActionDecoder | The execution amount exceeds the maximum ceiling authorized by the committed intent rule. |
| `MulticallChildCountMismatch(uint8,uint256)` | ActionDecoder | The multicall payload contains a different number of inner calls than the committed child rules. |
| `MulticallDepthExceeded(uint256)` | ActionDecoder | Multicall nesting exceeds the maximum allowed recursion depth of 2. |
| `SelectorNotAllowed(bytes4,bytes4)` | ActionDecoder | The calldata calls a function selector that does not match the committed intent rule. |
| `UnauthorizedImplementation(address,address)` | ActionDecoder | The proposed upgrade target implementation address was not approved in the committed intent. |
| `UnauthorizedNewOwner(address,address)` | ActionDecoder | The recipient of ownership transfer does not match the authorized address in the intent. |
| `UnauthorizedRecipient(address,address)` | ActionDecoder | The transaction recipient does not match the counterparty committed in the proposal intent. |
| `UnauthorizedTarget(address,address)` | ActionDecoder | The call target contract address does not match the committed intent rule target. |
| `UnknownActionKind(uint8)` | ActionDecoder | The specified action kind is not a valid `ActionKind` value. |
| `UnlimitedApprovalNotCommitted(address)` | ActionDecoder | Calldata requested `type(uint256).max` approval, which was not explicitly committed. |
| `ChallengeAlreadyVerified(uint256)` | DisclosureRegistry | This challenge has already been verified. |
| `ChallengeWindowClosed(uint256)` | DisclosureRegistry | The challenge window for this disclosure has closed. |
| `ChallengeWindowOpen(uint256)` | DisclosureRegistry | The bond cannot be reclaimed while the challenge window is open. |
| `DisclosureAlreadySubmitted(uint256)` | DisclosureRegistry | A disclosure already exists for this proposal. |
| `InvalidChallengeIndex(uint256)` | DisclosureRegistry | The requested challenge index does not exist. |
| `InvalidSignature()` | DisclosureRegistry | The disclosure signature does not recover to the proposer. |
| `NoDisclosureFound(uint256)` | DisclosureRegistry | No disclosure has been submitted for this proposal. |
| `NonceMismatch(uint256,uint256)` | DisclosureRegistry | The disclosure nonce is not the proposer's current nonce (replay prevention). |
| `NotVerifier(address)` | DisclosureRegistry | Only the verifier can verify challenges. |
| `AlreadyVoted(address)` | IntentGovernor | This voter already voted on this proposal. |
| `DisclosureChallenged(uint256)` | IntentGovernor | Voting cannot open because a verified challenge flags the disclosure. |
| `InsufficientVotingPower(address)` | IntentGovernor | The voter holds zero governance tokens. |
| `InvalidState(uint8,uint8)` | IntentGovernor | The governor state does not permit the requested operation. |
| `NoDisclosure(uint256)` | IntentGovernor | Voting cannot open without a disclosure. |
| `NotProposer(address,address)` | IntentGovernor | Only the proposal author can perform this action. |
| `QuorumNotReached(uint256,uint256)` | IntentGovernor | Total votes did not meet quorum. |
| `VotingNotOpen(uint256)` | IntentGovernor | Voting is not open, or the deadline has passed. |
| `VotingStillOpen(uint256)` | IntentGovernor | The vote cannot be finalized before the period ends. |
| `BadSignature()` | IntentGovernor, IntentLockExecutor | The EIP-712 signature does not recover to the expected voter or guardian. |
| `NonceUsed(address,uint256)` | IntentGovernor, IntentLockExecutor | The signed nonce is not current; the payload was replayed or is out of order. |
| `SignatureExpired(uint256)` | IntentGovernor, IntentLockExecutor | The signed payload is past its deadline. |
| `ActionExecutionFailed(uint256,address,bytes)` | IntentLockExecutor | An external call reverted during execution. |
| `AlreadyQueued(bytes32)` | IntentLockExecutor | This commitment is already queued. |
| `CommitmentMismatch(bytes32,bytes32)` | IntentLockExecutor | The recomputed commitment does not match the voted commitment. |
| `DelayOutOfRange(uint256,uint256,uint256)` | IntentLockExecutor | The timelock delay is outside `[minDelay, maxDelay]`. |
| `IntentHashMismatch(bytes32,bytes32)` | IntentLockExecutor | `keccak256(abi.encode(rules))` does not match the committed `intentHash`. |
| `NotGovernor(address)` | IntentLockExecutor | Only the governor can queue proposals. |
| `NotGuardian(address)` | IntentLockExecutor | Only the guardian can halt. |
| `NotQueued(bytes32)` | IntentLockExecutor | The commitment is not in the `Queued` state. |
| `PostConditionFailed(string,bytes)` | IntentLockExecutor | A post-condition check failed after the actions ran. |
| `ProposalNotInState(uint8,uint8)` | IntentLockExecutor | The proposal is not in the required state for this operation. |
| `RuleLengthMismatch(uint256,uint256)` | IntentLockExecutor | The number of actions does not match the number of top-level rules. |
| `TimelockNotExpired(uint256,uint256)` | IntentLockExecutor | `block.timestamp < eta`; execution is premature. |
| `VersionSuperseded(uint256,bytes32,bytes32)` | IntentLockExecutor | A newer registry version exists; the voted version is stale. |

## EIP-712 payloads

| Type | Domain name | Fields |
| :--- | :--- | :--- |
| `IntentVote` | `AegisIntentGovernor` | `govId, commitment, support, briefHash, statement, nonce, deadline` |
| `IntentHalt` | `AegisIntentLockExecutor` | `commitment, reportHash, reason, nonce, deadline` |
| `Disclosure` | `AegisDAO DisclosureRegistry` | `proposalId, proposer, walletListHash, interestsHash, bondAmount, nonce` |

Votes and halts can be relayed: a funded relayer submits an already-signed payload and never
sees the signer's key. The console labels the signer path (`DEV SIGNER`, `BROWSER WALLET`,
`HARDWARE`) on every receipt; see [HARDWARE.md](HARDWARE.md).
