import type { Hex } from "viem";
import { canonicalJson } from "../packages/shared/hash";
import { keccak256, toBytes } from "viem";

export type GraphNode = {
  id: string;
  address: string;
  label: string;
  role: string;
  group: "proposer" | "intermediary" | "recipient";
  disclosed: boolean;
  shape: "wallet" | "multisig";
  x: number;
  y: number;
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  type: "INTERNAL" | "DIRECT_TRANSFER" | "FUNDING" | "CONTRACT_CREATION";
  amountUsdc: string;
  txHash: Hex;
  timestamp: string;
  block: number;
  note: string;
};

export type GraphFixture = {
  label: string;
  generatedBy: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type LinkType = "DIRECT_TRANSFER" | "COMMON_FUNDER" | "TIME_CORRELATED" | "SHARED_DEPLOYER";

export type DiscoveredLink = {
  id: string;
  type: LinkType;
  title: string;
  description: string;
  baseStrength: number;
  multiplier: number;
  strength: number;
  disclosed: boolean;
  evidenceEdgeIds: string[];
  txHashes: Hex[];
};

export type ChallengePayload = {
  proposalId: string;
  disclosureHash: Hex | null;
  claim: string;
  overallRisk: number;
  threshold: number;
  filedBy: string;
  filedAt: string;
  links: {
    id: string;
    type: LinkType;
    strength: number;
    evidence: { txHash: Hex; from: string; to: string; amountUsdc: string; timestamp: string }[];
  }[];
};

export type GraphAnalysis = {
  fixture: GraphFixture;
  links: DiscoveredLink[];
  overallRisk: number;
  status: "GREEN" | "AMBER" | "RED";
  thresholds: { red: number; amber: number };
  disclosedWallets: string[];
  discoveredWallets: string[];
  challenge: ChallengePayload | null;
  disclaimer: string;
};

const BASE_STRENGTH: Record<Exclude<LinkType, "SHARED_DEPLOYER">, number> = {
  DIRECT_TRANSFER: 0.48,
  COMMON_FUNDER: 0.38,
  TIME_CORRELATED: 0.27,
};

const DISCLOSED_MULTIPLIER = 0.35;
const TIME_WINDOW_MINUTES = 15;
const RED_THRESHOLD = 0.65;
const AMBER_THRESHOLD = 0.35;

function nodeMap(fixture: GraphFixture): Map<string, GraphNode> {
  return new Map(fixture.nodes.map((node) => [node.id, node]));
}

function allDisclosed(nodes: GraphNode[], disclosed: Set<string>): boolean {
  return nodes.every((node) => disclosed.has(node.address.toLowerCase()));
}

function multiplierFor(nodes: GraphNode[], disclosed: Set<string>): number {
  return allDisclosed(nodes, disclosed) ? DISCLOSED_MULTIPLIER : 1;
}

function minutesBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60000;
}

