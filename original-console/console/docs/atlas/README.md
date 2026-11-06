# Project atlas — source pack

This folder feeds the standalone visual atlas. It is a **document about the whole system**, not the product website.

- [Project atlas (HTML)](../PROJECT-ATLAS.html) — the visual document. Open directly in a browser; print to PDF from there.
- [Project atlas (PDF)](../PROJECT-ATLAS.pdf) — the print-ready version.
- [GitHub-readable project map](../PROJECT-MAP.md) — one-page Mermaid map, branch topology, collisions, and status.
- [Chain + intelligence layer](01-chain-intelligence.md) — Person A's contracts, tests, Sentinel, intelligence modules, and integration boundary.
- [Experience layer](02-experience-layer.md) — Person B's decision console, evidence/AI/hash pipeline, Judge Mode, presentation, report export, and scorecard.

## Snapshot

| Layer | Branch | Commit | Contains |
| :--- | :--- | :--- | :--- |
| Chain + intelligence + chain-side console | `main` | `55c636a` | Solidity contracts, Hardhat tests, Sentinel, intelligence modules, chain-side console prototype |
| Judge-facing experience | `b/judge-mode` | `ea78e84` | Next.js decision console, evidence/AI/hash pipeline, red-team arena, Judge Mode, `/present`, report export |

The two histories are **unrelated and not merged**. The atlas documents both halves and the interface between them; it does not claim a running end-to-end chain integration.

A separate local visual-site experiment on the working copy's newer `main` is intentionally out of scope.
