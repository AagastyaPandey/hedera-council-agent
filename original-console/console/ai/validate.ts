import { hydrateIntent, hydrateSource, type EvidenceManifest } from "../packages/shared/evidence";
import {
  ClaimSchema,
  IntentSchema,
  type Claim,
  type Intent,
} from "../packages/shared/schemas";

export type ValidationIssue = {
  id: string;
  kind: "claim" | "intent" | "source" | "schema";
  message: string;
};

export type ValidationResult = {
  ok: boolean;
  intent: Intent | null;
  claims: Claim[];
  rejected: ValidationIssue[];
  warnings: ValidationIssue[];
  totalClaims: number;
  sourceLinked: number;
  openUnresolved: number;
  actionCount: number;
};

export function validateExtraction(input: {
  claims: Claim[];
  intent: Intent;
  manifest: EvidenceManifest;
}): ValidationResult {
  const rejected: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const intentParse = IntentSchema.safeParse(input.intent);
  let hydratedIntent: Intent | null = null;
  if (!intentParse.success) {
    for (const issue of intentParse.error.issues) {
      rejected.push({
        id: "intent",
        kind: "schema",
        message: `${issue.path.join(".") || "intent"}: ${issue.message}`,
      });
    }
  } else {
    try {
      hydratedIntent = hydrateIntent(intentParse.data, input.manifest);
    } catch (error) {
      rejected.push({
        id: "intent",
        kind: "source",
        message: error instanceof Error ? error.message : "Intent source hydration failed.",
      });
    }
  }

  const hydratedClaims: Claim[] = [];
  for (const rawClaim of input.claims) {
    const parsed = ClaimSchema.safeParse(rawClaim);
    if (!parsed.success) {
      rejected.push({
        id: rawClaim.id ?? "unknown-claim",
        kind: "schema",
        message: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
      continue;
    }
    try {
      const source = hydrateSource(parsed.data.source, input.manifest);
      if (
        parsed.data.linkedUnresolvedId &&
        !input.intent.unresolved.some((item) => item.id === parsed.data.linkedUnresolvedId)
      ) {
        rejected.push({
          id: parsed.data.id,
          kind: "claim",
          message: `Claim references unknown unresolved item ${parsed.data.linkedUnresolvedId}.`,
        });
        continue;
      }
      if (parsed.data.confidence < 0.5) {
        warnings.push({
          id: parsed.data.id,
          kind: "claim",
          message: "Low extraction confidence — requires reviewer attention.",
        });
      }
      hydratedClaims.push({ ...parsed.data, source });
    } catch (error) {
      rejected.push({
        id: parsed.data.id,
        kind: "source",
        message: error instanceof Error ? error.message : "Source quote not found.",
      });
    }
  }

  return {
    ok: rejected.length === 0,
    intent: hydratedIntent,
    claims: hydratedClaims,
    rejected,
    warnings,
    totalClaims: input.claims.length,
    sourceLinked: hydratedClaims.length,
    openUnresolved: input.intent.unresolved.length,
    actionCount: input.intent.actions.length,
  };
}
