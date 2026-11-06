# Start here — direction for Person A

This branch (`main`) holds the Solidity side: contracts, Hardhat, red-team tests, sentinel.
**Person B's console — the Next.js app, hashing reference, fixtures and the seven demo routes —
lives on the `person-b` branch.** They are not merged yet; see the note at the bottom.

Read this before adding more contracts. It covers what is already solved elsewhere, what to build
first, and the five traps that will cost you a day each.

Written 2026-10-25 after an audit of the Person B workspace and a prior-art review.

---

## 1. Fix the pitch before you write more Solidity

The obvious framing — "we bind the governance vote to the exact calldata" — is **already solved
and has been since 2020.** OpenZeppelin's Governor derives the proposal id from the encoded calls:

```solidity
hashProposal(address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash)
```

Compound Governor Bravo does the equivalent. In those systems the vote *is* over the exact bytes.

In Tornado Cash (May 2023) the malicious calldata **was** in the proposal, and the vote **did**
bind to it. What failed was that nobody could read it, nothing required the description to match
it, and the code at an approved address changed *after* approval.

**Our claim, in one sentence:** the binding exists; comprehension, evidence and code identity at
execution time do not.

---

## 2. Prior art — know what you are standing on

| System | Already does | Leaves open |
| :--- | :--- | :--- |
| Compound / OZ Governor | Proposal id = hash of calldata | Description is a separate string |
| Tally | Decodes actions, simulates proposals | Advisory; the governor never consults it |
| Tenderly, OZ Defender | Fork simulation, state diffs | Catches reverts, not intent mismatch |
| Etherscan diff, OpenChain | Bytecode diff, calldata decoding | Manual; you have to know to look |
| **Zodiac Roles Modifier** | Enforces calldata-level permissions at execution — target, function, parameter conditions, allowances | Enforces a **standing policy**, not a **per-proposal commitment** |
| Forta | Runtime monitoring | After the fact |

Zodiac Roles is the nearest neighbour and the proof that enforcement works in production. The
distinction: Roles says *"this role may call `transfer` up to X, ever."* We say *"this specific vote
authorised these exact bytes, and anything else is refused."*

### The problem is peer-reviewed, at scale

"Understanding Security Issues in the DAO Governance Process" — IEEE Transactions on Software
Engineering, 2025 (SUSTech / PolyU / Zhejiang). Its third research question is literally *"Does
Proposal ensure consistency between descriptions and code?"*

- Dataset: 3,348 DAOs, 65,436 proposals, 9 blockchains.
- **32,500 proposals — over 90% of those examined — had descriptions inconsistent with their code.**
- 176 DAOs allowed external entities to control the governance contract.
- The authors state the issue "has not been explored in prior research."

They built **detection**. Nobody in that line built **enforcement**. That is the space.

---

## 3. Where the work actually is

**a. The commitment object.** Binding `evidenceRoot` and `disclosureHash` into the same struct the
vote signs is the novel part. No existing system commits to the *documents* behind a proposal or to
the proposer's *disclosed wallets*.

**b. Refusal semantics.** Not "does it transfer the right amount" — any treasury tool does that.
The interesting property is refusing *uncommitted shapes*: an upgrade nobody voted for, a hidden
multicall child, a re-entrant recipient, a superseded version.

**c. Code identity at execution time.** The Tornado Cash lesson, and the reason the EIP-1967
post-condition matters. Committing to an *address* is not enough: an attacker can `selfdestruct`
and redeploy different code at the same address. Read `extcodehash` at execution and compare it to
the committed hash. Do not verify code at proposal time and assume it still holds.

---

## 4. Build order

| Order | Deliverable | Why |
| ---: | :--- | :--- |
| 1 | **Hash vectors / commitment parity** | Everything downstream is meaningless if `intentHash` differs by one byte. |
| 2 | **`IntentLockExecutor`** — timelock, executed flag, re-entrancy, code identity, post-conditions | This is the guarantee. |
| 3 | **`ProposalRegistry` / `IntentGovernor`** | Largely Governor-shaped — reuse, don't reinvent. |
| 4 | **`DisclosureRegistry`** | Small, but the only on-chain part of the conflict-of-interest story. |
| 5 | **Real traces for scenarios 3/4/6** | Demo credibility, not guarantee. |
| 6 | **Real evidence fixtures** | Same category. |
| 7 | **Arena bridge** | Plumbing. Last. |

