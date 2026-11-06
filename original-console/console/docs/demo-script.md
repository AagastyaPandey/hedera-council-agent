# AIP-042 demo script — Person B

Five minutes, seven app routes, one hard gate. Judge Mode walks them for you. This is a rehearsable click path with the numbers the app actually computes. Do not improvise claims about a chain, a live model or a deployed contract.

**Before you start**

```bash
npm install
npm run dev
```

Open `http://localhost:3000` for the Atlas, or go straight to `http://localhost:3000/trail` for the Decision Trail. Confirm `npm test` is green (57 tests) and, if you changed fixtures, run `npm run demo:check`. Have a terminal in the repo root as backup for `npm run arena -- 3`.

**One rule for the whole demo:** say "reference executor" or "executor model", never "the contract rejected it on-chain". Say "the wallet graph is simulated data with real link math", never "we proved they colluded".

## New judge-facing layer

- **Judge Mode:** click **Judge** in the header. The bottom bar walks the seven stops. Use **Next/Back** or `Alt+←/→`; `Esc` exits. **Present** opens the deck.
- **Presentation:** `/present` is a seven-slide, fully offline deck. Arrow keys or space advance; `F` toggles fullscreen. Each slide links to its live screen; the final slide downloads the report.
- **Downloadable report:** on `/arena/03-jargon-upgrade`, use the **Takeaway** panel: **Download report** (self-contained HTML) or **JSON**. The HTML carries the proposal quote, decoded submitted call, committed actions, every check, the violated constraint, the evidence hashes, and the reference-model note.

---

## 0:00–0:35 — `/trail` Decision Trail

**Click:** land on `/trail`. Do not scroll yet.

**Say:**
> "AIP-042 passed. It authorized 250,000 USDC: 200,000 to GrowthLabs, 50,000 to Developer Guild, and a 5,000 allowance. The queued transaction is an `upgradeTo` on the treasury proxy. The proposal never authorized an upgrade."

Point at the red banner and the four stages.

**Expected values:**
- Claims **0.81 GREEN**; COI **0.88 RED**; Voting **0.71 AMBER**; Execution **— RED**.
- Execution has no score because it is a hard gate, not a weighted average.
- Banner: execution blocked; disclosure challenge open.

**Say:**
> "Three advisory stages tell you how much to trust the decision. Execution is binary. That is the design."

---

## 0:35–1:35 — `/intent` Intent review

**Click:** nav **Intent**. Point at the claim list, then click **Prefill sourced** in the right-hand review panel. Watch the hashes and the rule count change. Then click **Confirm intent**.

**Say:**
> "Seven claims, all seven tied to an exact document quote. The validator rejects anything without a span. The extractor also produced a tentative upgrade at 42% confidence — that is the ambiguity a human must resolve."

**Expected values:**
- `7/7 source-linked`, `2 open ambiguities`, `1 low confidence`.
- Before review: 4 rules including `TENTATIVE — possible implementation upgrade`; claims **0.63 AMBER**.
- After **Prefill sourced**: 3 rules; claims **0.81 GREEN**; `intentHash`, `contentHash` and `commitment` all show **match** / `matches v3`.
- Treasury brief: 250,000 total, 5,000 allowance, runway **7.8 months** after funding at 122,000/month burn.
- Confirm button becomes enabled only when all three hashes match.

**Say:**
> "The reviewer is not approving a summary. They are producing the exact rule set the vote binds to. Reject the tentative upgrade and the intent hash moves; authorize it and the commitment no longer matches v3. Either way, a different decision needs a new version and a new vote."

---

## 1:35–2:05 — `/timeline` Version chain and evidence

**Click:** nav **Timeline**. Point at v1 → v2 → v3. Open the v3 "all anchors" disclosure if time allows. Click **Verify all** in the evidence section.

**Say:**
> "Three versions, hash-chained. v2 to v3 added the technical assessment and a sourced assumption. The rules did not change, so the intent hash is identical — but the content hash, evidence root and commitment all moved."

**Expected values:**
- v2 and v3 `intentHash` both `0x6a729404…`; `contentHash` differs (`0x0ec959bc…` vs `0x03aa5fec…`).
- Merkle root `0x7e4bcf6f…`; after **Verify all**, **4/4 verified**, each with a valid proof.
- Disclosure hash `0x11761372…`; challenge filed by Aegis Watch.
- Be explicit: documents are authored demo seeds; their hashes and proofs are real computation.

**Say:**
> "Anyone can re-hash the document locally. If the bytes change, the proof fails. If the root changes, the commitment changes."

---

## 2:05–2:50 — `/graph` Wallet graph

**Click:** nav **Graph**. Click the edge from **Nova Ops** to **GrowthLabs Deployer** (edge `e2`, 40,000 USDC). Then click **show full payload** in the disclosure-challenge panel.

