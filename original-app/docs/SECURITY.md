# Security model

What the system guarantees, what it assumes, what it refuses, and what it does not catch.
Every claim below is backed by a test or by code you can read.

## Guarantees

1. **The vote binds to the exact execution package.** Target, value, calldata, typed rules,
   disclosure, proposal version, chain id and executor address all enter the commitment. The
   executor recomputes it from the submitted bytes and reverts on any difference
   (`CommitmentMismatch`, `IntentHashMismatch`).
2. **Only committed shapes execute.** A call is allowed only if it matches a typed rule from
   the committed intent. Unknown selectors, unapproved recipients, over-ceiling amounts,
   unapproved implementations, unapproved ownership transfers and hidden multicall children
   revert before the call is made.
3. **Code identity is checked at execution time.** An `UPGRADE` rule may pin the
   implementation's `extcodehash`; a contract whose code changed after the vote does not match
   (`CodeHashMismatch`).
4. **State cannot be replayed or raced.** `block.timestamp < eta` reverts, the executed flag
   is set before external calls, `nonReentrant` guards `execute`, the chain id is in the
   commitment, and a superseded version cannot execute.
5. **Voting cannot open without a disclosure**, and a verified disclosure challenge blocks
   voting (`NoDisclosure`, `DisclosureChallenged`).
6. **The guardian can only halt.** `halt`/`haltBySig` change only `Queued → Halted`. A guardian
   signature cannot execute, edit or substitute a commitment.

## Assumptions

- The governance token, registry, governor and executor are deployed and configured correctly
  (constructor arguments are recorded in the deployment manifest).
- The guardian key is not compromised at the same time as the governor. **The guardian can
  also call `setGovernor`** — this is a deliberate recovery lever in the current code, and it
  means the guardian is not strictly halt-only at the contract level. Treat guardian
  compromise as a full trust failure, or transfer the role to a multisig.
- Voters read the brief they acknowledge. The contract records *that* a brief hash was signed;
  it cannot prove comprehension.
- Evidence documents were hashed before signing. The Merkle root proves the documents did not
  change after signing; it does not prove they are true.

## Threat model

| Attack | Blocked by | Test |
| :--- | :--- | :--- |
| Recipient swapped after the vote | Commitment mismatch, rule counterparty | [`scenario1-recipient-swap.test.ts`](../test/redteam/scenario1-recipient-swap.test.ts) |
| Amount inflated | Commitment mismatch + `ExceedsSpendLimit` | [`scenario2-amount-inflation.test.ts`](../test/redteam/scenario2-amount-inflation.test.ts) |
| "Routine tuning" hides `upgradeTo(malicious)` | No matching rule; `SelectorNotAllowed` / `UnauthorizedImplementation`; code hash pinning | [`scenario3-jargon-upgrade.test.ts`](../test/redteam/scenario3-jargon-upgrade.test.ts) |
| Hidden `transferOwnership` inside `multicall` | Recursive child-rule enforcement, depth ≤ 2, child-count check | [`scenario4-nested-multicall.test.ts`](../test/redteam/scenario4-nested-multicall.test.ts) |
| Unlimited approval disguised as a payment | `UnlimitedApprovalNotCommitted` + bounded approve rule | [`scenario5-unlimited-approve.test.ts`](../test/redteam/scenario5-unlimited-approve.test.ts) |
| Payload routed via `delegatecall` | Executor has no delegatecall path; Sentinel flags it in the trace and bytecode scan | [`scenario6-delegatecall-payload.test.ts`](../test/redteam/scenario6-delegatecall-payload.test.ts) |
| Recipient re-enters `execute` | Executed flag set before the call + `nonReentrant` | [`scenario7-reentrancy.test.ts`](../test/redteam/scenario7-reentrancy.test.ts) |
| Early execution, double execution, cross-chain replay | Timelock, executed flag, `chainid` in the commitment | [`scenario8-timelock-replay.test.ts`](../test/redteam/scenario8-timelock-replay.test.ts) |
| Execute a stale version after a new revision | `VersionSuperseded` against the registry | [`scenario9-stale-version.test.ts`](../test/redteam/scenario9-stale-version.test.ts) |
| Hidden conflict of interest | Forced disclosure, challenge, `isChallenged` blocks voting | [`scenario10-hidden-coi.test.ts`](../test/redteam/scenario10-hidden-coi.test.ts) |
| Mutated preview calldata | `hashActions` compared with the committed `actionsHash` before simulating | [`preview.test.ts`](../test/preview.test.ts) (mutated-calldata case) |
| Replayed or forged relayed vote/halt | EIP-712 domain, deadline, per-signer nonce, guardian check | [`signature-flows.test.ts`](../test/redteam/signature-flows.test.ts) (HS1–HS7, HH1–HH4) |

## Red-Team Arena

Every scenario is a real Hardhat test and a button in the console. Latest run in this
workspace: **20 scenario tests passing, scorecard 11 PASS / 0 FAIL**.

