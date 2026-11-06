# Person A handoff — replacing the reference model

This document is the contract between Person B's decision-integrity console and Person A's chain layer. The console is complete against fixtures and a TypeScript reference executor. Person A replaces the model with real contracts, real evidence, real traces and a real test run **without changing the UI-facing shapes** below.

Current state of this workspace:

- No Solidity, no Hardhat, no chain, no live LLM.
- `reference/executor.ts` is a TypeScript reference model.
- `packages/shared/hash.ts` is the only hashing implementation; vectors are TypeScript reference vectors.
- Scorecard: **25 PASS, 0 FAIL, 9 TEST_REQUIRED** (34 entries).
- 49 Vitest tests in 8 files pass.

Person A's job is to turn the nine amber properties green and keep every existing test meaningful.

---

## 1. What Person A must deliver

| # | Deliverable | Consumed by | Acceptance |
| :-- | :--- | :--- | :--- |
| 1 | Solidity contracts: `ProposalRegistry`, `DisclosureRegistry`, `IntentGovernor`, `IntentLockExecutor`, `ActionDecoder`, plus mocks (`MockUSDC`, `TreasuryProxy`, `MaliciousImpl`, `ReentrantRecipient`, `FeeModule`) | Local deployment, arena bridge | Red-team scenarios 0–10 behave as specified; no `delegatecall` path in the executor. |
| 2 | ABIs and `deployments/local.json` | `packages/shared/abi.ts`, `packages/shared/addresses.ts`, decoder, UI labels | `chainId`, executor address and contract addresses load from the deployment manifest; no hardcoded deployed addresses. |
| 3 | Error selector parity | `packages/shared/addresses.ts` `ERROR_DEFINITIONS`, `fixtures/errors.json`, `reference/errors.ts`, report UI | Every custom error keeps its name, signature and selector, or the change is announced and all tests/UI updated. |
| 4 | Solidity/TypeScript hash vectors | `packages/shared/hash-vectors.ts`, `fixtures/hash-vectors.json`, `tests/hash.test.ts` | Six vector keys match byte-for-byte: `intentHash`, `actionsHash`, `contentHash`, `disclosureHash`, `commitment`, `briefHash`. |
| 5 | Real evidence fixtures per scenario | `fixtures/evidence-manifest.json`, `fixtures/scenarios.json`, evidence docs | Raw calldata, commitment, revert data and tx/trace refs are real; documents remain clearly labeled seeds unless replaced. |
| 6 | Hardhat scorecard | `fixtures/scorecard.json`, `fixtures/scorecard-meta.json`, `/scorecard` | Real test run mapped to the existing entry shape; `TEST_REQUIRED` only for properties genuinely not yet tested. |
| 7 | Sentinel traces for scenarios 3, 4 and 6 | `fixtures/sentinel-trace-06.json`, scenario `context.sentinel.traceFile`, report UI | Real `callTracer` output; scenario 6 (`DELEGATECALL`) and the traces for 3/4 are not labeled as simulations. |
| 8 | `npm run arena -- <scenario>` bridge | `scripts/arena.ts`, arena UI | Runs one scenario against the local deployment and prints the raw evidence the UI consumes. Keep the script name and argument form. |
| 9 | Deployed executor adapter | `lib/demo.ts`, `reference/executor.ts` | UI receives the same `RunResult` shape; the reference model remains available as an explicit fallback. |

### `deployments/local.json` expected shape

Person A owns the exact keys, but the console needs at least this information. Announce any shape difference before B wires it.

```json
{
  "chainId": 31337,
  "deployer": "0x...",
  "deployedAt": "2026-10-25T08:00:00.000Z",
  "contracts": {
    "MockUSDC": "0x...",
    "TreasuryProxy": "0x...",
    "TreasuryImplV2": "0x...",
    "MaliciousImpl": "0x...",
    "ProposalRegistry": "0x...",
    "DisclosureRegistry": "0x...",
    "IntentGovernor": "0x...",
    "IntentLockExecutor": "0x...",
    "ActionDecoder": "0x..."
  }
}
```

