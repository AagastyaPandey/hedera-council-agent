/** Serialized Violation Report schema with no chain or filesystem dependencies. */

export interface DecodedActionRecord {
  target: string;
  targetLabel: string;
  function: string;
  args: Record<string, string>;
  argumentLabels?: Record<string, string>;
  humanText: string;
  nested: DecodedActionRecord[];
}

export interface ViolationReport {
  proposalId: string;
  scenarioId: string;
  layer: "executor" | "sentinel";
  status: "REJECTED" | "FLAGGED" | "PASSED";
  proposalSaid: string;
  approved: DecodedActionRecord[];
  submitted: DecodedActionRecord[];
  violatedConstraint: { code: string; message: string };
  evidence: {
    commitment: string;
    calldataHash: string;
    calldata: string;
    revertData: string;
    txHash: string | null;
    traceRef: string | null;
  };
}
