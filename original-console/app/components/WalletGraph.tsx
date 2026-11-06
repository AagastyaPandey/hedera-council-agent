"use client";

import { useMemo, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { FileWarning, Network, ShieldAlert } from "lucide-react";
import { DataState } from "@/components/ui/DataState";
import { HashChip } from "@/components/ui/HashChip";
import { Panel } from "@/components/ui/Panel";
import { ProvenanceTag } from "@/components/ui/ProvenanceTag";
import { Stat } from "@/components/ui/Stat";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { WhyDrawer } from "@/components/ui/WhyDrawer";
import {
  fileDisclosureChallenge,
  getCoiAssessment,
  getGraph,
} from "@/lib/data";
import {
  cn,
  formatDateTime,
  formatNumber,
  formatPct,
  formatTokenUnits,
  shortAddress,
} from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import type {
  ActionReceipt,
  CoiAssessment,
  WalletEdge,
  WalletGraphData,
  WalletNode,
} from "@/lib/types";

type GraphNode = WalletNode & SimulationNodeDatum;
type GraphEdge = WalletEdge &
  SimulationLinkDatum<GraphNode> & {
    source: string | GraphNode;
    target: string | GraphNode;
  };

const WIDTH = 960;
const HEIGHT = 500;

export function WalletGraph({ proposalId }: { proposalId: string }) {
  const { data, loading, error, reload } = useAsync(
    () => Promise.all([getGraph(proposalId), getCoiAssessment(proposalId)]),
    [proposalId]
  );
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<ActionReceipt | null>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [filing, setFiling] = useState(false);

  const graph = data?.[0] ?? null;
  const assessment = data?.[1] ?? null;
  const selectedEdge = graph?.edges.find((edge) => edge.id === selectedEdgeId) ?? null;

  const submitChallenge = async () => {
    setFiling(true);
    setChallengeError(null);
    try {
      setChallenge(await fileDisclosureChallenge(proposalId));
    } catch (cause) {
      setChallengeError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setFiling(false);
    }
  };

  return (
    <div className="space-y-5">
      <Panel
        title="Wallet Graph"
        subtitle="Select an edge to inspect its supporting transaction and contribution to risk."
        actions={
          <ProvenanceTag
            kind={graph?.simulated === false ? "LIVE" : "SIMULATED"}
            detail="Wallet links, amounts, and timestamps in this panel are simulated."
          />
        }
      >
        <DataState
          loading={loading}
          error={error}
          empty={!loading && !error && (!graph || graph.nodes.length === 0)}
          emptyMessage="No wallet links were found for this proposal."
          loadingLabel="Loading simulated graph"
          onRetry={reload}
        >
          {graph && assessment ? (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <Stat
                  label="Total risk R"
                  value={formatPct(assessment.overallRisk, 1)}
                  tone={assessment.overallRisk >= 0.7 ? "danger" : "warning"}
                  hint={assessment.riskBand}
                  why={`Noisy-OR combines ${assessment.links.length} assessed link strengths. It measures potential conflict, not intent or wrongdoing.`}
                />
                <Stat
                  label="Undisclosed risk"
                  value={formatPct(assessment.undisclosedRisk, 1)}
                  tone="danger"
                  why="Only discovered links contribute here; each raw strength is amplified by ×1.2 before noisy-OR aggregation."
                />
                <Stat
                  label="Disclosed risk"
                  value={formatPct(assessment.disclosedRisk, 1)}
                  tone="info"
                  why="Disclosed links are discounted to ×0.15 of raw strength because the relationship was declared."
                />
                <Stat
                  label="Wallets / links"
                  value={`${formatNumber(graph.nodes.length)} / ${formatNumber(graph.edges.length)}`}
                  why="Wallet count includes every rendered role. Link count is the number of supporting transaction or deployment edges in this snapshot."
                />
                <Stat
                  label="Snapshot"
                  value={formatDateTime(graph.snapshotAt)}
                  mono={false}
                  why="The graph is a point-in-time simulated view, not a live chain index. Later transactions are outside this assessment."
                />
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_310px]">
                <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60">
                  <div className="absolute right-3 top-3 z-10">
                    <ProvenanceTag
                      kind="SIMULATED"
                      detail="Force-directed wallet graph generated from simulated evidence."
                    />
                  </div>
                  <ForceGraph
                    data={graph}
                    selectedEdgeId={selectedEdgeId}
                    onSelectEdge={setSelectedEdgeId}
                  />
                  <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-800 px-4 py-3 text-[10px] text-slate-500">
                    <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-5 bg-cyan-400" /> disclosed</span>
                    <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-5 border-t border-dashed border-red-500" /> discovered</span>
                    <span>shapes: proposer ◆ · disclosed ● · intermediary ■ · recipient ⬡ · funder ▲</span>
                  </div>
                </div>
                <EdgeDetails edge={selectedEdge} />
              </div>

              <div className="rounded-xl border border-cyan-900/50 bg-cyan-950/10 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-cyan-300">Noisy-OR aggregation</p>
                    <p className="mt-1 font-mono text-sm text-slate-200">R = 1 − Π(1 − sⱼ)</p>
                  </div>
                  <WhyDrawer label="Why this formula">
                    Independent link strengths are combined without simply adding probabilities. Disclosed links use sⱼ = raw × 0.15; discovered links use sⱼ = raw × 1.2.
                  </WhyDrawer>
                </div>
                <p className="mt-3 break-all font-mono text-[11px] leading-relaxed text-slate-400">
                  R = 1 − {assessment.links.map((link) => `(1 − ${link.strength})`).join(" × ")} = {assessment.overallRisk.toFixed(4)}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  This indicates a <strong className="font-medium text-amber-300">potential conflict, supporting transactions attached</strong>. It is not a determination of wrongdoing.
                </p>
              </div>

              <LinkTable
                graph={graph}
                assessment={assessment}
                onSelectEdge={setSelectedEdgeId}
              />

              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-200">Challenge this disclosure</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">Attach the discovered-link evidence for an independent verifier. Filing a challenge does not itself prove a violation.</p>
                </div>
                <button
                  type="button"
                  onClick={submitChallenge}
                  disabled={filing}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-900 bg-red-950/30 px-3 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-950/60 disabled:cursor-wait disabled:opacity-50"
                >
                  <FileWarning size={14} /> {filing ? "Filing…" : "File disclosure challenge"}
                </button>
              </div>
              {challengeError ? <p className="text-xs text-red-400">{challengeError}</p> : null}
              {challenge ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-3 text-xs text-emerald-300">
                  {challenge.message}<HashChip label="evidence" value={challenge.hash} />
                </div>
              ) : null}
              <p className="text-[11px] leading-relaxed text-slate-500">{graph.disclaimer}</p>
            </div>
          ) : null}
        </DataState>
      </Panel>
    </div>
  );
}