| # | Scenario | Expected | Actual |
| :--- | :--- | :--- | :--- |
| 0 | Benign 5,000 USDC transfer | Succeeds | PASS |
| 1 | Post-vote recipient substitution | Reverts | PASS |
| 2 | Amount inflation | Reverts | PASS |
| 3 | Jargon upgrade (`upgradeTo`) | Reverts | PASS |
| 4 | Nested multicall hiding `transferOwnership` | Reverts | PASS |
| 5 | Unlimited `approve` | Reverts | PASS |
| 6 | Delegatecall payload | Not executable; Sentinel flags | PASS |
| 7 | Re-entrancy | Reverts | PASS |
| 8 | Early/double execution, cross-chain replay | Reverts | PASS |
| 9 | Stale version | Reverts | PASS |
| 10 | Hidden COI link | Flagged | PASS |

Scorecard snapshot (durations from the latest stored run):

| ID | Property | Status | Duration |
| :--- | :--- | :--- | ---: |
| S0 | Benign transfer succeeds | PASS | 740 ms |
| S1 | Post-vote payload substitution rejected | PASS | 387 ms |
| S2 | Amount inflation rejected | PASS | 333 ms |
| S3 | Unauthorized upgrade rejected | PASS | 825 ms |
| S4 | Hidden ownership transfer in multicall rejected | PASS | 2118 ms |
| S5 | Unlimited approval rejected | PASS | 301 ms |
| S6 | Delegatecall payload not executable | PASS | 225 ms |
| S7 | Re-entrancy rejected | PASS | 166 ms |
| S8 | Early execution, double execution, and cross-chain replay rejected | PASS | 465 ms |
| S9 | Stale version rejected | PASS | 189 ms |
| S10 | Hidden conflict-of-interest link flagged | PASS | 116 ms |

Regenerate it with the real suite:

```bash
npm run arena      # writes packages/shared/scorecard.json from the run
```

`scripts/scorecard-reporter.js` marks any property without a passing test as
`TEST_REQUIRED`; the console renders that amber, never green.

## Pre-vote effect preview

The preview is deterministic and read-only by construction:

- It verifies the calldata against the committed `actionsHash`, the rules against
  `intentHash`, and the recomputed commitment before simulating.
- It opens an `evm_snapshot`, impersonates the executor inside the snapshot, executes the
  actions, captures before/after state, and **always reverts** in a `finally` block — also
  when an action reverts or a read fails. `preview.test.ts` asserts balances, owner,
  implementation slot, nonce and `eth_blockNumber` are unchanged afterwards.
- A file lock (`sentinel/mutex.ts`) serialises snapshots with the Sentinel watcher and the
  arena runner, so two previews cannot interleave on one node.
- Anything it could not read — including functions a contract does not implement — is listed
  in `unobserved`. It is never reported as zero.
- It cannot run without `evm_snapshot`. On a plain JSON-RPC endpoint it returns `UNAVAILABLE`
  instead of risking state.

## What this does NOT catch

- **A vote that honestly authorizes something bad.** If the description matches the calldata
  and the vote passes, it executes. IntentLock binds intent to action; it does not judge intent.
- **Evidence that is self-authored but internally consistent.** Hashing proves the documents
  did not change, not that they are true.
- **A compromised governor or executor.** If the enforcement layer is replaced by an attacker,
  none of this holds. A guardian-key compromise is worse: the guardian can rotate the governor.
- **Social capture of delegates.** The informed-vote receipt raises the cost of voting blind; it
  does not stop a delegate voting against their mandate with their eyes open.
- **Arbitrary-bytecode safety.** The executor enforces a restricted, typed action model. It does
  not prove that a contract you legitimately call is safe. `PARAM_SET` binds the selector and,
  when `maxAmount > 0`, the first `uint256` argument only.
- **Stale-state post-conditions.** Post-conditions currently cover ERC-20 allowance ceilings.
  Owner/admin, treasury balance delta and EIP-1967 implementation are not re-asserted after
  the call; implementation identity is enforced *before* the call via `codeHash`.
- **Multicall routing assumptions.** Child rules are matched against the decoded inner calls, and
  the inner call is executed by the multicall contract itself. This matches the demo helpers
  (self-delegatecall), and nesting deeper than 2 is rejected.
- **Simulation as a guarantee.** The Sentinel sees what a fork can observe. Its trace support
  depends on the node; without `debug_traceTransaction` it records that gap in `unobserved`.
- **Wallet-graph ground truth.** Addresses, amounts and timestamps are **SIMULATED DATA**, and
  link strengths are transparent heuristics. Output is "potential conflict, evidence attached".
- **AI truth.** Drafts are heuristic or **PRE-BAKED** fixtures. No LLM is in the enforcement
  path; a human confirms the intent.
- **Formal verification or audit.** There is none. The Sepolia deployment is a testnet demo, not
  a production governance system.
- **Storage invariants outside the watch list.** The preview watches a computed set of
  contracts and accounts; storage it does not read is not compared.
