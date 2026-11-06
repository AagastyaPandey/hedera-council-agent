"use client";

import Link from "next/link";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Check,
  FileWarning,
  Fingerprint,
  GitBranch,
  Info,
  ListChecks,
  Lock,
  Network,
  Radar,
  ShieldCheck,
  Terminal,
  Wallet,
  X,
} from "lucide-react";
import { getDemo } from "@/lib/demo";
import {
  formatNumber,
  formatTimestamp,
  shortAddress,
  shortHex,
} from "@/packages/shared/format";
import type { DecodedAction, ViolationConstraint } from "@/packages/shared/schemas";
import type { RunResult, RunStepStatus, ScenarioLayer } from "@/reference/types";
import sentinelTraceJson from "@/packages/shared/fixtures/sentinel-trace-06.json";
import { CopyButton } from "@/components/CopyButton";
import { ReportDownload } from "@/components/ReportDownload";
import {
  Callout,
  HashLine,
  LayerBadge,
  ModelBadge,
  Panel,
  RiskMeter,
  SectionHeader,
  StatusPill,
  cn,
  statusTextClass,
  statusTone,
} from "@/components/ui";

const TONE_STYLES = {
  safe: {
    border: "border-safe/35",
    rule: "bg-safe",
    iconBox: "border-safe/35 bg-safe/8",
  },
  warn: {
    border: "border-signal/35",
    rule: "bg-signal",
    iconBox: "border-signal/35 bg-signal/8",
  },
  danger: {
    border: "border-danger/35",
    rule: "bg-danger",
    iconBox: "border-danger/35 bg-danger/8",
  },
  neutral: {
    border: "border-edge",
    rule: "bg-edge2",
    iconBox: "border-edge bg-white/3",
  },
} as const;

const STEP_TEXT: Record<RunStepStatus, string> = {
  PASS: "text-safe",
  FAIL: "text-danger",
  FLAG: "text-signal",
  INFO: "text-info",
};

const STEP_BORDER: Record<RunStepStatus, string> = {
  PASS: "border-safe/40 bg-safe/8",
  FAIL: "border-danger/40 bg-danger/8",
  FLAG: "border-signal/40 bg-signal/8",
  INFO: "border-info/40 bg-info/8",
};

const SCOPE: Record<ScenarioLayer, string> = {
  executor:
    "The reference executor decodes real ABI calldata and applies the committed rules byte-for-byte. The Solidity executor, its access control and its gas behaviour are Person A's pending deliverable. No transaction was broadcast.",
  sentinel:
    "Static simulation over a fixture call trace. It is an early warning before execution, not the on-chain guarantee. Fork simulation is Person A's deliverable.",
  disclosure:
    "Graph scoring and the noisy-OR aggregation are real code over simulated transfers. Challenge verification and the challenge window live in Person A's DisclosureRegistry contract.",
};

type TraceNode = {
  type: string;
  from: string;
  to: string;
  selector: string;
  function: string;
  flag?: string;
  children: TraceNode[];
};

type TraceFixture = {
  source: string;
  network: string;
  root: TraceNode;
  storageChanges: {
    contract: string;
    slot: string;
    label: string;
    before: string;
    after: string;
  }[];
  flags: { code: string; message: string; evidence: string }[];
};

const sentinelTrace = sentinelTraceJson as unknown as TraceFixture;

function pad(index: number): string {
  return String(index).padStart(2, "0");
}

function VerdictIcon({ status }: { status: RunResult["status"] }) {
  if (status === "PASSED") return <ShieldCheck size={20} className="text-safe" />;
  if (status === "FLAGGED") return <AlertTriangle size={20} className="text-signal" />;
  return <AlertOctagon size={20} className="text-danger" />;
}

function StepGlyph({ status }: { status: RunStepStatus }) {
  const Icon =
    status === "PASS" ? Check : status === "FAIL" ? X : status === "FLAG" ? AlertTriangle : Info;
  return (
    <span
      className={cn(
        "mt-0.5 grid size-[22px] shrink-0 place-items-center rounded-full border",
        STEP_BORDER[status],
        STEP_TEXT[status],
      )}
      aria-hidden="true"
    >
      <Icon size={11} strokeWidth={2.1} />
    </span>
  );
}

