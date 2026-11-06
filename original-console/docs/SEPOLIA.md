# Sepolia testnet

AegisDAO IntentLock runs on Sepolia with the same contracts and governance
lifecycle as local Hardhat. The differences are real block time, real gas, and
the fact that the Sentinel simulates on a Sepolia **fork** but halts on
Sepolia **itself**.

## What runs where

| Capability | Local Hardhat | Sepolia |
| :--- | :--- | :--- |
| Contracts, commitment hashing, registry | yes | yes |
| Governance lifecycle (disclosure → vote → queue → execute/halt) | yes, time-travelled | yes, real waiting (defaults: voting 300s, timelock 120s) |
| Red-Team Arena (`npm run arena`, every scenario card) | yes, in-process Hardhat | no — the arena runs Hardhat tests locally and is not submitted as Sepolia transactions |
| Sentinel decode, static scan, simulation, trace diff | yes, EVM snapshots | yes, but only in `FORK=1` mode (snapshots require Hardhat) |
| Guardian halt | local signer | `halt()` sent to Sepolia with `GUARDIAN_KEY` |
| Forced-execute failure receipt | instant | mined with a manual gas limit, linked on Etherscan |
| Pre-vote effect preview (`sentinel/preview.ts`) | yes, in-process snapshot | yes, but only on the `FORK=1` node (see below) |
| Evidence store, AI draft heuristics, COI graph | yes | yes (graph data stays labeled SIMULATED) |

The Sepolia seeder writes the same `packages/shared/fixtures/demo-state.json`
the console reads. Re-running the local seeder overwrites it.

## 1. One-time setup

```bash
cp .env.example .env        # then fill it in
```

Create at least these keys (each is a separate wallet, each needs Sepolia ETH):

| Role | Env | Used for |
| :--- | :--- | :--- |
| deployer | `DEPLOYER_KEY` | deploy, mint demo tokens, forced-execute attempts |
| proposer | `PROPOSER_KEY` | proposals, disclosures, votes are cast by this author |
| voter1–3 | `VOTER1_KEY` … `VOTER3_KEY` | voting (`GOV_TOKEN_MINT_TOKENS` each is minted at deploy) |
| guardian | `GUARDIAN_KEY` | `halt()` only — it can never execute |
| verifier | `VERIFIER_KEY` | verifies disclosure challenges |
| challenger | `CHALLENGER_KEY` | files the COI challenge in P3 |

`DEV_WALLET_ADDRESS` and `VENDOR_ADDRESS` receive the demo grants and need no key.
The proposer needs ~1 ETH extra for the P3 disclosure bond (it is slashed to the
challenger when the challenge is verified); everything else is gas only.

`.env` is gitignored. Never put a private key in a `NEXT_PUBLIC_*` variable.

### Faucets

Any Sepolia ETH source works; these are the common ones:

- Alchemy Sepolia faucet: <https://www.alchemy.com/faucets/ethereum-sepolia>
- Google Cloud Web3 faucet: <https://cloud.google.com/application/web3/faucet/ethereum/sepolia>
- Proof-of-work faucet: <https://sepolia-faucet.pk910.de>

Fund each role wallet once with ~0.1–0.5 ETH. The seeder sends many small
transactions; if one role runs dry mid-seed, top it up and re-run the seeder.

Get an Etherscan API key at <https://etherscan.io/myapikey> for verification.

## 2. Deploy

```bash
npm run deploy:sepolia
```

- Prints a dry-run gas estimate before sending anything.
- Uses testnet timing from `.env` (`TIMELOCK_DELAY_SECONDS` default 120,
  `VOTING_PERIOD_SECONDS` default 300, challenge window default 1800).
- Mints governance tokens to the proposer and all three voters.
- Writes `deployments/sepolia.json` with every address, deployment block,
  deploy tx hash, typed constructor args, and setup tx hashes.
- Prints the Etherscan address links.

Dry run only (no transactions):

```bash
DRY_RUN=1 npx hardhat run scripts/deploy.ts --network sepolia
```

## 3. Verify

