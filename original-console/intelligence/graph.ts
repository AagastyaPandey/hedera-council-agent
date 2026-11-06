/**
 * intelligence/graph.ts
 *
 * Simulated wallet graph + Conflict-of-Interest (COI) scoring.
 *
 * ALL wallet, transaction, and amount data produced here is SIMULATED. It is
 * demo seed data, not chain data. The scoring is deterministic code.
 *
 * Link types: direct transfer, common funder, shared deployer/signer, and
 * time-correlated transfers. Link strengths are combined with noisy-OR:
 *
 *   R = 1 - Π(1 - s_j)
 *
 * where each s_j is the raw link strength adjusted by disclosure status:
 * undisclosed links carry the undisclosed multiplier; disclosed links are
 * heavily discounted.
 */

import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

export const SIMULATED = true as const;
export const SNAPSHOT_AT = "2026-09-12T00:00:00.000Z";

const W = {
  proposer: "0x000000000000000000000000000000000000a001",
  treasury: "0x000000000000000000000000000000000000a002",
  recipient: "0x000000000000000000000000000000000000b001",
  intermediary: "0x000000000000000000000000000000000000b002",
  funder: "0x000000000000000000000000000000000000c001",
  deployer: "0x000000000000000000000000000000000000c002",
  disclosed: "0x000000000000000000000000000000000000d001",
} as const;

export type WalletRole =
  | "proposer"
  | "treasury"
  | "recipient"
  | "intermediary"
  | "funder"
  | "deployer"
  | "disclosed";

export interface GraphNode {
  id: string;
  label: string;
  role: WalletRole;
  disclosed: boolean;
  simulated: true;
}

export type EdgeType = "transfer" | "funding" | "deployment" | "signer";
export type EdgeAsset = "ETH" | "USDC" | "none";

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: EdgeType;
  asset: EdgeAsset;
  /** Base units (ETH 18 decimals, USDC 6 decimals). "0" for non-value edges. */
  amount: string;
  timestamp: string;
  txHash: string;
  disclosed: boolean;
  simulated: true;
}