**Say:**
> "Nova Labs disclosed two wallets. The graph finds a third: Nova Ops. A disclosed wallet funded Nova Ops with 120,000; Nova Ops funded the GrowthLabs deployer with 40,000, nineteen days before the proposal was posted. The same funder, Funder X, funded both sides six minutes apart."

**Expected values:**
- Noisy-OR risk **0.88 RED**, red threshold **0.65**.
- **4 links**: two direct transfers at 0.48, one common funder at 0.38, one time-correlated at 0.27.
- **2 disclosed, 3 discovered** wallets.
- Challenge payload cites all four links and carries the disclosure hash; challenge digest is deterministic.

**Say:**
> "This is a risk signal, not a conclusion of wrongdoing. The data is simulated and labeled. What is real is the detection code and the arithmetic: disclosed endpoints are damped to 0.35, everything else keeps full weight, and the links combine with noisy-OR."

---

## 2:50–3:30 — `/vote` Informed voting

**Click:** nav **Vote**. Read the one-page risk brief. Point at the informed ratio and the overlap row. Then tick the acknowledgement checkbox ("I have read this brief…"), choose **For**, and click **Cast vote with brief**. The receipt panel appears.

**Say:**
> "This is the gap the product is about. Before this vote, only 59% of cast weight recorded that it had seen the current brief. One 90,000-weight FOR voter is the undisclosed Nova Ops wallet. The score is 0.71 — amber, not a pass."

**Expected values:**
- Eligible 1,000,000; cast 780,000; turnout **78%**; quorum **40%**, met.
- FOR 500,000; AGAINST 230,000; abstain 50,000; support **68.5%**.
- Informed weight 460,000 → **59%** informed ratio.
- HHI 0.23; one flagged-wallet overlap, 90,000 weight, −0.05.
- Voting score **0.7094 AMBER** before the demo vote. Your 25,000-weight informed vote updates the projection and the receipt; do not quote a new score unless you read it off the screen.

**Say:**
> "The receipt binds to the brief hash and the intent hash. It is not a thumbs-up on a forum thread."

---

## 3:30–4:15 — `/arena` Run the attacks

**Click:** nav **Arena**. Select the **00-benign-grant** row and click its **Run** button, then do the same for **03-jargon-upgrade** and **04-nested-ownership**. Point at the layer badge on each result.

**Say:**
> "Eleven scenarios. One benign bundle passes. Eight are rejected by the executor model. Two are flagged: one by Sentinel, one by the disclosure challenge. Every result carries its layer, because 'simulation detected' and 'rejected by the executor' are different claims."

**Expected values:**
- 00: **PASSED OK**.
- 03: **REJECTED `SelectorNotAuthorized`**.
- 04: **REJECTED `NestedCallNotAuthorized`**; the hidden child is `transferOwnership()`.
- 06: **FLAGGED `DelegatecallDetected`**, layer **sentinel**; the trace is a labeled fixture, not a fork trace.
- 10: **FLAGGED `UndisclosedLink`**, layer **disclosure**.

**Say:**
> "The executor model has no delegatecall path, and ownership changes require a new proposal. The sentinel layer is early warning; the executor layer is the intended guarantee."

---

## 4:15–4:35 — `/arena/03-jargon-upgrade` Violation report

**Click:** open the 03 report (from the arena row or the home banner).

**Say:**
> "The proposal said it would 'align the treasury implementation with the program's delivery roadmap.' The queued call upgrades TreasuryProxy to an unknown implementation. The approved bundle has three actions; the submitted bundle has one. The commitment does not match."

**Takeaway:** after the walkthrough, click **Download report** in the Takeaway panel. Open it to show the same quote, decoded call and evidence hashes in a clean audit document. The JSON button is the machine-readable version.

**Expected values:**
- Status **REJECTED**; code **`SelectorNotAuthorized`**; selector **`0x1420732b`**.
- Approved: 3 decoded actions (two transfers, one bounded approve).
- Submitted: 1 decoded action — `upgradeTo(address)` on TreasuryProxy.
- Evidence: approved vs submitted commitment, calldata hash, revert data, deterministic tx hash. Trace ref is absent for an executor scenario.
- Proposal text is the §5 implementation note; the decoder output is the reality.

**Say:**
> "This is the artifact the whole product exists to produce: the jargon and the calldata side by side, with the violated constraint named."

---

## 4:35–4:55 — `/scorecard` The gaps

**Click:** nav **Scorecard**. Click the **test required** filter to show the nine amber gaps.

**Say:**
> "25 properties pass. Zero fail. Nine are `TEST_REQUIRED`, and they are amber, never green. Those nine are exactly the on-chain guarantees we are not claiming today: Solidity hash parity, append-only registry, commitment immutability, real EVM re-entrancy, EIP-1967 post-condition, timelock and executed flag, guardian halt, a real Sentinel trace, and on-chain disclosure verification."

**Expected values:** 34 entries total; **25 PASS / 0 FAIL / 9 TEST_REQUIRED**.

