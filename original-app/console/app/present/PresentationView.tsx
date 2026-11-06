"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Expand,
  ExternalLink,
  Fingerprint,
  Lock,
  Minimize2,
  ShieldCheck,
  X,
} from "lucide-react";
import { getDemo, type Demo } from "@/lib/demo";
import { formatNumber, formatPercent, shortAddress } from "@/packages/shared/format";
import { ReportDownload } from "@/components/ReportDownload";
import { StatusPill, cn, statusTextClass } from "@/components/ui";

const TOTAL = 7;
const PAD = (value: number) => String(value).padStart(2, "0");

const SLIDE_TITLES = [
  "The verdict",
  "Decision Trail",
  "The gap",
  "Conflict of interest",
  "Informed voting",
  "Execution gate",
  "What we can prove",
];

function SlideFrame({
  number,
  eyebrow,
  title,
  subtitle,
  children,
  href,
  action,
}: {
  number: number;
  eyebrow: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  href: string;
  action: string;
}) {
  return (
    <section
      aria-roledescription="slide"
      aria-label={`Slide ${number} of ${TOTAL}: ${eyebrow}`}
      className="mx-auto flex min-h-[calc(100svh-136px)] w-full max-w-[1440px] flex-col justify-center px-5 py-8 sm:px-8 lg:px-14"
    >
      <div className="flex items-center gap-3">
        <span className="font-mono text-[10px] tracking-[0.12em] text-signal">
          SLIDE {PAD(number)}
        </span>
        <span className="h-px w-10 bg-signal/40" />
        <span className="mono-label">{eyebrow}</span>
      </div>
      <h1 className="mt-3 max-w-5xl text-[clamp(30px,4.5vw,64px)] font-semibold leading-[0.98] tracking-[-0.045em] text-body">
        {title}
      </h1>
      {subtitle ? (
        <p className="mt-3 max-w-3xl text-[clamp(12px,1.3vw,15px)] leading-relaxed text-dim">
          {subtitle}
        </p>
      ) : null}
      <div className="mt-6 flex flex-1 flex-col justify-center">{children}</div>
      <div className="mt-6 flex items-center justify-between gap-3 border-t border-edge/70 pt-3">
        <span className="mono-label">AegisDAO IntentLock · AIP-042</span>
        <Link href={href} className="arrow-link text-[10px]">
          {action}
          <ExternalLink size={12} />
        </Link>
      </div>
    </section>
  );
}

function CommitmentSeal({ demo }: { demo: Demo }) {
  return (
    <div className="relative mx-auto grid aspect-square w-full max-w-[360px] place-items-center rounded-full border border-signal/25 bg-[radial-gradient(circle_at_center,rgba(241,181,74,0.14),transparent_68%)]">
      <div className="absolute inset-4 rounded-full border border-dashed border-signal/20" />
      <div className="absolute inset-10 rounded-full border border-signal/15" />
      <div className="absolute inset-16 rounded-full border border-signal/10" />
      <div className="relative flex flex-col items-center px-10 text-center">
        <ShieldCheck size={30} strokeWidth={1.5} className="text-signal" />
        <div className="mono-label mt-3">Committed intent</div>
        <div className="mt-1 font-mono text-[30px] leading-none tracking-[0.08em] text-body">
          AIP-042
        </div>
        <div className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-signal">
          v3 · 3 actions
        </div>
        <div className="mt-5 max-w-[230px] break-all font-mono text-[8px] leading-relaxed text-faint">
          {demo.intentHash}
        </div>
        <div className="mt-4 border-t border-signal/20 pt-2 text-[8px] uppercase tracking-[0.12em] text-faint">
          sealed at vote open
        </div>
      </div>
    </div>
  );
}

function FlowNode({
  name,
  sub,
  tone,
}: {
  name: string;
  sub: string;
  tone: "info" | "danger" | "neutral";
}) {
  const styles =
    tone === "info"
      ? "border-info/40 bg-info/6 text-info"
      : tone === "danger"
        ? "border-danger/40 bg-danger/6 text-danger"
        : "border-edge2 bg-white/[0.02] text-steel";
  return (
    <div className={cn("flex min-w-0 flex-col items-center justify-center border px-3 py-4 text-center", styles)}>
      <div className="text-[13px] font-medium text-body">{name}</div>
      <div className="mt-1 font-mono text-[8px] uppercase tracking-[0.08em] opacity-75">{sub}</div>
    </div>
  );
}

