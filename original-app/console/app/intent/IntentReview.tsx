"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  Check,
  CircleHelp,
  Fingerprint,
  Info,
  ListChecks,
  Lock,
  ScanText,
  Undo2,
} from "lucide-react";
import { applyResolutions, type Resolutions } from "@/ai/resolve";
import { buildTreasuryBrief } from "@/ai/brief";
import { scoreClaims } from "@/chain-scoring/score";
import { getDemo } from "@/lib/demo";
import { ADDRESSES, CHAIN_ID, ENTITY_LABELS } from "@/packages/shared/addresses";
import { buildApprovedCalls } from "@/packages/shared/calls";
import { formatTokenAmount, shortAddress } from "@/packages/shared/format";
import {
  computeActionsHash,
  computeCommitment,
  computeContentHash,
  computeIntentHash,
} from "@/packages/shared/hash";
import type { ActionSpec, Claim } from "@/packages/shared/schemas";
import { CopyButton } from "@/components/CopyButton";
import { SourceChip } from "@/components/SourceChip";
import {
  Callout,
  Panel,
  ScoreRing,
  SectionHeader,
  Stat,
  StatusPill,
  cn,
} from "@/components/ui";

function entity(address: string): string {
  return ENTITY_LABELS[address.toLowerCase()]?.label ?? shortAddress(address);
}

function ruleSummary(action: ActionSpec): { headline: string; detail: string } {
  switch (action.kind) {
    case "ERC20_TRANSFER":
      return {
        headline: `${formatTokenAmount(action.maxAmount)} USDC → ${entity(action.counterparty)}`,
        detail: `Transfer on ${entity(action.target)}`,
      };
    case "ERC20_APPROVE":
      return {
        headline: `${formatTokenAmount(action.maxAmount)} USDC allowance → ${entity(action.counterparty)}`,
        detail: `Approval on ${entity(action.target)}`,
      };
    case "UPGRADE":
      return {
        headline: `Upgrade ${entity(action.target)} → ${entity(action.counterparty)}`,
        detail: "Proxy implementation change",
      };
    case "OWNERSHIP_TRANSFER":
      return {
        headline: `Ownership of ${entity(action.target)} → ${entity(action.counterparty)}`,
        detail: "Ownable.transferOwnership",
      };
    case "MULTICALL":
      return {
        headline: `Batch ${action.children?.length ?? 0} calls`,
        detail: `Multicall wrapper on ${entity(action.target)}`,
      };
    default:
      return { headline: action.kind, detail: entity(action.target) };
  }
}

function HashCompare({
  label,
  description,
  live,
  committed,
  match,
}: {
  label: string;
  description: string;
  live: string;
  committed: string;
  match: boolean;
}) {
  return (
    <div className="border-b border-edge/70 py-3 last:border-0">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="mono-label-strong">{label}</div>
          <div className="mt-1 text-[10.5px] leading-snug text-faint">{description}</div>
        </div>
        <StatusPill status={match ? "GREEN" : "RED"}>{match ? "match" : "diverge"}</StatusPill>
      </div>
      <div className="mt-2 grid gap-2">
        <div className="min-w-0 rounded border border-edge bg-ink/40 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="mono-label">live</span>
            <CopyButton value={live} compact />
          </div>
          <code className="hash mt-1 block min-w-0 max-w-full break-all">{live}</code>
        </div>
        <div className="min-w-0 rounded border border-edge/60 px-2.5 py-2">
          <div className="mono-label">committed v3</div>
          <code className="hash mt-1 block min-w-0 max-w-full break-all text-faint">{committed}</code>
        </div>
      </div>
    </div>
  );
}

