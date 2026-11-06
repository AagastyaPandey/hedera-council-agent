import type { Address, Hex } from "viem";
import type { ConcreteCall, EncodableCall } from "../packages/shared/calls";
import type {
  DecodedAction,
  Intent,
  ViolationConstraint,
  ViolationReport,
} from "../packages/shared/schemas";

export type ScenarioLayer = "executor" | "sentinel" | "disclosure";
export type ScenarioMode = "approved" | "attack" | "challenge";

export type ScenarioContext = {
  chainId: number;
  expectedChainId: number;
  submittedVersion: number;
  latestVersion: number;
  executed: boolean;
  now: number;
  eta: number;
  blockNumber: number;
  recipientBehavior: "REENTRANT" | null;
  sentinel: { flag: string; traceFile: string } | null;
  disclosure: { challenge: boolean; linkIds: string[] } | null;
};

export type Scenario = {
  id: string;
  index: number;
  title: string;
  subtitle: string;
  layer: ScenarioLayer;
  mode: ScenarioMode;
  calls: EncodableCall[];
  context: ScenarioContext;
  expected: {
    status: "PASSED" | "REJECTED" | "FLAGGED";
    code: string;
    label: string;
  };
  proposalSaid: string;
  attackDescription: string;
  modelNote: string | null;
};

export type RunStepStatus = "PASS" | "FAIL" | "FLAG" | "INFO";

export type RunStep = {
  id: string;
  label: string;
  status: RunStepStatus;
  detail: string;
};

export type ExecutionContext = {
  proposalId: string;
  chainId: number;
  executor: Address;
  intent: Intent;
  evidenceRoot: Hex;
  disclosureHash: Hex;
  approvedCalls: ConcreteCall[];
};

export type ChallengeSummary = {
  score: number;
  threshold: number;
  claim: string;
  linkCount: number;
  payload: unknown;
};

export type RunResult = {
  scenario: Scenario;
  layer: ScenarioLayer;
  status: "PASSED" | "REJECTED" | "FLAGGED";
  code: string;
  label: string;
  message: string;
  steps: RunStep[];
  approved: DecodedAction[];
  submitted: DecodedAction[];
  approvedCalls: ConcreteCall[];
  submittedCalls: ConcreteCall[];
  approvedCalldata: Hex;
  submittedCalldata: Hex;
  approvedCommitment: Hex;
  submittedCommitment: Hex;
  commitmentMatched: boolean;
  intentHash: Hex;
  approvedActionsHash: Hex;
  submittedActionsHash: Hex;
  calldataHash: Hex;
  revertData: Hex;
  txHash: Hex | null;
  traceRef: string | null;
  violatedConstraint: ViolationConstraint | null;
  report: ViolationReport;
  notes: string[];
  challenge?: ChallengeSummary;
};