If `ActionDecoder` is an internal library rather than a separately deployed contract, omit it or add it under an agreed key. Announce the final shape before B wires it.

The UI currently derives demo addresses deterministically in `packages/shared/addresses.ts`. That file is the single swap point: load real addresses and `CHAIN_ID` from the deployment manifest, keep the `ADDRESSES` and `ENTITY_LABELS` exports stable, and keep `PROPOSAL_ID = "AIP-042"` for the demo unless the fixture set is regenerated.

---

## 2. Exact swap points

| Area | File / symbol | Current behavior | Replacement rule |
| :--- | :--- | :--- | :--- |
| Execution context | `lib/demo.ts` → `buildDemo()`, `executionContext`, `runScenario(...)` loop | Builds one context from the committed intent and runs every fixture scenario through the TypeScript model. | Keep `executionContext` semantics (proposalId, chainId, executor, intent, evidenceRoot, disclosureHash, approvedCalls). Replace `runScenario` with an adapter to the deployed executor or arena bridge. Keep the returned `RunResult`. |
| Executor | `reference/executor.ts` | Full TypeScript rule/commitment/version/timelock/post-condition model. | Replace internals with a deployed-executor adapter, or keep the model behind an explicit `REFERENCE_MODEL` fallback. Do not change `RunResult`, `RunStep`, `Scenario` or `ExecutionContext` without announcing it. |
| Decoder ABI registry | `sentinel/decode.ts` → `KNOWN_ABIS` | Hand-written ERC-20, proxy, Ownable and multicall fragments. | Load Person A's ABIs plus the standard registry. Unknown selectors must still render `UNKNOWN FUNCTION 0x…` and set `unknown: true`. |
| Entity labels | `packages/shared/addresses.ts` → `ENTITY_LABELS` | Deterministic demo address labels. | Replace with deployed addresses; keep human labels (`TreasuryProxy`, `GrowthLabs Multisig`, etc.) and the `kind` field. |
| Error map | `packages/shared/addresses.ts` → `ERROR_DEFINITIONS`, then `npm run errors` → `fixtures/errors.json` | 17 stable custom errors with names, signatures and selectors. | Person A's custom errors must match. If a selector changes, regenerate `errors.json`, update report tests, and announce it. `sentinel/report.ts` maps selectors to human text via this map. |
| Scenarios | `packages/shared/fixtures/scenarios.json` | 11 synthetic scenarios, expected status/code, simulated calls and contexts. | Replace calls/contexts with real calldata and real expected results. Keep scenario `id` and `index` stable; the arena routes and scorecard IDs (`S0`–`S10`) depend on them. Add real `traceFile` refs for Sentinel scenarios. |
| Evidence | `fixtures/evidence-manifest.json`, `evidence/documents/`, `scripts/build-evidence.ts` | Four authored seeds, real hashes/Merkle root/proofs. | If real documents replace seeds, regenerate the manifest and update every source quote. If scenarios need different evidence roots, add a per-scenario root as an **announced schema extension**; the current executor context assumes one proposal-level root. |
| Hash implementation | `packages/shared/hash.ts` | TypeScript implementation of the scheme below. | Person A may take ownership, but must either match the existing vectors or deliver a versioned migration. B never reimplements hashing. |
| Hash vectors | `packages/shared/hash-vectors.ts`, `fixtures/hash-vectors.json` | TypeScript-generated reference vectors. | Generate from Solidity and replace the fixture. `tests/hash.test.ts` compares all six keys; do not edit expectations silently. |
| Sentinel trace | `fixtures/sentinel-trace-06.json` | Explicitly labeled simulated trace. | Replace with a real local/fork trace. Scenario 3 and 4 need equivalent real trace fixtures, referenced from `scenarios.json`. `reference/executor.ts` currently sets `traceRef` only for sentinel-layer runs; exposing traces for executor scenarios 3/4 is an announced additive UI change. |
| Scorecard | `scripts/scorecard.ts`, `fixtures/scorecard.json`, `fixtures/scorecard-meta.json` | In-process checks against the reference model; 9 properties emitted as `TEST_REQUIRED`. | Map the Hardhat/JSON-reporter results into `ScorecardEntry`. Keep `PASS`/`FAIL`/`TEST_REQUIRED` semantics; a property without a passing test is never `PASS`. |
| Arena bridge | `scripts/arena.ts` | Reads `getDemo()`, selects a scenario by id or index, prints raw evidence. | Replace with Person A's runner while preserving `npm run arena -- 3` and the printed sections: layer, expected/actual, steps, proposal said, actually does, evidence, report JSON. |
| Addresses / chain | `packages/shared/addresses.ts` → `CHAIN_ID`, `ADDRESSES` | `31337`, deterministic addresses. | Load from `deployments/local.json`; keep exports stable. |