function ForceGraph({
  data,
  selectedEdgeId,
  onSelectEdge,
}: {
  data: WalletGraphData;
  selectedEdgeId: string | null;
  onSelectEdge: (id: string) => void;
}) {
  const layout = useMemo(() => {
    const nodes: GraphNode[] = data.nodes.map((node) => ({ ...node }));
    const links: GraphEdge[] = data.edges.map((edge) => ({
      ...edge,
      source: edge.from,
      target: edge.to,
    }));
    const simulation = forceSimulation(nodes)
      .force("link", forceLink<GraphNode, GraphEdge>(links).id((node) => node.id).distance(125))
      .force("charge", forceManyBody().strength(-380))
      .force("center", forceCenter(WIDTH / 2, HEIGHT / 2))
      .force("collide", forceCollide(48))
      .stop();
    for (let index = 0; index < 240; index += 1) simulation.tick();
    return { nodes, links };
  }, [data]);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-[430px] w-full"
      role="img"
      aria-label="Force-directed simulated wallet relationship graph"
    >
      <defs>
        <marker id="arrow-disclosed" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#22d3ee" /></marker>
        <marker id="arrow-discovered" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#ef4444" /></marker>
      </defs>
      {layout.links.map((edge) => {
        const source = edge.source as GraphNode;
        const target = edge.target as GraphNode;
        const color = edge.disclosed ? "#22d3ee" : "#ef4444";
        const selected = edge.id === selectedEdgeId;
        return (
          <g key={edge.id}>
            <line
              x1={source.x} y1={source.y} x2={target.x} y2={target.y}
              stroke={color}
              strokeWidth={selected ? 3 : 1.5}
              strokeDasharray={edge.disclosed ? undefined : "7 6"}
              strokeOpacity={selected ? 1 : 0.65}
              markerEnd={`url(#arrow-${edge.disclosed ? "disclosed" : "discovered"})`}
            />
            <line
              x1={source.x} y1={source.y} x2={target.x} y2={target.y}
              stroke="transparent"
              strokeWidth={16}
              className="cursor-pointer"
              role="button"
              tabIndex={0}
              aria-label={`Inspect ${edge.type} transaction`}
              onClick={() => onSelectEdge(edge.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelectEdge(edge.id);
              }}
            />
          </g>
        );
      })}
      {layout.nodes.map((node) => (
        <g key={node.id} transform={`translate(${node.x},${node.y})`}>
          <NodeShape node={node} />
          <text y={29} textAnchor="middle" className="fill-slate-300 text-[11px] font-medium">
            {node.label.length > 24 ? `${node.label.slice(0, 23)}…` : node.label}
          </text>
          <text y={43} textAnchor="middle" className="fill-slate-600 font-mono text-[9px]">
            {shortAddress(node.id)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function NodeShape({ node }: { node: WalletNode }) {
  const common = { strokeWidth: 2, className: "drop-shadow-[0_0_8px_rgba(34,211,238,0.2)]" };
  if (node.role === "proposer") {
    return <rect x={-10} y={-10} width={20} height={20} rx={2} transform="rotate(45)" fill="#0e7490" stroke="#67e8f9" {...common} />;
  }
  if (node.role === "recipient") {
    return <polygon points="0,-14 12,-7 12,7 0,14 -12,7 -12,-7" fill="#7f1d1d" stroke="#f87171" {...common} />;
  }
  if (node.role === "intermediary") {
    return <rect x={-11} y={-11} width={22} height={22} rx={3} fill="#78350f" stroke="#fbbf24" {...common} />;
  }
  if (node.role === "funder" || node.role === "deployer") {
    return <polygon points="0,-14 14,12 -14,12" fill="#4c1d95" stroke="#a78bfa" {...common} />;
  }
  return <circle r={12} fill="#064e3b" stroke="#34d399" {...common} />;
}

function EdgeDetails({ edge }: { edge: WalletEdge | null }) {
  if (!edge) {
    return (
      <aside className="flex min-h-[280px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-950/30 p-5 text-center">
        <Network size={22} className="text-slate-600" />
        <p className="mt-3 text-sm text-slate-400">Select a graph edge</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">Transaction hash, value, timestamp, and sⱼ will appear here.</p>
      </aside>
    );
  }
  const decimals = edge.asset === "USDC" ? 6 : edge.asset === "ETH" ? 18 : 0;
  return (
    <aside className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-400">Edge evidence</p>
        <StatusBadge tone={edge.disclosed ? "info" : "danger"}>{edge.disclosed ? "Disclosed" : "Discovered"}</StatusBadge>
      </div>
      <dl className="mt-4 space-y-4 text-xs">
        <div><dt className="text-slate-500">Transaction</dt><dd className="mt-1"><HashChip value={edge.txHash} /></dd></div>
        <div>
          <dt className="flex items-center gap-2 text-slate-500">Amount <WhyDrawer>{edge.asset === "none" ? "Deployment edges carry no token transfer, so their value is zero." : `Raw base units are formatted using ${decimals} decimals for ${edge.asset}.`}</WhyDrawer></dt>
          <dd className="mt-1 font-mono text-slate-200">{edge.asset === "none" ? "0" : formatTokenUnits(edge.amount, decimals)} {edge.asset === "none" ? "" : edge.asset}</dd>
        </div>
        <div><dt className="text-slate-500">Link type</dt><dd className="mt-1 font-mono uppercase text-slate-300">{edge.type}</dd></div>
        <div><dt className="text-slate-500">Timestamp</dt><dd className="mt-1 text-slate-300">{formatDateTime(edge.timestamp)}</dd></div>
        <div>
          <dt className="flex items-center gap-2 text-slate-500">Strength sⱼ <WhyDrawer>This edge inherits the adjusted strength of the COI link it supports. Zero means it is supporting context rather than a separately assessed proposer–recipient link.</WhyDrawer></dt>
          <dd className={cn("mt-1 font-mono text-lg", edge.disclosed ? "text-cyan-300" : "text-red-400")}>{(edge.strength ?? 0).toFixed(3)}</dd>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-amber-300/80"><ShieldAlert size={12} /> simulated evidence</div>
      </dl>
    </aside>
  );
}

function LinkTable({
  graph,
  assessment,
  onSelectEdge,
}: {
  graph: WalletGraphData;
  assessment: CoiAssessment;
  onSelectEdge: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/60 px-4 py-3">
        <p className="text-xs font-semibold text-slate-200">Disclosed vs Discovered</p>
        <WhyDrawer>Raw strength is the graph heuristic. Adjusted sⱼ applies disclosure status and is the value used by noisy-OR. Evidence count is the number of attached transactions.</WhyDrawer>
      </div>
      {assessment.links.length === 0 ? (
        <p className="p-6 text-center text-xs text-slate-500">No assessed links in this snapshot.</p>
      ) : (
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="bg-slate-950/40 text-[10px] uppercase tracking-[0.12em] text-slate-500">
            <tr><th className="px-4 py-2">Status</th><th className="px-4 py-2">Link</th><th className="px-4 py-2">Path</th><th className="px-4 py-2 text-right">Raw</th><th className="px-4 py-2 text-right">sⱼ</th><th className="px-4 py-2 text-right">Evidence</th></tr>
          </thead>
          <tbody>
            {assessment.links.map((link) => (
              <tr
                key={link.id}
                className="cursor-pointer border-t border-slate-800/70 transition-colors hover:bg-slate-900/50"
                onClick={() => {
                  const edge = graph.edges.find((item) => link.evidenceTxHashes.includes(item.txHash));
                  if (edge) onSelectEdge(edge.id);
                }}
              >
                <td className="px-4 py-3"><StatusBadge tone={link.disclosed ? "info" : "danger"}>{link.disclosed ? "Disclosed" : "Discovered"}</StatusBadge></td>
                <td className="px-4 py-3"><span className="font-mono text-slate-300">{link.type}</span><p className="mt-1 max-w-sm text-[10px] leading-relaxed text-slate-500">{link.description}</p></td>
                <td className="px-4 py-3 font-mono text-[10px] text-slate-500">{shortAddress(link.from)} → {shortAddress(link.to)}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-400">{link.rawStrength.toFixed(3)}</td>
                <td className={cn("px-4 py-3 text-right font-mono", link.disclosed ? "text-cyan-300" : "text-red-400")}>{link.strength.toFixed(3)}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-400">{link.evidenceTxHashes.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
