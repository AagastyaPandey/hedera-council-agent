"use client";

import { useState } from "react";
import { CheckCircle2, FileCheck2, History, Link2, Loader2 } from "lucide-react";
import { DataState } from "@/components/ui/DataState";
import { HashChip } from "@/components/ui/HashChip";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { WhyDrawer } from "@/components/ui/WhyDrawer";
import {
  getEvidenceDocument,
  getVersionChain,
  verifyEvidenceSource,
  verifyVersionChain,
} from "@/lib/data";
import { cn, formatDateTime, truncateMiddle } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import type {
  ChainVerification,
  SourceVerification,
  VersionEntry,
} from "@/lib/types";

export function VersionChainView({ proposalId }: { proposalId: string }) {
  const { data, loading, error, reload } = useAsync(
    () => getVersionChain(proposalId),
    [proposalId]
  );
  const [verification, setVerification] = useState<ChainVerification | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const verify = async () => {
    setVerifying(true);
    setVerifyError(null);
    try {
      setVerification(await verifyVersionChain(proposalId));
    } catch (cause) {
      setVerifyError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setVerifying(false);
    }
  };

  const valid = verification?.valid ?? data?.valid ?? false;

  return (
    <Panel
      title="Version Chain"
      subtitle="Append-only versions. Any amendment requires a new vote."
      actions={
        data ? (
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={valid ? "success" : "danger"}>
              {valid ? "CHAIN VALID" : "CHAIN BROKEN"}
            </StatusBadge>
            <button
              type="button"
              onClick={verify}
              disabled={verifying}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-900 bg-cyan-950/30 px-3 py-1.5 text-xs text-cyan-300 transition-colors hover:bg-cyan-950/60 disabled:opacity-50"
            >
              {verifying ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
              Verify chain
            </button>
          </div>
        ) : null
      }
    >
      <DataState
        loading={loading}
        error={error}
        empty={!loading && !error && (!data || data.versions.length === 0)}
        emptyMessage="No versions have been registered for this proposal."
        loadingLabel="Loading version chain"
        onRetry={reload}
      >
        {data ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span>{data.versions.length} version{data.versions.length === 1 ? "" : "s"} in the append-only timeline</span>
              <WhyDrawer>Each version stores the previous version hash. Verification checks the sequence and every predecessor link; a changed historical version breaks the chain.</WhyDrawer>
            </div>
            {verification ? (
              <div className={cn("rounded-lg border p-3 text-xs", verification.valid ? "border-emerald-900/60 bg-emerald-950/20 text-emerald-300" : "border-red-900/60 bg-red-950/20 text-red-300")}>
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={14} />
                  Checked {verification.checkedVersions} version{verification.checkedVersions === 1 ? "" : "s"}: {verification.valid ? "all predecessor links match." : "verification failed."}
                  <WhyDrawer>The checked count is derived from the versions traversed during this verification run, not from the cached validity badge.</WhyDrawer>
                </div>
                {verification.failures.length > 0 ? <ul className="mt-2 list-disc pl-5">{verification.failures.map((failure) => <li key={failure}>{failure}</li>)}</ul> : null}
              </div>
            ) : null}
            {verifyError ? <p className="text-xs text-red-400">{verifyError}</p> : null}

            <ol className="relative space-y-5 border-l border-slate-800 pl-6">
              {data.versions.map((version, index) => (
                <li key={version.versionHash} className="relative">
                  <span className="absolute -left-[31px] top-1.5 grid h-4 w-4 place-items-center rounded-full border border-slate-700 bg-slate-950">
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_#22d3ee]" />
                  </span>
                  <article className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone="info">v{version.version}</StatusBadge>
                        <span className="text-sm text-slate-200">{version.contentPreview}</span>
                        <WhyDrawer>Version {version.version} is position {index + 1} in the registry sequence. Its predecessor must be {index === 0 ? "the zero genesis hash" : `v${data.versions[index - 1].version}`}.</WhyDrawer>
                      </div>
                      <span className="font-mono text-[10px] text-slate-500">{formatDateTime(version.timestamp)}</span>
                    </div>

                    <div className="mt-4 grid gap-2 md:grid-cols-2">
                      <HashChip label="versionHash" value={version.versionHash} />
                      {isZeroHash(version.prevVersionHash) ? (
                        <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-950/70 px-2 py-1 font-mono text-[11px] text-slate-500"><History size={11} /> prevVersionHash · genesis</span>
                      ) : <HashChip label="prevVersionHash" value={version.prevVersionHash} />}
                      <HashChip label="contentHash" value={version.contentHash} />
                      <HashChip label="evidenceRoot" value={version.evidenceRoot} />
                      <HashChip label="intentHash" value={version.intentHash} />
                      <HashChip label="disclosureHash" value={version.disclosureHash} />
                      <HashChip label="financial" value={version.financialAssumptionsHash} />
                      <HashChip label="technical" value={version.technicalAssessmentHash} />
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                      <span>author</span><HashChip value={version.author} lead={8} tail={4} kind="address" />
                    </div>

                    {index > 0 ? (
                      <VersionDiff previous={data.versions[index - 1]} current={version} />
                    ) : (
                      <p className="mt-4 border-t border-slate-800 pt-3 text-[11px] text-slate-500">Genesis version — no earlier version to diff.</p>
                    )}
                    <EvidenceSource proposalId={proposalId} version={version.version} />
                  </article>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </DataState>
    </Panel>
  );
}

function VersionDiff({ previous, current }: { previous: VersionEntry; current: VersionEntry }) {
  const fields: Array<{ key: keyof VersionEntry; label: string }> = [
    { key: "version", label: "version" },
    { key: "versionHash", label: "versionHash" },
    { key: "prevVersionHash", label: "prevVersionHash" },
    { key: "contentHash", label: "contentHash" },
    { key: "evidenceRoot", label: "evidenceRoot" },
    { key: "intentHash", label: "intentHash" },
    { key: "disclosureHash", label: "disclosureHash" },
    { key: "financialAssumptionsHash", label: "financialAssumptionsHash" },
    { key: "technicalAssessmentHash", label: "technicalAssessmentHash" },
    { key: "author", label: "author" },
    { key: "timestamp", label: "timestamp" },
    { key: "contentPreview", label: "content" },
  ];
  const changed = fields.filter(({ key }) => previous[key] !== current[key]).length;
  return (
    <details className="group/diff mt-4 border-t border-slate-800 pt-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-cyan-300">
        <History size={13} /> Diff v{previous.version} → v{current.version}
        <span className="text-[10px] text-slate-500">{changed} changed fields</span>
        <WhyDrawer label="Why">Every registered field is compared in order. Unchanged fields remain visible so the diff cannot hide a commitment component.</WhyDrawer>
      </summary>
      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full min-w-[700px] text-left font-mono text-[10px]">
          <thead className="bg-slate-900/60 uppercase tracking-[0.1em] text-slate-500"><tr><th className="px-3 py-2">Field</th><th className="px-3 py-2">v{previous.version}</th><th className="px-3 py-2">v{current.version}</th></tr></thead>
          <tbody>
            {fields.map(({ key, label }) => {
              const before = String(previous[key]);
              const after = String(current[key]);
              const isChanged = before !== after;
              return (
                <tr key={key} className={cn("border-t border-slate-800/70", isChanged && "bg-amber-950/10")}>
                    <td className="px-3 py-2 text-slate-400">{label}{isChanged ? <span className="ml-2 text-amber-400">changed</span> : null}</td>
                    <td className="px-3 py-2 text-slate-500" title={before}>{displayValue(before, key)}</td>
                    <td className={cn("px-3 py-2", isChanged ? "text-amber-300" : "text-slate-500")} title={after}>{displayValue(after, key)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function EvidenceSource({ proposalId, version }: { proposalId: string; version: number }) {
  const { data, loading, error, reload } = useAsync(
    () => getEvidenceDocument(proposalId, version),
    [proposalId, version]
  );
  const [result, setResult] = useState<SourceVerification | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const verify = async () => {
    if (!data) return;
    setVerifying(true);
    setVerifyError(null);
    try {
      setResult(await verifyEvidenceSource(proposalId, data.docHash, data.span));
    } catch (cause) {
      setVerifyError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/30 p-3">
      <DataState loading={loading} error={error} empty={!loading && !error && !data} emptyMessage="No evidence document attached." loadingLabel="Loading evidence source" onRetry={reload}>
        {data ? (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <FileCheck2 size={14} className="text-cyan-300" />
                <span className="text-xs font-medium text-slate-300">Evidence source · {data.title}</span>
                <HashChip label="docHash" value={data.docHash} />
              </div>
              <button type="button" onClick={verify} disabled={verifying} className="rounded-md border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:border-cyan-800 hover:text-cyan-300 disabled:opacity-50">
                {verifying ? "Re-hashing…" : "Verify source"}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
              cited byte span [{data.span[0]}, {data.span[1]})
              <WhyDrawer>Verification re-hashes the UTF-8 document with keccak256, compares it to docHash, and checks that the cited half-open byte span lies inside the content.</WhyDrawer>
            </div>
            {result ? (
              <div className={cn("mt-3 rounded-md border p-2.5", result.status === "MATCH" ? "border-emerald-900/60 bg-emerald-950/20" : "border-red-900/60 bg-red-950/20")}>
                <StatusBadge tone={result.status === "MATCH" ? "success" : "danger"}>{result.status}</StatusBadge>
                <span className="ml-2 text-[11px] text-slate-400">span {result.spanValid ? "valid" : "invalid"}</span>
                <div className="mt-2"><HashChip label="recomputed" value={result.recomputedHash} /></div>
              </div>
            ) : null}
            {verifyError ? <p className="mt-2 text-xs text-red-400">{verifyError}</p> : null}
          </div>
        ) : null}
      </DataState>
    </div>
  );
}

function displayValue(value: string, key: keyof VersionEntry): string {
  if (key === "timestamp") return formatDateTime(value);
  return value.startsWith("0x") ? truncateMiddle(value, 10, 6) : value;
}

function isZeroHash(value: string): boolean {
  return /^0x0+$/.test(value);
}