**Order of operations:** land ABIs + addresses first, then error parity, then hash vectors, then real scenarios/evidence, then traces, then the scorecard, then the arena bridge. Re-run `npm test`, `npm run demo:check`, `npm run typecheck`, `npm run lint`, `npm run build` after each step.

---

## 3. The nine `TEST_REQUIRED` properties

These are the scorecard gaps. Each must become a real test, not a re-labeled reference check.

| ID | Property | Required test location (per work division) |
| :--- | :--- | :--- |
| P1 | Solidity `intentHash` is byte-identical to TypeScript | `contracts/` + `test/` |
| P2 | `ProposalRegistry` is append-only and hash-chained on-chain | `contracts/ProposalRegistry.sol` |
| P3 | The commitment cannot change after voting opens | `contracts/IntentGovernor.sol` |
| P4 | `nonReentrant` blocks a real EVM re-entrancy | `contracts/IntentLockExecutor.sol` |
| P5 | The EIP-1967 implementation post-condition holds | `contracts/IntentLockExecutor.sol` |
| P6 | Timelock and executed flag are enforced on-chain | `test/redteam/` |
| P7 | Guardian halt stops a queued proposal | `sentinel/halt.ts` |
| P8 | Sentinel fork simulation produces a real trace | `sentinel/simulate.ts` |
| P9 | `DisclosureRegistry` verifies a challenge on-chain | `contracts/DisclosureRegistry.sol` |

When a property passes, change its scorecard entry to `PASS` and set `evidenceKind` to the appropriate real-run value (`reference-model` is reserved for the model; use `unit` for Solidity unit tests or add an agreed `solidity` value with B). Do not simply delete the gap.

---

## 4. Interface rules

The console and the chain layer cross this boundary as JSON. Treat these as frozen unless a change is announced and coordinated.

1. **Do not rename** `ActionKind` values, schema fields, stage names, status values, scenario ids, error names or fixture paths without announcing it.
2. **Hash inputs and field order are frozen.** `intentHash` covers compiled rules only; sources and confidence never enter it. `contentHash` covers proposalId, version, title, projected actions and assumptions sorted by name. The commitment field order is:
   `chainId, executor, proposalKey, version, actionsHash, intentHash, evidenceRoot, disclosureHash`.
3. **`contentHash`, `disclosureHash` and `briefHash` are `keccak256` over UTF-8 canonical JSON**, not ABI-encoded. Solidity must reproduce the exact canonical JSON string (sorted keys, no whitespace, lowercased sorted wallets, bigint as decimal strings) or B must implement a versioned scheme change. This is the most likely parity trap.
4. **Error names and selectors are UI-visible.** `reference/executor.ts` also has a `CODE_LABELS` map; new error codes need a label and a `ERROR_DEFINITIONS` entry.
5. **Scenario ids and indices are stable.** The arena detail route is `/arena/<scenario.id>`; scorecard ids are `S<index>`; the demo report is `03-jargon-upgrade`.
6. **Status vocabulary is fixed:** `PASSED | REJECTED | FLAGGED` for runs, `GREEN | AMBER | RED` for stages, `PASS | FAIL | TEST_REQUIRED` for scorecard entries, `executor | sentinel | disclosure` for layers.
7. **Additive changes must be optional.** Existing fixtures and UI must keep working if a new field is absent. Breaking changes need a PR, a version bump in the relevant fixture/schema note, and updates to tests and UI in the same change.
8. **No secrets.** Do not commit private keys, RPC URLs with keys, or `.env` files. A local Hardhat deployment needs none of these.
9. **Announce before merging** any change to: `packages/shared/schemas.ts`, `packages/shared/hash.ts`, `packages/shared/addresses.ts`, `fixtures/errors.json`, `fixtures/hash-vectors.json`, `fixtures/scenarios.json`, or `reference/types.ts`.

