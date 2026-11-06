import { ProvenanceTag } from "@/components/ui/ProvenanceTag";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DATA_MODE } from "@/lib/config";
import { proposalRef } from "@/lib/proposal-naming";
import type { Proposal } from "@/lib/types";

export function ProposalHeaderActions({ proposal }: { proposal: Proposal }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <StatusBadge tone="info">{proposalRef(proposal.id)}</StatusBadge>
      <ProvenanceTag
        kind={proposal.provenance ?? (DATA_MODE === "live" ? "LIVE" : "MOCK")}
        detail="Provenance of this proposal record."
      />
    </div>
  );
}
