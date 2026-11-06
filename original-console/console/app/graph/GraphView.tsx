"use client";

import { useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleDollarSign,
  FileWarning,
  Info,
  Wallet,
} from "lucide-react";
import { getDemo } from "@/lib/demo";
import { challengeHash, type DiscoveredLink, type GraphEdge, type GraphNode } from "@/graph/discover";
import { formatNumber, formatTimestamp, shortAddress } from "@/packages/shared/format";
import { CopyButton } from "@/components/CopyButton";
import {
  Callout,
  Panel,
  RiskMeter,
  SectionHeader,
  StatusPill,
  cn,
} from "@/components/ui";

const EDGE_COLORS: Record<GraphEdge["type"], string> = {
  DIRECT_TRANSFER: "#c62f1c",
  FUNDING: "#9a6b15",
  CONTRACT_CREATION: "#6b655b",
  INTERNAL: "#b9b1a2",
};

const LINK_LABEL: Record<DiscoveredLink["type"], string> = {
  DIRECT_TRANSFER: "direct transfer",
  COMMON_FUNDER: "common funder",
  TIME_CORRELATED: "time correlated",
  SHARED_DEPLOYER: "shared deployer",
};

function edgeStrength(
  edgeId: string,
  links: DiscoveredLink[],
): { strength: number; link: DiscoveredLink | null } {
  const matches = links.filter((link) => link.evidenceEdgeIds.includes(edgeId));
  matches.sort((a, b) => b.strength - a.strength);
  return { strength: matches[0]?.strength ?? 0.1, link: matches[0] ?? null };
}

function NodeShape({ node }: { node: GraphNode }) {
  const isRecipient = node.group === "recipient";
  const stroke = node.disclosed ? "#1f6f8b" : isRecipient ? "#6b655b" : "#c62f1c";
  const fill = node.disclosed ? "#e8f2f6" : isRecipient ? "#f0ece4" : "#fbe9e5";
  return (
    <>
      {!node.disclosed && !isRecipient ? (
        <circle cx={node.x} cy={node.y} r={18} fill="none" stroke="#c62f1c" strokeWidth={1} opacity={0.18} />
      ) : null}
      {node.shape === "multisig" ? (
        <rect
          x={node.x - 15}
          y={node.y - 10}
          width={30}
          height={20}
          rx={4}
          fill={fill}
          stroke={stroke}
          strokeWidth={1.4}
        />
      ) : (
        <circle cx={node.x} cy={node.y} r={11} fill={fill} stroke={stroke} strokeWidth={1.4} />
      )}
      {node.shape === "multisig" ? (
        <path
          d={`M ${node.x - 6} ${node.y} h 12 M ${node.x} ${node.y - 5} v 10`}
          stroke={stroke}
          strokeWidth={1}
          opacity={0.6}
        />
      ) : (
        <circle cx={node.x} cy={node.y} r={3.2} fill={stroke} opacity={0.9} />
      )}
    </>
  );
}

