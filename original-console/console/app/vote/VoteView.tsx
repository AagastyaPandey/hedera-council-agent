"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  Fingerprint,
  Lock,
  ShieldCheck,
  Users,
} from "lucide-react";
import { getDemo } from "@/lib/demo";
import { scoreVoting, type Vote, type VotesFixture } from "@/chain-scoring/score";
import { ENTITY_LABELS } from "@/packages/shared/addresses";
import { formatNumber, formatPercent, shortAddress, shortHex } from "@/packages/shared/format";
import type { ActionSpec } from "@/packages/shared/schemas";
import { CopyButton } from "@/components/CopyButton";
import {
  Callout,
  Panel,
  RiskMeter,
  SectionHeader,
  StatusPill,
  cn,
} from "@/components/ui";

const SIMULATED_WEIGHT = "25000";
const STAGE_LABELS = {
  CLAIMS: "Claims",
  COI: "Conflict",
  VOTING: "Voting",
  EXECUTION: "Execution",
} as const;

const CHOICES: { value: Vote["support"]; label: string; description: string }[] = [
  { value: "FOR", label: "For", description: "Approve the committed intent." },
  { value: "AGAINST", label: "Against", description: "Reject the commitment." },
  { value: "ABSTAIN", label: "Abstain", description: "Count toward quorum only." },
];

function entity(address: string): string {
  return ENTITY_LABELS[address.toLowerCase()]?.label ?? shortAddress(address);
}

function actionSummary(action: ActionSpec): string {
  switch (action.kind) {
    case "ERC20_TRANSFER":
      return `${formatNumber(Number(BigInt(action.maxAmount) / 1_000_000n), 0)} USDC to ${entity(action.counterparty)}`;
    case "ERC20_APPROVE":
      return `${formatNumber(Number(BigInt(action.maxAmount) / 1_000_000n), 0)} USDC allowance to ${entity(action.counterparty)}`;
    case "UPGRADE":
      return `Upgrade ${entity(action.target)} to ${entity(action.counterparty)}`;
    default:
      return action.label ?? action.kind;
  }
}

function TallyRow({
  label,
  weight,
  total,
  tone,
}: {
  label: string;
  weight: number;
  total: number;
  tone: "safe" | "danger" | "neutral";
}) {
  const percent = total === 0 ? 0 : (weight / total) * 100;
  const color =
    tone === "danger"
      ? "var(--color-danger)"
      : tone === "neutral"
        ? "var(--color-faint)"
        : "var(--color-body)";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 font-sans text-[11px]">
        <span className={tone === "danger" ? "text-danger" : tone === "neutral" ? "text-faint" : "text-body"}>
          {label}
        </span>
        <span className="font-mono text-[10px] text-faint">
          {formatNumber(weight, 0)} ({percent.toFixed(1)}%)
        </span>
      </div>
      <div className="mt-1 h-px bg-edge">
        <div
          className="h-px"
          style={{ width: `${percent}%`, background: color, transition: "width 400ms ease" }}
        />
      </div>
    </div>
  );
}