function ActionTree({ actions, depth = 0 }: { actions: DecodedAction[]; depth?: number }) {
  if (actions.length === 0) return null;
  return (
    <ul className={cn("space-y-2", depth > 0 && "ml-2 border-l border-edge2/70 pl-3")}>
      {actions.map((action, index) => (
        <li key={`${action.target}-${action.function}-${index}`} className="min-w-0">
          <div
            className={cn(
              "rounded-lg border px-3 py-2.5",
              action.unknown ? "border-danger/35 bg-danger/4" : "border-edge bg-ink/30",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[12px] leading-snug text-body">{action.humanText}</p>
              {action.unknown ? (
                <span className="chip border-danger/30 text-danger">unknown</span>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="chip">{action.function}</span>
              <span className="chip">{action.targetLabel}</span>
              {action.selector ? <span className="chip">{action.selector}</span> : null}
              <span className="chip" title={action.target}>
                {shortAddress(action.target)}
              </span>
              {action.flag ? (
                <span className="chip border-signal/30 text-signal">{action.flag}</span>
              ) : null}
            </div>
            {Object.keys(action.args).length > 0 ? (
              <div className="mt-2 max-h-28 space-y-1 overflow-auto border-t border-edge/60 pt-2">
                {Object.entries(action.args).map(([key, value]) => (
                  <div
                    key={key}
                    className="flex items-start gap-3 font-mono text-[9px] leading-relaxed"
                  >
                    <span className="w-8 shrink-0 uppercase tracking-[0.08em] text-faint">{key}</span>
                    <span className="min-w-0 break-all text-steel">{value}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <ActionTree actions={action.nested} depth={depth + 1} />
        </li>
      ))}
    </ul>
  );
}

function DataBlock({
  label,
  value,
  emptyNote,
}: {
  label: string;
  value: string;
  emptyNote?: string;
}) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="mono-label">{label}</span>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[8px] uppercase tracking-[0.08em] text-faint">
            {value === "0x" ? "empty" : `${value.length} chars`}
          </span>
          <CopyButton value={value} compact />
        </div>
      </div>
      <pre className="mt-1.5 max-h-44 overflow-auto whitespace-pre-wrap break-all rounded border border-edge bg-ink/60 p-2.5 font-mono text-[9.5px] leading-relaxed text-steel">
        {value}
      </pre>
      {emptyNote ? (
        <p className="mt-1 text-[9.5px] leading-relaxed text-faint">{emptyNote}</p>
      ) : null}
    </div>
  );
}

function PassedRecord({ run }: { run: RunResult }) {
  const txHash = run.txHash ?? "0x";
  return (
    <div className="mt-4 rounded-lg border border-safe/25 bg-safe/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <BadgeCheck size={14} className="text-safe" />
        <span className="text-[11.5px] font-medium text-safe">Execution record</span>
        <span className="chip border-safe/30 text-safe">approved == submitted</span>
        <span className="chip">{run.submitted.length} top-level calls</span>
        <span className="chip">
          {run.steps.length}/{run.steps.length} gates passed
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded border border-edge/70 bg-ink/30 px-2.5 py-2">
        <div className="min-w-0">
          <div className="mono-label">tx hash, simulated</div>
          <code className="hash mt-1 block break-all">{txHash}</code>
        </div>
        <CopyButton value={txHash} compact />
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-faint">
        A reference-model execution, not a mined transaction. The hash is derived from the scenario
        id, calldata and block; no chain is running.
      </p>
    </div>
  );
}

function ConstraintCard({
  constraint,
  run,
}: {
  constraint: ViolationConstraint;
  run: RunResult;
}) {
  const hasRevert = Boolean(constraint.selector) && run.revertData !== "0x";
  return (
    <Panel className="border-danger/30">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-danger/20 bg-danger/4 px-4 py-3">
        <div className="flex items-center gap-2">
          <AlertOctagon size={15} className="text-danger" />
          <span className="text-[12.5px] font-medium text-body">Violated constraint</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn("chip", hasRevert ? "border-danger/30 text-danger" : "")}>
            {hasRevert ? "ABI custom error" : "no executor revert"}
          </span>
          <CopyButton value={run.revertData} label="Revert data" compact />
        </div>
      </div>
      <div className="p-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <code className="font-mono text-[14px] text-danger">{constraint.code}</code>
          <span className="text-[11px] text-dim">{run.label}</span>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-body">{constraint.message}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="panel-quiet px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="mono-label">error selector</span>
              {constraint.selector ? <CopyButton value={constraint.selector} compact /> : null}
            </div>
            <code className="mt-1 block font-mono text-[10px] text-steel">
              {constraint.selector ?? "—"}
            </code>
          </div>
          <div className="panel-quiet px-3 py-2">
            <div className="mono-label">layer</div>
            <div className="mt-1">
              <LayerBadge layer={run.layer} />
            </div>
          </div>
        </div>
        <DataBlock
          label="revert data"
          value={run.revertData}
          emptyNote={
            hasRevert
              ? undefined
              : "This layer flags before an executor revert exists. There is no custom-error payload for this scenario."
          }
        />
        <p className="mt-2 flex items-start gap-1.5 text-[9.5px] leading-relaxed text-faint">
          <Info size={11} className="mt-0.5 shrink-0" />
          {hasRevert
            ? "Real ABI-encoded custom error: a 4-byte selector followed by ABI-encoded arguments, encoded with viem against the error definitions. It is not a revert observed on a running chain."
            : "No ABI custom error is produced here. The reference model flags or rejects before the executor would revert; the empty payload is the honest result."}
        </p>
      </div>
    </Panel>
  );
}

function TraceNodeCard({ node, depth }: { node: TraceNode; depth: number }) {
  const danger = node.type === "DELEGATECALL";
  return (
    <div className={cn(depth > 0 && "ml-3 border-l border-edge2 pl-3 sm:ml-5 sm:pl-5")}>
      <div
        className={cn(
          "rounded-lg border p-3",
          danger ? "border-danger/40 bg-danger/6" : "border-edge bg-ink/35",
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.08em]",
              danger
                ? "border-danger/45 bg-danger/10 text-danger"
                : "border-edge2 bg-white/2 text-steel",
            )}
          >
            {danger ? <AlertTriangle size={9} /> : <GitBranch size={9} />}
            {node.type}
          </span>
          <code className="font-mono text-[10.5px] text-body">{node.function}</code>
          <span className="chip">{node.selector}</span>
          {node.flag ? <span className="chip border-danger/30 text-danger">{node.flag}</span> : null}
        </div>
        <dl className="mt-2 grid gap-1 font-mono text-[9px] sm:grid-cols-[40px_minmax(0,1fr)] sm:gap-x-2">
          <dt className="text-faint">from</dt>
          <dd className="break-all text-steel">{node.from}</dd>
          <dt className="text-faint">to</dt>
          <dd className="break-all text-steel">{node.to}</dd>
        </dl>
        {danger ? (
          <p className="mt-2 border-t border-danger/20 pt-2 text-[10px] leading-relaxed text-danger">
            This frame runs the callee code in the proxy storage context. This is the attack, not an
            implementation detail.
          </p>
        ) : null}
      </div>
      {node.children.map((child, index) => (
        <TraceNodeCard
          key={`${child.type}-${child.selector}-${index}`}
          node={child}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

function SentinelSection() {
  const trace = sentinelTrace;
  return (
    <section>
      <SectionHeader
        eyebrow="Sentinel, scenario 06"
        title="Simulated call tree"
        description="The upgrade's initialization payload reaches a DELEGATECALL. The flag is generated before the executor runs, so the executor is never invoked."
        right={
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="chip border-info/30 text-info">{trace.network}</span>
            <span className="chip">fixture trace</span>
          </div>
        }
      />
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-4 py-3">
          <div className="flex items-center gap-2">
            <Radar size={14} className="text-info" />
            <span className="text-[12px] font-medium text-body">Call trace</span>
          </div>
          <span className="font-mono text-[8.5px] uppercase tracking-[0.08em] text-faint">
            traceRef, sentinel-trace-06.json
          </span>
        </div>
        <div className="p-4">
          <p className="mb-3 font-mono text-[8.5px] uppercase tracking-[0.08em] text-faint">
            {trace.source}
          </p>
          <TraceNodeCard node={trace.root} depth={0} />

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="mono-label">Storage changes</span>
              <span className="chip">{trace.storageChanges.length} slot</span>
            </div>
            <div className="space-y-2">
              {trace.storageChanges.map((change) => (
                <div
                  key={change.slot}
                  className="rounded-lg border border-danger/25 bg-danger/4 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-body">{change.label}</span>
                    <CopyButton value={change.slot} compact />
                  </div>
                  <code className="hash mt-1 block break-all">{change.slot}</code>
                  <div className="mt-2 grid gap-1 font-mono text-[9px] sm:grid-cols-[52px_minmax(0,1fr)] sm:gap-x-2">
                    <span className="text-faint">contract</span>
                    <span className="break-all text-steel">{change.contract}</span>
                    <span className="text-faint">before</span>
                    <span className="break-all text-steel">{change.before}</span>
                    <span className="text-faint">after</span>
                    <span className="break-all text-danger">{change.after}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 space-y-1.5">
            {trace.flags.map((flag) => (
              <div
                key={flag.code}
                className="rounded border border-signal/25 bg-signal/4 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip border-signal/30 text-signal">{flag.code}</span>
                  <span className="text-[10.5px] leading-relaxed text-body">{flag.message}</span>
                </div>
                <p className="mt-1 font-mono text-[8.5px] text-faint">{flag.evidence}</p>
              </div>
            ))}
          </div>

          <Callout
            className="mt-4"
            tone="danger"
            title="Simulation detected — early warning, not the on-chain guarantee."
          >
            Trace is a fixture; fork simulation is Person A&apos;s deliverable. No fork was run for
            this page.
          </Callout>
        </div>
      </Panel>
    </section>
  );
}

function DisclosureSection() {
  const demo = getDemo();
  const challenge = demo.graph.challenge;

  return (
    <section>
      <SectionHeader
        eyebrow="Disclosure, scenario 10"
        title="Challenge claim and link evidence"
        description="The finding is outside the calldata: the signed disclosure omits a wallet that the graph connects to the recipient's deployer."
        right={<span className="chip border-signal/30 text-signal">challenge filed</span>}
      />
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-4 py-3">
          <div className="flex items-center gap-2">
            <Network size={14} className="text-signal" />
            <span className="text-[12px] font-medium text-body">Challenge payload</span>
            <StatusPill status="FLAGGED">filed</StatusPill>
          </div>
          {challenge ? (
            <CopyButton
              value={JSON.stringify(challenge, null, 2)}
              label="Challenge payload"
            />
          ) : null}
        </div>

        {challenge ? (
          <div className="p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="panel-quiet p-3">
                <div className="mono-label">Noisy-OR risk</div>
                <div className="mt-1.5 font-mono text-[20px] leading-none text-danger">
                  {challenge.overallRisk.toFixed(2)}
                </div>
                <div className="mt-1 text-[9.5px] text-faint">
                  red threshold {challenge.threshold.toFixed(2)}
                </div>
                <RiskMeter
                  value={challenge.overallRisk}
                  status={demo.graph.status}
                  threshold={challenge.threshold}
                  className="mt-2"
                />
              </div>
              <div className="panel-quiet p-3">
                <div className="mono-label">Discovered links</div>
                <div className="mt-1.5 font-mono text-[20px] leading-none text-body">
                  {challenge.links.length}
                </div>
                <div className="mt-1 text-[9.5px] text-faint">
                  each link carries transaction evidence
                </div>
              </div>
              <div className="panel-quiet p-3">
                <div className="mono-label">Filed</div>
                <div className="mt-1.5 text-[11px] font-medium text-body">{challenge.filedBy}</div>
                <div className="mt-1 text-[9.5px] leading-relaxed text-faint">
                  {formatTimestamp(challenge.filedAt)}
                </div>
                <div className="mt-1.5">
                  <span className="chip border-signal/30 text-signal">post-queue review</span>
                </div>
              </div>
            </div>

            <blockquote className="mt-4 border-l-2 border-signal/50 pl-3 text-[12.5px] italic leading-relaxed text-body">
              &ldquo;{challenge.claim}&rdquo;
            </blockquote>

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-edge/70 pt-2.5">
              <Wallet size={12} className="text-faint" />
              <span className="font-mono text-[9px] text-faint">filer {challenge.filedBy}</span>
              <span className="text-edge2">/</span>
              <span className="font-mono text-[9px] text-faint">
                {shortAddress(demo.proposal.challenge.filerAddress)}
              </span>
              {demo.challengeDigest ? (
                <>
                  <span className="text-edge2">/</span>
                  <span className="font-mono text-[9px] text-faint">
                    digest {shortHex(demo.challengeDigest, 8)}
                  </span>
                  <CopyButton value={demo.challengeDigest} label="Challenge digest" compact />
                </>
              ) : null}
            </div>

            <div className="mt-4 space-y-2">
              {challenge.links.map((link) => (
                <div key={link.id} className="rounded-lg border border-edge bg-ink/30 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="chip border-danger/30 text-danger">
                        {link.type.replaceAll("_", " ")}
                      </span>
                      <code className="font-mono text-[8.5px] text-faint">{link.id}</code>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="font-mono text-[12px] text-danger">
                        {link.strength.toFixed(2)}
                      </span>
                      <span className="font-mono text-[8px] uppercase tracking-[0.08em] text-faint">
                        strength
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {link.evidence.map((evidence, index) => (
                      <div
                        key={`${evidence.txHash}-${index}`}
                        className="rounded border border-edge/70 px-2 py-1.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[10px] text-dim">
                            {evidence.from} <ArrowRight size={9} className="inline text-faint" />{" "}
                            {evidence.to}
                          </span>
                          <span className="font-mono text-[9px] text-steel">
                            {formatNumber(Number(evidence.amountUsdc), 0)} USDC
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                          <code
                            className="font-mono text-[8.5px] text-faint"
                            title={evidence.txHash}
                          >
                            {shortHex(evidence.txHash, 10)}
                          </code>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[8px] text-faint">
                              {formatTimestamp(evidence.timestamp)}
                            </span>
                            <CopyButton value={evidence.txHash} compact />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <Callout className="mt-3" tone="info" title="Verification boundary">
              Challenge verification and the challenge window are Person A&apos;s contract. This
              panel shows the payload B generates and the noisy-OR math B runs over simulated
              transfers — not an on-chain ruling.
            </Callout>
          </div>
        ) : (
          <div className="p-4">
            <Callout tone="warn">No disclosure challenge is present in the demo graph.</Callout>
          </div>
        )}
      </Panel>
    </section>
  );
}

function EvidencePanel({ run }: { run: RunResult }) {
  return (
    <Panel>
      <div className="flex items-center justify-between gap-2 border-b border-edge px-4 py-3">
        <div className="flex items-center gap-2">
          <Fingerprint size={14} className="text-signal" />
          <span className="text-[12.5px] font-medium text-body">Evidence bundle</span>
        </div>
        <span className="chip">report, precomputed</span>
      </div>
      <div className="px-4 py-1">
        <HashLine label="commitment" value={run.approvedCommitment} full />
        {run.layer === "executor" ? (
          <HashLine label="submitted commitment" value={run.submittedCommitment} full />
        ) : (
          <div className="flex items-center justify-between gap-2 border-b border-edge/70 py-2.5">
            <span className="mono-label">submitted commitment</span>
            <span className="chip border-edge2 text-dim">not submitted</span>
          </div>
        )}
        <HashLine label="calldata hash" value={run.calldataHash} full />
      </div>
      <div className="border-t border-edge px-4 pb-4 pt-1">
        <DataBlock
          label="submitted calldata"
          value={run.submittedCalldata}
          emptyNote={
            run.submittedCalldata === "0x"
              ? "No execution calldata was submitted in this scenario."
              : undefined
          }
        />
        <DataBlock
          label="revert data"
          value={run.revertData}
          emptyNote={
            run.revertData === "0x"
              ? "Empty: no executor custom error exists for this layer and scenario."
              : undefined
          }
        />
        <div className="mt-3 border-t border-edge/70">
          {run.txHash ? (
            <HashLine label="tx hash, SIMULATED" value={run.txHash} full />
          ) : (
            <div className="flex items-center justify-between gap-2 border-b border-edge/70 py-2.5">
              <span className="mono-label">tx hash</span>
              <span className="chip border-signal/30 text-signal">not executed</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 py-2.5">
            <span className="mono-label">trace ref</span>
            <span className="font-mono text-[10px] text-steel">{run.traceRef ?? "—"}</span>
          </div>
        </div>
      </div>
    </Panel>
  );
}

export function ArenaDetail({ scenarioId }: { scenarioId: string }) {
  const demo = getDemo();
  const row = demo.scenarioRows.find((candidate) => candidate.scenario.id === scenarioId);

  if (!row) {
    return (
      <Panel className="p-6">
        <h1 className="text-[20px] font-medium text-body">Scenario not found</h1>
        <Link href="/arena" className="arrow-link mt-4">
          Back to the arena
          <ArrowUpRight size={13} />
        </Link>
      </Panel>
    );
  }

  const { scenario, run } = row;
  const report = run.report;
  const isPassed = run.status === "PASSED";
  const isSentinel = scenario.id === "06-delegatecall-payload";
  const isDisclosure = scenario.id === "10-undisclosed-link";
  const tone = statusTone(run.status);
  const styles = TONE_STYLES[tone];
  const passCount = run.steps.filter((step) => step.status === "PASS").length;
  const failCount = run.steps.filter((step) => step.status === "FAIL").length;
  const flagCount = run.steps.filter((step) => step.status === "FLAG").length;
  const infoCount = run.steps.filter((step) => step.status === "INFO").length;
  const stepCounts: { status: RunStepStatus; count: number }[] = [
    { status: "PASS", count: passCount },
    { status: "FAIL", count: failCount },
    { status: "FLAG", count: flagCount },
    { status: "INFO", count: infoCount },
  ];

  return (
    <div>
      <div className="mb-5">
        <Link
          href="/arena"
          className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-dim transition-colors hover:text-body"
        >
          <ArrowLeft size={12} />
          Red-team arena
        </Link>

        <div className="mt-4 flex flex-col gap-5 border-b border-edge pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="mono-label text-signal">
                Violation report, {demo.proposal.id}
              </span>
              <span className="chip">scenario {pad(scenario.index)}</span>
              <LayerBadge layer={scenario.layer} />
              <ModelBadge />
            </div>
            <h1 className="text-balance text-[25px] font-semibold leading-[1.1] tracking-[-0.02em] text-body sm:text-[30px]">
              {scenario.title}
            </h1>
            <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-dim">
              {scenario.subtitle}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="chip">{scenario.id}</span>
              <span className="chip">{scenario.mode}</span>
              <StatusPill status={row.matchesExpected ? "GREEN" : "RED"}>
                {row.matchesExpected ? "expected == actual" : "expected != actual"}
              </StatusPill>
            </div>
          </div>

          <div className="grid shrink-0 grid-cols-2 gap-4 sm:max-w-md">
            <div>
              <div className="mono-label">Expected</div>
              <div
                className={cn(
                  "mt-1 font-mono text-[20px] leading-none",
                  statusTextClass(scenario.expected.status),
                )}
              >
                {scenario.expected.status}
              </div>
              <div className="mt-1 font-mono text-[9px] leading-relaxed text-faint">
                {scenario.expected.code}, {scenario.expected.label}
              </div>
            </div>
            <div>
              <div className="mono-label">Actual</div>
              <div
                className={cn(
                  "mt-1 font-mono text-[20px] leading-none",
                  statusTextClass(run.status),
                )}
              >
                {run.status}
              </div>
              <div className="mt-1 font-mono text-[9px] leading-relaxed text-faint">
                {run.code}, {run.label}
              </div>
            </div>
          </div>
        </div>
      </div>

      <Callout
        tone="warn"
        title="Reference model (TypeScript) — Solidity executor pending Person A."
      >
        Verdicts come from real calldata encoding/decoding and rule checks; no chain is running.
      </Callout>

      <Panel className="mt-3 flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Terminal size={13} className="text-faint" />
          <span className="mono-label">Reproduce</span>
          <code className="font-mono text-[11px] text-body">npm run arena -- {scenario.index}</code>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9.5px] text-faint">Deterministic fixture run, same verdict</span>
          <CopyButton
            value={`npm run arena -- ${scenario.index}`}
            label="Reproduce command"
          />
        </div>
      </Panel>

      <Panel id="download" className="mt-3 flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mono-label">Takeaway</div>
          <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-dim">
            A self-contained HTML report and a machine-readable JSON bundle. The quote, decoded
            call, violated constraint and evidence hashes travel with you.
          </p>
        </div>
        <ReportDownload run={run} proposalId={demo.proposal.id} />
      </Panel>

      <Panel className={cn("mt-4 overflow-hidden", styles.border)}>
        <div className={cn("h-0.5 w-full", styles.rule)} />
        <div className="p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-lg border",
                  styles.iconBox,
                )}
              >
                <VerdictIcon status={run.status} />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "font-mono text-[22px] font-medium leading-none tracking-[0.04em]",
                      statusTextClass(run.status),
                    )}
                  >
                    {run.status}
                  </span>
                  <span className="chip">{run.code}</span>
                  <LayerBadge layer={run.layer} />
                </div>
                <div className="mt-2 text-[13px] font-medium text-body">{run.label}</div>
                <p className="mt-1.5 max-w-3xl text-[12.5px] leading-relaxed text-dim">
                  {run.message}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 lg:flex-col lg:items-end">
              <StatusPill status={row.matchesExpected ? "GREEN" : "RED"}>
                {row.matchesExpected ? "expected == actual" : "expected != actual"}
              </StatusPill>
              {run.layer === "executor" ? (
                <span
                  className={cn(
                    "chip",
                    run.commitmentMatched
                      ? "border-safe/30 text-safe"
                      : "border-danger/30 text-danger",
                  )}
                >
                  {run.commitmentMatched ? "bundle commitment matched" : "bundle commitment differs"}
                </span>
              ) : (
                <span className="chip border-edge2 text-dim">commitment check, not executed</span>
              )}
              <span className="chip">layer, {run.layer}</span>
            </div>
          </div>
          {isPassed ? <PassedRecord run={run} /> : null}
        </div>
      </Panel>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.42fr)_minmax(0,0.82fr)]">
        <div className="space-y-4">
          <section>
            <SectionHeader
              eyebrow="Reference trace"
              title={`${run.steps.length} gates, in order`}
              description="Context gates run before calldata is decoded. Each row below is the executor's own step output — the detail is quoted, not rewritten for display."
              right={
                <div className="flex flex-wrap items-center gap-1.5">
                  {run.status === "PASSED" ? (
                    <StatusPill status="PASSED">all gates passed</StatusPill>
                  ) : (
                    <StatusPill status={run.status} />
                  )}
                  <span className="chip">{run.steps.length} checks</span>
                </div>
              }
            />
            <Panel>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <ListChecks size={13} className="text-signal" />
                  <span className="text-[11px] text-body">Reference executor output</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {stepCounts.map(({ status, count }) =>
                    count > 0 ? (
                      <span key={status} className={cn("chip", STEP_TEXT[status])}>
                        {count} {status}
                      </span>
                    ) : null,
                  )}
                </div>
              </div>
              <ol className="p-4">
                {run.steps.map((step, index) => (
                  <li
                    key={step.id}
                    className="relative flex gap-3 pb-4 last:pb-0"
                  >
                    {index < run.steps.length - 1 ? (
                      <span className="absolute bottom-0 left-[10.5px] top-6 w-px bg-edge" />
                    ) : null}
                    <StepGlyph status={step.status} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-[8.5px] text-faint">
                            {pad(index + 1)}
                          </span>
                          <span className="text-[12px] font-medium text-body">{step.label}</span>
                        </div>
                        <span
                          className={cn(
                            "font-mono text-[8.5px] uppercase tracking-[0.08em]",
                            STEP_TEXT[step.status],
                          )}
                        >
                          {step.status}
                        </span>
                      </div>
                      <p className="mt-1 text-[10.5px] leading-relaxed text-dim">{step.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="border-t border-edge px-4 py-2.5">
                <p className="text-[9.5px] leading-relaxed text-faint">
                  Source: <span className="font-mono text-steel">reference/executor.ts</span>, the
                  same steps printed by the CLI reproduce command.
                </p>
              </div>
            </Panel>
          </section>

          <section>
            <SectionHeader
              eyebrow="Intent vs bytes"
              title="Proposal said / actually does"
              description={scenario.attackDescription}
              right={
                <span className="chip">
                  {run.approved.length} committed, {run.submitted.length} submitted
                </span>
              }
            />
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel className="h-full">
                <div className="flex items-center justify-between gap-2 border-b border-edge px-4 py-3">
                  <div className="flex items-center gap-2">
                    <FileWarning size={13} className="text-signal" />
                    <span className="text-[11.5px] font-medium text-body">Proposal said</span>
                  </div>
                  <span className="chip">human text</span>
                </div>
                <div className="p-4">
                  <blockquote className="border-l-2 border-signal/50 pl-3 text-[13px] italic leading-relaxed text-body">
                    &ldquo;{report.proposalSaid}&rdquo;
                  </blockquote>
                  <p className="mt-3 text-[10px] leading-relaxed text-faint">
                    Quoted from the scenario fixture. The report compares this statement with the
                    decoded calldata, not with an interpretation of it.
                  </p>
                </div>
              </Panel>

              <Panel className="h-full">
                <div className="flex items-center justify-between gap-2 border-b border-edge px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Terminal size={13} className="text-signal" />
                    <span className="text-[11.5px] font-medium text-body">Actually does</span>
                  </div>
                  <span className="chip">{run.submitted.length} decoded</span>
                </div>
                <div className="p-4">
                  {run.submitted.length > 0 ? (
                    <ActionTree actions={report.submitted} />
                  ) : (
                    <Callout
                      tone="warn"
                      title="No execution calldata in this scenario."
                    >
                      The finding is in the disclosure graph, not in a submitted bundle. Attack
                      model: {scenario.attackDescription}
                    </Callout>
                  )}
                  <p className="mt-3 text-[10px] leading-relaxed text-faint">
                    Recursive decode of the submitted ABI calldata. Multicall children are indented
                    with their own function, target and raw arguments.
                  </p>
                </div>
              </Panel>
            </div>
          </section>

          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-4 py-3">
              <div className="flex items-center gap-2">
                <Lock size={13} className="text-faint" />
                <span className="text-[11.5px] font-medium text-body">Committed actions</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="chip">{report.approved.length} rules</span>
                <span className="chip">
                  {demo.proposal.id}, v{demo.committed.version}
                </span>
              </div>
            </div>
            <div className="p-4">
              <ActionTree actions={report.approved} />
              {isPassed ? (
                <div className="mt-3 flex items-start gap-2 rounded border border-safe/25 bg-safe/5 px-3 py-2 text-[10.5px] leading-relaxed text-safe">
                  <BadgeCheck size={13} className="mt-0.5 shrink-0" />
                  Submitted calldata decodes to exactly these committed actions. Approved ==
                  submitted, and the commitment hash agrees.
                </div>
              ) : (
                <p className="mt-3 text-[10px] leading-relaxed text-faint">
                  The committed baseline every verdict is measured against. Some scenarios fail
                  before calldata comparison because chain, version, executed flag or timelock is
                  checked first.
                </p>
              )}
            </div>
          </Panel>

          {run.violatedConstraint ? (
            <ConstraintCard constraint={run.violatedConstraint} run={run} />
          ) : null}

          {isSentinel ? <SentinelSection /> : null}
          {isDisclosure ? <DisclosureSection /> : null}
        </div>

        <aside className="space-y-4 self-start">
          <EvidencePanel run={run} />

          <Panel className="p-4">
            <div className="flex items-center gap-2">
              <Info size={13} className="text-info" />
              <span className="mono-label">Scope, layer {run.layer}</span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-dim">{SCOPE[run.layer]}</p>
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-edge/70 pt-3">
              <span className="chip">no RPC</span>
              <span className="chip">no fork</span>
              <span className="chip">no broadcast</span>
              <span className="chip border-signal/30 text-signal">TypeScript model</span>
            </div>
          </Panel>
        </aside>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-edge pt-4">
        <Info size={12} className="text-faint" />
        <span className="text-[10px] leading-relaxed text-faint">
          Verdicts, steps and decoded actions come from the TypeScript reference model in this
          repo. Tx hashes, sentinel traces and graph transfers are simulated. The Solidity executor
          and fork simulation are Person A&apos;s deliverables.
        </span>
        <Link href="/arena" className="arrow-link ml-auto text-[9px]">
          All scenarios
          <ArrowUpRight size={11} />
        </Link>
      </div>
    </div>
  );
}