export function GraphView() {
  const demo = getDemo();
  const graph = demo.graph;
  const nodes = graph.fixture.nodes;
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const [selectedEdgeId, setSelectedEdgeId] = useState("e2");
  const [payloadOpen, setPayloadOpen] = useState(false);

  const selectedEdge = graph.fixture.edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const selectedLink = selectedEdge ? edgeStrength(selectedEdge.id, graph.links).link : null;
  const challenge = graph.challenge;
  const challengeDigest = challenge ? challengeHash(challenge) : null;

  const direct = graph.links.filter((link) => link.type === "DIRECT_TRANSFER");
  const common = graph.links.find((link) => link.type === "COMMON_FUNDER");
  const time = graph.links.find((link) => link.type === "TIME_CORRELATED");

  function selectLink(link: DiscoveredLink) {
    setSelectedEdgeId(link.evidenceEdgeIds[0]);
  }

  return (
    <div className="space-y-6">
      <div className="border-t border-edge pt-3">
        <table className="doc-ledger">
          <tbody>
            <tr>
              <th className="w-[130px]">Risk</th>
              <td className="text-danger">
                {graph.overallRisk.toFixed(2)}, red threshold{" "}
                {graph.thresholds.red.toFixed(2)}, higher is worse
              </td>
            </tr>
            <tr>
              <th>Links</th>
              <td>
                {graph.links.length}:{" "}
                {graph.links
                  .map((link) => `${LINK_LABEL[link.type]} ${link.strength.toFixed(2)}`)
                  .join(", ")}
              </td>
            </tr>
            <tr>
              <th>Disclosed</th>
              <td>
                {demo.proposal.disclosure.wallets
                  .map((wallet) => shortAddress(wallet))
                  .join(", ")}
              </td>
            </tr>
            <tr>
              <th>Discovered</th>
              <td className="text-danger">
                {graph.discoveredWallets.length}:{" "}
                {graph.discoveredWallets.map((wallet) => shortAddress(wallet)).join(", ")}
              </td>
            </tr>
          </tbody>
        </table>
        <RiskMeter
          value={graph.overallRisk}
          status={graph.status}
          threshold={graph.thresholds.red}
          className="mt-3"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,0.8fr)]">
        <Panel className="overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-edge py-2.5">
            <span className="text-[12.5px] font-medium text-body">
              Disclosed vs discovered
            </span>
            <span className="doc-folio text-danger">
              simulated data, click an edge
            </span>
          </div>

          <div className="overflow-x-auto">
            <svg
              viewBox="0 0 940 470"
              className="min-w-[780px] w-full"
              role="img"
              aria-label="Simulated wallet graph connecting the proposer to the GrowthLabs deployer"
            >
              <defs>
                <pattern id="graph-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e2dccf" strokeWidth="1" />
                </pattern>
                <radialGradient id="graph-glow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#c62f1c" stopOpacity="0.10" />
                  <stop offset="100%" stopColor="#c62f1c" stopOpacity="0" />
                </radialGradient>
              </defs>
              <rect width="940" height="470" fill="url(#graph-grid)" />
              <circle cx="460" cy="230" r="260" fill="url(#graph-glow)" />

              <text x="24" y="34" fill="#857e72" fontFamily="ui-monospace, monospace" fontSize="9" letterSpacing="2">
                AIP-042, SIMULATED TRANSACTION GRAPH, 2025-11 → 2026-10
              </text>

              {graph.fixture.edges.map((edge) => {
                const from = nodeMap.get(edge.from);
                const to = nodeMap.get(edge.to);
                if (!from || !to) return null;
                const { strength } = edgeStrength(edge.id, graph.links);
                const color = EDGE_COLORS[edge.type];
                const selected = selectedEdgeId === edge.id;
                const width = 1 + Math.max(0, strength) * 3.4;
                return (
                  <g key={edge.id} className="cursor-pointer" onClick={() => setSelectedEdgeId(edge.id)}>
                    <line
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke="transparent"
                      strokeWidth={20}
                    />
                    <line
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke={color}
                      strokeWidth={selected ? width + 1.2 : width}
                      strokeOpacity={selected ? 0.95 : 0.55}
                      strokeDasharray={edge.type === "INTERNAL" || edge.type === "CONTRACT_CREATION" ? "5 5" : undefined}
                      strokeLinecap="round"
                    />
                    {selected ? (
                      <line
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                        stroke={color}
                        strokeWidth={width + 7}
                        strokeOpacity={0.08}
                        strokeLinecap="round"
                      />
                    ) : null}
                    {edge.type === "DIRECT_TRANSFER" || edge.type === "FUNDING" ? (
                      <text
                        x={(from.x + to.x) / 2 + 8}
                        y={(from.y + to.y) / 2 - 7}
                        fill={selected ? "#111110" : "#6b655b"}
                        fontFamily="ui-monospace, monospace"
                        fontSize="8.5"
                      >
                        {formatNumber(Number(edge.amountUsdc), 0)}
                      </text>
                    ) : null}
                    <title>{`${edge.type}, ${edge.amountUsdc} USDC, ${edge.txHash}`}</title>
                  </g>
                );
              })}

              {nodes.map((node) => {
                const isRecipient = node.group === "recipient";
                const labelColor = node.disclosed ? "#1f6f8b" : isRecipient ? "#575149" : "#a52a18";
                return (
                  <g key={node.id}>
                    <NodeShape node={node} />
                    <text
                      x={node.x}
                      y={node.y + 29}
                      textAnchor="middle"
                      fill={labelColor}
                      fontFamily="Helvetica Neue, Helvetica, Arial, sans-serif"
                      fontSize="10.5"
                      fontWeight="500"
                    >
                      {node.label}
                    </text>
                    <text
                      x={node.x}
                      y={node.y + 41}
                      textAnchor="middle"
                      fill="#857e72"
                      fontFamily="ui-monospace, monospace"
                      fontSize="7.5"
                      letterSpacing="0.6"
                    >
                      {node.role.toUpperCase()}
                    </text>
                    <title>{`${node.label}, ${node.address}`}</title>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-edge px-4 py-2.5">
            {[
              { color: "#1f6f8b", label: "disclosed" },
              { color: "#c62f1c", label: "discovered" },
              { color: "#6b655b", label: "recipient" },
              { color: "#9a6b15", label: "funding" },
              { color: "#b9b1a2", label: "internal / creation" },
            ].map((legend) => (
              <span key={legend.label} className="inline-flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.06em] text-faint">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: legend.color }} />
                {legend.label}
              </span>
            ))}
            <span className="ml-auto font-mono text-[8.5px] uppercase tracking-[0.06em] text-faint">
              edge width = link strength
            </span>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel className="p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="mono-label">Selected edge</span>
              {selectedEdge ? <CopyButton value={selectedEdge.txHash} compact /> : null}
            </div>
            {selectedEdge ? (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="chip" style={{ borderColor: `${EDGE_COLORS[selectedEdge.type]}55`, color: EDGE_COLORS[selectedEdge.type] }}>
                    edge, {selectedEdge.type.replaceAll("_", " ")}
                  </span>
                  {selectedLink ? (
                    <span className="chip border-danger/30 text-danger">
                      link {selectedLink.strength.toFixed(2)}, {LINK_LABEL[selectedLink.type]}
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 flex items-center gap-2 text-[12px] text-body">
                  <span>{nodeMap.get(selectedEdge.from)?.label}</span>
                  <ArrowRight size={12} className="text-faint" />
                  <span>{nodeMap.get(selectedEdge.to)?.label}</span>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-dim">{selectedEdge.note}</p>
                <div className="mt-3 grid gap-2 font-mono text-[9.5px] uppercase tracking-[0.05em] text-faint">
                  <div className="flex items-center justify-between gap-2">
                    <span>amount</span>
                    <span className="text-steel">{formatNumber(Number(selectedEdge.amountUsdc), 0)} USDC</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span>timestamp</span>
                    <span className="text-steel">{formatTimestamp(selectedEdge.timestamp)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span>block</span>
                    <span className="text-steel">{selectedEdge.block.toLocaleString("en-US")}</span>
                  </div>
                </div>
                <div className="mt-2 rounded border border-edge bg-ink/40 px-2.5 py-2">
                  <div className="mono-label">tx hash</div>
                  <code className="hash mt-1 block">{selectedEdge.txHash}</code>
                </div>
              </>
            ) : (
              <p className="mt-3 text-[11px] text-faint">Select an edge in the graph.</p>
            )}
          </Panel>

          <Panel>
            <div className="flex items-center justify-between border-b border-edge px-4 py-3">
              <div className="flex items-center gap-2">
                <CircleDollarSign size={14} className="text-danger" />
                <span className="text-[12.5px] font-medium text-body">The funding path</span>
              </div>
              <StatusPill status="RED">flagged</StatusPill>
            </div>
            <div className="divide-y divide-edge/70">
              {[
                { step: "01", text: "Nova Main (disclosed) funds Nova Ops", amount: "120,000", link: direct[0] },
                { step: "02", text: "Nova Ops funds the GrowthLabs deployer", amount: "40,000", link: direct[1] },
                { step: "03", text: "Funder X funds both sides within 6 minutes", amount: "2 × 25,000", link: common },
              ].map((item) => (
                <button
                  key={item.step}
                  type="button"
                  onClick={() => item.link && selectLink(item.link)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
                >
                  <span className="mt-0.5 font-mono text-[9px] text-faint">{item.step}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11.5px] leading-snug text-body">{item.text}</span>
                    <span className="mt-1 block font-mono text-[9px] text-faint">
                      {item.amount} USDC {item.link ? `· link ${item.link.strength.toFixed(2)}` : ""}
                    </span>
                  </span>
                  <ArrowRight size={12} className="mt-0.5 shrink-0 text-faint" />
                </button>
              ))}
            </div>
            <div className="border-t border-edge px-4 py-3">
              <p className="text-[10.5px] leading-relaxed text-dim">
                {time ? time.description : null}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span className="chip">{challenge?.links.length ?? 0} links in payload</span>
                <span className="chip border-signal/30 text-signal">disclosure incomplete</span>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      <section id="links">
        <SectionHeader
          eyebrow="Link detection"
          title="Each link has a type, a strength and a transaction"
          description="The risk model is code: base strength by link type × an undisclosed multiplier, aggregated with noisy-OR. Disclosed links are damped to 0.35."
          right={<span className="chip border-signal/30 text-signal">R = 1 − Π(1 − sⱼ)</span>}
        />
        <div className="grid gap-3 md:grid-cols-2">
          {graph.links.map((link) => (
            <button
              key={link.id}
              type="button"
              onClick={() => selectLink(link)}
              className={cn(
                "panel p-4 text-left transition-colors hover:border-edge2",
                selectedEdge && link.evidenceEdgeIds.includes(selectedEdge.id) && "border-signal/35",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="mono-label mb-1">{LINK_LABEL[link.type]}</div>
                  <div className="text-[12.5px] font-medium text-body">{link.title}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[16px] text-danger">{link.strength.toFixed(2)}</div>
                  <div className="font-mono text-[8px] uppercase tracking-[0.08em] text-faint">strength</div>
                </div>
              </div>
              <p className="mt-2 text-[10.5px] leading-relaxed text-dim">{link.description}</p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="chip">base {link.baseStrength.toFixed(2)}</span>
                <span className="chip">× {link.multiplier.toFixed(2)}</span>
                <span className="chip">{link.evidenceEdgeIds.length} tx</span>
                {link.disclosed ? <span className="chip border-info/30 text-info">disclosed</span> : <span className="chip border-danger/30 text-danger">undisclosed</span>}
              </div>
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Panel id="challenge" className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="mono-label mb-1">Disclosure challenge, already filed</div>
              <h2 className="text-[14px] font-medium text-body">{demo.proposal.challenge.filer}, {formatTimestamp(demo.proposal.challenge.filedAt)}</h2>
              <p className="mt-1.5 max-w-xl text-[11px] leading-relaxed text-dim">{demo.proposal.challenge.claim}</p>
            </div>
            <div className="flex items-center gap-2">
              <StatusPill status="FLAGGED">filed</StatusPill>
              <CopyButton value={JSON.stringify(challenge, null, 2)} label="Challenge payload" />
            </div>
          </div>

          <div className="mt-3 rounded border border-edge bg-ink/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="mono-label">challenge digest</div>
              <span className="font-mono text-[9px] text-faint">deterministic JSON</span>
            </div>
            <code className="hash mt-1 block">{challengeDigest}</code>
          </div>

          <button
            type="button"
            onClick={() => setPayloadOpen((open) => !open)}
            className="mt-3 inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-dim hover:text-body"
          >
            <ChevronDown size={12} className={cn("transition-transform", payloadOpen && "rotate-180")} />
            {payloadOpen ? "hide" : "show"} full payload
          </button>
          {payloadOpen ? (
            <pre className="mt-2 max-h-72 overflow-auto rounded border border-edge bg-ink/50 p-3 font-mono text-[9.5px] leading-relaxed text-steel">
              {JSON.stringify(challenge, null, 2)}
            </pre>
          ) : null}
        </Panel>

        <div className="space-y-4">
          <Callout tone="warn" title="Cautious language is part of the product.">
            {graph.disclaimer}
          </Callout>
          <Panel className="p-4">
            <div className="flex items-center gap-2">
              <FileWarning size={14} className="text-signal" />
              <span className="mono-label">What this does not prove</span>
            </div>
            <ul className="mt-2 space-y-1.5 text-[10.5px] leading-relaxed text-dim">
              <li>· It does not prove the wallets share a human controller.</li>
              <li>· It does not prove the transfers were consideration for the grant.</li>
              <li>· It does not prove the recipient knew about the link.</li>
              <li>· It does show the signed disclosure is incomplete against the graph.</li>
            </ul>
            <div className="mt-3 flex items-center gap-2 border-t border-edge/70 pt-2.5">
              <Wallet size={12} className="text-faint" />
              <span className="text-[10px] text-faint">
                Disclosure hash anchored in v3. Challenge verification is Person A&apos;s on-chain
                contract; this screen shows the payload B produces.
              </span>
            </div>
          </Panel>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-edge pt-4">
        <Info size={12} className="text-faint" />
        <span className="text-[10px] text-faint">
          All transaction hashes, amounts and timestamps on this page are simulated. The graph
          computation and noisy-OR math are real code.
        </span>
        <span className="ml-auto inline-flex items-center gap-1 font-mono text-[8.5px] uppercase tracking-[0.08em] text-faint">
          <Check size={10} className="text-safe" /> 4/4 links carry evidence
        </span>
      </div>
    </div>
  );
}
