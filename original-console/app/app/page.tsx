"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DecisionTrail } from "@/components/DecisionTrail";
import { LiveSentinel } from "@/components/LiveSentinel";
import { ViolationExplainer } from "@/components/ViolationExplainer";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProposalHeaderActions } from "@/components/ui/ProposalHeaderActions";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useProposal } from "@/lib/proposal-context";
import { proposalLabel, normalizeProposalTitle } from "@/lib/proposal-naming";
import { useSentinelFeed } from "@/lib/useSentinelFeed";
import type { Proposal, SentinelEvent } from "@/lib/types";

export default function DecisionTrailPage() {
  const { proposal, selectProposal } = useProposal();
  const { feed, loading, error } = useSentinelFeed();
  const seenHalts = useRef<Set<string>>(new Set());
  const initializedFeed = useRef(false);
  const [autoHalt, setAutoHalt] = useState<SentinelEvent | null>(null);

  useEffect(() => {
    if (!feed) return;
    const halts = feed.events.filter((event) => event.phase === "HALTED");

    if (!initializedFeed.current) {
      initializedFeed.current = true;
      for (const halt of halts) seenHalts.current.add(halt.id);
      return;
    }

    for (const halt of halts) {
      if (seenHalts.current.has(halt.id)) continue;
      seenHalts.current.add(halt.id);
      selectProposal(proposalFromEvent(halt));
      setAutoHalt(halt);
    }
  }, [feed, selectProposal]);

  const currentEvents = useMemo(
    () =>
      (feed?.events ?? []).filter(
        (event) =>
          event.proposalId === proposal.id &&
          normalizeProposalTitle(event.title, "LIVE") === proposal.title
      ),
    [feed, proposal.id, proposal.title]
  );
  const currentGate = useMemo(
    () =>
      [...currentEvents]
        .reverse()
        .find(
          (event) =>
            event.phase === "HALTED" || event.phase === "VIOLATION"
        ) ?? null,
    [currentEvents]
  );
  const currentHalt = useMemo(
    () =>
      [...currentEvents]
        .reverse()
        .find((event) => event.phase === "HALTED") ?? null,
    [currentEvents]
  );
  const openedBySentinel = Boolean(
    autoHalt && currentGate && autoHalt.id === currentGate.id
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Decision trail"
        title={proposal.title}
        description="Claims → COI → Voting → Execution. The first three stages inform; execution is a binary on-chain gate."
        actions={
          <ProposalHeaderActions proposal={proposal} />
        }
      />

      <DecisionTrail proposalId={proposal.id} liveEvent={currentGate} />

      <LiveSentinel
        feed={feed}
        loading={loading}
        error={error}
        currentProposalId={proposal.id}
        onSelectProposal={(event) => {
          selectProposal(proposalFromEvent(event));
          if (event.phase === "HALTED") setAutoHalt(event);
        }}
      />

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          Violation explainer
          {currentHalt ? (
            <StatusBadge tone="warning">live halt report</StatusBadge>
          ) : null}
        </h2>
        <ViolationExplainer
          scenarioId={proposal.scenarioId}
          liveReport={currentHalt?.report ?? currentGate?.report ?? null}
          liveTitle={normalizeProposalTitle(
            currentGate?.title ?? currentHalt?.title ?? proposal.title,
            "LIVE"
          )}
          autoOpen={openedBySentinel}
        />
      </section>
    </div>
  );
}

function proposalFromEvent(event: SentinelEvent): Proposal {
  const title = normalizeProposalTitle(event.title, "LIVE");
  return {
    id: event.proposalId,
    label: proposalLabel(event.proposalId, title),
    title,
    scenarioId: Number(event.proposalId),
    govId: event.govId ?? "",
    provenance: "LIVE",
  };
}