export function analyzeGraph(
  fixture: GraphFixture,
  disclosedWallets: string[],
  challengeMeta?: {
    proposalId: string;
    disclosureHash: Hex;
    claim: string;
    filedBy: string;
    filedAt: string;
  },
): GraphAnalysis {
  const disclosed = new Set(disclosedWallets.map((address) => address.toLowerCase()));
  const nodes = nodeMap(fixture);
  const edges = fixture.edges;
  const links: DiscoveredLink[] = [];

  for (const edge of edges) {
    if (edge.type !== "DIRECT_TRANSFER") continue;
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to) continue;
    const multiplier = multiplierFor([from, to], disclosed);
    const strength = BASE_STRENGTH.DIRECT_TRANSFER * multiplier;
    links.push({
      id: `l-${edge.id}`,
      type: "DIRECT_TRANSFER",
      title: `Direct transfer · ${from.label} → ${to.label}`,
      description: `${from.label} sent ${Number(edge.amountUsdc).toLocaleString("en-US")} USDC to ${
        to.label
      } on ${new Date(edge.timestamp).toISOString().slice(0, 10)}.`,
      baseStrength: BASE_STRENGTH.DIRECT_TRANSFER,
      multiplier,
      strength,
      disclosed: allDisclosed([from, to], disclosed),
      evidenceEdgeIds: [edge.id],
      txHashes: [edge.txHash],
    });
  }

  const fundingBySender = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    if (edge.type !== "FUNDING") continue;
    const list = fundingBySender.get(edge.from) ?? [];
    list.push(edge);
    fundingBySender.set(edge.from, list);
  }

  for (const [funderId, fundingEdges] of fundingBySender) {
    const funder = nodes.get(funderId);
    if (!funder) continue;
    const recipients = [...new Set(fundingEdges.map((edge) => edge.to))]
      .map((id) => nodes.get(id))
      .filter((node): node is GraphNode => Boolean(node));
    if (recipients.length < 2) continue;

    const reachesRecipient = recipients.some((node) => node.group === "recipient");
    const reachesProposerNetwork = recipients.some(
      (node) => node.group === "proposer" || node.group === "intermediary",
    );
    if (!reachesRecipient || !reachesProposerNetwork) continue;

    const multiplier = multiplierFor([funder, ...recipients], disclosed);
    const strength = BASE_STRENGTH.COMMON_FUNDER * multiplier;
    links.push({
      id: `l-common-${funderId}`,
      type: "COMMON_FUNDER",
      title: `Common funder · ${funder.label}`,
      description: `${funder.label} funded both ${recipients
        .map((node) => node.label)
        .join(" and ")}.`,
      baseStrength: BASE_STRENGTH.COMMON_FUNDER,
      multiplier,
      strength,
      disclosed: allDisclosed([funder, ...recipients], disclosed),
      evidenceEdgeIds: fundingEdges.map((edge) => edge.id),
      txHashes: fundingEdges.map((edge) => edge.txHash),
    });

    const sorted = [...fundingEdges].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    let correlated: GraphEdge[] = [];
    for (let index = 0; index < sorted.length - 1; index += 1) {
      if (minutesBetween(sorted[index].timestamp, sorted[index + 1].timestamp) <= TIME_WINDOW_MINUTES) {
        correlated = [sorted[index], sorted[index + 1]];
        break;
      }
    }
    if (correlated.length === 2) {
      const gap = Math.round(minutesBetween(correlated[0].timestamp, correlated[1].timestamp));
      const timeMultiplier = multiplierFor([funder, ...recipients], disclosed);
      links.push({
        id: `l-time-${funderId}`,
        type: "TIME_CORRELATED",
        title: `Time-correlated funding · ${gap} minutes apart`,
        description: `${funder.label} funded the two wallets ${gap} minutes apart, which is consistent with a single coordinated funding event.`,
        baseStrength: BASE_STRENGTH.TIME_CORRELATED,
        multiplier: timeMultiplier,
        strength: BASE_STRENGTH.TIME_CORRELATED * timeMultiplier,
        disclosed: allDisclosed([funder, ...recipients], disclosed),
        evidenceEdgeIds: correlated.map((edge) => edge.id),
        txHashes: correlated.map((edge) => edge.txHash),
      });
    }
  }

  const overallRisk = 1 - links.reduce((product, link) => product * (1 - link.strength), 1);
  const status =
    overallRisk >= RED_THRESHOLD ? "RED" : overallRisk >= AMBER_THRESHOLD ? "AMBER" : "GREEN";

  const discoveredWallets = fixture.nodes
    .filter((node) => !node.disclosed && node.shape === "wallet")
    .map((node) => node.address);

  let challenge: ChallengePayload | null = null;
  if (challengeMeta) {
    challenge = {
      proposalId: challengeMeta.proposalId,
      disclosureHash: challengeMeta.disclosureHash,
      claim: challengeMeta.claim,
      overallRisk,
      threshold: RED_THRESHOLD,
      filedBy: challengeMeta.filedBy,
      filedAt: challengeMeta.filedAt,
      links: links.map((link) => ({
        id: link.id,
        type: link.type,
        strength: link.strength,
        evidence: link.evidenceEdgeIds
          .map((edgeId) => fixture.edges.find((edge) => edge.id === edgeId))
          .filter((edge): edge is GraphEdge => Boolean(edge))
          .map((edge) => ({
            txHash: edge.txHash,
            from: nodes.get(edge.from)?.label ?? edge.from,
            to: nodes.get(edge.to)?.label ?? edge.to,
            amountUsdc: edge.amountUsdc,
            timestamp: edge.timestamp,
          })),
      })),
    };
  }

  return {
    fixture,
    links,
    overallRisk,
    status,
    thresholds: { red: RED_THRESHOLD, amber: AMBER_THRESHOLD },
    disclosedWallets,
    discoveredWallets,
    challenge,
    disclaimer:
      "Potential conflict, supporting transactions attached. This is a risk signal, not a conclusion of wrongdoing. All transaction records are SIMULATED DATA.",
  };
}

export function challengeHash(payload: ChallengePayload): Hex {
  return keccak256(toBytes(canonicalJson(payload)));
}
