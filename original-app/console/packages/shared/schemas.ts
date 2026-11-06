import { isAddress, isHex, type Address, type Hex } from "viem";
import { z } from "zod";

export const ACTION_KINDS = [
  "ERC20_TRANSFER",
  "ERC20_APPROVE",
  "PARAM_SET",
  "UPGRADE",
  "OWNERSHIP_TRANSFER",
  "MULTICALL",
] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];

export type SourceRef = {
  docKey: string;
  docHash?: Hex;
  page: number;
  section: string;
  quote: string;
  span?: [number, number];
};

export type UnresolvedItem = {
  id: string;
  question: string;
  context: string;
  source: SourceRef;
  options: { value: string; label: string; effect: string }[];
  resolution?: string;
};

export type Assumption = {
  name: string;
  value: string;
  source: SourceRef;
};

export type ActionSpec = {
  kind: ActionKind;
  target: Address;
  selector: Hex;
  counterparty: Address;
  maxAmount: string;
  codeHash: Hex | null;
  children?: ActionSpec[];
  source: SourceRef;
  confidence: number;
  label?: string;
};

export type Intent = {
  proposalId: string;
  version: number;
  title: string;
  actions: ActionSpec[];
  unresolved: UnresolvedItem[];
  assumptions: Assumption[];
};

export type Claim = {
  id: string;
  text: string;
  kind: "action" | "assumption" | "impact";
  source: SourceRef;
  confidence: number;
  support: number;
  actionIndex?: number;
  linkedUnresolvedId?: string;
};

export const SourceRefSchema = z.object({
  docKey: z.string().min(1),
  docHash: z.custom<Hex>((value) => typeof value === 'string' && isHex(value)).optional(),
  page: z.number().int().positive(),
  section: z.string().min(1),
  quote: z.string().min(3),
  span: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).optional(),
});

const ActionSchema: z.ZodType<ActionSpec> = z.lazy(() =>
  z.object({
    kind: z.enum(ACTION_KINDS),
    target: z.custom<Address>((value) => typeof value === 'string' && isAddress(value)),
    selector: z.custom<Hex>((value) => typeof value === 'string' && isHex(value)),
    counterparty: z.custom<Address>((value) => typeof value === 'string' && isAddress(value)),
    maxAmount: z.string().regex(/^\d+$/),
    codeHash: z.custom<Hex>((value) => typeof value === 'string' && isHex(value)).nullable(),
    children: z.array(ActionSchema).optional(),
    source: SourceRefSchema,
    confidence: z.number().min(0).max(1),
    label: z.string().optional(),
  }),
);

export const SourceInputSchema = SourceRefSchema;

export const IntentSchema = z.object({
  proposalId: z.string().min(1),
  version: z.number().int().positive(),
  title: z.string().min(1),
  actions: z.array(ActionSchema).min(1),
  unresolved: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      context: z.string(),
      source: SourceRefSchema,
      options: z.array(z.object({ value: z.string(), label: z.string(), effect: z.string() })),
      resolution: z.string().optional(),
    }),
  ),
  assumptions: z.array(
    z.object({ name: z.string(), value: z.string(), source: SourceRefSchema }),
  ),
});

export const ClaimSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: z.enum(["action", "assumption", "impact"]),
  source: SourceRefSchema,
  confidence: z.number().min(0).max(1),
  support: z.number().min(0).max(1),
  actionIndex: z.number().int().nonnegative().optional(),
  linkedUnresolvedId: z.string().optional(),
});

export type DecodedAction = {
  target: Address;
  targetLabel: string;
  function: string;
  selector?: Hex;
  args: Record<string, string>;
  humanText: string;
  nested: DecodedAction[];
  unknown?: boolean;
  flag?: string;
};

export type ViolationConstraint = {
  code: string;
  message: string;
  selector?: Hex;
};

export type EvidenceBundle = {
  commitment: Hex;
  submittedCommitment?: Hex;
  calldataHash: Hex;
  calldata: Hex;
  revertData: Hex;
  txHash: Hex | null;
  traceRef: string | null;
};

export type ViolationReport = {
  proposalId: string;
  scenarioId: string;
  layer: "executor" | "sentinel" | "disclosure";
  status: "REJECTED" | "FLAGGED" | "PASSED";
  proposalSaid: string;
  approved: DecodedAction[];
  submitted: DecodedAction[];
  violatedConstraint: ViolationConstraint | null;
  evidence: EvidenceBundle;
};

export type ScorecardStatus = "PASS" | "FAIL" | "TEST_REQUIRED";

export type ScorecardEntry = {
  id: string;
  property: string;
  status: ScorecardStatus;
  testFile: string;
  durationMs: number;
  evidenceKind: "reference-model" | "unit" | "pending-solidity";
  reason?: string;
};

export type StageFactor = {
  label: string;
  value: string;
  weight?: string;
  detail?: string;
};

export type StageStatus = "GREEN" | "AMBER" | "RED";

export type StageScore = {
  stage: "CLAIMS" | "COI" | "VOTING" | "EXECUTION";
  score: number | null;
  status: StageStatus;
  reason: string;
  factors: StageFactor[];
  drilldown: string;
};

export type EvaluationChain = {
  proposalId: string;
  stages: StageScore[];
};
