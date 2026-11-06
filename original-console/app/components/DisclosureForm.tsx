"use client";

import { useEffect, useState } from "react";
import { Clock3, FileCheck2, Loader2, Send } from "lucide-react";
import { DataState } from "@/components/ui/DataState";
import { HashChip } from "@/components/ui/HashChip";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { WhyDrawer } from "@/components/ui/WhyDrawer";
import {
  getDisclosureState,
  previewDisclosure,
  publishDisclosure,
} from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import type {
  ActionReceipt,
  DisclosurePreview,
  DisclosureState,
} from "@/lib/types";

export function DisclosureForm({ proposalId }: { proposalId: string }) {
  const { data, loading, error, reload } = useAsync(
    () => getDisclosureState(proposalId),
    [proposalId]
  );
  const [wallets, setWallets] = useState("");
  const [interests, setInterests] = useState("");
  const [preview, setPreview] = useState<DisclosurePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ActionReceipt | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    if (!data) return;
    setWallets(data.wallets.join("\n"));
    setInterests(data.interests);
    setReceipt(null);
    setPublishError(null);
  }, [data]);

  useEffect(() => {
    let cancelled = false;
    previewDisclosure({
      wallets: wallets.split(/[\n,]/),
      interests,
    }).then((value) => {
      if (!cancelled) {
        setPreview(value);
        setPreviewError(null);
      }
    }).catch((cause) => {
      if (!cancelled) {
        setPreview(null);
        setPreviewError(cause instanceof Error ? cause.message : String(cause));
      }
    });
    return () => { cancelled = true; };
  }, [wallets, interests]);

  const publish = async (event: React.FormEvent) => {
    event.preventDefault();
    setPublishing(true);
    setPublishError(null);
    try {
      setReceipt(await publishDisclosure(proposalId, {
        wallets: wallets.split(/[\n,]/),
        interests,
      }));
      reload();
    } catch (cause) {
      setPublishError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Panel
      title="Disclosure Registry"
      subtitle="Publish wallet relationships, preview their commitments, and track independent challenges."
      actions={data ? <StatusBadge tone={data.challenges.some((challenge) => challenge.status === "VERIFIED") ? "danger" : "info"}>{data.challenges.some((challenge) => challenge.status === "VERIFIED") ? "Challenged" : "Disclosure active"}</StatusBadge> : null}
    >
      <DataState
        loading={loading}
        error={error}
        empty={!loading && !error && !data}
        emptyMessage="No disclosure record exists for this proposal."
        loadingLabel="Loading disclosure registry"
        onRetry={reload}
      >
        {data ? (
          <div className="space-y-5">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <form onSubmit={publish} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <div className="grid gap-4">
                  <label className="text-xs font-medium text-slate-300">
                    Wallet list
                    <span className="mt-1 block text-[10px] font-normal text-slate-500">One address per line or comma-separated. Duplicates and blank lines are removed.</span>
                    <textarea
                      value={wallets}
                      onChange={(event) => setWallets(event.target.value)}
                      rows={6}
                      required
                      spellCheck={false}
                      className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-[11px] leading-relaxed text-cyan-200 outline-none transition-colors focus:border-cyan-600"
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-300">
                    Interests and relationships
                    <textarea
                      value={interests}
                      onChange={(event) => setInterests(event.target.value)}
                      rows={4}
                      className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs leading-relaxed text-slate-300 outline-none transition-colors focus:border-cyan-600"
                    />
                  </label>
                </div>

                <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-500">Hash previews</p>
                    <WhyDrawer>walletListHash hashes the sorted, lowercase address array as JSON. interestsHash hashes the trimmed UTF-8 interests text. Publishing uses these same computed values.</WhyDrawer>
                  </div>
                  {preview ? (
                    <div className="mt-3 grid gap-2">
                      <HashChip label="walletListHash" value={preview.walletListHash} />
                      <HashChip label="interestsHash" value={preview.interestsHash} />
                    </div>
                  ) : <p className="mt-2 text-xs text-amber-300">{previewError ?? "Enter disclosure content to preview hashes."}</p>}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    disabled={publishing || !preview}
                    className="inline-flex items-center gap-2 rounded-lg border border-cyan-800 bg-cyan-950/30 px-4 py-2 text-xs font-medium text-cyan-300 transition-colors hover:bg-cyan-950/60 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {publishing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    {publishing ? "Publishing…" : "Publish disclosure"}
                  </button>
                  <span className="text-[10px] text-slate-500">Mock mode updates this session only; no signature or bond is submitted.</span>
                </div>
                {publishError ? <p className="mt-3 text-xs text-red-400">{publishError}</p> : null}
                {receipt ? <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-3 text-xs text-emerald-300">{receipt.message}<HashChip label="wallet list" value={receipt.hash} /></div> : null}
              </form>

              <div className="space-y-4">
                <ChallengeWindow state={data} />
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-500">Published commitments</p>
                  <div className="mt-3 grid gap-2"><HashChip label="walletListHash" value={data.walletListHash} /><HashChip label="interestsHash" value={data.interestsHash} /></div>
                  <p className="mt-3 text-[10px] text-slate-500">Disclosed wallets: {data.wallets.length}</p>
                  <WhyDrawer className="mt-2">The count is derived from the normalized wallet array in the currently published mock disclosure.</WhyDrawer>
                </div>
              </div>
            </div>

            <section className="rounded-xl border border-slate-800 bg-slate-950/40">
              <header className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
                <div className="flex items-center gap-2"><FileCheck2 size={15} className="text-cyan-300" /><h3 className="text-xs font-semibold text-slate-200">Filed challenges</h3><StatusBadge tone="neutral">{data.challenges.length}</StatusBadge></div>
                <WhyDrawer>Verified means the registry verifier accepted the challenge. Unverified means evidence was filed but no independent verification has completed.</WhyDrawer>
              </header>
              {data.challenges.length === 0 ? (
                <p className="p-6 text-center text-xs text-slate-500">No challenges have been filed against this disclosure.</p>
              ) : (
                <div className="divide-y divide-slate-800">
                  {data.challenges.map((challenge) => (
                    <article key={challenge.id} className="p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <StatusBadge tone={challenge.status === "VERIFIED" ? "success" : "warning"}>{challenge.status}</StatusBadge>
                        <span className="font-mono text-[10px] text-slate-500">{formatDateTime(challenge.filedAt)}</span>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-slate-400">{challenge.reason}</p>
                      <div className="mt-2"><HashChip label="linkEvidenceHash" value={challenge.linkEvidenceHash} /></div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </DataState>
    </Panel>
  );
}

function ChallengeWindow({ state }: { state: DisclosureState }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const opens = new Date(state.challengeOpensAt).getTime();
  const closes = new Date(state.challengeClosesAt).getTime();
  const active = now >= opens && now < closes;
  const expired = now >= closes;
  const remaining = Math.max(0, (now < opens ? opens : closes) - now);
  const seconds = Math.floor(remaining / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2"><Clock3 size={15} className="text-cyan-300" /><p className="text-xs font-semibold text-slate-200">Challenge window</p></div>
        <StatusBadge tone={active ? "warning" : expired ? "danger" : "neutral"}>{active ? "Open" : expired ? "Closed" : "Scheduled"}</StatusBadge>
      </div>
      <p className="mt-4 font-mono text-2xl tabular-nums text-slate-100">
        {now === 0 ? "—" : expired ? "00:00:00" : `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(secs).padStart(2, "0")}s`}
      </p>
      <p className="mt-1 text-[10px] text-slate-500">{now < opens ? "until challenges open" : expired ? "challenge deadline passed" : "remaining to file evidence"}</p>
      <WhyDrawer className="mt-2">The countdown is computed from the registry open/close timestamps and your current clock. Days, hours, minutes, and seconds are a display breakdown of the same remaining duration.</WhyDrawer>
      <div className="mt-3 border-t border-slate-800 pt-3 text-[10px] leading-relaxed text-slate-500">Opens {formatDateTime(state.challengeOpensAt)}<br />Closes {formatDateTime(state.challengeClosesAt)}</div>
    </div>
  );
}
