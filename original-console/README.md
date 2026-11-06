# Original console (CODE_TANTRAFEST, Next.js)

The original console app, copied from BeastAyyG/CODE_TANTRAFEST at commit `a6c8497`, with the Solidity
contracts, Hardhat config and contract tests left out (nothing in the console needs them: it builds without them).
Its own screens (Trail, Intent, Graph, ...) use its data (AegisDAO IntentLock, AIP-042). One screen was added, `/council`
(`console/app/council/page.tsx`, `console/lib/council.ts`, a nav entry in `components/AppShell.tsx`): built from the original's own
components, it shows this project's proposals, decisions, hashes and audit-log verification, read live from the council
server (`COUNCIL_API_URL`, default http://127.0.0.1:3000). Start the council server first (`npm start`).

```bash
npm run console:install     # once, from the repo root
npm run console             # http://localhost:3380/council (this project), /trail (original data)
```

Rule check: this code dates from Oct 25 2026, before the event, and was written partly by other contributors.
See `docs/submission.md` before submitting.
