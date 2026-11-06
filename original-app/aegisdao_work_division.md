# AegisDAO IntentLock: Work Division for Two People

This document splits the project into two ownership areas with a clean interface between them, so both people can work in parallel without blocking each other.

| | **Person A: Chain & Security Engineer** | **Person B: Intelligence & Experience Engineer** |
| :--- | :--- | :--- |
| **Owns** | Smart contracts, tests, Red-Team Arena, Sentinel simulation and halting | Evidence store, AI intent drafting, calldata decoder and report generator, wallet graph, Evaluation Chain scoring, entire frontend, demo data |
| **Stack** | Solidity, Hardhat, TypeScript, ethers v6 | TypeScript, LLM API, Next.js/React, Tailwind, graph library |
| **Core promise** | "The executor genuinely rejects anything outside the commitment." | "Anyone can see, understand, and verify why." |
| **Primary risk** | Contract correctness and test coverage | Integration with real contract outputs; UI polish |

**Principle:** A produces *truth* (contracts, test results, simulation output). B turns truth into *understanding* (decoded text, reports, scores, UI). B never needs to wait for A, because everything crosses the boundary as agreed JSON schemas and fixtures (Section 1).

---

## 1. The Interface Contract (agree on this first, together)

Before splitting, both people sit together and fix these artifacts. Everything else is independent.

### 1.1 Repo layout and ownership

```
aegisdao/
├── contracts/              [A]
├── test/                   [A]
├── sentinel/
│   ├── simulate.ts         [A]
│   ├── diff.ts             [A]
│   ├── halt.ts             [A]
│   ├── decode.ts           [B]
│   └── report.ts           [B]
├── packages/shared/
│   ├── hash.ts             [A] (commitment + intentHash in TS, parity-tested vs Solidity)
│   ├── schemas/            [joint, frozen after handshake]
│   └── fixtures/           [A produces real, B produces mock until real lands]
├── ai/                     [B]
├── evidence/               [B]
├── graph/                  [B]
├── chain-scoring/          [B]
├── app/                    [B]
└── README.md               [joint]
```

Rule: **only the owner edits their folders.** Changes needed in the other person's area go through a short message or a PR.

### 1.2 Frozen JSON schemas

**(a) Intent specification** (B produces, A consumes via `hash.ts`)

```json
{
  "proposalId": "string",
  "version": 1,
  "title": "string",
  "actions": [
    {
      "kind": "ERC20_TRANSFER | ERC20_APPROVE | PARAM_SET | UPGRADE | OWNERSHIP_TRANSFER | MULTICALL",
      "target": "0x...",
      "selector": "0x........",
      "counterparty": "0x...",
      "maxAmount": "string (wei/base units)",
      "codeHash": "0x... or null",
      "children": [ "...nested actions for MULTICALL..." ],
      "source": { "docHash": "0x...", "page": 3, "section": "2", "span": [120, 188] },
      "confidence": 0.94
    }
  ],
  "unresolved": [ { "question": "string", "source": {} } ],
  "assumptions": [ { "name": "string", "value": "string", "source": {} } ]
}
```