function ClaimRow({
  claim,
  demo,
  resolutions,
  removed,
}: {
  claim: Claim;
  demo: ReturnType<typeof getDemo>;
  resolutions: Resolutions;
  removed: boolean;
}) {
  const linked = claim.linkedUnresolvedId
    ? demo.extracted.unresolved.find((item) => item.id === claim.linkedUnresolvedId)
    : null;
  const decision = claim.linkedUnresolvedId ? resolutions[claim.linkedUnresolvedId] : null;
  const support = decision ? 1 : claim.support;

  return (
    <div className={cn("px-4 py-3 transition-opacity", removed && "opacity-45")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 shrink-0 font-mono text-[9px] text-faint">{claim.id}</span>
          <div className="min-w-0">
            <p className={cn("text-[12.5px] leading-snug text-body", removed && "line-through")}>
              {claim.text}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <SourceChip source={claim.source} compact />
              {claim.actionIndex !== undefined ? (
                <span className="chip">
                  rule {String(claim.actionIndex + 1).padStart(2, "0")}
                </span>
              ) : null}
              {linked ? (
                <span
                  className={cn(
                    "chip",
                    decision === "reject"
                      ? "border-danger/30 text-danger"
                      : decision
                        ? "border-safe/30 text-safe"
                        : "border-signal/30 text-signal",
                  )}
                >
                  {decision === "reject" ? "removed by review" : decision ? "resolved" : "ambiguity"} ·{" "}
                  {linked.id}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="w-20">
            <div className="mb-1 flex justify-between font-mono text-[8.5px] text-faint">
              <span>conf</span>
              <span>{Math.round(claim.confidence * 100)}%</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-edge">
              <div
                className={cn(
                  "h-full rounded-full",
                  claim.confidence < 0.5 ? "bg-signal" : "bg-safe/70",
                )}
                style={{ width: `${claim.confidence * 100}%` }}
              />
            </div>
            <div className="mt-1 text-right font-mono text-[8px] text-faint">
              support {support.toFixed(2)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function IntentReview() {
  const demo = getDemo();
  const [resolutions, setResolutions] = useState<Resolutions>({});
  const [confirmed, setConfirmed] = useState(false);

  const resolved = applyResolutions(demo.extracted, resolutions);
  const liveIntentHash = computeIntentHash(resolved);
  const liveContentHash = computeContentHash(resolved);
  const liveCalls = buildApprovedCalls(resolved);
  const liveActionsHash = computeActionsHash(liveCalls);
  const liveCommitment = computeCommitment({
    chainId: CHAIN_ID,
    executor: ADDRESSES.executor,
    proposalId: demo.proposal.id,
    version: resolved.version,
    actionsHash: liveActionsHash,
    intentHash: liveIntentHash,
    evidenceRoot: demo.manifest.root,
    disclosureHash: demo.disclosureHash,
  });

  const rulesMatch = liveIntentHash.toLowerCase() === demo.intentHash.toLowerCase();
  const contentMatch = liveContentHash.toLowerCase() === demo.contentHash.toLowerCase();
  const commitmentMatch = liveCommitment.toLowerCase() === demo.commitment.toLowerCase();
  const allResolved = resolved.unresolved.length === 0;
  const canConfirm = allResolved && rulesMatch && contentMatch && commitmentMatch;
  const liveClaims = scoreClaims(demo.validation.claims, demo.extracted.unresolved, resolutions);
  const liveBrief = buildTreasuryBrief(resolved, demo.manifest);
  const openCount = resolved.unresolved.length;

  function choose(itemId: string, value: string) {
    setResolutions((previous) => ({ ...previous, [itemId]: value }));
    setConfirmed(false);
  }

  function reset() {
    setResolutions({});
    setConfirmed(false);
  }

  function prefill() {
    setResolutions({ "upgrade-scope": "reject", cadence: "one_time" });
    setConfirmed(false);
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.42fr)_minmax(0,0.82fr)]">
      <div className="space-y-4">
        <section id="claims">
          <SectionHeader
            eyebrow="Extraction, schema (a)"
            title="Claims with document spans"
            description="Every retained claim points to an exact quote in the evidence manifest. The validator rejects unsourced claims; the reviewer does not get to guess."
            right={
              <div className="flex items-center gap-2">
                <span className="chip border-safe/30 text-safe">{demo.validation.sourceLinked}/{demo.validation.totalClaims} source-linked</span>
                <span className="chip border-signal/30 text-signal">{demo.validation.warnings.length} low confidence</span>
              </div>
            }
          />
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3">
              <div className="flex items-center gap-2">
                <ListChecks size={14} className="text-signal" />
                <span className="text-[12px] text-body">Strict validation</span>
                <span className="chip">zod, schema a</span>
              </div>
              <div className="flex items-center gap-3 font-mono text-[9px] uppercase tracking-[0.08em] text-faint">
                <span>{demo.validation.rejected.length} rejected</span>
                <span>{openCount} open ambiguities</span>
              </div>
            </div>
            <div className="divide-y divide-edge/70">
              {demo.validation.claims.map((claim) => (
                <ClaimRow
                  key={claim.id}
                  claim={claim}
                  demo={demo}
                  resolutions={resolutions}
                  removed={liveClaims.rejectedClaimIds.includes(claim.id)}
                />
              ))}
            </div>
            {demo.validation.warnings.length > 0 ? (
              <div className="border-t border-signal/20 bg-signal/4 px-4 py-2.5">
                <div className="flex items-start gap-2 text-[11px] leading-relaxed text-dim">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0 text-signal" />
                  <span>
                    {demo.validation.warnings.map((warning) => `${warning.id}: ${warning.message}`).join(", ")}
                    {" "}The 42% tentative upgrade claim is why a reviewer must decide before the
                    intent can be committed.
                  </span>
                </div>
              </div>
            ) : null}
          </Panel>
        </section>

        <section>
          <SectionHeader
            eyebrow={`Live rule set, ${resolved.actions.length} actions`}
            title="Proposed on-chain rules"
            description="The intent hash covers these rules only. Sources and confidence inform the reviewer, but never enter the hash."
            right={<span className="chip">{liveActionsHash.slice(0, 10)}…</span>}
          />
          <div className="space-y-2">
            {resolved.actions.map((action, index) => {
              const summary = ruleSummary(action);
              const tentative = action.label?.includes("TENTATIVE");
              const authorized = action.label?.includes("Reviewer-authorized");
              return (
                <Panel
                  key={`${action.kind}-${index}-${action.counterparty}`}
                  className={cn(
                    "p-4",
                    tentative && "border-signal/35",
                    authorized && "border-signal/35",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className={cn(
                          "mt-0.5 grid size-7 shrink-0 place-items-center rounded border font-mono text-[9px]",
                          tentative || authorized
                            ? "border-signal/40 bg-signal/8 text-signal"
                            : "border-edge text-faint",
                        )}
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-faint">
                            {action.kind.replaceAll("_", " ")}
                          </span>
                          {tentative ? (
                            <span className="chip border-signal/40 text-signal">tentative, unresolved</span>
                          ) : null}
                          {authorized ? (
                            <span className="chip border-signal/40 text-signal">reviewer authorized</span>
                          ) : null}
                        </div>
                        <div className="mt-1.5 text-[13px] font-medium text-body">{summary.headline}</div>
                        <div className="mt-0.5 text-[11px] text-dim">{summary.detail}</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-[9px] text-faint">
                        {Math.round(action.confidence * 100)}% conf
                      </span>
                      <SourceChip source={action.source} compact />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-edge/70 pt-2.5 font-mono text-[9px] uppercase tracking-[0.06em] text-faint">
                    <span className="chip">{action.selector}</span>
                    <span className="truncate">{entity(action.target)}</span>
                    <span className="text-edge2">/</span>
                    <span className="truncate">{entity(action.counterparty)}</span>
                    {action.maxAmount !== "0" ? (
                      <>
                        <span className="text-edge2">/</span>
                        <span>{formatTokenAmount(action.maxAmount)} USDC</span>
                      </>
                    ) : null}
                  </div>
                </Panel>
              );
            })}
          </div>
          <p className="mt-2 flex items-start gap-2 text-[10.5px] leading-relaxed text-faint">
            <Fingerprint size={12} className="mt-0.5 shrink-0" />
            `intentHash = keccak256(abi.encode(rules))`. Changing a recipient, amount, selector,
            child call, version, chain, executor or disclosure changes the commitment.
          </p>
        </section>

        <section>
          <SectionHeader
            eyebrow="Recomputed from the live rules"
            title="Treasury impact brief"
            right={<span className="chip">self-sourced figures</span>}
          />
          <Panel className="p-4">
            <div className="grid gap-5 sm:grid-cols-4">
              <Stat
                label="Total grants"
                value={`${formatTokenAmount(liveBrief.totalGrantsUsdc)}`}
                sub="USDC, transfers only"
              />
              <Stat
                label="Allowance"
                value={`${formatTokenAmount(liveBrief.allowanceUsdc)}`}
                sub="bounded ceiling"
              />
              <Stat
                label="Runway before"
                value={`${liveBrief.runwayBeforeMonths.toFixed(1)} mo`}
                sub="at 122,000 / month"
              />
              <Stat
                label="Runway after"
                value={`${liveBrief.runwayAfterMonths.toFixed(1)} mo`}
                tone={liveBrief.runwayAfterMonths < 4 ? "danger" : "default"}
                sub={liveBrief.runwayAfterMonths < 4 ? "below four months" : "after grants"}
              />
            </div>

            <div className="mt-4 grid gap-4 border-t border-edge/70 pt-4 lg:grid-cols-[1fr_1.2fr]">
              <div>
                <div className="mono-label mb-2">Recipients</div>
                <div className="space-y-1.5">
                  {liveBrief.recipients.map((recipient) => (
                    <div key={recipient.address} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-dim">{recipient.name}</span>
                      <span className="font-mono text-[10.5px] text-steel">
                        {formatTokenAmount(recipient.amountUsdc)} USDC
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mono-label mb-2 mt-4">Dependencies</div>
                <ul className="space-y-1">
                  {liveBrief.dependencies.map((dependency) => (
                    <li key={dependency} className="flex items-start gap-1.5 text-[10.5px] text-dim">
                      <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-faint" />
                      {dependency}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="mono-label mb-2">Figures & sources</div>
                <div className="space-y-1.5">
                  {liveBrief.figures.map((figure) => (
                    <div
                      key={figure.label}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border border-edge bg-ink/30 px-2.5 py-2"
                    >
                      <span className="text-[10.5px] text-dim">{figure.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10.5px] text-body">{figure.value}</span>
                        <SourceChip source={figure.source} compact />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {liveBrief.runwayAfterMonths < 4 ? (
              <div className="mt-3">
                <Callout tone="danger" title="This resolution would cut runway below four months.">
                  Four quarterly payments raise the committed transfer ceiling to 850,000 USDC. The
                  financial model was built on a single 200,000 USDC outflow.
                </Callout>
              </div>
            ) : null}
          </Panel>
        </section>
      </div>

      <aside id="review" className="space-y-4 self-start xl:sticky xl:top-[80px]">
        <Panel>
          <div className="flex items-start justify-between gap-3 border-b border-edge px-4 py-3">
            <div>
              <div className="mono-label mb-1">Human confirmation</div>
              <h2 className="text-[14px] font-medium text-body">Resolve the ambiguities</h2>
            </div>
            <button type="button" onClick={prefill} className="btn btn-sm">
              <ScanText size={11} />
              Prefill sourced
            </button>
          </div>

          <div className="divide-y divide-edge/70">
            {demo.extracted.unresolved.map((item) => {
              const selected = resolutions[item.id];
              return (
                <div key={item.id} className="px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <CircleHelp size={13} className={selected ? "text-safe" : "text-signal"} />
                    <span className="mono-label">{item.id}</span>
                    {selected ? (
                      <span className="chip border-safe/30 text-safe">resolved</span>
                    ) : (
                      <span className="chip border-signal/30 text-signal">open</span>
                    )}
                  </div>
                  <p className="mt-2 text-[12px] leading-snug text-body">{item.question}</p>
                  <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">{item.context}</p>
                  <div className="mt-2">
                    <SourceChip source={item.source} compact />
                  </div>
                  <div className="mt-3 grid gap-1.5">
                    {item.options.map((option) => {
                      const active = selected === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => choose(item.id, option.value)}
                          className={cn(
                            "rounded-lg border px-3 py-2 text-left transition-colors",
                            active
                              ? "border-signal/50 bg-signal/7"
                              : "border-edge bg-white/[0.012] hover:border-edge2",
                          )}
                        >
                          <div className="flex items-start gap-2">
                            <span
                              className={cn(
                                "mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-full border",
                                active ? "border-signal bg-signal" : "border-edge2",
                              )}
                            >
                              {active ? <Check size={9} className="text-ink" /> : null}
                            </span>
                            <div>
                              <div className="text-[11.5px] font-medium text-body">{option.label}</div>
                              <div className="mt-0.5 text-[10px] leading-snug text-faint">{option.effect}</div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t border-edge px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="mono-label">Claims score</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-faint">
                  {demo.claimsScoreAsExtracted.score.toFixed(2)} → {liveClaims.score.toFixed(2)}
                </span>
                <StatusPill status={liveClaims.status} />
              </div>
            </div>
          </div>
        </Panel>

        <Panel className={cn(canConfirm || confirmed ? "border-safe/30" : "border-signal/25")}>
          <div className="flex items-center justify-between gap-2 border-b border-edge px-4 py-3">
            <div className="flex items-center gap-2">
              <Lock size={13} className={canConfirm ? "text-safe" : "text-signal"} />
              <span className="text-[12.5px] font-medium text-body">Commitment check</span>
            </div>
            <StatusPill status={confirmed ? "GREEN" : canConfirm ? "GREEN" : allResolved ? "RED" : "AMBER"}>
              {confirmed ? "confirmed" : canConfirm ? "matches v3" : allResolved ? "diverges" : "pending"}
            </StatusPill>
          </div>

          <div className="px-4 py-1">
            <HashCompare
              label="intentHash"
              description="keccak256(abi.encode(rules)) — action rules only"
              live={liveIntentHash}
              committed={demo.intentHash}
              match={rulesMatch}
            />
            <HashCompare
              label="contentHash"
              description="Rules + reviewer assumptions (the proposal content)"
              live={liveContentHash}
              committed={demo.contentHash}
              match={contentMatch}
            />
            <HashCompare
              label="commitment"
              description="chain, executor, version, actions, intent, evidence, disclosure"
              live={liveCommitment}
              committed={demo.commitment}
              match={commitmentMatch}
            />
          </div>

          <div className="border-t border-edge p-4">
            {confirmed ? (
              <Callout tone="safe" title="Reviewer confirmed. The intent matches committed v3.">
                <div className="mt-1 flex items-center gap-2">
                  <BadgeCheck size={13} className="text-safe" />
                  <span>
                    {resolved.actions.length} rules, {resolved.assumptions.length} sourced
                    assumptions, evidence root {demo.manifest.root.slice(0, 10)}…
                  </span>
                </div>
              </Callout>
            ) : (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  className="btn btn-primary w-full"
                  disabled={!canConfirm}
                  onClick={() => setConfirmed(true)}
                >
                  <Lock size={12} />
                  Confirm intent
                </button>
                {!allResolved ? (
                  <p className="text-[10.5px] leading-relaxed text-faint">
                    {openCount} open ambiguities. Resolve both to compute the final commitment.
                  </p>
                ) : !canConfirm ? (
                  <Callout tone="danger">
                    This review produces a different commitment. It would require a new proposal
                    version (v4) and a new vote — the v3 commitment is immutable.
                  </Callout>
                ) : null}
              </div>
            )}

            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-faint hover:text-body"
              >
                <Undo2 size={11} />
                reset review
              </button>
              {confirmed ? (
                <Link href="/timeline" className="arrow-link text-[9px]">
                  see the chain <ArrowUpRight size={11} />
                </Link>
              ) : null}
            </div>
          </div>
        </Panel>

        <Panel className="p-4">
          <div className="flex items-center gap-2">
            <Info size={13} className="text-info" />
            <span className="mono-label">Why this is the demo moment</span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-dim">
            The tentative upgrade is in the draft rules. Rejecting it removes the rule and changes
            the intent hash. The reviewer is not approving a summary — they are producing the exact
            bytes the vote will bind to.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <ScoreRing
              score={liveClaims.score}
              status={liveClaims.status}
              size={46}
              label="claims"
            />
            <div className="text-[10.5px] leading-snug text-faint">
              {liveClaims.reason}
              <div className="mt-1">
                {liveClaims.rejectedClaimIds.length} tentative claim removed, {liveClaims.open} open
              </div>
            </div>
          </div>
        </Panel>
      </aside>
    </div>
  );
}
