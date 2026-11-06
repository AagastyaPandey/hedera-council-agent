# UI handoff

The backend is finished and tested; the UI is a thin layer on top of it. Everything
visual lives in `public/`. Nothing outside `public/` needs to change for the UI work.

## Where to work

| File | Role | Design reference |
| --- | --- | --- |
| `public/assets/theme.css` | **Placeholder tokens and components. Replace this.** | the paper / red system |
| `public/index.html` | Atlas: the overview. Every proposal is a node (`data-proposal`, `data-decision`, `data-large`) | "Archipelago poster" |
| `public/report.html` | One proposal as a poster: two big numbers, *described* vs *actual transfer*, headline verdict | "AIP-042 report poster" |
| `public/console.html` | Working console: proposal list, record, submit, World ID approval, join council | "Console, paper and red" |
| `public/assets/rail.js` | The shared left rail. One place to change navigation | |

Do not touch: `public/assets/api.js` and `public/assets/world-flow.js`. They are the
seam to the server. Restyle the markup around them, keep calling them.

## From Scratch rule (important)

ETHGlobal's From Scratch rule says prior project-specific "code, designs, or assets are
not allowed" in a project entering partner prizes. The three references come from
CODE_TANTRAFEST. Take the ideas (paper background, red accent, mono small-caps labels,
left rail, big numerals, isometric scene) and draw and write everything fresh here. Do
not copy its HTML, CSS, SVG or images into this repo.

## Server contract

All JSON. Base URL is the same origin. Use `api` from `assets/api.js`.

| Call | Returns |
| --- | --- |
| `api.health()` | `{ mode, network, x402Seller, x402Buyer, checkPrice, spendCapRemaining, zeroG, world, councilSeats, note }` |
| `api.proposals()` | `{ proposals: [{ id, purpose, amountTinybars, large, matches, decision, scheduledTxId }] }` |
| `api.proposal(id)` | `{ proposal, large, check: { matches, mismatches[], verdict }, lastOutcome, approval }` |
| `api.submit(proposal)` | the outcome below (200), or `{ error }` (400/409) |
| `api.seats()` | `{ count, seats[] }` |
| `api.worldConfig()` | `{ configured, appId, environment, mockedAllowed }` |

Outcome: `{ decision: "SIGNED"|"REFUSED", reason, checkMatches, paidVia, paidTxId, paidHashscan, auditTxId, scheduledTxId, scheduleAction, zeroGSource, zeroGRequestId, zeroGVerdictText, worldGateReason, approveUrl?, mode }`.
`mode: "simulated"` means ids start with `SIM-`: the UI must label them SIMULATED, never present them as real.
`zeroGSource: "simulated"` and World `source: "mocked"` must likewise be labelled.

Money: amounts are tinybars; `hbar()` in `api.js` formats them.

## State machine for animation

Animation can be built entirely from events and attributes, no server changes.

Events on `bus` (`import { bus } from "/assets/api.js"`), `event.detail` in brackets:

- `proposal:submitted` [id]
- `proposal:decision` [id, outcome], the moment the agent signs or refuses
- `world:qr`, `world:waiting`, `world:approved`, `world:denied`, `council:joined`

Attributes: `document.body.dataset.state` (`loading`, `ready`, `error`),
`dataset.lastEvent`, `dataset.decision`. Rows and panels carry `data-proposal` and
`data-decision` (`SIGNED`, `REFUSED`, `PENDING`), so CSS-only animation works.

The four story beats to animate: routine proposal signs; mismatch refuses (the two
numbers diverge); large proposal waits for World ID; denied or expired, no signature.

## Run it

```bash
npm install && npm start      # http://localhost:3000, simulated mode, no keys needed
```

Demo mode shows MOCKED approvals; with the World env vars set it shows the real QR.
Edit `public/` and refresh: it is served statically, no build step.
