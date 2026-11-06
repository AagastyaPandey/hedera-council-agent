# UI handoff

The backend is finished and tested; the UI is a thin layer on top of it. Everything
visual lives in `public/`. Nothing outside `public/` needs to change for the UI work.

## Where to work

The paper-and-red design (cream `#f0ede5` paper, red `#df3d2a` headline type, tiny mono
labels, vertical rail, pixel-isometric islands) is implemented on every page. Everything
visual lives in `public/`; nothing outside it needs to change.

| File | Role | Reference look |
| --- | --- | --- |
| `public/assets/theme.css` | Tokens and all components (frame, rail, ticker, poster, record, process strip) | all three |
| `public/index.html` | Atlas: treasury island plus one island per proposal, bridges, legend, timeline | The Archipelago poster |
| `public/report.html` | Poster: *described* vs *actual* numerals, pixel island, stamp, red verdict | AIP-042 report poster |
| `public/console.html` | Console: headline, record table, claim/check/gate/sign strip, new proposal, join | Console, paper and red |
| `public/assets/scene.js` | SVG scenery generators: `island`, `pixelIsland`, `bridge`, `sky` | |
| `public/assets/rail.js` | Top meta row (menu and status columns) and the bottom ticker | |

Do not touch: `public/assets/api.js` and `public/assets/world-flow.js`. They are the
seam to the server. Restyle the markup around them, keep calling them.

Animation hooks already in the markup: `.packet` (the red dot on each bridge, ready to
travel), `.island` groups (`data-proposal`, `data-decision`, `data-large`), `.stamp`,
`.ticker .run` (CSS marquee, off under `prefers-reduced-motion`), `.timeline .fill`, and
the `.step[data-state]` strip (`pass`, `fail`, `wait`).

## From Scratch rule (important)

ETHGlobal's From Scratch rule says prior project-specific "code, designs, or assets are
not allowed" in a project entering partner prizes. The reference designs live in
CODE_TANTRAFEST, created Oct 25 2026, before the event (Nov 5-7), with commits by several
people and no license. So no file from it is in this repo. The look was rebuilt from a
screenshot in new code: the HTML, CSS and SVG here are all written for this project.
Replacing them with the originals would put pre-event designs in the submission, which is
the thing the rule forbids. If the look is judged too close, ask ETHGlobal before submitting.

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

Outcome: `{ proposal, transferSource: "request"|"hedera-mirror-node", decision: "SIGNED"|"REFUSED", reason, checkMatches, paidVia, paidTxId, paidHashscan, auditTxId, scheduledTxId, scheduleAction, zeroGSource, zeroGRequestId, zeroGVerdictText, worldGateReason, approveUrl?, mode }`.
`outcome.proposal` is the proposal as checked (real mode: with the transfer read from Hedera and its `scheduleId`); show that, not what was typed. `mode: "simulated"` means ids start with `SIM-`: the UI must label them SIMULATED, never present them as real.
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
