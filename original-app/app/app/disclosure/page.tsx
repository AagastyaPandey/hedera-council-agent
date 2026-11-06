"use client";

import { DisclosureForm } from "@/components/DisclosureForm";
import { WalletGraph } from "@/components/WalletGraph";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProposalHeaderActions } from "@/components/ui/ProposalHeaderActions";
import { useProposal } from "@/lib/proposal-context";

export default function DisclosurePage() {
  const { proposal } = useProposal();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Disclosure & graph"
        title="Disclosure and potential conflicts"
        description="Publish declared interests, inspect simulated wallet links, and attach supporting transactions to a disclosure challenge."
        actions={<ProposalHeaderActions proposal={proposal} />}
      />
      <DisclosureForm proposalId={proposal.id} />
      <WalletGraph proposalId={proposal.id} />
    </div>
  );
}