export interface SeedData {
  simulated: true;
  schema: "aegisdao.wallet-graph.v1";
  snapshotAt: string;
  disclaimer: string;
  proposalId: string;
  disclosure: {
    walletListHash: string;
    disclosedWallets: string[];
  };
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type LinkType =
  | "DIRECT_TRANSFER"
  | "COMMON_FUNDER"
  | "SHARED_DEPLOYER"
  | "TIME_CORRELATED";

export interface LinkFinding {
  id: string;
  type: LinkType;
  /** Wallet on the proposer's side of the link. */
  from: string;
  /** Always the payment recipient for this assessment. */
  to: string;
  disclosed: boolean;
  rawStrength: number;
  strength: number;
  evidenceTxHashes: string[];
  description: string;
}

export interface CoiOptions {
  timeWindowMs?: number;
  amountTolerance?: number;
  disclosedMultiplier?: number;
  undisclosedMultiplier?: number;
  maxStrength?: number;
}

export interface CoiAssessment {
  simulated: true;
  formula: string;
  proposalId: string;
  snapshotAt: string;
  subject: {
    proposer: string;
    proposerLabel: string;
    counterparty: string;
    counterpartyLabel: string;
  };
  disclosure: {
    walletListHash: string;
    disclosedWallets: string[];
  };
  links: LinkFinding[];
  overallRisk: number;
  disclosedRisk: number;
  undisclosedRisk: number;
  riskBand: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  caveats: string[];
  challengePayload: {
    proposalId: string;
    linkEvidenceHash: string;
    reason: string;
    canonicalEvidence: string;
  };
}

const DEFAULTS: Required<CoiOptions> = {
  timeWindowMs: 15 * 60 * 1000,
  amountTolerance: 0.15,
  disclosedMultiplier: 0.15,
  undisclosedMultiplier: 1.2,
  maxStrength: 0.99,
};

const BASE_STRENGTH: Record<LinkType, number> = {
  DIRECT_TRANSFER: 0.9,
  COMMON_FUNDER: 0.65,
  SHARED_DEPLOYER: 0.7,
  TIME_CORRELATED: 0.45,
};

const TX = (label: string) => ethers.id(`aegisdao-simulated-tx:${label}`);

/**
 * Deterministic simulated dataset: proposer, treasury, recipient, an
 * intermediary hop, a shared funder, a shared deployer, and one disclosed
 * contributor wallet.
 */
export function buildSeedData(): SeedData {
  const disclosedWallets = [W.proposer, W.treasury, W.disclosed];
  const walletListHash = ethers.keccak256(
    ethers.toUtf8Bytes(JSON.stringify([...disclosedWallets].sort()))
  );

  const nodes: GraphNode[] = [
    { id: W.proposer, label: "Proposer Council Safe", role: "proposer", disclosed: true, simulated: true },
    { id: W.treasury, label: "DAO Treasury", role: "treasury", disclosed: true, simulated: true },
    { id: W.recipient, label: "Development Wallet (undisclosed)", role: "recipient", disclosed: false, simulated: true },
    { id: W.intermediary, label: "Intermediary Wallet", role: "intermediary", disclosed: false, simulated: true },
    { id: W.funder, label: "Shared Funder", role: "funder", disclosed: false, simulated: true },
    { id: W.deployer, label: "Shared Deployer", role: "deployer", disclosed: false, simulated: true },
    { id: W.disclosed, label: "Disclosed Contributor Wallet", role: "disclosed", disclosed: true, simulated: true },
  ];

  const edges: GraphEdge[] = [
    {
      id: "treasury-funds-proposer",
      from: W.treasury,
      to: W.proposer,
      type: "funding",
      asset: "ETH",
      amount: ethers.parseEther("50").toString(),
      timestamp: "2026-09-01T09:00:00.000Z",
      txHash: TX("treasury-funds-proposer"),
      disclosed: true,
      simulated: true,
    },
    {
      id: "funder-funds-proposer",
      from: W.funder,
      to: W.proposer,
      type: "funding",
      asset: "ETH",
      amount: ethers.parseEther("12").toString(),
      timestamp: "2026-09-10T09:00:00.000Z",
      txHash: TX("funder-funds-proposer"),
      disclosed: false,
      simulated: true,
    },
    {
      id: "funder-funds-recipient",
      from: W.funder,
      to: W.recipient,
      type: "funding",
      asset: "ETH",
      amount: ethers.parseEther("12").toString(),
      timestamp: "2026-09-10T09:04:00.000Z",
      txHash: TX("funder-funds-recipient"),
      disclosed: false,
      simulated: true,
    },
    {
      id: "proposer-to-intermediary",
      from: W.proposer,
      to: W.intermediary,
      type: "transfer",
      asset: "USDC",
      amount: ethers.parseUnits("25000", 6).toString(),
      timestamp: "2026-09-10T10:00:00.000Z",
      txHash: TX("proposer-to-intermediary"),
      disclosed: false,
      simulated: true,
    },
    {
      id: "intermediary-to-recipient",
      from: W.intermediary,
      to: W.recipient,
      type: "transfer",
      asset: "USDC",
      amount: ethers.parseUnits("24500", 6).toString(),
      timestamp: "2026-09-10T10:06:00.000Z",
      txHash: TX("intermediary-to-recipient"),
      disclosed: false,
      simulated: true,
    },
    {
      id: "treasury-disclosed-grant",
      from: W.treasury,
      to: W.recipient,
      type: "transfer",
      asset: "USDC",
      amount: ethers.parseUnits("4000", 6).toString(),
      timestamp: "2026-09-05T11:00:00.000Z",
      txHash: TX("treasury-disclosed-grant"),
      disclosed: true,
      simulated: true,
    },
    {
      id: "proposer-disclosed-contributor",
      from: W.proposer,
      to: W.disclosed,
      type: "transfer",
      asset: "USDC",
      amount: ethers.parseUnits("3000", 6).toString(),
      timestamp: "2026-09-08T15:30:00.000Z",
      txHash: TX("proposer-disclosed-contributor"),
      disclosed: true,
      simulated: true,
    },
    {
      id: "deployer-deploys-proposer",
      from: W.deployer,
      to: W.proposer,
      type: "deployment",
      asset: "none",
      amount: "0",
      timestamp: "2026-08-20T08:00:00.000Z",
      txHash: TX("deployer-deploys-proposer"),
      disclosed: false,
      simulated: true,
    },
    {
      id: "deployer-deploys-recipient",
      from: W.deployer,
      to: W.recipient,
      type: "deployment",
      asset: "none",
      amount: "0",
      timestamp: "2026-08-20T08:07:00.000Z",
      txHash: TX("deployer-deploys-recipient"),
      disclosed: false,
      simulated: true,
    },
  ];

  return {
    simulated: true,
    schema: "aegisdao.wallet-graph.v1",
    snapshotAt: SNAPSHOT_AT,
    disclaimer:
      "SIMULATED DATA. Wallets, transactions, amounts, and timestamps are fabricated for the AegisDAO demo.",
    proposalId: "sim-42",
    disclosure: { walletListHash, disclosedWallets },
    nodes,
    edges,
  };
}

/**
 * Noisy-OR: R = 1 - Π(1 - s_j). Independent signals accumulate; any single
 * strong link can drive the score high.
 */
export function noisyOr(strengths: number[]): number {
  const product = strengths.reduce((acc, s) => acc * (1 - clamp01(s)), 1);
  return round4(clamp01(1 - product));
}

export function findLinks(seed: SeedData, options: CoiOptions = {}): LinkFinding[] {
  const opts = { ...DEFAULTS, ...options };
  const proposer = requireNode(seed, "proposer");
  const recipient = requireNode(seed, "recipient");
  const disclosed = new Set(seed.disclosure.disclosedWallets.map((a) => a.toLowerCase()));
  const proposerSide = (address: string) =>
    address.toLowerCase() === proposer.id.toLowerCase() || disclosed.has(address.toLowerCase());

  const links: LinkFinding[] = [];
  const add = (link: LinkFinding) => {
    const key = `${link.type}:${link.from}:${link.to}`;
    const existing = links.find((l) => `${l.type}:${l.from}:${l.to}` === key);
    if (existing) {
      existing.evidenceTxHashes = unique([...existing.evidenceTxHashes, ...link.evidenceTxHashes]);
      return;
    }
    links.push(link);
  };
  const adjusted = (type: LinkType, isDisclosed: boolean) => {
    const factor = isDisclosed ? opts.disclosedMultiplier : opts.undisclosedMultiplier;
    return round4(Math.min(opts.maxStrength, Math.max(0.01, BASE_STRENGTH[type] * factor)));
  };
  const disclosedOf = (edges: GraphEdge[]) => edges.every((e) => e.disclosed) || edges.every((e) => proposerSide(e.from) && disclosed.has(e.to.toLowerCase()));

  // 1. Direct transfers from the proposer (or a disclosed wallet) to the recipient.
  for (const edge of seed.edges) {
    if (edge.type !== "transfer") continue;
    if (edge.to.toLowerCase() !== recipient.id.toLowerCase()) continue;
    if (!proposerSide(edge.from)) continue;
    const isDisclosed = edge.disclosed;
    add({
      id: `direct-${edge.id}`,
      type: "DIRECT_TRANSFER",
      from: edge.from,
      to: recipient.id,
      disclosed: isDisclosed,
      rawStrength: BASE_STRENGTH.DIRECT_TRANSFER,
      strength: adjusted("DIRECT_TRANSFER", isDisclosed),
      evidenceTxHashes: [edge.txHash],
      description: `Direct transfer from ${labelOf(seed, edge.from)} to the payment recipient.`,
    });
  }

  // 2. Common funder: the same wallet funded both the proposer and the recipient.
  for (const node of seed.nodes) {
    const toProposer = seed.edges.filter(
      (e) => e.type === "funding" && same(e.from, node.id) && same(e.to, proposer.id)
    );
    const toRecipient = seed.edges.filter(
      (e) => e.type === "funding" && same(e.from, node.id) && same(e.to, recipient.id)
    );
    if (toProposer.length === 0 || toRecipient.length === 0) continue;
    const evidence = [...toProposer, ...toRecipient];
    const isDisclosed = disclosedOf(evidence);
    add({
      id: `funder-${node.id}`,
      type: "COMMON_FUNDER",
      from: node.id,
      to: recipient.id,
      disclosed: isDisclosed,
      rawStrength: BASE_STRENGTH.COMMON_FUNDER,
      strength: adjusted("COMMON_FUNDER", isDisclosed),
      evidenceTxHashes: evidence.map((e) => e.txHash),
      description: `Common funder: ${node.label} funded both the proposer and the payment recipient.`,
    });
  }

  // 3. Shared deployer/signer.
  for (const node of seed.nodes) {
    const toProposer = seed.edges.filter(
      (e) =>
        (e.type === "deployment" || e.type === "signer") &&
        same(e.from, node.id) &&
        same(e.to, proposer.id)
    );
    const toRecipient = seed.edges.filter(
      (e) =>
        (e.type === "deployment" || e.type === "signer") &&
        same(e.from, node.id) &&
        same(e.to, recipient.id)
    );
    if (toProposer.length === 0 || toRecipient.length === 0) continue;
    const evidence = [...toProposer, ...toRecipient];
    const isDisclosed = disclosedOf(evidence);
    add({
      id: `deployer-${node.id}`,
      type: "SHARED_DEPLOYER",
      from: node.id,
      to: recipient.id,
      disclosed: isDisclosed,
      rawStrength: BASE_STRENGTH.SHARED_DEPLOYER,
      strength: adjusted("SHARED_DEPLOYER", isDisclosed),
      evidenceTxHashes: evidence.map((e) => e.txHash),
      description: `Shared deployer/signer: ${node.label} provisioned both the proposer and the payment recipient.`,
    });
  }

  // 4. Time-correlated intermediary hops: proposer-side -> X then X -> recipient
  //    within the time window and with similar amounts.
  for (const first of seed.edges) {
    if (first.type !== "transfer") continue;
    if (!proposerSide(first.from)) continue;
    for (const second of seed.edges) {
      if (second.type !== "transfer") continue;
      if (!same(first.to, second.from)) continue;
      if (!same(second.to, recipient.id)) continue;
      if (first.asset !== second.asset) continue;
      // A common funder already captures the same-funder pair.
      if (same(first.from, second.from)) continue;

      const gap = Math.abs(Date.parse(first.timestamp) - Date.parse(second.timestamp));
      if (!Number.isFinite(gap) || gap > opts.timeWindowMs) continue;

      const a = BigInt(first.amount);
      const b = BigInt(second.amount);
      if (a === 0n || b === 0n) continue;
      const larger = a > b ? a : b;
      const smaller = a > b ? b : a;
      const diff = Number(((larger - smaller) * 10000n) / larger) / 10000;
      if (diff > opts.amountTolerance) continue;

      const evidence = [first, second];
      const isDisclosed = disclosedOf(evidence);
      add({
        id: `time-${first.id}-${second.id}`,
        type: "TIME_CORRELATED",
        from: first.from,
        to: recipient.id,
        disclosed: isDisclosed,
        rawStrength: BASE_STRENGTH.TIME_CORRELATED,
        strength: adjusted("TIME_CORRELATED", isDisclosed),
        evidenceTxHashes: evidence.map((e) => e.txHash),
        description:
          `Time-correlated hop: ${first.from.slice(0, 10)}… sent ${formatAmount(first)} to ` +
          `${labelOf(seed, first.to)} ${Math.round(gap / 60000)} min before a similar ` +
          `${formatAmount(second)} transfer reached the payment recipient.`,
      });
    }
  }

  return links.sort((a, b) => b.strength - a.strength);
}

export function assessConflictOfInterest(
  seed: SeedData = buildSeedData(),
  options: CoiOptions = {}
): CoiAssessment {
  const proposer = requireNode(seed, "proposer");
  const recipient = requireNode(seed, "recipient");
  const links = findLinks(seed, options);

  const undisclosedLinks = links.filter((l) => !l.disclosed);
  const disclosedLinks = links.filter((l) => l.disclosed);
  const overallRisk = noisyOr(links.map((l) => l.strength));
  const disclosedRisk = noisyOr(disclosedLinks.map((l) => l.strength));
  const undisclosedRisk = noisyOr(undisclosedLinks.map((l) => l.strength));

  const canonicalEvidence = [
    `proposal=${seed.proposalId}`,
    ...undisclosedLinks
      .map((l) => `${l.type}:${[...l.evidenceTxHashes].sort().join("+")}`)
      .sort(),
  ].join("|");
  const linkEvidenceHash = ethers.keccak256(ethers.toUtf8Bytes(canonicalEvidence));
  const types = [...new Set(undisclosedLinks.map((l) => l.type))].join(", ") || "none";

  return {
    simulated: true,
    formula: "R = 1 - Π(1 - s_j), s_j adjusted by disclosure status",
    proposalId: seed.proposalId,
    snapshotAt: seed.snapshotAt,
    subject: {
      proposer: proposer.id,
      proposerLabel: proposer.label,
      counterparty: recipient.id,
      counterpartyLabel: recipient.label,
    },
    disclosure: seed.disclosure,
    links,
    overallRisk,
    disclosedRisk,
    undisclosedRisk,
    riskBand: riskBand(overallRisk),
    caveats: [
      "All wallet, transaction, and amount data is SIMULATED.",
      "A link is a potential conflict, not proof of intent or wrongdoing.",
      "Disclosed links are discounted; undisclosed links carry the undisclosed multiplier.",
      "The challenge payload is advisory evidence for the DisclosureRegistry; the verifier decides.",
    ],
    challengePayload: {
      proposalId: seed.proposalId,
      linkEvidenceHash,
      reason:
        `Potential undisclosed conflict of interest: ${undisclosedLinks.length} undisclosed link(s) ` +
        `between the proposer and the payment recipient (${types}). ` +
        `Supporting transactions attached; all data is simulated.`,
      canonicalEvidence,
    },
  };
}

export function writeSeedData(filePath: string = path.join(__dirname, "seed-data.json")): string {
  const seed = buildSeedData();
  fs.writeFileSync(filePath, JSON.stringify(seed, null, 2) + "\n", "utf8");
  return filePath;
}

export function writeAssessment(
  assessment: CoiAssessment = assessConflictOfInterest(),
  filePath: string = path.join(__dirname, "coi-assessment.json")
): string {
  fs.writeFileSync(filePath, JSON.stringify(assessment, null, 2) + "\n", "utf8");
  return filePath;
}

function requireNode(seed: SeedData, role: WalletRole): GraphNode {
  const node = seed.nodes.find((n) => n.role === role);
  if (!node) throw new Error(`Seed data is missing a node with role "${role}"`);
  return node;
}

function labelOf(seed: SeedData, address: string): string {
  return seed.nodes.find((n) => same(n.id, address))?.label ?? `${address.slice(0, 10)}…`;
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function formatAmount(edge: GraphEdge): string {
  if (edge.asset === "none") return "0";
  const decimals = edge.asset === "ETH" ? 18 : 6;
  return `${ethers.formatUnits(edge.amount, decimals)} ${edge.asset}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function riskBand(risk: number): CoiAssessment["riskBand"] {
  if (risk >= 0.8) return "CRITICAL";
  if (risk >= 0.6) return "HIGH";
  if (risk >= 0.3) return "MEDIUM";
  return "LOW";
}

if (require.main === module) {
  const seed = buildSeedData();
  const seedPath = writeSeedData();
  const assessment = assessConflictOfInterest(seed);
  const assessmentPath = writeAssessment(assessment);

  console.log("SIMULATED wallet graph (not chain data)");
  console.log(`  Nodes: ${seed.nodes.length} · Edges: ${seed.edges.length}`);
  console.log(`  Seed data:  ${seedPath}`);
  console.log(`  Assessment: ${assessmentPath}`);
  console.log("");
  console.log(`COI risk: ${assessment.overallRisk} (${assessment.riskBand})`);
  console.log(`  disclosed:   ${assessment.disclosedRisk}`);
  console.log(`  undisclosed: ${assessment.undisclosedRisk}`);
  for (const link of assessment.links) {
    console.log(
      `  · ${link.type.padEnd(16)} ${link.strength.toFixed(3)} ` +
        `${link.disclosed ? "disclosed" : "UNDISCLOSED"}  ${link.description}`
    );
  }
  console.log("");
  console.log(`Challenge payload (fileChallenge):`);
  console.log(`  proposalId:       ${assessment.challengePayload.proposalId}`);
  console.log(`  linkEvidenceHash: ${assessment.challengePayload.linkEvidenceHash}`);
  console.log(`  reason:           ${assessment.challengePayload.reason}`);
}
