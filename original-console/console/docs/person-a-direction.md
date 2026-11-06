# Person A — direction, prior art, and where the value actually is

Read this before `docs/person-a-handoff.md`. The handoff tells you *what interfaces to match*.
This tells you *what to build first, what not to rebuild, and where the traps are*.

Written 2026-10-25 after an audit of the Person B workspace and a prior-art review.

---

## 1. Correct the pitch before you write any Solidity

The obvious framing — "we bind the governance vote to the exact calldata" — is **already solved
and has been since 2020.** OpenZeppelin's Governor derives the proposal id from the encoded
calls:

```solidity
hashProposal(address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash)
```

Compound Governor Bravo does the equivalent. In those systems the vote *is* over the exact bytes.
If we claim otherwise, the first judge who knows governance contracts will catch it, and the whole
project loses credibility.

So state the gap precisely. In Tornado Cash (May 2023) the malicious calldata **was** in the
proposal and the vote **did** bind to it. What failed was that nobody could read it, nothing
required the description to match it, and the code at an approved address changed *after*
approval.

**Our claim, in one sentence:** the binding exists, but comprehension, evidence and code identity
at execution time do not. That is what this system adds.

---

## 2. Prior art — know what you are standing on

| System | What it already does | What it leaves open |
| :--- | :--- | :--- |
| Compound / OZ Governor | Proposal id = hash of calldata | Description is a separate string; nothing reconciles the two |
| Tally | Decodes actions, simulates proposals, proposal builder | Advisory display; the Governor never consults it |
| Tenderly, OZ Defender | Fork simulation, state diffs | Catches reverts and side effects, not intent mismatch |
| Etherscan diff, OpenChain | Bytecode diff, calldata decoding | Manual; you have to know to look |
| **Zodiac Roles Modifier** | Enforces calldata-level permissions at execution — target, function, parameter conditions, allowances | Enforces a **standing policy**, not a **per-proposal commitment** |
| Forta | Runtime monitoring | After the fact |

Zodiac Roles is the nearest neighbour and the proof that enforcement works in production. The
distinction to hold onto: Roles says *"this role may call `transfer` up to X, ever."* We say
*"this specific vote authorised these exact bytes, and anything else is refused."* Per-role
policy versus per-proposal commitment.

### The problem is peer-reviewed, at scale

"Understanding Security Issues in the DAO Governance Process" — IEEE Transactions on Software
Engineering, 2025 (SUSTech / PolyU / Zhejiang University). Its third research question is
literally *"Does Proposal ensure consistency between descriptions and code?"*

- Dataset: 3,348 DAOs, 65,436 proposals, 9 blockchains.
- **32,500 proposals — over 90% of those examined — had descriptions inconsistent with their code.**
- 176 DAOs allowed external entities to control the governance contract.
- Only 71 of 3,348 DAOs documented their governance process.
- The authors state the issue "has not been explored in prior research."

They built **detection**. Nobody in that line of work built **enforcement**. That is the space.

---

## 3. Where the work actually is

Three things are genuinely unoccupied. Spend your effort here and nowhere else.

**a. The commitment object.** Binding `evidenceRoot` and `disclosureHash` into the same struct the
vote signs is the novel part. No existing system commits to the *documents* behind a proposal or
to the proposer's *disclosed wallets*. This is cheap to build and is the actual invention.

**b. The executor's refusal semantics.** Not "does it transfer the right amount" — any treasury
tool does that. The interesting property is that it refuses *uncommitted shapes*: an upgrade
nobody voted for, a hidden multicall child, a re-entrant recipient, a superseded version.

**c. Code identity at execution time.** This is the Tornado Cash lesson and the reason P5 exists.
Committing to an *address* is not enough: an attacker can `selfdestruct` and redeploy different
code at the same address. You must read `extcodehash` at execution and compare it to the committed
hash. Do not verify code at proposal time and assume it holds later.

---

## 4. Build order

The handoff lists nine deliverables. They are not equal. Do them in this order.

| Order | Deliverable | Why this position |
| ---: | :--- | :--- |
| 1 | **Solidity hash vectors (P1)** | Everything downstream is meaningless if `intentHash` differs by one byte. Until parity holds, the commitment is a number nobody can verify. |
| 2 | **`IntentLockExecutor` + EIP-1967 post-condition (P4, P5, P6)** | This is the guarantee. Timelock, executed flag, re-entrancy, code identity, post-conditions. |
| 3 | **`ProposalRegistry` / `IntentGovernor` (P2, P3)** | Append-only chain and commitment immutability. Note this is largely Governor-shaped — reuse, don't reinvent. |
| 4 | **`DisclosureRegistry` (P9)** | Challenge verification. Small, but it is the only on-chain part of the COI story. |
| 5 | **Real traces for 3/4/6 (P8)** | Demo credibility, not guarantee. Cheap once the executor runs. |
| 6 | **Real evidence fixtures per scenario** | Same category — quality of demonstration. |
| 7 | **`npm run arena` bridge** | Plumbing. Do it last; it consumes everything above. |

