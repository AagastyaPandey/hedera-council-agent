/**
 * packages/shared/schemas/effect-preview.ts
 *
 * Canonical type for the Pre-vote Effect Preview. Produced by
 * sentinel/preview.ts, served by GET /api/preview/[proposalId], mirrored in
 * app/lib/types.ts, and recorded into packages/shared/fixtures/previews.json.
 *
 * All values are produced by deterministic code: a sandboxed simulation of the
 * committed calldata plus rule matching. No LLM text appears in this schema.
 */

import type { DecodedAction } from "../../../sentinel/decode";

export type EffectPreviewStatus = "OK" | "FAILED_SIMULATION" | "UNAVAILABLE";

export type EffectKind =
  | "TOKEN_BALANCE"
  | "ETH_BALANCE"
  | "ALLOWANCE"
  | "OWNERSHIP"
  | "IMPLEMENTATION"
  | "ADMIN"
  | "CODEHASH"
  | "STORAGE"
  | "CALL_TRACE";

export type EffectSeverity = "EXPECTED" | "UNEXPECTED" | "CRITICAL";

export interface EffectEntry {
  kind: EffectKind;
  /** Address the change happened to. */
  subject: string;
  /** Human label for the subject and the changed value, never just a raw address. */
  label: string;
  before: string;
  after: string;
  /** Signed base-unit delta for numeric kinds; null for address kinds. */
  delta: string | null;
  severity: EffectSeverity;
  /** Index into the committed rules array, or null when nothing matched. */
  matchedRuleIndex: number | null;
  explanation: string;
}

export interface DecodedRevert {
  selector: string;
  code: string;
  title: string;
  explanation: string;
  revertData: string;
}

export interface EffectPreview {
  proposalId: string;
  network: string;
  chainId: number;
  blockNumber: number;
  simulatedAt: string;
  status: EffectPreviewStatus;
  /** Decoded committed actions, decoded with sentinel/decode.ts. */
  actions: DecodedAction[];
  effects: EffectEntry[];
  statedVsSimulated: {
    statedSummary: string;
    mismatchCount: number;
    mismatches: string[];
  };
  traceFindings: string[];
  /** Reads that failed or could not be interpreted. Never reported as zero. */
  unobserved: string[];
  /** keccak256 of the canonical JSON of this object minus simulatedAt/previewHash. */
  previewHash: string;
  /** Present for UNAVAILABLE. */
  reason?: string;
  /** Present for FAILED_SIMULATION: the decoded on-chain revert. */
  revert?: DecodedRevert;
}

/** Fields excluded from previewHash so identical inputs hash identically. */
export const PREVIEW_HASH_EXCLUDED_FIELDS = ["simulatedAt", "previewHash"] as const;