**(b) Decoded action** (B's `decode.ts` output, used in reports and UI)

```json
{
  "target": "0x...",
  "targetLabel": "TreasuryProxy",
  "function": "upgradeTo(address)",
  "args": { "newImplementation": "0x..." },
  "humanText": "Upgrades TreasuryProxy to implementation 0xBAD...",
  "nested": []
}
```

**(c) Violation Report** (A supplies raw evidence, B's `report.ts` assembles the final report)

```json
{
  "proposalId": "string",
  "scenarioId": "string",
  "layer": "executor | sentinel",
  "status": "REJECTED | FLAGGED | PASSED",
  "proposalSaid": "string",
  "approved": [ "DecodedAction" ],
  "submitted": [ "DecodedAction" ],
  "violatedConstraint": { "code": "UnauthorizedRecipient", "message": "string" },
  "evidence": {
    "commitment": "0x...",
    "calldataHash": "0x...",
    "calldata": "0x...",
    "revertData": "0x...",
    "txHash": "0x... or null",
    "traceRef": "path or null"
  }
}
```

**(d) Scorecard** (A's test runner emits it, B renders it)

```json
[
  { "id": "S1", "property": "Approved transfer succeeds", "status": "PASS | FAIL | TEST_REQUIRED", "testFile": "string", "durationMs": 120 }
]
```

**(e) Evaluation Chain output** (B produces and renders)

```json
{
  "proposalId": "string",
  "stages": [
    { "stage": "CLAIMS", "score": 0.82, "status": "AMBER", "reason": "2 unresolved claims", "factors": [], "drilldown": "ref" },
    { "stage": "COI", "score": 0.71, "status": "RED", "reason": "1 undisclosed link", "factors": [], "drilldown": "ref" },
    { "stage": "VOTING", "score": 0.64, "status": "AMBER", "reason": "informed ratio 58%", "factors": [], "drilldown": "ref" },
    { "stage": "EXECUTION", "score": null, "status": "GREEN | RED", "reason": "deterministic match", "factors": [], "drilldown": "ref" }
  ]
}
```

### 1.3 Parity test vectors (critical)

The commitment and `intentHash` must be byte-identical in Solidity and TypeScript. A owns `packages/shared/hash.ts` and a **test vectors file** (`fixtures/hash-vectors.json`) containing input → expected hash, generated from the Solidity side. B only ever calls `hash.ts`; B never reimplements hashing.

### 1.4 Handshake deliverables (done jointly before splitting)

- [ ] Schemas (a) to (e) committed and frozen.
- [ ] Repo skeleton and branch strategy set.
- [ ] Action kinds and rule fields agreed (they drive both the contract and the AI extraction).
- [ ] Seed scenario written in plain English: the proposal, the proposer, the recipient, the attack payloads, the hidden wallet link.
- [ ] Mock fixtures: B creates mock versions of (c), (d), (e) so the frontend can be built from day one.

---

## 2. Person A: Chain & Security Engineer

**Mission:** Make the on-chain guarantee real, reproducible, and demonstrably unbreakable within the stated model.

### A1. Core contracts

| Contract | Responsibilities | Done when |
| :--- | :--- | :--- |
| `ProposalRegistry.sol` | Append-only hash-chained versions: `prevVersionHash`, `contentHash`, `evidenceRoot`, `financialAssumptionsHash`, `technicalAssessmentHash`, `intentHash`, `disclosureHash`, timestamp, author. `latestVersion(id)` view. | Cannot edit or delete a version; chain verifiable from events. |
| `DisclosureRegistry.sol` | Proposer submits signed wallet disclosure (EIP-712) + optional bond. `disclosureHash` stored. Challenge function: anyone submits an undisclosed-link claim with tx proof references during the challenge window; verified challenge flags the proposal. | Voting cannot open without a disclosure; challenge flips proposal to flagged. |
| `IntentGovernor.sol` | Voting on a **commitment**, snapshot-based weights, quorum, `voteWithBrief(proposalId, support, briefHash)` that records the brief version seen. State machine: Draft → DisclosurePending → VotingOpen → Passed → Queued → Executed / Halted / Defeated. | Commitment immutable after voting opens; any change forces a new version and a new round. |
| `IntentLockExecutor.sol` | Commitment verification, rule enforcement, timelock, `nonReentrant`, executed-flag-before-call, version supersession check, post-condition checks, guardian `halt`/`cancel` (halt only, cannot execute). | Every Red-Team scenario behaves as specified. |
| `libs/ActionDecoder.sol` | Decoding per action kind: transfer (length 68, selector check, `data[4:]` decode), approve (bounded, exact spender), upgrade (exact implementation + `extcodehash`), ownership transfer (exact new owner), recursive multicall (depth ≤ 2, each child matched to a child rule). | Unknown selector, wrong recipient, over-limit amount, nested hidden call all revert with specific custom errors. |

**Design rules for A to hold the line on:**

- Only `call`. No `delegatecall` path exists.
- `intentHash == keccak256(abi.encode(rules))` is verified before any rule is trusted.
- Use **custom errors with the violated constraint** (e.g. `UnauthorizedRecipient(address)`, `ExceedsSpendLimit(uint256)`). B's report generator maps these error selectors to human text, so they must be stable and documented.
- Post-conditions revert the whole transaction: owner/admin unchanged unless a rule says otherwise, allowance ≤ committed ceiling, treasury balance delta ≤ sum of `maxAmount`, EIP-1967 implementation equals committed address where verifiable.

### A2. Test helpers (malicious and mock contracts)

`MockUSDC`, `TreasuryProxy` (upgradeable), `MaliciousImpl` (with delegatecall and selfdestruct), `ReentrantRecipient`, `VulnerableProxy` (documented storage layout for the local Red-Team environment), `FeeModule` (for the benign "parameter tuning" case).

### A3. Red-Team Arena test suite

One test file per scenario in `test/redteam/`:

| # | Scenario | Expected |
| :--- | :--- | :--- |
| 0 | Benign 5,000 USDC transfer to approved dev wallet | Succeeds |
| 1 | Post-vote recipient substitution | Reverts: commitment mismatch |
| 2 | Amount inflation | Reverts: commitment mismatch / spend limit |
| 3 | Jargon upgrade (`upgradeTo(maliciousImpl)`) | Reverts: no rule / code hash not approved |
| 4 | Nested multicall hiding `transferOwnership` | Reverts: recursive rule enforcement |
| 5 | Unlimited `approve` disguised as payment | Reverts: approve bounds |
| 6 | Delegatecall payload | Not executable; Sentinel flags in trace |
| 7 | Re-entrancy via recipient contract | Reverts |
| 8 | Early execution, double execution, cross-chain replay | Reverts |
| 9 | Stale version executed after supersession | Reverts |
| 10 | Hidden COI (undisclosed link) | Disclosure Challenge flags proposal |

Plus unit tests for: commitment changes when **any** field changes (target, value, calldata, intent, disclosure, version, chain id, executor address), registry immutability, and state-machine transitions.

**Scorecard emitter:** a script that runs the suite (Hardhat JSON reporter) and writes schema (d). Any property without a passing test is emitted as `TEST_REQUIRED`.

### A4. Shared hashing package

`packages/shared/hash.ts`: `computeIntentHash(intent)`, `compileRules(intent)`, `computeActionsHash(actions)`, `computeCommitment(...)`. Parity tests against Solidity outputs using `hash-vectors.json`. Also exports the `ActionRule[]` compiled from intent JSON so B's pipeline can produce on-chain-ready data.

### A5. Sentinel (simulation and halting)

| File | Responsibility |
| :--- | :--- |
| `simulate.ts` | `evm_snapshot` → send the exact proposed transaction on local/forked Hardhat → `debug_traceTransaction` with `callTracer` → collect call tree, delegatecalls, events, storage changes → `evm_revert`. |
| `diff.ts` | Compare before/after: token balances, owner/admin, role holders, allowances, EIP-1967 implementation slot. Compare against committed rules and invariants. Output a machine-readable list of violations. |
| `halt.ts` | On violation, call guardian `halt(proposalId, reportHash)`. Watch queued proposals during the timelock. |

**Fallback if trace parsing is slow:** drop to fork-based simulation comparing balance/ownership/storage diffs only. The on-chain executor's guarantees do not depend on Sentinel.

**Static bytecode scan:** scan proposed implementation/target code for `DELEGATECALL`, `SELFDESTRUCT`, `CALLCODE` and compare `extcodehash` to the committed value. Output feeds the same violation list.

### A6. A's outputs delivered to B (the handoff list)

1. Deployed contract ABIs and addresses (local Hardhat deployment script `deploy.ts` writes `deployments/local.json`).
2. Real fixtures replacing B's mocks: sample violation evidence (raw revert data, calldata, commitment, tx hash) for every Red-Team scenario.
3. Scorecard JSON from the real test run.
4. Error selector → meaning map (`errors.json`).
5. `hash.ts` and `hash-vectors.json`.
6. Sentinel raw output JSON for scenarios 3, 4, 6.
7. A script `npm run arena -- <scenarioId>` that runs one scenario and prints raw evidence, which B's UI calls via a small local API.

### A7. A's definition of done

- [ ] All scenario tests pass; scorecard generated from real run.
- [ ] Commitment parity between Solidity and TypeScript proven by vectors.
- [ ] Sentinel flags scenarios 3, 4, 6 and halts a queued proposal.
- [ ] No test relies on mocks of the executor's own checks.
- [ ] `deploy.ts` and `npm run arena` work from a clean clone.

---

## 3. Person B: Intelligence & Experience Engineer

**Mission:** Turn fragmented governance data into an understandable, verifiable decision trail, and make the invisible gap between "what was said" and "what would execute" impossible to miss.

### B1. Evidence store and ingestion (`evidence/`)

- Content-addressed store: hash every ingested document (forum post snapshot, the vague external PDF, financial model).
- Build the **evidence manifest Merkle tree**; produce `evidenceRoot` for A's registry. A thin helper that exports the root and per-document proofs.
- "Verify source" function in the UI: re-hash a cited document locally and match it to the anchored hash.
- Seed documents for the demo: a forum post, a deliberately vague PDF, a financial assumptions sheet.

### B2. AI intent drafting (`ai/`)

- Prompt and strict JSON-schema output for Intent specification (schema a).
- **Every claim must carry a source reference** `(docHash, page, section, span)`; claims without one are rejected by a validator and marked `UNRESOLVED`.
- Ambiguity detection: recurring vs one-time, unclear recipients, missing amounts, undefined parameters → `unresolved[]`.
- **Treasury impact brief:** amounts, recipients, dependencies, runway effect, each figure linked to its source.
- **Human confirmation step:** a reviewer UI that requires resolving or explicitly accepting each `UNRESOLVED` item; on confirm, call A's `hash.ts` to get `intentHash` and compiled rules.
- **Fallback:** pre-baked extraction output stored as fixtures so the demo never depends on live API latency. The live path and the baked path use the same schema.

### B3. Calldata decoder and report generator (`sentinel/decode.ts`, `sentinel/report.ts`)

**`decode.ts`:**

- Local ABI registry for the demo contracts (using A's ABIs) plus a small standard registry (ERC-20, proxies, multicall).
- Selector → function name → typed args → `humanText`.
- **Recursive multicall unwrapping** so nested calls appear as a tree.
- Unknown selectors rendered as `UNKNOWN FUNCTION 0x…` and flagged, never silently hidden.

**`report.ts`:**

- Takes A's raw evidence and the approved intent, produces the Violation Report (schema c).
- Maps A's custom error selectors (via `errors.json`) to human-readable constraint text.
- Produces the **"proposal said" vs "actually does"** comparison, including the jargon side-by-side.
- Report is deterministic code, not LLM text. (Optionally the LLM rephrases the headline, but evidence fields are always code-derived.)

### B4. Wallet graph and COI scoring (`graph/`)

- Seeded simulated dataset: proposer, disclosed wallets, intermediary, recipient, funders, with realistic transaction hashes, amounts, and timestamps. **All labeled SIMULATED DATA.**
- Link finder: direct transfer, common funder, shared deployer/signer, time-correlated transfers.
- Link strength per type and the **noisy-OR** aggregation: `R = 1 − Π(1 − s_j)`, with an undisclosed multiplier.
- Disclosed vs discovered classification by comparing against the on-chain `disclosureHash` payload.
- Output: nodes, edges (with tx evidence), per-link score, overall `R`, and the explicit disclosure-challenge payload A's contract accepts.
- Cautious language everywhere: "potential conflict, supporting transactions attached."

### B5. Evaluation Chain engine (`chain-scoring/`)

Implements the four stages and emits schema (e):

| Stage | Input | Method |
| :--- | :--- | :--- |
| Claims (`C`) | B2 output | `c_i = extraction_confidence × evidence_support`, mean; unresolved and unsupported counts |
| COI (`R`) | B4 output | Noisy-OR with undisclosed multiplier |
| Voting (`V`) | On-chain vote data (via A's contracts) | Quorum/margin, informed-vote ratio from `voteWithBrief`, concentration, overlap with flagged wallets |
| Execution (`D`) | A's executor/Sentinel result | Deterministic 0/1 hard gate; shows simulation confidence separately |

Each stage includes `factors[]` so the UI can show *why*.

### B6. Frontend (`app/`)

| Screen / component | Content |
| :--- | :--- |
| **Decision Trail (home)** | Horizontal pipeline Claims → COI → Voting → Execution with status color, score, one-line reason, drilldown. First thing judges see. |
| **Proposal timeline** | Hash-chained version history with hashes, diffs between versions, evidence documents with "verify source". |
| **AI intent review** | Extracted claims with source links, `UNRESOLVED` flags, confirm/resolve controls, resulting `intentHash`. |
| **Disclosed vs Discovered graph** | Interactive graph with tx hash tooltips, SIMULATED DATA badge, challenge button. |
| **Informed Voting Mode** | One-page risk brief, vote with acknowledgment, attention queue ranking proposals by risk. |
| **Red-Team Arena** | List of scenarios, "Run attack" button, live result: ✅ succeeded / ❌ rejected by executor / ⚠️ simulation detected. Layer labels always shown. |
| **Intent Violation Explainer** | The structured report: proposal said vs actually does, violated constraint, evidence links. |
| **Governance Security Scorecard** | Rendered from A's scorecard JSON; `TEST_REQUIRED` shown as amber, never green. |

**UI rules:**

- "Simulation detected" and "Rejected by executor" are visually distinct labels.
- Every number has a "why" drilldown.
- Everything built against mock fixtures first, then swapped to A's real fixtures.

### B7. Demo assets

- Demo script (Section 5), seeded scenario data, pre-baked AI output, backup recorded run, README quickstart.

### B8. B's definition of done

- [ ] Intent extraction yields source-linked claims and unresolved items; confirmation produces a hash that matches A's contract.
- [ ] Decoder shows the jargon-vs-reality gap for scenarios 3 and 4.
- [ ] Graph shows an undisclosed link with real-looking transaction records.
- [ ] Decision Trail renders all four stages from real data.
- [ ] Arena and Scorecard are driven by A's real outputs, not mocks.
- [ ] Entire demo runs on pre-baked data if the network or LLM fails.

---

## 4. Dependencies and Sync Points

```
Handshake (joint) ─┬─► A: contracts → tests → Sentinel
                   └─► B: evidence → AI → decoder → graph → scoring → UI (on mocks)

Sync 1: A delivers hash.ts + vectors ───────► B wires intent confirmation to real hashing
Sync 2: A delivers ABIs + errors.json ──────► B finalizes decoder and report generator
Sync 3: A delivers real fixtures + scorecard ► B swaps mocks for real data in UI
Sync 4: Sentinel output (scenarios 3,4,6) ──► B connects flag/halt display
Sync 5: Full integration run ──► both fix bugs together, rehearse demo
```

| Dependency | Direction | Mitigation if late |
| :--- | :--- | :--- |
| `hash.ts` and vectors | A → B | B uses a stub that returns deterministic placeholder hashes behind the same function signature |
| ABIs and `errors.json` | A → B | B decodes using hand-written ABI fragments for the demo contracts |
| Real violation evidence | A → B | B builds from mock fixtures matching schema (c) |
| Scorecard JSON | A → B | B renders mock scorecard; swaps in later |
| Intent JSON | B → A | A tests with hand-written intent JSON fixtures |
| Disclosure/challenge payload format | B → A | A defines the on-chain struct; B conforms |

---

## 5. Demo Roles

| Segment | Presenter | Support |
| :--- | :--- | :--- |
| Problem framing and Decision Trail overview | B | A |
| Proposal with jargon, AI draft with unresolved flags, version history | B | A (shows hash chain on-chain) |
| Forced disclosure and undisclosed link in graph | B | A (challenge flag on-chain) |
| Informed vote | B | A |
| Attack launch: payload swap, hidden upgrade in multicall | A | B (decoded side-by-side) |
| Sentinel flag and guardian halt | A | B (report UI) |
| Executor revert and Violation Report | A | B |
| Benign transfer succeeds, scorecard from live test run | A | B |
| Limitations slide and closing line | Both | |

**Closing line:** *"Voting transparency isn't informed consent. We made the vote bind to the exact action, and we make the evidence, the conflicts, and the execution verifiable."*

---

## 6. Working Agreements

- **Branches:** `main` is always demo-able. `a/*` and `b/*` feature branches, merge via PR with a quick review by the other person.
- **Contract changes:** any change to schemas, action kinds, error names, or commitment fields is announced immediately, because it breaks the other side.
- **No hardcoded results:** scorecard and arena results always come from real runs. If something is not yet tested, it displays `TEST_REQUIRED`.
- **Fixture discipline:** fixtures live in `packages/shared/fixtures/`, versioned, one file per scenario.
- **Stuck rule:** if blocked on the other person for more than a short while, switch to the mitigation in Section 4 and keep moving.
- **Integration rehearsal:** at least two full end-to-end demo runs before presenting, one on live components and one on the pre-baked fallback.

---

## 7. Balance Check and Flex Tasks

Person A carries the highest-risk work (contracts, security, simulation). Person B carries the broadest work (AI, graph, scoring, UI). To keep load even:

- **If A finishes early:** A takes the Evaluation Chain's Voting stage (on-chain data reading), Sentinel UI hooks, and more Red-Team scenarios (e.g. approval-then-drain, timelock edge cases).
- **If B finishes early:** B helps with test fixtures, malicious helper contracts, and README/architecture diagrams.
- **If either falls behind:** cut order is Informed Voting attention queue, then extra Red-Team scenarios beyond the required ones (0, 1, 3, 4, 5, 10), then graph polish. Never cut contract tests or the Violation Explainer.

---

## 8. Combined Definition of Done

- [ ] Commitment parity between Solidity and TypeScript proven.
- [ ] Benign transfer succeeds; required attacks (1, 3, 4, 5) revert; scenario 10 flags.
- [ ] Sentinel flags and halts the jargon-upgrade proposal.
- [ ] Violation Report shows the jargon beside the decoded reality.
- [ ] Decision Trail shows Claims → COI → Voting → Execution from real data.
- [ ] Scorecard generated from the real test run.
- [ ] Demo runs end-to-end live and on fallback data.
- [ ] Limitations slide ready: restricted action model, simulation is early warning, simulated wallet data, AI is advisory.