Suggested announcement format:

```text
BREAKING INTERFACE CHANGE
Area: <schemas | hash | errors | scenarios | run result>
What changed: <field / selector / vector / scenario id>
Why: <reason>
Migration: <what B must update>
Verification: <tests run>
```

---

## 5. Current accepted schemas

These are the shapes B's UI and tests accept today. They are defined in `packages/shared/schemas.ts` and `reference/types.ts`.

```ts
type ActionKind =
  | "ERC20_TRANSFER"
  | "ERC20_APPROVE"
  | "PARAM_SET"
  | "UPGRADE"
  | "OWNERSHIP_TRANSFER"
  | "MULTICALL";

type SourceRef = {
  docKey: string;
  docHash?: `0x${string}`;   // filled by hydration
  page: number;
  section: string;
  quote: string;             // must be found verbatim in the document
  span?: [number, number];   // filled by hydration
};

type ActionSpec = {
  kind: ActionKind;
  target: `0x${string}`;
  selector: `0x${string}`;
  counterparty: `0x${string}`;
  maxAmount: string;         // decimal string, base units
  codeHash: `0x${string}` | null;
  children?: ActionSpec[];
  source: SourceRef;
  confidence: number;        // 0..1, advisory only
  label?: string;
};

type Intent = {
  proposalId: string;
  version: number;
  title: string;
  actions: ActionSpec[];
  unresolved: {
    id: string;
    question: string;
    context: string;
    source: SourceRef;
    options: { value: string; label: string; effect: string }[];
    resolution?: string;
  }[];
  assumptions: { name: string; value: string; source: SourceRef }[];
};

type Claim = {
  id: string;
  text: string;
  kind: "action" | "assumption" | "impact";
  source: SourceRef;
  confidence: number;
  support: number;
  actionIndex?: number;
  linkedUnresolvedId?: string;
};

type DecodedAction = {
  target: `0x${string}`;
  targetLabel: string;
  function: string;
  selector?: `0x${string}`;
  args: Record<string, string>;
  humanText: string;
  nested: DecodedAction[];
  unknown?: boolean;
  flag?: string;
};

type ViolationReport = {
  proposalId: string;
  scenarioId: string;
  layer: "executor" | "sentinel" | "disclosure";
  status: "REJECTED" | "FLAGGED" | "PASSED";
  proposalSaid: string;
  approved: DecodedAction[];
  submitted: DecodedAction[];
  violatedConstraint: {
    code: string;
    message: string;
    selector?: `0x${string}`;
  } | null;
  evidence: {
    commitment: `0x${string}`;
    submittedCommitment?: `0x${string}`;
    calldataHash: `0x${string}`;
    calldata: `0x${string}`;
    revertData: `0x${string}`;
    txHash: `0x${string}` | null;
    traceRef: string | null;
  };
};

type ScorecardEntry = {
  id: string;
  property: string;
  status: "PASS" | "FAIL" | "TEST_REQUIRED";
  testFile: string;
  durationMs: number;
  evidenceKind: "reference-model" | "unit" | "pending-solidity";
  reason?: string;
};

type StageScore = {
  stage: "CLAIMS" | "COI" | "VOTING" | "EXECUTION";
  score: number | null;       // EXECUTION is always null
  status: "GREEN" | "AMBER" | "RED";
  reason: string;
  factors: { label: string; value: string; weight?: string; detail?: string }[];
  drilldown: string;
};

type EvaluationChain = {
  proposalId: string;
  stages: StageScore[];       // CLAIMS, COI, VOTING, EXECUTION in order
};
```