Do **not** start by re-deriving `proposalId`. Wire the existing Governor and focus on the
commitment and the executor.

---

## 5. Five traps that will cost you a day each

**1. `abi.encode` only — never `abi.encodePacked`.**
Every hash in `packages/shared/hash.ts` uses `encodeAbiParameters`, which is `abi.encode`. Packed
encoding produces different bytes and will silently fail parity. Same for `bytes32[]`: pass the
array itself to `abi.encode`, do not concatenate.

**2. Canonical JSON is the hardest part of P1, not the ABI encoding.**
Three of the six vectors — `contentHash`, `disclosureHash`, `briefHash` — are
`keccak256(UTF-8 canonical JSON)`, not `abi.encode`. The TypeScript is authoritative and is
defined in `canonicalJson()`: keys sorted, no whitespace, `bigint` as a decimal string, `undefined`
dropped. Reproducing `JSON.stringify` escaping rules byte-for-byte in Solidity is painful and is
where parity will break. Two honest options: implement a minimal canonical encoder and pin it with
test vectors, or compute those three hashes off-chain and pass them in as `bytes32`. Decide
deliberately and document the choice — do not discover it at integration time.

**3. `bytes4` is right-padded in `abi.encode`.**
A selector occupies the first four bytes of a 32-byte word. `bytes32(selector)` and
`abi.encode(selector)` are not the same thing. Use `abi.encode` with a real `bytes4`.

**4. Set the executed flag before the external call.**
Checks-effects-interactions. If you mark executed after the call, a re-entrant recipient gets a
second execution. `nonReentrant` is defence in depth, not the primary fix.

**5. EIP-1967 has three slots, not one.**
Implementation (`0x360894a1…`), admin (`0xb5312768…`) and beacon (`0xa3f0ad74…`). Your
post-condition must assert the slot you actually care about *after* the call, and the admin slot
must not be left pointing somewhere unexpected. The simulated trace in
`fixtures/sentinel-trace-06.json` already uses the implementation slot — match it.

---

## 6. Give yourself a red/green target

The fastest way to know you are done is a conformance suite you can run, not a document you read.

`npm run scorecard` already runs 34 in-process checks and turns green only when they pass. Extend
the same idea: for each of P1–P9, a test that **fails today** and passes when the contract is
correct. The negative cases matter more than the positive ones:

- an uncommitted selector must revert `SelectorNotAuthorized`
- a hidden multicall child must revert `NestedCallNotAuthorized`
- an implementation whose `extcodehash` changed must revert `CodeHashMismatch`
- a superseded version must revert `StaleVersion`
- a re-entrant recipient must revert `ReentrancyDetected`

If a test cannot be made to fail, it is not testing anything. That principle is why this repo has
a `docs/audit-2026-10-25.md` — two scorecard rows were passing without being able to fail, and
that was treated as a bug.

---

## 7. What this system cannot catch — say it before someone else does

Build these limits into how you describe the product. They are not flaws to hide; they are the
boundary of the claim.

- **A vote that honestly authorises something bad.** If the description matches the calldata and
  the vote passes, the commitment holds and the action executes. We bind intent to action; we do
  not judge whether the intent is wise.
- **Evidence that is self-authored but internally consistent.** The Merkle root proves the
  documents did not change after signing. It does not prove they are true. A proposer who writes
  their own four documents gets a valid root over fiction.
- **A compromised executor or governor.** If the enforcement layer itself is upgradeable by an
  attacker, none of this holds. That is why P3 (commitment immutability) is a security property,
  not a nicety.
- **Social capture of delegates.** The informed-vote receipt raises the cost of voting blind. It
  does not stop a delegate voting against their mandate with their eyes open.

---

## 8. Definition of done

The swap is complete when all of these are true, and not before:

- `npm test`, `npm run demo:check`, `npm run typecheck`, `npm run lint`, `npm run build` all pass.
- `fixtures/hash-vectors.json` is regenerated from Solidity; all six keys match byte-for-byte.
- The scorecard goes from 9 `TEST_REQUIRED` to 0, with a real Hardhat run recorded in
  `scorecard-meta.json`.
- `npm run arena -- 3` runs against a local deployment and prints the same evidence sections the
  UI reads.
- Nothing in `ERROR_DEFINITIONS`, the scenario ids, the stage names or the fixture paths changed
  without an announcement.

If you cannot preserve a shape, stop and say so. The console degrades gracefully to the reference
model — that is a supported state. It cannot silently reinterpret a commitment, an error selector
or a scorecard status.
