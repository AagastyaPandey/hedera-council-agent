# Architecture

How the pieces fit together, and where each piece lives in the repository.

## System map

```mermaid
flowchart LR
    subgraph Inputs
        A["Forum post snapshot"]
        B["PDF, financial model, audit"]
        C["Wallet and transfer data"]
    end

    subgraph Intelligence["Intelligence layer (advisory)"]
        D["Evidence store<br/>keccak256 docs + Merkle root"]
        E["Intent drafting<br/>source-linked claims + UNRESOLVED flags"]
        F["COI graph<br/>noisy-OR link scoring"]
        G["Evaluation chain<br/>claims, COI, voting, execution"]
        P["Pre-vote effect preview<br/>snapshot simulation"]
    end

    subgraph Chain["On-chain enforcement"]
        H["ProposalRegistry<br/>hash-chained versions"]
        I["DisclosureRegistry<br/>forced disclosure + challenges"]
        J["IntentGovernor<br/>votes on the commitment"]
        K["Timelock queue"]
        L["IntentLockExecutor<br/>typed rule enforcement"]
    end

    subgraph Off["Off-chain enforcement"]
        M["Sentinel<br/>decode, scan, simulate, diff"]
        N["Guardian key<br/>halt only"]
    end

    U["Console UI<br/>Decision Trail, Proposals, Arena,<br/>Disclosure, Voting, Scorecard, Status"]

    A --> D
    B --> D
    D --> E
    E --> H
    D --> H
    E --> G
    C --> F
    F --> I
    F --> G
    D --> I
    H --> J
    I --> J
    J --> K
    K --> M
    M -->|clean| L
    M -->|violation| N
    N -->|halt| L
    L -->|reverts| M
    L -->|executes| U
    J --> G
    M --> G
    P --> G
    H --> U
    I --> U
    J --> U
    L --> U
    G --> U
    P --> U
```

The arrow that matters: **the LLM and the scores never touch the executor**. Only the
commitment and the typed rules decide whether bytes run.

## One proposal, end to end

```mermaid
sequenceDiagram
    autonumber
    participant P as Proposer
    participant UI as Console
    participant R as ProposalRegistry
    participant D as DisclosureRegistry
    participant G as IntentGovernor
    participant V as Voters
    participant S as Sentinel
    participant X as IntentLockExecutor
    participant GD as Guardian

    P->>UI: Ingest post + PDF
    UI->>UI: Draft source-linked intent, mark UNRESOLVED
    P->>UI: Confirm intent, resolve items
    UI->>R: createProposal(contentHash, evidenceRoot, intentHash, disclosureHash)
    P->>D: submitDisclosure (EIP-712 signed wallet list)
    D-->>G: hasDisclosure and disclosureHash
    P->>G: submitProposal(versionHash, actionsHash, intentHash, disclosureHash)
    P->>G: openVoting(govId)
    UI->>UI: Pre-vote effect preview of the committed calldata
    V->>G: voteWithBrief(govId, support, briefHash covering the preview)
    G->>G: finalizeVote after voteEnd
    G->>X: queueForExecution (commitment, timelock)
    S->>X: read ProposalQueued, decode calldata
    S->>S: snapshot, simulate, diff, trace, revert
    alt simulation clean
        X->>X: execute after timelock, enforcement passes
    else violation detected
        S->>GD: signed violation report
        GD->>X: halt(commitment, reportHash)
        UI->>X: forced execute attempt reverts with the violated constraint
    end
```

## Proposal state machines

Governor states (`IntentGovernor.GovProposalState`):

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> DisclosurePending: submitProposal
    DisclosurePending --> VotingOpen: openVoting (needs disclosure)
    VotingOpen --> Passed: finalizeVote, quorum and majority
    VotingOpen --> Defeated: finalizeVote, quorum or majority fails
    Passed --> Queued: queueForExecution
    Queued --> Executed: syncFromExecutor
    Queued --> Halted: syncFromExecutor
    Queued --> Cancelled: cancelProposal
    Defeated --> [*]
    Executed --> [*]
    Halted --> [*]
    Cancelled --> [*]
