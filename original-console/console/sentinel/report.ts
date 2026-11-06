import { ERROR_BY_NAME, ERROR_BY_SELECTOR } from "../packages/shared/addresses";
import type {
  DecodedAction,
  EvidenceBundle,
  ViolationConstraint,
  ViolationReport,
} from "../packages/shared/schemas";
import { violationSelector } from "../reference/errors";

export function describeErrorSelector(selector: string): { name: string; text: string } | null {
  const definition = ERROR_BY_SELECTOR[selector.toLowerCase()];
  if (!definition) return null;
  return { name: definition.name, text: definition.text };
}

export function buildReport(input: {
  proposalId: string;
  scenarioId: string;
  layer: "executor" | "sentinel" | "disclosure";
  status: "REJECTED" | "FLAGGED" | "PASSED";
  proposalSaid: string;
  approved: DecodedAction[];
  submitted: DecodedAction[];
  constraint: { code: string; message: string } | null;
  evidence: EvidenceBundle;
}): ViolationReport {
  const violatedConstraint: ViolationConstraint | null = input.constraint
    ? {
        code: input.constraint.code,
        message: input.constraint.message,
        selector: violationSelector(input.constraint.code),
      }
    : null;

  return {
    proposalId: input.proposalId,
    scenarioId: input.scenarioId,
    layer: input.layer,
    status: input.status,
    proposalSaid: input.proposalSaid,
    approved: input.approved,
    submitted: input.submitted,
    violatedConstraint,
    evidence: input.evidence,
  };
}

export function constraintTitle(code: string): string {
  return code in ERROR_BY_NAME ? ERROR_BY_NAME[code as keyof typeof ERROR_BY_NAME].name : code;
}
