"use client";

import { IntentDraftView } from "@/components/IntentDraftView";
import { VersionChainView } from "@/components/VersionChainView";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProposalHeaderActions } from "@/components/ui/ProposalHeaderActions";
import { Tabs } from "@/components/ui/Tabs";
import { useProposal } from "@/lib/proposal-context";

export default function ProposalsPage() {
  const { proposal } = useProposal();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Proposal intelligence"
        title={proposal.title}
        description="Source-grounded intent extraction and the append-only, hash-chained version history."
        actions={
          <ProposalHeaderActions proposal={proposal} />
        }
      />

      <Tabs
        items={[
          {
            id: "intent",
            label: "Intent Draft",
            content: <IntentDraftView proposalId={proposal.id} />,
          },
          {
            id: "versions",
            label: "Version Chain",
            content: <VersionChainView proposalId={proposal.id} />,
          },
        ]}
      />
    </div>
  );
}