export function VoteView() {
  const demo = getDemo();
  const [acknowledged, setAcknowledged] = useState(false);
  const [choice, setChoice] = useState<Vote["support"] | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const projectedFixture = useMemo<VotesFixture>(() => {
    if (!submitted || !choice) return demo.votes;
    return {
      ...demo.votes,
      votes: [
        ...demo.votes.votes,
        {
          id: "demo-you",
          voter: "0x0000000000000000000000000000000000000001",
          label: "You (demo)",
          weight: SIMULATED_WEIGHT,
          support: choice,
          sawCurrentBrief: true,
          briefVersion: demo.committed.version,
          overlap: null,
        },
      ],
    };
  }, [choice, demo, submitted]);

  const projected = useMemo(
    () => scoreVoting(projectedFixture, demo.committed.version),
    [projectedFixture, demo.committed.version],
  );
  const current = demo.voting;
  const metrics = submitted ? projected.metrics : current.metrics;
  const tallyTotal = metrics.forWeight + metrics.againstWeight + metrics.abstainWeight;

  const stage = (key: string) => demo.chain.stages.find((item) => item.stage === key);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,0.8fr)]">
      <div className="space-y-4">
        <section id="brief">
          <SectionHeader
            title="Risk brief"
            description="The brief is the source of the vote receipt. It is generated from the committed intent, the graph, the vote ledger and the execution gate."
            right={
              <div className="flex items-center gap-3">
                <span className="doc-folio">
                  AIP-042, {formatNumber(Number(demo.proposal.requestedUsdc), 0)} USDC
                </span>
                <CopyButton value={demo.briefHash} label="Brief hash" />
              </div>
            }
          />
          <Panel>
            <div className="border-b border-edge px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="mono-label">What this vote authorizes</span>
                <span className="font-mono text-[9px] text-faint">{shortHex(demo.briefHash, 7)}</span>
              </div>
              <div className="mt-2 space-y-1.5">
                {demo.committed.actions.map((action, index) => (
                  <div key={`${action.kind}-${index}`} className="flex items-center gap-2.5">
                    <span className="font-mono text-[9px] text-faint">{String(index + 1).padStart(2, "0")}</span>
                    <span className="flex-1 text-[11.5px] text-dim">{actionSummary(action)}</span>
                    <span className="chip">{action.kind.replaceAll("_", " ")}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="chip">intentHash {shortHex(demo.intentHash, 6)}</span>
                <span className="chip">3 rules, 3 assumptions</span>
                <Link href="/intent" className="arrow-link">
                  Review the intent
                </Link>
              </div>
            </div>

            <div className="grid gap-0 sm:grid-cols-2">
              {(["CLAIMS", "COI", "VOTING", "EXECUTION"] as const).map((key) => {
                const item = stage(key);
                if (!item) return null;
                const hard = key === "EXECUTION";
                return (
                  <Link
                    key={key}
                    href={item.drilldown}
                    className={cn(
                      "group border-b border-edge px-4 py-3 transition-colors hover:bg-white/[0.02] sm:odd:border-r",
                      hard && "bg-danger/3",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="mono-label">{STAGE_LABELS[key]}</span>
                      <StatusPill status={item.status} />
                    </div>
                    <div className="mt-1.5 flex items-baseline gap-2">
                      <span className={cn("font-mono text-[14px]", hard ? "text-danger" : "text-body")}>
                        {hard ? "GATE" : item.score?.toFixed(2)}
                      </span>
                      <span className="text-[10px] leading-snug text-dim">{item.reason}</span>
                    </div>
                    <span className="mt-1 inline-flex items-center gap-1 font-sans text-[10px] text-faint group-hover:text-danger">
                      notes
                    </span>
                  </Link>
                );
              })}
            </div>

            <div className="border-l-2 border-danger py-2 pl-3">
              <div className="flex items-start gap-2">
                <Lock size={13} className="mt-0.5 shrink-0 text-danger" />
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-danger">
                    The queued transaction is already rejected
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-dim">
                    The queued call upgrades TreasuryProxy to an unrecognized implementation. The
                    executor returns{" "}
                    <code className="text-steel">{demo.mainRun.code}</code>. A yes vote cannot make
                    the uncommitted upgrade executable.
                  </p>
                  <Link
                    href={`/arena/${demo.mainRun.scenario.id}`}
                    className="mt-1.5 inline-flex items-center gap-1 font-sans text-[11px] text-danger underline decoration-danger/40 underline-offset-2"
                  >
                    Open the report
                  </Link>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <span className="inline-flex items-center gap-1.5 text-[10px] text-dim">
                <Fingerprint size={12} className="text-safe" /> {demo.manifest.docs.length} documents anchored
              </span>
              <span className="inline-flex items-center gap-1.5 text-[10px] text-dim">
                <AlertTriangle size={12} className="text-signal" /> COI {demo.graph.overallRisk.toFixed(2)} RED
              </span>
              <Link href="/graph" className="arrow-link">
                Graph
              </Link>
              <Link href="/timeline" className="arrow-link">
                Evidence
              </Link>
            </div>

            <div className="border-t border-edge px-4 py-3">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  disabled={submitted}
                  className="mt-0.5 size-4 shrink-0 accent-[#c62f1c]"
                />
                <span className="text-[11.5px] leading-relaxed text-dim">
                  I have read this brief and understand that the queued transaction is blocked. I am
                  voting on the committed intent — two transfers and a bounded allowance — not on the
                  proposal summary.
                </span>
              </label>
              {!acknowledged ? (
                <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.08em] text-signal">
                  acknowledgment required before voting
                </div>
              ) : null}
            </div>
          </Panel>
        </section>

        <section>
          <SectionHeader
            title="Attention queue"
            description="The queue is a demo fixture; only AIP-042 is wired to the full flow."
            right={<span className="doc-folio">3 proposals</span>}
          />
          <Panel className="divide-y divide-edge/70">
            {demo.attention.map((proposal, index) => (
              <div key={proposal.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="font-mono text-[10px] text-faint">{String(index + 1).padStart(2, "0")}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px] text-body">{proposal.id}</span>
                    <span className="text-[11px] text-dim">{proposal.title}</span>
                    {proposal.youAreHere ? (
                      <span className="chip border-danger/30 text-danger">you are here</span>
                    ) : (
                      <span className="chip">preview</span>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <RiskMeter
                      value={proposal.coi}
                      status={proposal.coi >= 0.65 ? "RED" : proposal.coi >= 0.35 ? "AMBER" : "GREEN"}
                      className="max-w-40 flex-1"
                    />
                    <span className="font-mono text-[8.5px] text-faint">
                      COI {proposal.coi.toFixed(2)}, vote {(proposal.voting * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
                <span
                  className={cn(
                    "font-mono text-[9px] uppercase tracking-[0.08em]",
                    proposal.execution === "RED"
                      ? "text-danger"
                      : proposal.execution === "AMBER"
                        ? "text-signal"
                        : "text-safe",
                  )}
                >
                  {proposal.state}
                </span>
                {proposal.youAreHere ? (
                  <Link href={`/arena/${demo.mainRun.scenario.id}`} className="btn btn-sm">
                    Report
                  </Link>
                ) : null}
              </div>
            ))}
          </Panel>
        </section>

        <details className="panel group p-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Users size={14} className="text-signal" />
              <span className="text-[12.5px] text-body">Vote ledger, {demo.votes.votes.length} voters</span>
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-faint group-open:hidden">
              show
            </span>
          </summary>
          <div className="mt-3 divide-y divide-edge/70">
            {demo.votes.votes.map((vote) => (
              <div key={vote.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-32 flex-1 text-[10.5px] text-dim">{vote.label}</span>
                <span className="w-20 font-mono text-[9.5px] text-steel">{formatNumber(Number(vote.weight), 0)}</span>
                <span
                  className={cn(
                    "w-16 font-mono text-[9px] uppercase",
                    vote.support === "FOR"
                      ? "text-safe"
                      : vote.support === "AGAINST"
                        ? "text-danger"
                        : "text-faint",
                  )}
                >
                  {vote.support}
                </span>
                <span className={cn("w-24 font-mono text-[8.5px] uppercase", vote.sawCurrentBrief ? "text-safe" : "text-signal")}>
                  {vote.sawCurrentBrief ? "brief seen" : "no brief"}
                </span>
                {vote.overlap ? (
                  <span className="chip border-danger/30 text-danger">flagged overlap</span>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      </div>

      <aside id="cast" className="space-y-4 self-start xl:sticky xl:top-[80px]">
        <Panel>
          <div className="flex items-center justify-between gap-2 border-b border-edge px-4 py-3">
            <span className="text-[12.5px] font-medium text-body">Tally</span>
            <StatusPill status={submitted ? projected.status : current.status}>
              {submitted ? "projected" : null}
            </StatusPill>
          </div>
          <div className="space-y-3 px-4 py-4">
            <TallyRow label="For" weight={metrics.forWeight} total={tallyTotal} tone="safe" />
            <TallyRow label="Against" weight={metrics.againstWeight} total={tallyTotal} tone="danger" />
            <TallyRow label="Abstain" weight={metrics.abstainWeight} total={tallyTotal} tone="neutral" />
            <div className="flex items-center justify-between gap-2 border-t border-edge/70 pt-3 font-mono text-[9px] uppercase tracking-[0.08em] text-faint">
              <span>cast weight</span>
              <span className="text-steel">
                {formatNumber(tallyTotal, 0)} / {formatNumber(Number(demo.votes.eligibleWeight), 0)}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-edge/70 pt-3">
              <div>
                <div className="mono-label">Informed</div>
                <div className="mt-1 font-mono text-[17px] text-signal">
                  {formatPercent(metrics.informedRatio, 1)}
                </div>
                <div className="mt-1 text-[9px] text-faint">
                  {submitted ? `from ${formatPercent(current.metrics.informedRatio, 1)}` : "current brief only"}
                </div>
              </div>
              <div>
                <div className="mono-label">Turnout</div>
                <div className="mt-1 font-mono text-[17px] text-steel">
                  {formatPercent(metrics.turnout, 1)}
                </div>
                <div className="mt-1 text-[9px] text-faint">quorum 40%</div>
              </div>
            </div>
            {submitted ? (
              <div className="border-l-2 border-signal pl-3 font-sans text-[10.5px] text-signal">
                Includes your 25,000 simulated weight.
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel>
          <div className="border-b border-edge px-4 py-3">
            <span className="text-[12.5px] font-medium text-body">Your vote</span>
          </div>
          <div className="p-4">
            <div className="grid gap-1.5">
              {CHOICES.map((option) => {
                const active = choice === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setChoice(option.value)}
                    disabled={!acknowledged || submitted}
                    className={cn(
                      "border-b border-edge py-2 pl-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                      active
                        ? "border-l-2 border-danger"
                        : "border-l-2 border-transparent hover:border-l-edge2",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-medium text-body">{option.label}</span>
                      {active ? <Check size={13} className="text-danger" /> : null}
                    </div>
                    <div className="mt-0.5 text-[10px] text-faint">{option.description}</div>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setSubmitted(true)}
              disabled={!acknowledged || !choice || submitted}
              className="btn btn-primary mt-3 w-full"
            >
              <Lock size={12} />
              Cast vote with brief
            </button>
            {!acknowledged ? (
              <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.06em] text-signal">
                acknowledge the brief to unlock the vote
              </p>
            ) : !choice ? (
              <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.06em] text-faint">
                choose for, against or abstain
              </p>
            ) : null}
            <p className="mt-2 text-[9.5px] leading-relaxed text-faint">
              Local demo. No vote is broadcast. The receipt records{" "}
              <code className="text-steel">briefHash {shortHex(demo.briefHash, 5)}</code>, the exact
              brief version you saw.
            </p>

            {submitted && choice ? (
              <div className="mt-3 rounded-lg border border-safe/30 bg-safe/5 p-3">
                <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.1em] text-safe">
                  <Check size={12} /> receipt recorded, {choice}
                </div>
                <div className="mt-2 space-y-1 font-mono text-[9px] text-faint">
                  <div className="flex justify-between gap-2">
                    <span>weight</span>
                    <span className="text-steel">25,000 simulated</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>brief hash</span>
                    <span className="text-steel">{shortHex(demo.briefHash, 6)}</span>
                  </div>
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-dim">
                  Informed ratio would move from{" "}
                  {formatPercent(current.metrics.informedRatio, 1)} to{" "}
                  {formatPercent(projected.metrics.informedRatio, 1)}. The fixture tally is unchanged;
                  this is a projection.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSubmitted(false);
                    setChoice(null);
                    setAcknowledged(false);
                  }}
                  className="mt-2 font-mono text-[9px] uppercase tracking-[0.08em] text-faint hover:text-body"
                >
                  reset demo vote
                </button>
              </div>
            ) : null}
          </div>
        </Panel>

        <Callout tone="info" title="Why a brief hash, not a checkbox">
          A vote can be transparent and still uninformed. The receipt binds the voter to the brief
          version they saw; the tally can then separate informed weight from weight that never
          opened the brief.
        </Callout>

        <div className="flex items-center gap-2 rounded-lg border border-edge bg-white/2 px-3 py-2">
          <ShieldCheck size={12} className="text-safe" />
          <span className="text-[10px] leading-snug text-faint">
            Vote weights, addresses and the overlap flag are simulated. The tally math is code.
          </span>
        </div>
      </aside>
    </div>
  );
}
