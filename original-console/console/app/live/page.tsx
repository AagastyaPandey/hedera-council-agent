import Link from "next/link";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { formatUnits } from "ethers";
import { getChainDiagnostics, getProvider } from "@/lib/chain";
import { liveGetProposals, liveGetVotingState } from "@/lib/live";
import { repoRoot } from "@/lib/backend";
import type { Proposal, VotingState } from "@/lib/types";
import { LiveWatcher } from "@/components/LiveWatcher";
import { StatusPill, type StatusLike } from "@/components/ui";

export const dynamic = "force-dynamic";

type SeedEntry = {
  title: string;
  govId: string | null;
  state: string;
  commitment: string | null;
  versionChain: string[];
  notes: string;
};

type LiveRow = {
  proposal: Proposal;
  seed: SeedEntry | null;
  chain: VotingState | null;
};

function readSeedIndex(): Record<string, SeedEntry> {
  try {
    const file = path.join(
      repoRoot(),
      "packages",
      "shared",
      "fixtures",
      "demo-state.json"
    );
    if (!existsSync(file)) return {};
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, SeedEntry>;
  } catch {
    return {};
  }
}

function short(value: string | null | undefined, head = 6, tail = 4): string {
  if (!value) return "—";
  if (value.length <= head + tail + 2) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function votes(value: string | undefined): string {
  if (!value) return "—";
  try {
    return Number(formatUnits(BigInt(value), 18)).toLocaleString("en-US", {
      maximumFractionDigits: 0,
    });
  } catch {
    return value;
  }
}

const STATE_LABELS: Record<string, string> = {
  VotingOpen: "Voting open",
  DisclosurePending: "Disclosure pending",
  Executed: "Executed",
  Halted: "Halted",
  Drafted: "Drafted",
  Challenged: "Challenged",
  Passed: "Passed",
  Defeated: "Defeated",
  Queued: "Queued",
  Cancelled: "Cancelled",
};

function stateLabel(state: string): string {
  return STATE_LABELS[state] ?? state;
}

function stateTone(state: string): StatusLike {
  switch (state) {
    case "Executed":
      return "OK";
    case "Halted":
    case "Defeated":
    case "Cancelled":
      return "RED";
    case "VotingOpen":
    case "Queued":
    case "DisclosurePending":
      return "AMBER";
    case "Challenged":
      return "FLAGGED";
    case "Passed":
      return "PASSED";
    default:
      return "NEUTRAL";
  }
}

export default async function LivePage() {
  const diagnostics = await getChainDiagnostics();
  const seed = readSeedIndex();

  let proposals: Proposal[] = [];
  let listError: string | null = null;
  try {
    proposals = await liveGetProposals();
  } catch (error) {
    listError = error instanceof Error ? error.message : String(error);
  }

  let blockNumber: number | null = null;
  try {
    blockNumber = await getProvider().getBlockNumber();
  } catch {
    blockNumber = null;
  }

  const rows: LiveRow[] = await Promise.all(
    proposals.map(async (proposal) => {
      let chain: VotingState | null = null;
      if (proposal.govId) {
        try {
          chain = await liveGetVotingState(proposal.govId);
        } catch {
          chain = null;
        }
      }
      return { proposal, seed: seed[proposal.id] ?? null, chain };
    })
  );

  const liveContracts = diagnostics.contracts.filter((contract) => contract.hasCode);
  const openCount = rows.filter((row) => row.chain?.state === "VotingOpen").length;
  const executedCount = rows.filter((row) => row.chain?.state === "Executed").length;

  return (
    <div className="doc-page">
      <aside className="doc-margin">
        <div className="doc-folio">Live record</div>
        <div className="doc-folio mt-1">Chain {diagnostics.chainId ?? "—"}</div>
        <div className="doc-folio mt-1">Block {blockNumber ?? "—"}</div>
        <div className="mt-7 border-t border-edge pt-3">
          <div className="doc-note">
            {diagnostics.rpcReachable ? "RPC reachable" : "RPC offline"}
          </div>
          <div className="doc-note mt-1">
            {liveContracts.length} contracts with code
          </div>
          <div className="doc-note mt-1">{rows.length} proposals</div>
        </div>
        <div className="mt-6">
          <span className="doc-stamp">Local chain only</span>
        </div>
      </aside>

      <div className="doc-body">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="doc-folio">Live network, local Hardhat</span>
          <span className="doc-folio">block {blockNumber ?? "—"}</span>
        </div>

        <h1 className="doc-title mt-2 text-body">Local chain</h1>
        <p className="doc-deck mt-4">
          Six proposals are seeded on the node. Governor state, version chains,
          commitments and votes below are read from the deployed contracts. The
          AIP-042 narrative on the other pages remains a labelled reference model.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <Link href="/trail" className="btn btn-primary">
            Open the narrative trail
          </Link>
          <Link href="/docs" className="arrow-link">
            How to run the chain
          </Link>
        </div>

        {listError ? (
          <div className="mt-6 border-l-2 border-danger pl-3 text-[12px] leading-relaxed text-dim">
            <span className="text-danger">Chain read failed.</span> {listError}.
            Start the node with{" "}
            <code className="font-mono text-[11px]">npx hardhat node</code> and deploy
            with <code className="font-mono text-[11px]">npm run deploy</code>.
          </div>
        ) : null}

        <section className="doc-section">
          <div className="doc-section-head">
            <h2 className="doc-section-title">Chain record</h2>
            <span className="doc-folio">
              {diagnostics.demoState.allMatched
                ? "seed matches chain"
                : diagnostics.demoState.checked
                  ? "seed drift"
                  : "seed not checked"}
            </span>
          </div>
          <table className="doc-ledger">
            <tbody>
              <tr>
                <th className="w-[120px]">RPC</th>
                <td>
                  <span className="font-mono text-[11px]">{diagnostics.rpcUrl}</span>
                  <span className={diagnostics.rpcReachable ? "ml-2 text-safe" : "ml-2 text-danger"}>
                    {diagnostics.rpcReachable ? "reachable" : "offline"}
                  </span>
                </td>
              </tr>
              <tr>
                <th>Chain</th>
                <td>
                  {diagnostics.chainId ?? "—"}, manifest{" "}
                  {diagnostics.manifestChainId} ·{" "}
                  {diagnostics.chainIdMatch ? "match" : "mismatch"}
                </td>
              </tr>
              <tr>
                <th>Contracts</th>
                <td>{liveContracts.length} with code</td>
              </tr>
              <tr>
                <th>Proposals</th>
                <td>
                  {rows.length} seeded, {openCount} voting, {executedCount} executed
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="doc-section">
          <div className="doc-section-head">
            <h2 className="doc-section-title">Proposals</h2>
            <span className="doc-folio">{rows.length} rows</span>
          </div>

          <div className="overflow-x-auto">
            <table className="doc-ledger min-w-[920px]">
              <thead>
                <tr>
                  <th className="w-[50px]">ID</th>
                  <th>Proposal</th>
                  <th className="w-[130px]">State</th>
                  <th className="w-[70px]">Ver.</th>
                  <th className="w-[150px]">Commitment</th>
                  <th className="w-[130px]">For / against</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const state = row.chain?.state ?? row.seed?.state ?? "Drafted";
                  const versions =
                    row.seed?.versionChain.length ?? row.chain?.version ?? "—";
                  const commitment = row.chain?.commitment ?? row.seed?.commitment ?? null;
                  return (
                    <tr key={row.proposal.id}>
                      <td className="font-mono text-[10.5px] text-faint">
                        {row.proposal.id}
                      </td>
                      <td>
                        <Link
                          href={`/live/${row.proposal.id}`}
                          className="text-[12.5px] font-medium text-body hover:text-danger"
                        >
                          {row.proposal.title}
                        </Link>
                        <div className="mt-0.5 text-[10.5px] text-faint">
                          gov {row.proposal.govId || "—"}, seed{" "}
                          {row.seed?.state ?? "—"}
                        </div>
                      </td>
                      <td>
                        <StatusPill status={stateTone(state)}>{stateLabel(state)}</StatusPill>
                      </td>
                      <td className="font-mono text-[11px] text-steel">{versions}</td>
                      <td className="font-mono text-[10.5px] text-steel">
                        {short(commitment, 8, 6)}
                      </td>
                      <td className="font-mono text-[10.5px] text-steel">
                        {row.chain
                          ? `${votes(row.chain.forVotes)} / ${votes(row.chain.againstVotes)}`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="doc-note mt-2">
            State labels come from IntentGovernor. Seed notes are listed separately
            below. Proposal 3 is labelled challenged by the disclosure seed; its
            governor state is shown above.
          </p>
        </section>

        <section className="doc-section grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <h2 className="doc-section-title">Contracts on this node</h2>
            <table className="doc-ledger mt-2">
              <tbody>
                {diagnostics.contracts.map((contract) => (
                  <tr key={contract.name}>
                    <td className="w-[45%] text-[11.5px]">{contract.name}</td>
                    <td className="font-mono text-[10px] text-faint">
                      {short(contract.address, 8, 6)}
                    </td>
                    <td
                      className={
                        contract.hasCode
                          ? "w-[50px] text-right text-[10px] text-safe"
                          : "w-[50px] text-right text-[10px] text-danger"
                      }
                    >
                      {contract.hasCode ? "code" : "none"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h2 className="doc-section-title">Watcher</h2>
            <div className="mt-3">
              <LiveWatcher />
            </div>
          </div>
        </section>

        <section className="doc-section">
          <h2 className="doc-section-title">Seed notes</h2>
          <table className="doc-ledger mt-2">
            <tbody>
              {rows.map((row) => (
                <tr key={row.proposal.id}>
                  <td className="w-[40px] font-mono text-[10.5px] text-faint">
                    {row.proposal.id}
                  </td>
                  <td className="w-[120px]">
                    <StatusPill status={stateTone(row.seed?.state ?? "Drafted")}>
                      {stateLabel(row.seed?.state ?? "Drafted")}
                    </StatusPill>
                  </td>
                  <td className="text-[11px] leading-relaxed text-dim">
                    {row.seed?.notes ?? "No seed note recorded."}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="doc-section">
          <h2 className="doc-section-title">Raw reads</h2>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-[12px]">
            <Link href="/api/status" prefetch={false} className="underline decoration-danger/40 underline-offset-2 hover:text-danger">
              /api/status
            </Link>
            <Link href="/api/live/proposals" prefetch={false} className="underline decoration-danger/40 underline-offset-2 hover:text-danger">
              /api/live/proposals
            </Link>
            <Link href="/api/watcher/events" prefetch={false} className="underline decoration-danger/40 underline-offset-2 hover:text-danger">
              /api/watcher/events
            </Link>
            <Link href="/api/scorecard" prefetch={false} className="underline decoration-danger/40 underline-offset-2 hover:text-danger">
              /api/scorecard
            </Link>
          </div>
          <p className="doc-note mt-3">
            These endpoints run against the local node. If it stops, this page
            reports a chain-read failure instead of stale values.
          </p>
        </section>
      </div>
    </div>
  );
}
