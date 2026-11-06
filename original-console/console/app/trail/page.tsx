import Link from "next/link";
import { getDemo } from "@/lib/demo";
import { StagePipeline } from "@/components/StagePipeline";
import { SourceChip } from "@/components/SourceChip";
import {
  HashLine,
  ModelBadge,
  StatusPill,
} from "@/components/ui";
import {
  formatNumber,
  shortAddress,
  shortHex,
} from "@/packages/shared/format";

const RELATED = [
  { href: "/intent", label: "Intent review", note: "claims and rule set" },
  { href: "/timeline", label: "Version history", note: "hashes and evidence" },
  { href: "/graph", label: "Disclosure graph", note: "wallet links" },
  { href: "/vote", label: "Vote record", note: "brief and ballot" },
  { href: "/arena", label: "Red-team arena", note: "11 scenarios" },
  { href: "/scorecard", label: "Scorecard", note: "what is proven" },
];

export default function TrailPage() {
  const demo = getDemo();
  const main = demo.mainRun;
  const tentativeUpgrade = demo.extracted.actions.find(
    (action) => action.kind === "UPGRADE"
  );
  const queued = main.submitted[0];

  return (
    <div className="doc-page">
      <aside className="doc-margin">
        <div className="doc-folio">Record 01</div>
        <div className="doc-folio mt-1">AIP-042</div>
        <div className="doc-folio mt-1">25 Oct 2026</div>
        <div className="mt-7 border-t border-edge pt-3">
          <div className="doc-note">Execution blocked</div>
          <div className="doc-note mt-1">Disclosure challenged</div>
          <div className="doc-note mt-1">Reference model</div>
        </div>
        <div className="mt-6">
          <ModelBadge />
        </div>
      </aside>

      <div className="doc-body">
        <div className="border-l-2 border-danger pl-3 text-[12px] leading-relaxed text-dim">
          <span className="text-danger">Execution blocked.</span> The queued
          transaction was rejected at the executor. A disclosure challenge is open.
        </div>

        <header className="mt-7">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="doc-folio">Proposal AIP-042 · Decision trail</span>
            <StatusPill status="REJECTED">rejected</StatusPill>
          </div>
          <h1 className="doc-title mt-2 text-body">Ecosystem Growth Grant</h1>
          <p className="doc-deck mt-4">
            GrowthLabs and Developer Guild requested 250,000 USDC. The proposal
            authorized two one-time transfers and a 5,000 USDC allowance. The
            queued call upgrades the treasury proxy; the executor rejects it with{" "}
            <span className="font-mono text-[15px] text-danger">
              SelectorNotAuthorized
            </span>
            .
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <Link href={`/arena/${main.scenario.id}`} className="btn btn-primary">
              Open violation report
            </Link>
            <Link href="/intent" className="btn">
              Review the intent
            </Link>
            <Link href="/arena" className="btn">
              Run the arena
            </Link>
          </div>
        </header>

        <section className="doc-section">
          <div className="doc-section-head">
            <h2 className="doc-section-title">Record</h2>
            <span className="doc-folio">v{demo.committed.version}</span>
          </div>
          <table className="doc-ledger">
            <tbody>
              <tr>
                <th className="w-[120px]">Requested</th>
                <td className="font-mono text-[13px]">
                  {formatNumber(Number(demo.proposal.requestedUsdc), 0)} USDC
                </td>
              </tr>
              <tr>
                <th>Recipients</th>
                <td>
                  {demo.proposal.recipients.map((recipient) => (
                    <div
                      key={recipient.address}
                      className="flex flex-wrap items-baseline justify-between gap-2"
                    >
                      <span>
                        {recipient.name}{" "}
                        <span className="font-mono text-[10.5px] text-faint">
                          {shortAddress(recipient.address)}
                        </span>
                      </span>
                      <span className="font-mono text-[11px]">
                        {formatNumber(Number(recipient.amountUsdc), 0)}
                      </span>
                    </div>
                  ))}
                </td>
              </tr>
              <tr>
                <th>Proposer</th>
                <td>{demo.proposal.proposer.name}</td>
              </tr>
              <tr>
                <th>Versions</th>
                <td>
                  {demo.versions.length}, hash-chained. Current version{" "}
                  {demo.committed.version}.
                </td>
              </tr>
              <tr>
                <th>Timelock</th>
                <td>Elapsed. Execution attempt rejected.</td>
              </tr>
              <tr>
                <th>Disclosure</th>
                <td className="text-danger">
                  Challenge filed. Two wallets disclosed, three discovered.
                </td>
              </tr>
              <tr>
                <th>Commitment</th>
                <td className="font-mono text-[11px]">
                  {shortHex(demo.commitment, 12)}
                </td>
              </tr>
            </tbody>
          </table>
          <div className="mt-3">
            <HashLine label="Committed intent hash" value={demo.intentHash} />
            <HashLine label="Evidence root" value={demo.manifest.root} />
          </div>
        </section>

        <section className="doc-section">
          <div className="doc-section-head">
            <h2 className="doc-section-title">Process</h2>
            <span className="doc-folio">claims → conflict → vote → execution</span>
          </div>
          <StagePipeline stages={demo.chain.stages} />
          <p className="doc-note mt-3">
            Claims, conflict and voting are advisory. Execution is a binary gate.
            Higher is better for claims and voting; conflict is a risk score.
          </p>
        </section>

        <section className="doc-section">
          <div className="doc-section-head">
            <h2 className="doc-section-title">What the proposal said, what the call does</h2>
            <span className="doc-folio">§5 · implementation note</span>
          </div>
          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <div className="doc-folio">The proposal said</div>
              <blockquote className="doc-quote mt-3 text-body">
                We will align the treasury implementation with the program&apos;s
                delivery roadmap during the grant period.
              </blockquote>
              <div className="mt-4 flex flex-wrap items-start gap-2">
                {tentativeUpgrade ? (
                  <SourceChip source={tentativeUpgrade.source} />
                ) : null}
                <span className="doc-note max-w-[34ch]">
                  Jargon, not a rule. No upgrade appears in the committed intent.
                </span>
              </div>
            </div>

            <div>
              <div className="doc-folio">The queued call does</div>
              <div className="mt-3 font-mono text-[14px] text-danger">
                {queued?.function ?? "—"}
              </div>
              <p className="mt-1 text-[15px] leading-snug text-body">
                {queued?.humanText ?? "No submitted action."}
              </p>
              <table className="doc-ledger mt-4">
                <tbody>
                  <tr>
                    <th className="w-[110px]">Target</th>
                    <td className="font-mono text-[11px]">
                      {shortAddress(queued?.target ?? "0x")}
                    </td>
                  </tr>
                  <tr>
                    <th>New implementation</th>
                    <td className="font-mono text-[11px]">
                      {shortAddress(queued?.args.arg0 ?? "0x")}
                    </td>
                  </tr>
                  <tr>
                    <th>Committed actions</th>
                    <td>{demo.approvedCalls.length} approved, 1 submitted.</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-3 border-l-2 border-danger pl-3 text-[12px] leading-relaxed text-dim">
                <span className="font-mono text-[11px] text-danger">
                  {main.code}
                </span>
                . upgradeTo was never in the commitment.
              </p>
            </div>
          </div>
        </section>

        <section className="doc-section">
          <div className="doc-section-head">
            <h2 className="doc-section-title">Attention queue</h2>
            <span className="doc-folio">
              {demo.attention.length} proposals, fixture
            </span>
          </div>
          <table className="doc-ledger">
            <thead>
              <tr>
                <th className="w-[78px]">ID</th>
                <th>Proposal</th>
                <th>State</th>
                <th>Conflict</th>
              </tr>
            </thead>
            <tbody>
              {demo.attention.map((proposal) => (
                <tr key={proposal.id}>
                  <td className="whitespace-nowrap font-mono text-[10.5px] text-faint">
                    {proposal.id}
                  </td>
                  <td>
                    {proposal.title}
                    {proposal.youAreHere ? (
                      <span className="ml-2 text-[10px] text-danger">
                        current
                      </span>
                    ) : null}
                  </td>
                  <td className="text-[11.5px]">{proposal.state}</td>
                  <td
                    className={
                      proposal.coi >= 0.65
                        ? "text-danger"
                        : proposal.coi >= 0.35
                          ? "text-signal"
                          : "text-body"
                    }
                  >
                    {proposal.coi.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="doc-note mt-2">
            The queue is a fixture; only AIP-042 is wired to the full flow.
          </p>
        </section>

        <section className="doc-section">
          <h2 className="doc-section-title">Related records</h2>
          <div className="mt-2 grid gap-x-10 sm:grid-cols-2">
            {RELATED.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-baseline justify-between gap-3 border-b border-edge/60 py-2 text-[12.5px] hover:text-danger"
              >
                <span>{item.label}</span>
                <span className="doc-note">{item.note}</span>
              </Link>
            ))}
          </div>
        </section>

        <footer className="doc-section doc-note">
          The AIP-042 trail is a TypeScript reference model over labelled fixtures.
          The live local chain is at <Link href="/live" className="underline decoration-danger/50 underline-offset-2">/live</Link>.
          Do not present the reference model as an on-chain guarantee.
        </footer>
      </div>
    </div>
  );
}
