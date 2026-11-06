# Screenshot checklist

The README links to these files. Until real captures exist, the README shows the alt text and
path; add the PNGs here after running the local demo (`npx hardhat node`, `GUARDIAN_MODE=auto
npm run seed`, `npm run sentinel:watch`, app on `http://localhost:3000`).

| File | Page | What to capture | Alt text to use |
| :--- | :--- | :--- | :--- |
| `hero-decision-trail.png` | `/` | Full viewport: Decision Trail stages, the compact "If this passes" verdict, Live Sentinel panel below | "Decision Trail showing four evaluation stages and the pre-vote effect preview" |
| `proposals-versions.png` | `/proposals` | Version chain card with hashes and prev-hash links | "Hash-chained proposal versions with content and evidence hashes" |
| `intent-draft.png` | `/proposals` → Intent tab | Drafted actions with source chips and the amber UNRESOLVED list | "AI intent draft with source-linked claims and unresolved items" |
| `disclosure-graph.png` | `/disclosure` | Wallet graph with one undisclosed path highlighted and the SIMULATED DATA tag | "Wallet graph showing a discovered, undisclosed link" |
| `effect-preview.png` | `/voting` (proposal #6) | Crimson verdict banner plus the CRITICAL owner/implementation rows | "Pre-vote effect preview warning about owner and implementation changes" |
| `voting-brief.png` | `/voting` | Risk brief with briefHash and previewHash chips, effect preview above the vote buttons | "Informed voting brief with the acknowledged preview hash" |
| `sentinel-live.png` | `/` (Live Sentinel) | HALTED event with report hash, halt tx and block | "Sentinel halt event with on-chain evidence" |
| `forced-execution.png` | `/` (after halt) | Forced execution result: decoded revert + Etherscan link | "Executor refusing a halted commitment with a decoded revert" |
| `arena-scorecard.png` | `/scorecard` | Eleven green rows, no amber | "Governance security scorecard with eleven passing properties" |
| `status.png` | `/status` | RPC reachable, chain id match, every contract with code | "Console status page showing deployment diagnostics" |
| `preview-cli.png` | terminal | `npx ts-node sentinel/preview-cli.ts 6 --no-cache` output | "Preview CLI returning CRITICAL effects for the obfuscated proposal" |
| `sepolia-etherscan.png` | Sepolia Etherscan | A verified contract page or a mined failed execution | "Sepolia Etherscan page for an IntentLock contract" |

Capture tips:

- Use the dark console theme (`app/`), viewport 1440×900, browser zoom 100%.
- For `/voting`, select proposal #6 ("Routine parameter tuning (obfuscated)") first.
- For the Sepolia shots, set `NEXT_PUBLIC_CHAIN_ID=11155111` and `NEXT_PUBLIC_DATA_MODE=live`
  before building the console.