```

Executor states (`IntentLockExecutor.ProposalState`):

```mermaid
stateDiagram-v2
    [*] --> Empty
    Empty --> Queued: queue, governor only
    Queued --> Executed: execute, after eta, all checks pass
    Queued --> Halted: halt, guardian only
    Queued --> Cancelled: cancel by governor
    Executed --> [*]
    Halted --> [*]
    Cancelled --> [*]
```

## Three enforcement layers

| Layer | Where | Role | Trust level |
| :--- | :--- | :--- | :--- |
| Protected Executor | On-chain (`IntentLockExecutor` + `ActionDecoder`) | Reverts anything outside the commitment and the typed rules | Cryptographic and deterministic. This is the security claim. |
| Sentinel | Off-chain (`sentinel/`), simulation on Hardhat or a Sepolia fork | Early warning, evidence, plain-English explanation, guardian halt | Deterministic checks, limited to what simulation can observe |
| AI drafting, scoring, preview commentary | Off-chain (`intelligence/`, `sentinel/preview.ts`) | Helps humans read and compare; never approves or enforces | Advisory. Every output is source-linked or simulation-derived, and a human confirms the intent |

## The commitment

The vote binds: chain id, executor address, proposal id, version, version hash, actions hash,
intent hash and disclosure hash. The full formula, the `Version` struct and the reasoning are
in [CONTRACTS.md](CONTRACTS.md#the-commitment).

## Evaluation chain

```mermaid
flowchart LR
    C["Claims C<br/>mean of confidence x evidence support"] --> R["COI R<br/>noisy-OR with undisclosed penalty"]
    R --> V["Voting V<br/>harmonic mean of quorum, informed,<br/>concentration, COI overlap"]
    V --> D["Execution D<br/>deterministic 0 or 1"]
    D -->|D = 1| HALT["Hard stop: no execution"]
    D -->|D = 0| OK["Executed"]
    C -.->|advisory| OK
    R -.->|advisory| OK
    V -.->|advisory| OK
```

`intelligence/chain.ts` implements the four scorers; `sentinel/preview.ts` feeds the claims
factor with real simulation mismatches. The formulas and thresholds are documented in the
README's evaluation-chain section and in the source (`CONFIG` at the top of `chain.ts`).

## Module map

| Concern | Code |
| :--- | :--- |
| Contracts and tests | `contracts/`, `test/redteam/` |
| Commitment hashing (Solidity + TypeScript parity) | `contracts/CommitmentHasher.sol`, `packages/shared/hash.ts`, `test/commitment-parity.test.ts` |
| Evidence store, Merkle manifest, source verification | `intelligence/evidence.ts`, `intelligence/evidence-verify.ts` |
| Intent drafting, confirmation, bridging to rules | `intelligence/ai-draft.ts`, `intelligence/intent-bridge.ts` |
| COI graph and noisy-OR | `intelligence/graph.ts` |
| Evaluation chain | `intelligence/chain.ts` |
| Local benefit classifier and decision CLI | `intelligence/tiny-model.ts`, `intelligence/recommendation.ts`, `scripts/decide.ts` |
| Sentinel decode, scan, simulate, diff, trace, halt | `sentinel/` |
| Pre-vote effect preview | `sentinel/preview.ts`, `sentinel/preview-cli.ts` |
| Snapshot mutex shared by preview, watcher and arena | `sentinel/mutex.ts` |
| Shared schemas, fixtures, error catalog | `packages/shared/` |
| Contract-wired console (Next.js) | `app/` |
| Editorial console, atlas and Ledger signing (Next.js) | `console/` |
| Deploy, seed, verify, preview recording | `scripts/` |
| Deployment manifests (addresses, ABIs, args, blocks) | `deployments/` |
