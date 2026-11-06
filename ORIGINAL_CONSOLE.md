# Original console (verbatim copy, separate branch)

`original-app/` is a verbatim copy of BeastAyyG/CODE_TANTRAFEST at commit `a6c8497`, kept at its original layout
because `console/` imports from its sibling folders (`sentinel`, `intelligence`, `contracts`, `packages`).
The only change is that `console/public/atlas.html` and `console/public/report.html` were refreshed from the
original `public/ecosystem.html` and `public/report-editorial.html`, which is what its `sync:editorial` step does.

```bash
cd original-app && npm install --ignore-scripts
cd console && npm install && npx next build && npx next start -p 3380   # http://localhost:3380/trail
```

Verified: `next build` succeeds and `/trail` and `/arena` render the original design with no page errors.

## Read before using

- It is **another project's EVM app** (AegisDAO IntentLock: Solidity contracts, Hardhat, viem, ethers, Ledger). It has
  its own data and does not talk to this repo's Hedera backend. It also contains Solidity, which sits badly with the
  Hedera "No Solidity Allowed" track.
- ETHGlobal's From Scratch rule says prior project-specific "code, designs, or assets are not allowed" in projects
  entering partner prizes. This copy was created Oct 25 2026, before the event (Nov 5-7), and its authors include
  people other than the project owner. Do **not** merge this branch into the submission without ETHGlobal's
  confirmation.
- The submission branch (`hoplite/aspendos-096475b8`) already uses the original stylesheet and pages for this
  project's own screens (see `docs/ui-handoff.md`).
