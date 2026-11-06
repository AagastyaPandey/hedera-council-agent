import Link from "next/link";
import { notFound } from "next/navigation";
import { formatUnits } from "ethers";
import {
  liveGetProposals,
  liveGetVersionChain,
  liveGetVotingState,
} from "@/lib/live";
import type { Proposal, VersionChain, VotingState } from "@/lib/types";
import { GuardianHalt } from "@/components/GuardianHalt";
import { HardwareVote } from "@/components/HardwareVote";
import { HashLine, StatusPill, type StatusLike } from "@/components/ui";

export const dynamic = "force-dynamic";

function short(value: string | null | undefined, head = 8, tail = 6): string {
  if (!value) return "—";
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function tokens(value: string | undefined): string {
  if (!value) return "—";
  try {
    return Number(formatUnits(BigInt(value), 18)).toLocaleString("en-US", {
      maximumFractionDigits: 0,
    });
  } catch {
    return value;
  }
}

function when(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

const STATE_LABELS: Record<string, string> = {
  VotingOpen: "Voting open",
  DisclosurePending: "Disclosure pending",
  Executed: "Executed",
  Halted: "Halted",
  Drafted: "Drafted",
  Passed: "Passed",
  Defeated: "Defeated",
  Queued: "Queued",
  Cancelled: "Cancelled",
};

function stateLabel(state: string | undefined): string {
  if (!state) return "—";
  return STATE_LABELS[state] ?? state;
}

function stateTone(state: string | undefined): StatusLike {
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
    case "Passed":
      return "PASSED";
    default:
      return "NEUTRAL";
  }
}

export default async function LiveProposalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let proposals: Proposal[] = [];
  let listError: string | null = null;
  try {
    proposals = await liveGetProposals();
  } catch (error) {
    listError = error instanceof Error ? error.message : String(error);
  }

  const proposal = proposals.find((candidate) => candidate.id === id);
  if (!proposal && !listError) notFound();

  let chain: VotingState | null = null;
  let chainError: string | null = null;
  if (proposal?.govId) {
    try {
      chain = await liveGetVotingState(proposal.govId);
    } catch (error) {
      chainError = error instanceof Error ? error.message : String(error);
    }
  }

  let versions: VersionChain | null = null;
  let versionError: string | null = null;
  try {
    versions = await liveGetVersionChain(id);
  } catch (error) {
    versionError = error instanceof Error ? error.message : String(error);
  }

  if (listError) {
    return (
      <div className="border-l-2 border-danger pl-4">
        <div className="text-[12px] text-danger">Chain read failed</div>
        <p className="mt-2 text-[13px] leading-relaxed text-dim">{listError}</p>
        <Link href="/live" className="arrow-link mt-4">
          Back to the live network
        </Link>
      </div>
    );
  }

  const state = chain?.state ?? "Drafted";

  return (
    <div className="doc-page">
      <aside className="doc-margin">
        <div className="doc-folio">Proposal {proposal?.id ?? id}</div>
        <div className="doc-folio mt-1">Governor {proposal?.govId || "—"}</div>
        <div className="doc-folio mt-1">Version {chain?.version ?? "—"}</div>
        <div className="mt-7 border-t border-edge pt-3">
          <StatusPill status={stateTone(state)}>{stateLabel(state)}</StatusPill>
          <div className="doc-note mt-3">
            Read from the local Hardhat node. No fixture values.
          </div>
        </div>
      </aside>

      <div className="doc-body">
        <Link href="/live" className="arrow-link">
          Live network
        </Link>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <span className="doc-folio">
            Proposal {proposal?.id ?? id}, governor {proposal?.govId || "—"}
          </span>
          <StatusPill status={stateTone(state)}>{stateLabel(state)}</StatusPill>
        </div>

        <h1 className="doc-title mt-2 text-body">
          {proposal?.title ?? "Unknown proposal"}
        </h1>
        <p className="doc-deck mt-4">
          This page reads the proposal registry, the version chain and the governor
          directly from the local Hardhat node. Nothing below is a fixture.
        </p>

        <section className="doc-section">
          <div className="doc-section-head">
            <h2 className="doc-section-title">Governor record</h2>
            <span className="doc-folio">IntentGovernor</span>
          </div>
          {chain ? (
            <table className="doc-ledger">
              <tbody>
                <tr>
                  <th className="w-[130px]">State</th>
                  <td>{stateLabel(chain.state)}, code {chain.stateCode}</td>
                </tr>
                <tr>
                  <th>Commitment</th>
                  <td className="font-mono text-[11px]">
                    {short(chain.commitment, 14, 10)}
                  </td>
                </tr>
                <tr>
                  <th>Version hash</th>
                  <td className="font-mono text-[11px]">
                    {short(chain.versionHash, 14, 10)}
                  </td>
                </tr>
                <tr>
                  <th>Intent hash</th>
                  <td className="font-mono text-[11px]">
                    {short(chain.intentHash, 14, 10)}
                  </td>
                </tr>
                <tr>
                  <th>Vote window</th>
                  <td className="font-mono text-[10.5px]">
                    {when(chain.voteStart)} → {when(chain.voteEnd)}
                  </td>
                </tr>
                <tr>
                  <th>Snapshot block</th>
                  <td className="font-mono text-[11px]">{chain.snapshotBlock}</td>
                </tr>
                <tr>
                  <th>Proposer</th>
                  <td className="font-mono text-[11px]">
                    {short(chain.proposer, 10, 8)}
                  </td>
                </tr>
                <tr>
                  <th>Brief acknowledgements</th>
                  <td>{chain.totalBriefAcks}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="text-[12.5px] leading-relaxed text-dim">
              {chainError ??
                "This proposal has not been submitted to the governor, so there is no voting record."}
            </p>
          )}
        </section>

        <section className="doc-section">
          <div className="doc-section-head">
            <h2 className="doc-section-title">Votes</h2>
            <span className="doc-folio">
              quorum {chain?.quorumReached ? "reached" : "not reached"}
            </span>
          </div>
          <table className="doc-ledger">
            <tbody>
              <tr>
                <th className="w-[130px]">For</th>
                <td className="font-mono text-[12px]">{tokens(chain?.forVotes)}</td>
              </tr>
              <tr>
                <th>Against</th>
                <td className="font-mono text-[12px]">{tokens(chain?.againstVotes)}</td>
              </tr>
              <tr>
                <th>Abstain</th>
                <td className="font-mono text-[12px]">{tokens(chain?.abstainVotes)}</td>
              </tr>
              <tr>
                <th>Informed</th>
                <td>
                  {chain ? `${Math.round(chain.informedRatio * 100)}%` : "—"} ·{" "}
                  {chain
                    ? `${tokens(chain.informedForVotes)} of ${tokens(chain.forVotes)} for`
                    : "no record"}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="doc-section">
          <div className="doc-section-head">
            <h2 className="doc-section-title">Version chain</h2>
            <span className="doc-folio">
              {versions?.valid ? "chain valid" : "unverified"}
            </span>
          </div>
          {versions && versions.versions.length > 0 ? (
            <ol>
              {versions.versions.map((version) => (
                <li
                  key={version.versionHash}
                  className="border-b border-edge/60 py-4 first:pt-0 last:border-0 last:pb-0"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[12px] font-medium">
                      Version {version.version}
                    </span>
                    <span className="doc-folio">{when(version.timestamp)}</span>
                  </div>
                  <div className="mt-2">
                    <HashLine label="Version hash" value={version.versionHash} />
                    <HashLine label="Previous" value={version.prevVersionHash} />
                    <HashLine label="Content" value={version.contentHash} />
                    <HashLine label="Evidence root" value={version.evidenceRoot} />
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-dim">
                    {version.contentPreview || "No preview recorded."}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[12.5px] leading-relaxed text-dim">
              {versionError ?? "No versions found for this proposal."}
            </p>
          )}
        </section>

        {chain?.state === "VotingOpen" ? (
          <section className="doc-section">
            <div className="doc-section-head">
              <h2 className="doc-section-title">Cast a live vote</h2>
              <span className="doc-folio">dev · browser · hardware</span>
            </div>
            <HardwareVote
              govId={proposal?.govId ?? ""}
              proposalId={proposal?.id ?? id}
              version={chain?.version ?? 1}
            />
          </section>
        ) : null}

        {chain?.state === "Queued" ? (
          <GuardianHalt govId={proposal?.govId ?? ""} />
        ) : null}

        <section className="doc-section">
          <h2 className="doc-section-title">Raw reads</h2>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-[12px]">
            <a
              href={`/api/live/version-chain?proposalId=${encodeURIComponent(id)}`}
              className="underline decoration-danger/40 underline-offset-2 hover:text-danger"
            >
              version chain JSON
            </a>
            {proposal?.govId ? (
              <a
                href={`/api/live/voting-state?govId=${encodeURIComponent(proposal.govId)}`}
                className="underline decoration-danger/40 underline-offset-2 hover:text-danger"
              >
                voting state JSON
              </a>
            ) : null}
            {proposal?.govId ? (
              <a
                href={`/api/live/verify-chain?proposalId=${encodeURIComponent(id)}`}
                className="underline decoration-danger/40 underline-offset-2 hover:text-danger"
              >
                verify chain JSON
              </a>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