```bash
npm run verify:sepolia
```

Reads `deployments/sepolia.json`, calls `hardhat verify` with the recorded
constructor arguments, skips already-verified contracts, and prints the
Etherscan URLs. If a contract is not yet indexed, wait a minute and re-run.

## 4. Seed the demo proposals

```bash
npm run seed:sepolia
```

Creates the five demo proposals on Sepolia:

| Proposal | Final state | What happens |
| :--- | :--- | :--- |
| P1 Q4 Development Grant | Executed | two versions, votes, real voting period, 120s timelock, 5,000 USDC to the dev wallet |
| P2 Fee parameter tuning | Halted | benign `setFee(35)` queued; malicious `upgradeTo` bundle registered; Sentinel flags and guardian halts |
| P3 Ecosystem grant | Challenged | undisclosed-link challenge filed and verified, 1 ETH bond slashed |
| P4 Infrastructure budget | VotingOpen | mixed informed/uninformed votes, no challenge |
| P5 Community Grants draft | Drafted | unresolved AI extraction, never submitted |

The seeder **never advances time and never redeploys**. It polls the chain for
`voteEnd` and `eta`, and every step checks on-chain state first. If it is
interrupted, run the same command again to resume; logical proposal ids are
checkpointed in `packages/shared/fixtures/sepolia-seed-progress.json`.

P2 waits for the Sentinel by default. Start the Sentinel before or while the
seeder reaches P2:

```bash
FORK=1 SENTINEL_NETWORK=sepolia npm run sentinel:fork
```

PowerShell:

```powershell
$env:FORK=1; $env:SENTINEL_NETWORK="sepolia"; npm run sentinel:fork
```

If no Sentinel is running, the seeder waits `P2_HALT_TIMEOUT_SECONDS` (default
600) and then stops with instructions; re-run after starting the Sentinel.
Setting `SEED_ALLOW_DIRECT_HALT=1` lets the seeder submit the guardian halt
itself, which is useful for a quick reset but skips the Sentinel demo.

To start over, redeploy and delete `sepolia-seed-progress.json` plus
`demo-state.json`.

## 5. Sentinel on the Sepolia fork

```bash
FORK=1 SENTINEL_NETWORK=sepolia npm run sentinel:fork
```

- `FORK=1` makes the Hardhat network a Sepolia fork, so `evm_snapshot`,
  `evm_revert`, and timestamp warping work while state comes from Sepolia.
- Reads and simulation use the fork; the watcher polls `ProposalQueued` from
  the executor's deployment block in the manifest (override with
  `SENTINEL_FROM_BLOCK`).
- On a violation, `halt(commitment, reportHash)` is signed with `GUARDIAN_KEY`
  and sent to Sepolia through `SEPOLIA_RPC_URL` (or `SENTINEL_HALT_RPC_URL`).
- Rate-limit responses (429/5xx/timeouts) are retried with backoff; a failed
  log chunk is re-queried instead of skipped.
- The watcher refuses to start if `GUARDIAN_KEY` does not match
  `executor.guardian()`.

`FORK=1` in `.env` would fork the network for *every* Hardhat command,
including the test suite. Set it only for the Sentinel shell.

## 5b. Pre-vote effect preview

Before anyone votes, `sentinel/preview.ts` simulates the EXACT committed calldata in a
reverted snapshot and diffs the result against the stated intent (the committed rules).
It uses `evm_snapshot` / `evm_revert`, `hardhat_impersonateAccount` and
`hardhat_setBalance`, so it must run against a Hardhat node — never the public RPC.

```bash
# Recorded previews for the console (recorded mode)
FORK=1 SENTINEL_NETWORK=sepolia npm run previews:record:sepolia

# One proposal, on demand (same CLI the API route shells out to)
FORK=1 RPC_URL=$SEPOLIA_RPC_URL npx ts-node sentinel/preview-cli.ts 6 --no-cache
```

