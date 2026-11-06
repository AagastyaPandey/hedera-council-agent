"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { DATA_MODE } from "./config";
import {
  normalizeProposalTitle,
  proposalLabel,
} from "./proposal-naming";
import type { Proposal } from "./types";

interface ProposalContextValue {
  proposals: Proposal[];
  proposal: Proposal;
  setProposalId: (id: string) => void;
  selectProposal: (proposal: Proposal) => void;
}

const ProposalContext = createContext<ProposalContextValue | null>(null);

function normalizeProposal(proposal: Proposal): Proposal {
  const provenance =
    proposal.provenance ?? (DATA_MODE === "live" ? "LIVE" : "MOCK");
  const title = normalizeProposalTitle(proposal.title, provenance);
  return {
    ...proposal,
    title,
    label: proposalLabel(proposal.id, title),
    provenance,
  };
}

export function ProposalProvider({
  proposals,
  children,
}: {
  proposals: Proposal[];
  children: React.ReactNode;
}) {
  const [id, setId] = useState(proposals[0]?.id ?? "");
  const [liveProposals, setLiveProposals] = useState<Proposal[]>([]);

  const allProposals = useMemo(() => {
    const merged = proposals.map(normalizeProposal);
    for (const candidate of liveProposals) {
      const normalized = normalizeProposal(candidate);
      if (!merged.some((proposal) => proposal.id === normalized.id)) {
        merged.push(normalized);
      }
    }
    return merged;
  }, [proposals, liveProposals]);

  const selectProposal = useCallback((proposal: Proposal) => {
    const normalized = normalizeProposal(proposal);
    setLiveProposals((current) =>
      current.some((item) => item.id === normalized.id)
        ? current
        : [...current, normalized]
    );
    setId(normalized.id);
  }, []);

  const value = useMemo<ProposalContextValue | null>(() => {
    const proposal = allProposals.find((item) => item.id === id) ?? allProposals[0];
    if (!proposal) return null;
    return {
      proposals: allProposals,
      proposal,
      setProposalId: setId,
      selectProposal,
    };
  }, [allProposals, id, selectProposal]);

  if (!value) return <>{children}</>;
  return (
    <ProposalContext.Provider value={value}>
      {children}
    </ProposalContext.Provider>
  );
}

export function useProposal(): ProposalContextValue {
  const context = useContext(ProposalContext);
  if (!context) {
    throw new Error("useProposal must be used inside a ProposalProvider");
  }
  return context;
}