Do **not** start by re-deriving `proposalId`. Wire the existing Governor and focus on the
commitment and the executor.

---

## 5. Five traps that cost a day each

**1. `abi.encode` only — never `abi.encodePacked`.**
The TypeScript reference uses `encodeAbiParameters`, which is `abi.encode`. Packed encoding
produces different bytes and fails parity silently. Same for `bytes32[]`: pass the array to
`abi.encode`, do not concatenate.

**2. Canonical JSON is the hardest part of parity, not the ABI encoding.**
Three of the six vectors — `contentHash`, `disclosureHash`, `briefHash` — are
`keccak256(UTF-8 canonical JSON)`, not `abi.encode`. The TypeScript is authoritative and is defined
in `canonicalJson()` on the `person-b` branch: keys sorted, no whitespace, `bigint` as a decimal
string, `undefined` dropped. Reproducing `JSON.stringify` escaping byte-for-byte in Solidity is
where parity will break. Either implement a minimal canonical encoder and pin it with vectors, or
compute those three off-chain and pass them in as `bytes32`. Decide deliberately.

**3. `bytes4` is right-padded in `abi.encode`.**
`bytes32(selector)` and `abi.encode(selector)` are not the same thing. Use a real `bytes4`.

**4. Set the executed flag before the external call.**
Checks-effects-interactions. Mark executed after the call and a re-entrant recipient gets a second
execution. `nonReentrant` is defence in depth, not the primary fix.

**5. EIP-1967 has three slots, not one.**
Implementation (`0x360894a1…`), admin (`0xb5312768…`), beacon (`0xa3f0ad74…`). Assert the slot you
care about *after* the call, and make sure the admin slot is not left pointing somewhere unexpected.

---

## 6. Make the tests able to fail

The negative cases matter more than the positive ones:

- an uncommitted selector must revert `SelectorNotAuthorized`
- a hidden multicall child must revert `NestedCallNotAuthorized`
- an implementation whose `extcodehash` changed must revert `CodeHashMismatch`
- a superseded version must revert `StaleVersion`
- a re-entrant recipient must revert `ReentrancyDetected`

If a test cannot be made to fail, it is not testing anything. This repo's audit exists because two
scorecard rows were passing without being able to fail — and that was treated as a bug.

---

## 7. What this system cannot catch — say it before someone else does

- **A vote that honestly authorises something bad.** If the description matches the calldata and
  the vote passes, it executes. We bind intent to action; we do not judge the intent.
- **Evidence that is self-authored but internally consistent.** The Merkle root proves the documents
  did not change after signing. It does not prove they are true.
- **A compromised executor or governor.** If the enforcement layer is upgradeable by an attacker,
  none of this holds.
- **Social capture of delegates.** The informed-vote receipt raises the cost of voting blind. It
  does not stop a delegate voting against their mandate with their eyes open.

---

## 8. Repository layout (important)

| Branch | Contents |
| :--- | :--- |
| `main` | This branch: Solidity contracts, Hardhat, red-team tests, sentinel, deployments. |
| `person-b` | The Next.js console, hashing reference, fixtures, 7 demo routes, docs, audit. |

They are currently **separate histories** — `main` was replaced by an orphan commit, so the two
halves do not share ancestry. Before the final submission they need to be reconciled into one tree
(or a deliberate two-repo layout). Overlapping paths that must be reconciled by hand:
`package.json`, `tsconfig.json`, `packages/shared/hash.ts`, `packages/shared/errors.json`,
`sentinel/`, and `scripts/`.

The console degrades gracefully to its TypeScript reference model — that is a supported state. It
cannot silently reinterpret a commitment, an error selector or a scorecard status.