- The simulation executes each committed action as the **executor** address with plain
  CALL semantics, captures before/after state for the auto-built watch list (action
  targets, decoded counterparties, treasury, tokens, owner/admin, the three EIP-1967
  slots, extcodehash, ETH and token balances, allowances), then reverts. Chain state is
  never changed, including when an action reverts or a read fails.
- Readings that fail, and functions a contract does not implement, are listed in
  `unobserved` — never reported as zero.
- Results are cached by `(proposalId, blockNumber)` in
  `packages/shared/fixtures/preview-cache.json` (gitignored), and a shared file lock
  (`sentinel/mutex.ts`) serialises snapshots with the Sentinel watcher and the arena
  runner so two previews never interleave on one node.
- `GET /api/preview/<proposalId>` returns the preview: live mode shells out to the CLI,
  recorded mode serves `packages/shared/fixtures/previews.json`. There is no silent
  fallback between the two.
- On Sepolia, proposal P2's registered bundle is the *presented attack payload* used for
  the Sentinel demo, so it deliberately does not hash to P2's committed actions and the
  preview refuses it (`UNAVAILABLE`). The obfuscated pre-vote proposal is **P6**, whose
  registered bundle matches its commitment and shows CRITICAL owner/implementation
  effects before the vote.

## 6. Console against Sepolia

In `.env`:

```bash
NEXT_PUBLIC_CHAIN_ID=11155111
NEXT_PUBLIC_DATA_MODE=live
NEXT_PUBLIC_RPC_URL=<same as SEPOLIA_RPC_URL>
```

Then:

```bash
cd app
npm install
npm run build     # NEXT_PUBLIC_* values are baked in at build time
npm run start
```

The console:

- loads `deployments/sepolia.json` (chosen by `NEXT_PUBLIC_CHAIN_ID`),
- shows the chain tag **Sepolia testnet**,
- links every tx hash and address to `https://sepolia.etherscan.io`,
- signs server-side with the same role keys from `.env`; private keys never
  reach the browser. The `eth_accounts` dev signer is local-only and always
  disabled on Sepolia.

Forced execution ("Try to execute anyway") submits with a manual gas limit of
8,000,000 so the failing transaction is still mined. The panel shows the mined
tx, the decoded revert selector, and an Etherscan link.

## 7. Command summary

| Task | Command |
| :--- | :--- |
| Local node | `npx hardhat node` |
| Local deploy | `npm run deploy` |
| Local full demo seed | `npm run seed` |
| Local Sentinel | `npm run sentinel:watch` |
| Sepolia deploy (+ gas estimate) | `npm run deploy:sepolia` |
| Sepolia verify | `npm run verify:sepolia` |
| Sepolia seed (resumable) | `npm run seed:sepolia` |
| Sepolia Sentinel (fork simulation, real halt) | `FORK=1 SENTINEL_NETWORK=sepolia npm run sentinel:fork` |
| Red-team tests | `npx hardhat test` / `npm run arena` |

## 8. Troubleshooting

| Symptom | Fix |
| :--- | :--- |
| `No signer available on "sepolia"` | Set `DEPLOYER_KEY` in `.env`. |
| `GUARDIAN_KEY resolves to … but executor.guardian() is …` | The guardian wallet changed; update `GUARDIAN_KEY` or `GUARDIAN_ADDRESS` and redeploy. |
| `FORK=1 requires SEPOLIA_RPC_URL` | Set the RPC URL before forking. |
| Rate-limit / `could not coalesce` errors | Use a dedicated provider (Alchemy/Infura) and raise `SENTINEL_POLL_MS`. Retries are automatic. |
| Seeder stops at P3 `ChallengeWindowClosed` | The challenge window elapsed during a long pause; redeploy and reseed, or raise `CHALLENGE_WINDOW_SECONDS`. |
| Console shows empty proposals | The seeder has not run, or `NEXT_PUBLIC_CHAIN_ID` and the manifest disagree. |
| Verification fails right after deploy | Wait for Etherscan to index the bytecode, then re-run `npm run verify:sepolia`. |
| Rebuilt app still uses old chain | `NEXT_PUBLIC_*` is baked at build time; rebuild after editing `.env`. |