---

## 4:55–5:00 — Close

**Say the closing line verbatim:**
> "Voting transparency isn't informed consent. We made the vote bind to the exact action, and we make the evidence, the conflicts, and the execution verifiable."

Do not add "and it's all on-chain." It is not, and the scorecard says so.

---

## Two-minute fallback

Use this if the room is running late, the network is unhappy, or an interactive route misbehaves. The values are all local and pre-baked.

| Time | Route | Action | Say / expected |
| ---: | :--- | :--- | :--- |
| 0:00 | `/trail` | Point at the blocked banner and the four stages. | "The vote passed; the transaction does not match it. Claims 0.81, COI 0.88, voting 0.71, execution a red gate." |
| 0:25 | `/intent` | Click **Prefill sourced**, then **Confirm intent**. | "Two ambiguities resolved; all three hashes match v3; claims move 0.63 to 0.81." |
| 1:00 | `/graph` | Click edge `e2`, then the challenge payload. | "Four links, noisy-OR 0.88. Simulated data, real math. The disclosure omits Nova Ops." |
| 1:30 | `/arena/03-jargon-upgrade` | Open the report. | "Three approved actions, one queued upgrade, `SelectorNotAuthorized`." |
| 1:50 | Close | — | Deliver the closing line. |

If the arena route is unavailable, run this in the terminal instead and read the verdict and evidence fields:

```bash
npm run arena -- 3
```

It prints the layer, expected vs actual, every check step, "proposal said" vs "actually does", and the raw evidence fields (commitment, calldata hash, revert data, tx hash, trace ref). Do not read the whole JSON aloud.

---

## Likely judge questions — honest answers

**1. "Is this actually on-chain? Did a contract reject the transaction?"**
> "No. The executor here is a TypeScript reference model; there is no Solidity, Hardhat or chain in this workspace. The nine on-chain properties are `TEST_REQUIRED` on the scorecard. Person A's deliverable is the deployed executor and the parity vectors. We are showing the decision trail and the exact enforcement logic, not claiming a live guarantee."

**2. "Is the AI live? How do you stop hallucinated rules or prompt injection?"**
> "Extraction is pre-baked for the demo; no model is called. The validator is real: every claim must match an exact quote in a document, unsourced claims are rejected, and the reviewer must resolve each ambiguity. The intent hash covers only the compiled rules, never model prose or confidence. Execution is independent of the AI."

**3. "Are the wallet links real? Are you accusing GrowthLabs?"**
> "No. Every address, amount, timestamp and tx hash in the graph is simulated and labeled. The link detectors and noisy-OR math are real. We present a risk signal with supporting transactions attached, not a conclusion of wrongdoing. The narrow claim is that the signed disclosure is incomplete against the graph."

**4. "Why four scores instead of one risk number?"**
> "They answer different questions: are the claims sourced, is there a conflict, was the vote informed, and does the calldata match. Averaging execution into the other three would hide the only deterministic fact. Execution stays a hard gate; the other three are advisory and every number has a drilldown."

**5. "How well tested is this? Do you have 80% coverage?"**
> "57 tests in 9 files, all passing. The scorecard checks 34 specific properties: 25 pass, 0 fail, 9 require the Solidity layer. We do not claim 80% line coverage and there is no coverage gate configured. The honest statement is that the reference logic is well covered on the properties we chose, and the on-chain properties are unproven."

**If asked "what is the biggest weakness?"**
> "The guarantee is modeled, not enforced. Until the Solidity executor and hash parity exist, this is a very clear demonstration of the gap and a specification for closing it — not a security guarantee."

---

## Limitations — say these verbally (no slide deck)

Use this 30–45 second block if judges ask for limitations, or weave it into the close if there is time.

1. **Restricted action model.** Six action kinds only: transfer, approve, parameter set, upgrade, ownership transfer, multicall. This is not arbitrary-call governance.
2. **Simulation is early warning, not the guarantee.** Sentinel-style flags help humans act before execution; the executor is the boundary. Here even the executor is a TypeScript model.
3. **Wallet data is simulated.** Addresses, transfers and tx hashes are fixtures labeled `SIMULATED DATA`. The link math is real; the records are not chain evidence.
4. **AI is advisory.** Pre-baked extraction, no live LLM. The validator, human confirmation, hashing, decoder, report and scoring are real code.
5. **No on-chain evidence yet.** Evidence roots and disclosure hashes are computed locally; nothing is anchored in a registry. Solidity/TypeScript hash parity is `TEST_REQUIRED`.
6. **Coverage is modest.** 57 tests, 9 files, no 80% coverage claim. Nine on-chain properties are amber and unproven.

**Phrases to avoid:** "on-chain", "the contract reverts", "the AI found", "we proved the wallets are linked", "production-ready". Replace with "the executor model rejects", "the extractor proposes and the validator checks", "the graph flags a risk signal", "demo".