Executor adapter boundary (`reference/types.ts`):

```ts
type EncodableCall = {
  kind: ActionKind;
  target: `0x${string}`;
  counterparty: `0x${string}`;
  amount?: string;
  maxAmount?: string;
  children?: EncodableCall[];
  variant?: string;
  extraData?: `0x${string}`;
  rawCalldata?: `0x${string}`;
  note?: string;
};

type ExecutionContext = {
  proposalId: string;
  chainId: number;
  executor: `0x${string}`;
  intent: Intent;
  evidenceRoot: `0x${string}`;
  disclosureHash: `0x${string}`;
  approvedCalls: { target: `0x${string}`; value: bigint; data: `0x${string}` }[];
};

type Scenario = {
  id: string;
  index: number;
  title: string;
  subtitle: string;
  layer: "executor" | "sentinel" | "disclosure";
  mode: "approved" | "attack" | "challenge";
  calls: EncodableCall[];
  context: {
    chainId: number;
    expectedChainId: number;
    submittedVersion: number;
    latestVersion: number;
    executed: boolean;
    now: number;
    eta: number;
    blockNumber: number;
    recipientBehavior: "REENTRANT" | null;
    sentinel: { flag: string; traceFile: string } | null;
    disclosure: { challenge: boolean; linkIds: string[] } | null;
  };
  expected: {
    status: "PASSED" | "REJECTED" | "FLAGGED";
    code: string;      // must match an ERROR_DEFINITIONS name or "OK"
    label: string;
  };
  proposalSaid: string;
  attackDescription: string;
  modelNote: string | null;
};

type RunResult = {
  scenario: Scenario;
  layer: "executor" | "sentinel" | "disclosure";
  status: "PASSED" | "REJECTED" | "FLAGGED";
  code: string;
  label: string;
  message: string;
  steps: { id: string; label: string; status: "PASS" | "FAIL" | "FLAG" | "INFO"; detail: string }[];
  approved: DecodedAction[];
  submitted: DecodedAction[];
  approvedCalls: { target: `0x${string}`; value: bigint; data: `0x${string}` }[];
  submittedCalls: { target: `0x${string}`; value: bigint; data: `0x${string}` }[];
  approvedCalldata: `0x${string}`;
  submittedCalldata: `0x${string}`;
  approvedCommitment: `0x${string}`;
  submittedCommitment: `0x${string}`;
  commitmentMatched: boolean;
  intentHash: `0x${string}`;
  approvedActionsHash: `0x${string}`;
  submittedActionsHash: `0x${string}`;
  calldataHash: `0x${string}`;
  revertData: `0x${string}`;
  txHash: `0x${string}` | null;
  traceRef: string | null;
  violatedConstraint: { code: string; message: string; selector?: `0x${string}` } | null;
  report: ViolationReport;
  notes: string[];
  challenge?: {
    score: number;
    threshold: number;
    claim: string;
    linkCount: number;
    payload: unknown;
  };
};
```

Optional voting handoff (if Person A supplies on-chain votes to the Voting stage):

```ts
type VotesFixture = {
  eligibleWeight: string;
  quorumBps: number;
  votingClosedAt: string;
  votes: {
    id: string;
    voter: `0x${string}`;
    label: string;
    weight: string;
    support: "FOR" | "AGAINST" | "ABSTAIN";
    sawCurrentBrief: boolean;
    briefVersion: number | null;
    overlap: string | null;
  }[];
};
```

---

## 6. Current hash scheme Person A must match

