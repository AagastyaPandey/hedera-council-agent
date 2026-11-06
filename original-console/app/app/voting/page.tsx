"use client";

import { AttentionQueue } from "@/components/AttentionQueue";
import { VotingPanel } from "@/components/VotingPanel";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProposalHeaderActions } from "@/components/ui/ProposalHeaderActions";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useProposal } from "@/lib/proposal-context";

export default function VotingPage() {
  const { proposal } = useProposal();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Informed consent"
        title="Voting"
        description="Votes bind to the execution commitment. Brief acknowledgments feed the informed-vote ratio."
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <StatusBadge tone="info">gov {proposal.govId}</StatusBadge>
            <ProposalHeaderActions proposal={proposal} />
          </div>
        }
      />
      <AttentionQueue />
      <VotingPanel govId={proposal.govId} proposalId={proposal.id} />
    </div>
  );
}
