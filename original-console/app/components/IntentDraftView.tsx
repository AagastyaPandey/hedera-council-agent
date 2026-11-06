"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileText,
  GitBranch,
  Loader2,
} from "lucide-react";
import { DataState } from "@/components/ui/DataState";
import { HashChip } from "@/components/ui/HashChip";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { WhyDrawer } from "@/components/ui/WhyDrawer";
import {
  confirmIntent,
  getEvidenceDocument,
  getIntentDraft,
} from "@/lib/data";
import { cn, formatPct } from "@/lib/format";
import { proposalRef } from "@/lib/proposal-naming";
import { useAsync } from "@/lib/useAsync";
import type {
  IntentConfirmation,
  IntentSource,
  UnresolvedItem,
} from "@/lib/types";

export function IntentDraftView({ proposalId }: { proposalId: string }) {
  const { data, loading, error, reload } = useAsync(
    async () => {
      const draft = await getIntentDraft(proposalId);
      const document = await getEvidenceDocument(proposalId, draft.version);
      return { draft, document };
    },
    [proposalId]
  );
  const [selectedSource, setSelectedSource] = useState<IntentSource | null>(null);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [confirmation, setConfirmation] = useState<IntentConfirmation | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setSelectedSource(null);
    setAccepted(new Set());
    setConfirmation(null);
    setConfirmError(null);
  }, [proposalId]);

  const unresolved = data?.draft.unresolved ?? [];
  const ready = unresolved.length === 0 || accepted.size === unresolved.length;

  const confirm = async () => {
    setConfirming(true);
    setConfirmError(null);
    try {
      setConfirmation(await confirmIntent(proposalId, accepted.size));
    } catch (cause) {
      setConfirmError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Panel
      title="AI Intent Review"
      subtitle="Advisory extraction with source citations. Humans confirm the exact executable intent."
      actions={
        data ? (
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="info">
              {data.draft.actions.length}{" "}
              {data.draft.actions.length === 1 ? "claim" : "claims"}
            </StatusBadge>
            {unresolved.length > 0 ? <StatusBadge tone="warning">{unresolved.length} unresolved</StatusBadge> : <StatusBadge tone="success">Ready to compile</StatusBadge>}
            <WhyDrawer>Claim count is the number of extracted executable actions. Every UNRESOLVED item must be resolved in the source or explicitly accepted before the bridge will hash the intent.</WhyDrawer>
          </div>
        ) : null
      }
    >
      <DataState
        loading={loading}
        error={error}
        empty={!loading && !error && !data}
        emptyMessage="No intent draft or source document is available."
        loadingLabel="Extracting source-grounded intent"
        onRetry={reload}
      >
        {data ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <FileText size={16} className="text-cyan-300" />
              <h3 className="text-sm font-semibold text-slate-100">{data.draft.title}</h3>
              <StatusBadge tone="neutral">v{data.draft.version}</StatusBadge>
              <StatusBadge tone="neutral">{proposalRef(data.draft.proposalId)}</StatusBadge>
              <HashChip label="doc" value={data.document.docHash} />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <section className="rounded-xl border border-slate-800 bg-slate-950/50">
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
                  <div>
                    <p className="text-xs font-semibold text-slate-200">Source document</p>
                    <p className="mt-0.5 text-[10px] text-slate-500">page {data.document.content ? 1 : "—"} · section 1</p>
                  </div>
                  <WhyDrawer>Claims use half-open UTF-8 byte spans [start, end). Selecting a claim highlights exactly those bytes in this document.</WhyDrawer>
                </header>
                <HighlightedDocument
                  content={data.document.content}
                  source={selectedSource}
                />
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">Extracted claims</p>
                  <span className="text-[10px] text-cyan-300">Select a claim to inspect its citation</span>
                </div>
                {data.draft.actions.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-800 p-5 text-center text-xs text-slate-500">No executable actions could be grounded in the source.</div>
                ) : data.draft.actions.map((action, index) => (
                  <button
                    type="button"
                    key={`${action.kind}-${index}`}
                    onClick={() => setSelectedSource(action.source)}
                    className={cn(
                      "w-full rounded-xl border bg-slate-950/40 p-4 text-left transition-colors",
                      selectedSource === action.source || (!selectedSource && index === 0)
                        ? "border-cyan-800 bg-cyan-950/10"
                        : "border-slate-800 hover:border-slate-700"
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <StatusBadge tone="info">{action.kind}</StatusBadge>
                      <span className="inline-flex items-center gap-1 text-[10px] text-cyan-300">Open citation <ArrowRight size={11} /></span>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <HashChip label="target" value={action.target || null} lead={8} tail={4} kind="address" />
                      <HashChip label="counterparty" value={action.counterparty || null} lead={8} tail={4} kind="address" />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-slate-400">
                      <span>selector <span className="font-mono text-slate-300">{action.selector}</span></span>
                      <span>max <span className="font-mono text-slate-300">{action.maxAmount}</span> base units</span>
                      <WhyDrawer>Max amount is the executable upper bound in token or parameter base units. It is not formatted as a confidence or a percentage.</WhyDrawer>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-800 pt-3">
                      <HashChip label="docHash" value={action.source.docHash} lead={8} tail={4} />
                      <span className="text-[10px] text-slate-500">page {action.source.page} · §{action.source.section} · [{action.source.span[0]}, {action.source.span[1]})</span>
                      <span className="font-mono text-[11px] text-slate-300">{formatPct(action.confidence)}</span>
                      <WhyDrawer>Confidence is the extractor&apos;s advisory grounding score for this action. It does not change the on-chain rule or override human review.</WhyDrawer>
                    </div>
                  </button>
                ))}
              </section>
            </div>

            {unresolved.length > 0 ? (
              <section className="space-y-2 rounded-xl border border-amber-900/50 bg-amber-950/10 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <AlertTriangle size={15} className="text-amber-400" />
                  <p className="text-xs font-semibold uppercase tracking-[0.13em] text-amber-300">Unresolved — human decision required</p>
                  <WhyDrawer>These are ambiguities in the proposal, not AI errors. Accepting one records that you deliberately included the current executable interpretation despite the ambiguity.</WhyDrawer>
                </div>
                {unresolved.map((item, index) => (
                  <UnresolvedCard
                    key={`${item.question}-${index}`}
                    item={item}
                    checked={accepted.has(index)}
                    onToggle={() => {
                      setConfirmation(null);
                      setAccepted((current) => {
                        const next = new Set(current);
                        if (next.has(index)) next.delete(index); else next.add(index);
                        return next;
                      });
                    }}
                    onSelectSource={() => {
                      if ("docHash" in item.source) {
                        setSelectedSource(item.source as IntentSource);
                      }
                    }}
                  />
                ))}
              </section>
            ) : null}

            {data.draft.assumptions.length > 0 ? (
              <section>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Assumptions</p>
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {data.draft.assumptions.map((item) => (
                    <li key={item.name} className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs">
                      <span className="font-mono text-[10px] text-cyan-300">{item.name}</span>
                      <p className="mt-0.5 text-slate-400">{item.value}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-200">Confirm executable intent</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    {ready ? "The bridge will compile actions and rules, then return their hashes." : `${unresolved.length - accepted.size} UNRESOLVED item${unresolved.length - accepted.size === 1 ? "" : "s"} still block confirmation.`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={confirm}
                  disabled={!ready || confirming}
                  className="inline-flex items-center gap-2 rounded-lg border border-emerald-800 bg-emerald-950/30 px-4 py-2 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-950/60 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-900 disabled:text-slate-600"
                >
                  {confirming ? <Loader2 size={14} className="animate-spin" /> : <GitBranch size={14} />}
                  {confirming ? "Compiling…" : "Confirm intent"}
                </button>
              </div>
              {confirmError ? <p className="mt-3 text-xs text-red-400">{confirmError}</p> : null}
              {confirmation ? <ConfirmedIntent confirmation={confirmation} /> : null}
            </section>
          </div>
        ) : null}
      </DataState>
    </Panel>
  );
}

function HighlightedDocument({ content, source }: { content: string; source: IntentSource | null }) {
  const highlightRef = useRef<HTMLElement>(null);
  const active = source ?? null;
  const start = active?.span[0] ?? 0;
  const end = active?.span[1] ?? 0;
  const valid = start >= 0 && end >= start && end <= content.length;

  useEffect(() => {
    highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [start, end]);

  return (
    <div className="max-h-[520px] overflow-auto p-4">
      <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-7 text-slate-400">
        {valid && active ? (
          <>
            {content.slice(0, start)}
            <mark ref={highlightRef} className="rounded bg-cyan-400/20 px-0.5 text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.12)]">{content.slice(start, end)}</mark>
            {content.slice(end)}
          </>
        ) : content}
      </pre>
    </div>
  );
}

function UnresolvedCard({
  item,
  checked,
  onToggle,
  onSelectSource,
}: {
  item: UnresolvedItem;
  checked: boolean;
  onToggle: () => void;
  onSelectSource: () => void;
}) {
  const hasSource = "docHash" in item.source;
  return (
    <div className="rounded-lg border border-amber-900/60 bg-slate-950/40 px-3 py-3">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="mt-1 h-4 w-4 accent-amber-400"
          aria-label={`Explicitly accept unresolved item: ${item.question}`}
        />
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onSelectSource} disabled={!hasSource} className="text-left text-xs leading-relaxed text-amber-200 hover:text-amber-100 disabled:cursor-default">
            {item.question}
          </button>
          <p className="mt-1 text-[10px] text-amber-500/80">
            {hasSource && "span" in item.source ? `page ${item.source.page} · §${item.source.section} · [${item.source.span[0]}, ${item.source.span[1]})` : "No source span"}
          </p>
          <label className="mt-2 block text-[10px] text-slate-500">Check to explicitly accept this ambiguity for the current draft.</label>
        </div>
      </div>
    </div>
  );
}

function ConfirmedIntent({ confirmation }: { confirmation: IntentConfirmation }) {
  return (
    <div className="mt-4 border-t border-slate-800 pt-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-emerald-300">
        <CheckCircle2 size={15} /> Intent compiled through intent-bridge
        {confirmation.acceptedUnresolved > 0 ? <StatusBadge tone="warning">{confirmation.acceptedUnresolved} explicitly accepted</StatusBadge> : null}
        <WhyDrawer>Accepted count records how many ambiguity acknowledgements were removed from the final spec before hashing. The bridge rejects any unacknowledged unresolved item.</WhyDrawer>
      </div>
      <div className="mt-3 grid gap-2 lg:grid-cols-3">
        <HashChip label="intentHash" value={confirmation.intentHash} />
        <HashChip label="rulesHash" value={confirmation.rulesHash} />
        <HashChip label="actionsHash" value={confirmation.actionsHash} />
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-slate-500">intentHash commits to the canonical reviewed spec; rulesHash is the on-chain ABI-encoded rule hash. They intentionally use different encodings.</p>
      <div className="mt-4 space-y-2">
        {confirmation.rules.map((rule, index) => (
          <article key={`${rule.selector}-${index}`} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StatusBadge tone="info">{rule.kindLabel}</StatusBadge>
              <span className="font-mono text-[10px] text-slate-500">rule {index + 1}</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">{rule.plainEnglish}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <HashChip label="target" value={rule.target} lead={8} tail={4} kind="address" />
              <HashChip label="counterparty" value={rule.counterparty} lead={8} tail={4} kind="address" />
              <span className="font-mono text-[10px] text-slate-500">{rule.selector} · max {rule.maxAmount} · children {rule.childCount}</span>
              <WhyDrawer>Rule position {index + 1} matches action position {index + 1}. Max is an upper bound in base units; children is the number of nested actions a multicall must contain.</WhyDrawer>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