function FlowArrow({ amount, label }: { amount: string; label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-1 sm:py-0">
      <span className="font-mono text-[10px] text-steel">{amount}</span>
      <span className="hidden h-px w-full min-w-8 bg-danger/60 sm:block" />
      <ArrowRight size={13} className="hidden text-danger sm:block" />
      <ArrowRight size={13} className="rotate-90 text-danger sm:hidden" />
      {label ? <span className="font-mono text-[7.5px] uppercase tracking-[0.08em] text-faint">{label}</span> : null}
    </div>
  );
}

function BigStat({
  label,
  value,
  tone = "default",
  sub,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "safe" | "warn" | "danger";
  sub?: string;
}) {
  const color =
    tone === "safe" ? "text-safe" : tone === "warn" ? "text-signal" : tone === "danger" ? "text-danger" : "text-body";
  return (
    <div className="border border-edge bg-white/[0.015] p-4">
      <div className="mono-label">{label}</div>
      <div className={cn("mt-2 font-mono text-[clamp(24px,3vw,36px)] leading-none", color)}>{value}</div>
      {sub ? <div className="mt-1.5 text-[10px] leading-snug text-faint">{sub}</div> : null}
    </div>
  );
}

function VerdictSlide({ demo }: { demo: Demo }) {
  const main = demo.mainRun;
  const blockers = [
    { label: "executor", value: main.code, tone: "danger" as const },
    { label: "disclosure", value: "undisclosed funder link", tone: "danger" as const },
    { label: "vote", value: `${formatPercent(demo.voting.metrics.informedRatio)} informed`, tone: "warn" as const },
  ];
  return (
    <SlideFrame
      number={1}
      eyebrow="The verdict"
      title={
        <>
          The proposal passed.
          <br />
          <span className="text-danger">The transaction doesn&apos;t match it.</span>
        </>
      }
      subtitle="AIP-042 authorized two one-time grants and a bounded allowance. The queued call upgrades the treasury proxy. The executor rejects it, and the disclosure is incomplete."
      href="/trail"
      action="Open the live trail"
    >
      <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="flex flex-col justify-center gap-3">
          <div className="grid gap-2 sm:grid-cols-3">
            {blockers.map((blocker) => (
              <div
                key={blocker.label}
                className={cn(
                  "border-l-2 bg-white/[0.015] px-3 py-2.5",
                  blocker.tone === "danger" ? "border-danger" : "border-signal",
                )}
              >
                <div className="font-mono text-[8px] uppercase tracking-[0.12em] text-faint">
                  {blocker.label}
                </div>
                <div
                  className={cn(
                    "mt-1 truncate font-mono text-[12px] uppercase tracking-[0.02em]",
                    blocker.tone === "danger" ? "text-danger" : "text-signal",
                  )}
                >
                  {blocker.value}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-5 border border-edge bg-white/[0.015] p-5">
            <div>
              <div className="mono-label">Requested</div>
              <div className="font-mono text-[clamp(36px,4.5vw,58px)] leading-none tracking-tight text-body">
                {formatNumber(Number(demo.proposal.requestedUsdc), 0)}
              </div>
              <div className="mono-label mt-1">USDC</div>
            </div>
            <div className="hidden h-12 w-px bg-edge2 sm:block" />
            <div>
              <div className="mono-label">Committed</div>
              <div className="mt-1 font-mono text-[18px] text-body">3 actions · v3</div>
              <div className="mt-1 max-w-48 text-[10.5px] leading-snug text-dim">
                two transfers + a bounded allowance
              </div>
            </div>
            <div className="ml-auto rounded border border-danger/35 bg-danger/5 px-3 py-2 text-right">
              <div className="mono-label text-danger">Execution</div>
              <div className="font-mono text-[14px] text-danger">BLOCKED</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="chip">AIP-042</span>
            <span className="chip">25 oct 2026</span>
            <span className="chip border-signal/30 text-signal">reference model</span>
            <span className="chip">no chain running</span>
          </div>
        </div>

        <div className="hidden lg:block">
          <CommitmentSeal demo={demo} />
        </div>
      </div>
    </SlideFrame>
  );
}

function TrailSlide({ demo }: { demo: Demo }) {
  return (
    <SlideFrame
      number={2}
      eyebrow="Decision Trail"
      title="Four stages. One hard gate."
      subtitle="Claims answer “is it sourced?” COI answers “who benefits?” Voting answers “was the vote informed?” Execution answers “does the calldata match?” Only the last one is deterministic."
      href="/trail"
      action="Open the trail"
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {demo.chain.stages.map((stage, index) => {
          const hard = stage.stage === "EXECUTION";
          const tone = stage.status === "GREEN" ? "safe" : stage.status === "AMBER" ? "warn" : "danger";
          return (
            <div
              key={stage.stage}
              className={cn(
                "relative border bg-white/[0.015] p-5",
                hard ? "border-danger/30" : "border-edge",
              )}
            >
              <span
                className={cn(
                  "absolute inset-x-0 top-0 h-[2px]",
                  stage.status === "GREEN" ? "bg-safe" : stage.status === "AMBER" ? "bg-signal" : "bg-danger",
                )}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="mono-label">0{index + 1}</span>
                <StatusPill status={stage.status} />
              </div>
              <div className="mt-6 flex items-center gap-3">
                {hard ? (
                  <div className="grid size-16 place-items-center rounded-full border border-danger/40 text-danger">
                    <Lock size={22} />
                  </div>
                ) : (
                  <div className={cn("font-mono text-[clamp(30px,3.5vw,44px)] leading-none", statusTextClass(stage.status))}>
                    {stage.score?.toFixed(2)}
                  </div>
                )}
                <div>
                  <div className="text-[15px] font-medium text-body">
                    {stage.stage === "CLAIMS"
                      ? "Claims"
                      : stage.stage === "COI"
                        ? "Conflict"
                        : stage.stage === "VOTING"
                          ? "Voting"
                          : "Execution"}
                  </div>
                  <div className="mono-label mt-0.5">{hard ? "binary gate" : stage.stage === "COI" ? "risk" : "score"}</div>
                </div>
              </div>
              <p className="mt-5 text-[11.5px] leading-snug text-dim">{stage.reason}</p>
              <div className={cn("mt-4 h-1.5 w-full", tone === "safe" ? "bg-safe/30" : tone === "warn" ? "bg-signal/30" : "bg-danger/30")}>
                <div
                  className={cn("h-full", tone === "safe" ? "bg-safe" : tone === "warn" ? "bg-signal" : "bg-danger")}
                  style={{ width: `${stage.score === null ? 100 : Math.max(4, stage.score * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-5 flex flex-col gap-3 border border-signal/25 bg-signal/[0.03] px-4 py-3 sm:flex-row sm:items-center">
        <div className="grid size-8 shrink-0 place-items-center border border-signal/40 text-signal">
          <Lock size={14} />
        </div>
        <p className="text-[12.5px] leading-relaxed text-dim">
          <span className="font-medium text-body">Three advisory stages. One hard gate.</span>{" "}
          A good average cannot unblock a rejected call.
        </p>
        <span className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] text-signal">
          execution is binary
        </span>
      </div>
    </SlideFrame>
  );
}

function GapSlide({ demo }: { demo: Demo }) {
  const main = demo.mainRun;
  const queued = main.submitted[0];
  return (
    <SlideFrame
      number={3}
      eyebrow="The gap"
      title={
        <>
          Said one thing.
          <br />
          <span className="text-danger">Would do another.</span>
        </>
      }
      href={`/arena/${main.scenario.id}`}
      action="Open the full report"
    >
      <div className="grid items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr]">
        <div className="border border-edge bg-white/[0.015] p-5 sm:p-6">
          <div className="mono-label">The proposal said</div>
          <div className="mt-4 text-[clamp(18px,2.1vw,27px)] font-medium leading-[1.35] tracking-[-0.01em] text-body">
            &ldquo;{main.report.proposalSaid}&rdquo;
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="chip">§5 · implementation note</span>
            <span className="chip">proposal text</span>
          </div>
        </div>

        <div className="grid place-items-center py-1">
          <div className="grid size-12 place-items-center rounded-full border border-danger/40 bg-danger/8 font-mono text-[24px] text-danger">
            ≠
          </div>
        </div>

        <div className="border border-danger/30 bg-danger/[0.03] p-5 sm:p-6">
          <div className="mono-label text-danger">The queued call would do</div>
          <div className="mt-4 font-mono text-[15px] text-danger">{queued?.function}</div>
          <div className="mt-2 text-[clamp(17px,2vw,24px)] leading-snug text-body">
            {queued?.humanText}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <div className="border border-edge bg-ink/35 px-3 py-2">
              <div className="mono-label">target</div>
              <div className="mt-1 font-mono text-[10px] text-steel">{shortAddress(queued?.target ?? "0x")}</div>
            </div>
            <div className="border border-edge bg-ink/35 px-3 py-2">
              <div className="mono-label">new implementation</div>
              <div className="mt-1 font-mono text-[10px] text-steel">{shortAddress(queued?.args.arg0 ?? "0x")}</div>
            </div>
          </div>
          <div className="mt-4 inline-flex border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-danger">
            {main.code}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="chip">3 committed actions</span>
        <span className="chip">1 submitted call</span>
        <span className="chip border-danger/30 text-danger">commitment differs</span>
        <span className="chip">no upgrade rule</span>
      </div>
    </SlideFrame>
  );
}

function GraphSlide({ demo }: { demo: Demo }) {
  return (
    <SlideFrame
      number={4}
      eyebrow="Conflict of interest"
      title={
        <>
          The disclosure is incomplete.
          <br />
          <span className="text-signal">The funding path is not.</span>
        </>
      }
      subtitle="A disclosed proposer wallet funded an undisclosed operations wallet, which funded the GrowthLabs deployer 19 days before the proposal. This is a risk signal with transactions attached — not a conclusion of wrongdoing."
      href="/graph"
      action="Open the wallet graph"
    >
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="border border-edge bg-white/[0.015] p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="mono-label">The money path</span>
            <span className="chip border-danger/30 text-danger">simulated data</span>
          </div>
          <div className="mt-6 grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
            <FlowNode name="Nova Main" sub="proposer · disclosed" tone="info" />
            <FlowArrow amount="120,000" label="funded" />
            <FlowNode name="Nova Ops" sub="undisclosed" tone="danger" />
            <FlowArrow amount="40,000" label="19 days before" />
            <FlowNode name="GL Deployer" sub="recipient deployer" tone="neutral" />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="chip">Funder X</span>
            <span className="text-[10.5px] text-dim">funded both sides six minutes apart</span>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-4">
            <BigStat label="Direct" value="2" sub="0.48 each" tone="danger" />
            <BigStat label="Common funder" value="1" sub="0.38" tone="danger" />
            <BigStat label="Time correlated" value="1" sub="0.27" tone="danger" />
            <BigStat label="Disclosed" value="2" sub="of 5 wallets" />
          </div>
        </div>

        <div className="flex flex-col justify-between border border-danger/30 bg-danger/[0.03] p-5 sm:p-6">
          <div>
            <div className="mono-label text-danger">Noisy-OR risk</div>
            <div className="font-mono text-[clamp(48px,6vw,82px)] leading-none text-danger">
              {demo.graph.overallRisk.toFixed(2)}
            </div>
            <div className="mono-label mt-1">red threshold {demo.graph.thresholds.red.toFixed(2)}</div>
          </div>
          <div className="mt-5">
            <div className="h-2 w-full bg-edge">
              <div className="h-full bg-danger" style={{ width: `${demo.graph.overallRisk * 100}%` }} />
            </div>
            <p className="mt-3 text-[11.5px] leading-relaxed text-dim">
              4 links aggregate above the red threshold. Undisclosed links keep full weight.
            </p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <StatusPill status="RED">flagged</StatusPill>
            <span className="chip">real detection code</span>
            <span className="chip">simulated records</span>
          </div>
        </div>
      </div>
    </SlideFrame>
  );
}

function VoteSlide({ demo }: { demo: Demo }) {
  const metrics = demo.voting.metrics;
  const tally = [
    { label: "For", value: metrics.forWeight, tone: "safe" as const },
    { label: "Against", value: metrics.againstWeight, tone: "danger" as const },
    { label: "Abstain", value: metrics.abstainWeight, tone: "neutral" as const },
  ];
  return (
    <SlideFrame
      number={5}
      eyebrow="Informed voting"
      title={
        <>
          A transparent vote
          <br />
          <span className="text-signal">is not an informed one.</span>
        </>
      }
      href="/vote"
      action="Open the risk brief"
    >
      <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="border border-edge bg-white/[0.015] p-5 sm:p-6">
          <div className="mono-label">Informed weight</div>
          <div className="font-mono text-[clamp(54px,8vw,96px)] leading-none text-signal">
            {formatPercent(metrics.informedRatio, 0)}
          </div>
          <div className="mt-2 max-w-64 text-[12px] leading-relaxed text-dim">
            of cast weight recorded the current brief hash. The rest voted without it.
          </div>
          <div className="mt-6 grid grid-cols-2 gap-2">
            <BigStat label="Turnout" value={formatPercent(metrics.turnout, 0)} />
            <BigStat label="Quorum" value="met" tone="safe" />
            <BigStat label="Support" value={formatPercent(metrics.supportRatio, 1)} />
            <BigStat label="Overlap" value={`${metrics.overlapCount} voter`} tone="danger" />
          </div>
        </div>

        <div className="border border-edge bg-white/[0.015] p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="mono-label">The receipt binds to the brief hash</span>
            <StatusPill status="AMBER">0.71 amber</StatusPill>
          </div>
          <code className="hash mt-2 block break-all text-[10px]">{demo.briefHash}</code>
          <div className="mt-5 space-y-3">
            {tally.map((row) => (
              <div key={row.label}>
                <div className="flex justify-between font-mono text-[9px] uppercase tracking-[0.08em]">
                  <span className={row.tone === "safe" ? "text-safe" : row.tone === "danger" ? "text-danger" : "text-dim"}>
                    {row.label}
                  </span>
                  <span className="text-faint">{formatNumber(row.value, 0)}</span>
                </div>
                <div className="mt-1 h-1.5 bg-edge">
                  <div
                    className={row.tone === "safe" ? "h-full bg-safe" : row.tone === "danger" ? "h-full bg-danger" : "h-full bg-steel"}
                    style={{ width: `${(row.value / metrics.castWeight) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-5 border-l border-signal/30 pl-3 text-[11.5px] leading-relaxed text-dim">
            One 90,000-weight FOR voter is the undisclosed Nova Ops wallet. Informed consent is
            measurable, not assumed.
          </p>
        </div>
      </div>
    </SlideFrame>
  );
}

function ExecutorSlide({ demo }: { demo: Demo }) {
  const main = demo.mainRun;
  const queued = main.submitted[0];
  return (
    <SlideFrame
      number={6}
      eyebrow="Execution gate"
      title={
        <>
          The executor
          <br />
          <span className="text-danger">rejected it.</span>
        </>
      }
      href={`/arena/${main.scenario.id}`}
      action="Open the evidence report"
    >
      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="border border-danger/35 bg-danger/[0.03] p-5 sm:p-6">
          <div className="mono-label text-danger">Reference executor verdict</div>
          <div className="mt-2 font-mono text-[clamp(38px,5.5vw,72px)] leading-none text-danger">
            REJECTED
          </div>
          <div className="mt-3 font-mono text-[14px] text-body">{main.code}</div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-dim">{main.message}</p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <BigStat label="Approved" value="3" sub="decoded actions" />
            <BigStat label="Submitted" value="1" sub="decoded action" />
            <BigStat label="Commitment" value="≠" tone="danger" />
            <BigStat label="Layer" value="executor" />
          </div>
        </div>

        <div className="border border-edge bg-white/[0.015] p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <Fingerprint size={14} className="text-signal" />
            <span className="mono-label">The queued call</span>
          </div>
          <div className="mt-2 font-mono text-[14px] text-body">{queued?.humanText}</div>
          <div className="mt-4 border border-danger/25 bg-danger/4 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mono-label text-danger">violated constraint</span>
              <span className="font-mono text-[9px] text-faint">{main.report.violatedConstraint?.selector}</span>
            </div>
            <div className="mt-1 font-mono text-[11px] text-danger">{main.code}</div>
            <div className="mt-1 text-[10.5px] leading-relaxed text-dim">
              {main.report.violatedConstraint?.message}
            </div>
          </div>
          <div className="mt-4 space-y-1.5">
            <div className="mono-label">Evidence</div>
            <div className="border border-edge bg-ink/35 px-2.5 py-1.5">
              <span className="mono-label">approved commitment</span>
              <code className="hash mt-0.5 block text-[8.5px]">{main.approvedCommitment}</code>
            </div>
            <div className="border border-edge bg-ink/35 px-2.5 py-1.5">
              <span className="mono-label">submitted commitment</span>
              <code className="hash mt-0.5 block text-[8.5px]">{main.submittedCommitment}</code>
            </div>
            <div className="border border-edge bg-ink/35 px-2.5 py-1.5">
              <span className="mono-label">revert data</span>
              <code className="hash mt-0.5 block text-[8.5px]">{main.revertData}</code>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="chip border-danger/30 text-danger">hard gate</span>
        <span className="chip">no delegatecall path</span>
        <span className="chip">deterministic report</span>
        <span className="chip">no chain broadcast</span>
      </div>
    </SlideFrame>
  );
}

const GAP_LABELS: Record<string, string> = {
  P1: "Solidity / TS hash parity",
  P2: "Append-only registry",
  P3: "Commitment immutability",
  P4: "Real EVM re-entrancy",
  P5: "EIP-1967 post-condition",
  P6: "Timelock + executed flag",
  P7: "Guardian halt",
  P8: "Real Sentinel trace",
  P9: "On-chain disclosure challenge",
};

function HonestySlide({ demo }: { demo: Demo }) {
  const pending = demo.scorecard.filter((entry) => entry.status === "TEST_REQUIRED");
  const summary = {
    pass: demo.scorecard.filter((entry) => entry.status === "PASS").length,
    fail: demo.scorecard.filter((entry) => entry.status === "FAIL").length,
    required: pending.length,
  };
  return (
    <SlideFrame
      number={7}
      eyebrow="What we can prove"
      title={
        <>
          Real code.
          <br />
          <span className="text-signal">Labelled gaps.</span>
        </>
      }
      href="/scorecard"
      action="Open the scorecard"
    >
      <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <div className="grid grid-cols-3 gap-2">
            <BigStat label="Passed" value={summary.pass} tone="safe" sub="executed checks" />
            <BigStat label="Failed" value={summary.fail} tone={summary.fail > 0 ? "danger" : "default"} sub="would block" />
            <BigStat label="Test required" value={summary.required} tone="warn" sub="amber, never green" />
          </div>
          <div className="mt-4 border border-signal/25 bg-signal/[0.04] p-4">
            <div className="mono-label text-signal">The nine unproven properties</div>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {pending.map((entry) => (
                <div key={entry.id} className="flex items-start gap-1.5 text-[10px] leading-snug text-dim">
                  <span className="font-mono text-[8px] text-signal">{entry.id}</span>
                  {GAP_LABELS[entry.id] ?? entry.property}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-between border border-edge bg-white/[0.015] p-5">
          <div>
            <div className="mono-label text-signal">The closing line</div>
            <p className="mt-3 text-[clamp(17px,2.1vw,26px)] font-medium leading-[1.35] tracking-[-0.01em] text-body">
              Voting transparency isn&apos;t informed consent. We made the vote bind to the exact
              action, and we make the evidence, the conflicts, and the execution verifiable.
            </p>
          </div>
          <div className="mt-5">
            <ReportDownload run={demo.mainRun} proposalId={demo.proposal.id} />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="chip">self-contained HTML + JSON</span>
              <span className="chip border-signal/30 text-signal">Solidity pending · Person A</span>
            </div>
          </div>
        </div>
      </div>
    </SlideFrame>
  );
}

export function PresentationView() {
  const demo = getDemo();
  const [index, setIndex] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  const go = useCallback((nextIndex: number) => {
    setIndex(Math.max(0, Math.min(TOTAL - 1, nextIndex)));
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [index]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === " " || event.key === "PageDown") {
        event.preventDefault();
        go(index + 1);
      }
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        go(index - 1);
      }
      if (event.key === "Home") go(0);
      if (event.key === "End") go(TOTAL - 1);
      if (event.key.toLowerCase() === "f") {
        void toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, go]);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Fullscreen can be denied by the browser; the presentation remains usable.
    }
  }

  return (
    <div className="relative flex min-h-[100svh] flex-col bg-ink text-body">
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(900px_500px_at_20%_0%,rgba(241,181,74,0.08),transparent_65%)]" />
      <div className="pointer-events-none fixed inset-0 z-0 bg-[linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.018)_1px,transparent_1px)] [background-size:52px_52px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />

      <header className="fixed inset-x-0 top-0 z-40 border-b border-edge/70 bg-ink/88 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-[1480px] items-center gap-4 px-4 sm:px-6">
          <Link href="/trail" className="flex items-center gap-2.5">
            <span className="grid size-7 place-items-center rounded border border-signal/40 bg-signal/8 text-signal">
              <ShieldCheck size={14} strokeWidth={1.8} />
            </span>
            <span className="font-mono text-[11px] font-medium tracking-[0.18em] text-body">
              AEGIS <span className="text-signal">INTENTLOCK</span>
            </span>
          </Link>
          <span className="hidden font-mono text-[9px] uppercase tracking-[0.12em] text-faint sm:block">
            Presenting · AIP-042 · Decision Trail
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="font-mono text-[10px] tracking-[0.1em] text-dim">
              {PAD(index + 1)} / {PAD(TOTAL)}
            </span>
            <button type="button" onClick={toggleFullscreen} className="btn btn-sm" aria-label="Toggle fullscreen">
              {fullscreen ? <Minimize2 size={12} /> : <Expand size={12} />}
              <span className="hidden sm:inline">{fullscreen ? "Exit fullscreen" : "Fullscreen"}</span>
            </button>
            <Link href="/trail" className="btn btn-sm" aria-label="Exit presentation">
              <X size={12} />
              <span className="hidden sm:inline">Exit</span>
            </Link>
          </div>
        </div>
        <div className="h-[2px] bg-edge">
          <div
            data-testid="present-progress"
            className="h-full bg-signal transition-all duration-300"
            style={{ width: `${((index + 1) / TOTAL) * 100}%` }}
          />
        </div>
      </header>

      <main className="relative z-10 flex-1 pb-24 pt-14">
        <div className="sr-only" aria-live="polite">
          Slide {index + 1} of {TOTAL}: {SLIDE_TITLES[index]}
        </div>
        <div key={index} className="fade-up">
          {index === 0 ? <VerdictSlide demo={demo} /> : null}
          {index === 1 ? <TrailSlide demo={demo} /> : null}
          {index === 2 ? <GapSlide demo={demo} /> : null}
          {index === 3 ? <GraphSlide demo={demo} /> : null}
          {index === 4 ? <VoteSlide demo={demo} /> : null}
          {index === 5 ? <ExecutorSlide demo={demo} /> : null}
          {index === 6 ? <HonestySlide demo={demo} /> : null}
        </div>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-40 border-t border-edge/70 bg-ink/88 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-[1480px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => go(index - 1)}
              disabled={index === 0}
              className="btn btn-sm"
              aria-label="Previous slide"
            >
              <ArrowLeft size={12} />
              <span className="hidden sm:inline">Back</span>
            </button>
            <button
              type="button"
              onClick={() => go(index + 1)}
              disabled={index === TOTAL - 1}
              className="btn btn-primary btn-sm"
              aria-label="Next slide"
            >
              <span className="hidden sm:inline">Next</span>
              <ArrowRight size={12} />
            </button>
          </div>

          <div className="flex items-center gap-1.5" role="group" aria-label="Slide navigation">
            {Array.from({ length: TOTAL }, (_, slideIndex) => (
              <button
                key={slideIndex}
                type="button"
                onClick={() => go(slideIndex)}
                aria-label={`Go to slide ${slideIndex + 1}: ${SLIDE_TITLES[slideIndex]}`}
                aria-current={slideIndex === index ? "step" : undefined}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  slideIndex === index ? "w-6 bg-signal" : "w-1.5 bg-edge2 hover:bg-steel",
                )}
              />
            ))}
          </div>

          <span className="hidden font-mono text-[8px] uppercase tracking-[0.08em] text-faint md:block">
            ← → · space · F fullscreen
          </span>
        </div>
      </footer>
    </div>
  );
}