| Value | Construction |
| :--- | :--- |
| `ruleHash` | `keccak256(abi.encode(uint8 kind, address target, bytes4 selector, address counterparty, uint256 maxAmount, bytes32 codeHash, bytes32 childrenHash))` |
| `childrenHash` | `keccak256(abi.encode(bytes32[] childRuleHashes))`; zero hash when there are no children |
| `intentHash` | `keccak256(abi.encode(bytes32[] ruleHashes))` |
| `actionsHash` | `keccak256(abi.encode((address target, uint256 value, bytes data)[]))` |
| `commitment` | `keccak256(abi.encode(uint256 chainId, address executor, bytes32 proposalKey, uint256 version, bytes32 actionsHash, bytes32 intentHash, bytes32 evidenceRoot, bytes32 disclosureHash))`; `proposalKey = keccak256(UTF-8 proposalId)` |
| `contentHash` | `keccak256(UTF-8 canonical JSON)` of proposalId, version, title, projected actions, assumptions sorted by name |
| `disclosureHash` | `keccak256(UTF-8 canonical JSON)` of proposalId, proposer, lowercased sorted wallets, statement, signedAt |
| `briefHash` | `keccak256(UTF-8 canonical JSON)` of proposalId, version, intentHash, contentHash, evidenceRoot |
| `calldataHash` / doc hash | `keccak256(calldata)` / `keccak256(UTF-8 text)` |
| `evidenceRoot` | Merkle root of doc hashes; `keccak256(sorted(a, b))`, odd leaf duplicated |

Kind codes: transfer 1, approve 2, parameter set 3, upgrade 4, ownership transfer 5, multicall 6.

The six expected vector keys are `intentHash`, `actionsHash`, `contentHash`, `disclosureHash`, `commitment` and `briefHash`. `fixtures/hash-vectors.json` currently says: "TypeScript reference vectors. Byte-parity with a Solidity implementation is TEST_REQUIRED."

---

## 7. Checklist

Before Person A declares the swap complete:

- [ ] `deployments/local.json` exists and `packages/shared/addresses.ts` loads real `chainId` and addresses from it.
- [ ] Real ABIs are in the decoder registry; nested multicall still unwraps; unknown selectors still flag.
- [ ] Every `ERROR_DEFINITIONS` entry has a matching Solidity custom error; `npm run errors` regenerated; `tests/report.test.ts` still passes.
- [ ] `fixtures/hash-vectors.json` regenerated from Solidity; all six keys match; P1 passes.
- [ ] `fixtures/scenarios.json` carries real calldata/contexts; scenario ids and indices unchanged.
- [ ] Real raw evidence is available for every scenario: commitment, submitted commitment, calldata, calldata hash, revert data, tx hash and trace ref where applicable.
- [ ] Sentinel traces for scenarios 3, 4 and 6 are real; scenario 6 still flags `DELEGATECALL`.
- [ ] P2–P9 each has a real passing test; scorecard goes from 9 `TEST_REQUIRED` to 0 (or the remaining gap is documented and announced).
- [ ] Scorecard metadata records the real Hardhat run, not the in-process reference run.
- [ ] `npm run arena -- 3` works from a clean clone and prints the same evidence sections the UI reads.
- [ ] No schema, error name/selector, scenario id, stage name or fixture path changed without an announcement.
- [ ] `npm test` (49+ tests), `npm run demo:check`, `npm run typecheck`, `npm run lint` and `npm run build` pass.
- [ ] The UI still labels anything unproven as `TEST_REQUIRED` or `reference model`; no gap is rendered green.
- [ ] No secrets, private keys or authenticated RPC URLs are committed.

Verification commands:

```bash
npm install
npm test
npm run demo:check
npm run typecheck
npm run lint
npm run build
npm run evidence:build   # only if evidence documents changed
npm run vectors          # only after Solidity vectors are authoritative
npm run errors           # only after error definitions changed
npm run scorecard        # only after the real test run is wired
npm run arena -- 3
```

---

## 8. Escalation

If a change cannot preserve the current shapes, stop and announce it before editing B's files. The console can degrade gracefully to the reference model, but it cannot silently reinterpret a commitment, an error selector or a scorecard status. The honest fallback is a visible `TEST_REQUIRED` or `reference model` label, not a green check.
