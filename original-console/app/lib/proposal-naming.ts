import type { Provenance } from "./types";

export const ATTACK_PROPOSAL_TITLE = "Fee Tuning: attack (recorded)";
export const ATTACK_PROPOSAL_TITLE_LIVE = "Fee Tuning: attack (live)";
export const BENIGN_PROPOSAL_TITLE = "Q3 Developer Grant";

export function isAttackProposalTitle(title: string): boolean {
  return (
    /p2 live replay/i.test(title) ||
    /routine parameter tuning of the fee module/i.test(title) ||
    /fee module parameter tuning/i.test(title) ||
    /fee tuning: attack/i.test(title)
  );
}

export function normalizeProposalTitle(
  title: string,
  provenance?: Provenance
): string {
  const trimmed = title.trim();
  if (!trimmed) return "Untitled proposal";
  if (isAttackProposalTitle(trimmed)) {
    return provenance === "LIVE"
      ? ATTACK_PROPOSAL_TITLE_LIVE
      : ATTACK_PROPOSAL_TITLE;
  }
  if (/^q3 developer grant(?: and fee tuning)?$/i.test(trimmed)) {
    return BENIGN_PROPOSAL_TITLE;
  }
  return trimmed;
}

export function normalizeLegacyAttackText(text: string): string {
  return /^p2 live replay\b/i.test(text.trim())
    ? ATTACK_PROPOSAL_TITLE_LIVE
    : text;
}

export function proposalFamily(title: string): string {
  if (isAttackProposalTitle(title)) return "attack";
  if (/^q3 developer grant/i.test(title.trim())) return "grant";
  return normalizeProposalTitle(title).toLowerCase();
}

export function proposalRef(id: string): string {
  return `Proposal #${id}`;
}

export function proposalLabel(id: string, title: string): string {
  return `${proposalRef(id)} · ${title}`;
}
