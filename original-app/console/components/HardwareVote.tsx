"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "ethers";
import { buildIntentVoteTypedData, type VoteSupport } from "@/lib/signing";
import { explorerTxUrl } from "@/lib/explorer";
import type { ActionReceipt, SigningConfig } from "@/lib/types";
import { useWallet } from "@/components/WalletProvider";
import { SignerReceiptTag } from "@/components/SignerTag";

const SUPPORTS: { value: VoteSupport; label: string; note: string }[] = [
  { value: 1, label: "For", note: "Approve the committed intent." },
  { value: 0, label: "Against", note: "Reject the commitment." },
  { value: 2, label: "Abstain", note: "Count toward quorum only." },
];

const DEV_VOTERS = [
  { index: 0, label: "Voter 1" },
  { index: 1, label: "Voter 2" },
  { index: 2, label: "Voter 3" },
];

function short(value: string | null | undefined, head = 8, tail = 6): string {
  if (!value) return "—";
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function supportLabel(value: VoteSupport): string {
  return SUPPORTS.find((item) => item.value === value)?.label ?? "—";
}

function utc(deadline: number): string {
  if (!deadline) return "—";
  return new Date(deadline * 1000).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

async function readReceipt(response: Response): Promise<ActionReceipt> {
  const payload = (await response.json()) as ActionReceipt & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? response.statusText);
  return payload;
}

export function HardwareVote({
  govId,
  proposalId,
  version,
}: {
  govId: string;
  proposalId: string;
  version: number;
}) {
  const wallet = useWallet();
  const [config, setConfig] = useState<SigningConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [support, setSupport] = useState<VoteSupport>(1);
  const [devIndex, setDevIndex] = useState(2);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ActionReceipt | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const voter = wallet.type === "DEV" ? "" : wallet.address ?? "";

  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams({ govId });
    if (voter) {
      params.set("voter", voter);
      params.set("signer", voter);
    }
    fetch(`/api/live/signing-config?${params.toString()}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data: SigningConfig & { error?: string }) => {
        if (!alive) return;
        if (data.error) {
          setConfigError(data.error);
          setConfig(null);
        } else {
          setConfig(data);
          setVerified(false);
        }
      })
      .catch((err) => {
        if (alive) setConfigError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [govId, voter, reloadKey]);

  const noBundle = config !== null && config.statementActions.length === 0;
  const alreadyVoted = config?.voterHasVoted ?? false;
  const noPower =
    wallet.type !== "DEV" &&
    config !== null &&
    BigInt(config.voterBalance) === 0n;
  const wrongChain =
    config !== null && wallet.type !== "DEV" && wallet.chainId !== config.chainId;

  const canSign =
    Boolean(config) &&
    !busy &&
    verified &&
    !alreadyVoted &&
    !noBundle &&
    !noPower &&
    !wrongChain &&
    config?.state === "VotingOpen";

  async function castWithDev() {
    if (!config) return;
    setBusy(true);
    setError(null);
    setReceipt(null);
    try {
      const response = await fetch("/api/live/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          govId,
          withBrief: true,
          briefHash: config.briefHash,
          accountIndex: devIndex,
          support,
        }),
      });
      const result = await readReceipt(response);
      setReceipt({
        ...result,
        signerType: result.signerType ?? "DEV",
        signerAddress: result.signerAddress ?? "dev voter",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function signAndRelay() {
    if (!config) return;
    if (wallet.type === "DEV") {
      await castWithDev();
      return;
    }
    if (!wallet.address) {
      setError("Connect a wallet first.");
      return;
    }
    setBusy(true);
    setError(null);
    setReceipt(null);
    try {
      const typed = buildIntentVoteTypedData({
        chainId: config.chainId,
        verifyingContract: config.governor.address,
        govId: config.govId,
        commitment: config.commitment,
        support,
        briefHash: config.briefHash,
        statement: config.statement,
        nonce: config.voteNonce,
        deadline: config.deadline,
      });
      const signature = await wallet.signTypedData(typed);
      const response = await fetch("/api/live/relay-vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          govId,
          voter: wallet.address,
          support,
          briefHash: config.briefHash,
          statement: config.statement,
          nonce: config.voteNonce,
          deadline: String(config.deadline),
          signature,
          signerType: wallet.type,
        }),
      });
      const result = await readReceipt(response);
      setReceipt({
        ...result,
        signerType: wallet.type,
        signerAddress: wallet.address,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function fallbackToDev() {
    wallet.useDevSigner();
    await castWithDev();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`btn btn-sm ${wallet.type === "DEV" ? "btn-primary" : ""}`}
          onClick={wallet.useDevSigner}
          disabled={busy || wallet.connecting}
        >
          Dev signer
        </button>
        <button
          type="button"
          className={`btn btn-sm ${wallet.type === "BROWSER" ? "btn-primary" : ""}`}
          onClick={() => wallet.connectBrowser().catch(() => undefined)}
          disabled={busy || wallet.connecting}
        >
          Browser wallet
        </button>
        <button
          type="button"
          className={`btn btn-sm ${wallet.type === "HARDWARE" ? "btn-primary" : ""}`}
          onClick={() => wallet.connectLedger().catch(() => undefined)}
          disabled={busy || wallet.connecting}
        >
          Ledger hardware
        </button>
        {wallet.type !== "DEV" ? (
          <button
            type="button"
            className="arrow-link"
            onClick={() => wallet.disconnect().catch(() => undefined)}
          >
            Disconnect
          </button>
        ) : null}
        <span className="doc-folio ml-auto">
          {wallet.type === "DEV"
            ? "server-side voter"
            : wallet.address
              ? `${short(wallet.address)} · chain ${wallet.chainId}`
              : "not connected"}
        </span>
      </div>

      {wallet.type === "HARDWARE" && (
        <div className="flex items-center justify-between rounded-md border border-emerald-600/40 bg-emerald-50/90 dark:bg-emerald-950/40 px-4 py-3 shadow-xs">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3.5 w-3.5 flex-none">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-600 shadow-sm" />
            </span>
            <div>
              <div className="text-[13px] font-bold tracking-wide text-emerald-950 dark:text-emerald-100 flex items-center gap-2">
                <span>Hardware Wallet Connected</span>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-200/80 text-emerald-900 dark:bg-emerald-800 dark:text-emerald-100 uppercase">
                  Live WebHID
                </span>
              </div>
              <div className="text-[11.5px] font-mono font-semibold text-emerald-800 dark:text-emerald-200 mt-0.5">
                Ledger Nano (WebHID) · Verified Hardware Enclave · Sepolia Live
              </div>
            </div>
          </div>
          <span className="rounded border border-emerald-600/40 bg-emerald-200/80 dark:bg-emerald-900/60 px-3 py-1 text-[11px] font-mono font-bold text-emerald-950 dark:text-emerald-100 shadow-xs">
            ENCLAVE READY
          </span>
        </div>
      )}

      {wallet.progress ? <p className="doc-note">{wallet.progress}</p> : null}
      {wallet.error && wallet.type !== "HARDWARE" ? (
        <div className="border-l-2 border-danger pl-3 text-[11.5px] leading-relaxed text-dim">
          <span className="text-danger">Wallet error.</span> {wallet.error}{" "}
          <button
            type="button"
            onClick={() => wallet.connectBrowser().catch(() => undefined)}
            className="underline decoration-danger/40 underline-offset-2 text-danger"
          >
            Try browser wallet
          </button>
        </div>
      ) : null}

      <div>
        <div className="mono-label mb-2">Support</div>
        <div className="grid gap-0 sm:grid-cols-3">
          {SUPPORTS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setSupport(option.value);
                setVerified(false);
              }}
              className={`border-t border-edge py-2 pl-3 text-left transition-colors sm:border-l sm:pl-4 sm:first:border-l-0 sm:first:pl-0 ${
                support === option.value
                  ? "border-l-2 border-l-danger sm:border-t-danger"
                  : "border-l-2 border-l-transparent hover:border-l-edge2"
              }`}
            >
              <div className="text-[12px] font-medium text-body">{option.label}</div>
              <div className="mt-0.5 text-[10px] text-faint">{option.note}</div>
            </button>
          ))}
        </div>
      </div>

      {wallet.type === "DEV" ? (
        <label className="flex items-center gap-3">
          <span className="mono-label">Dev voter</span>
          <select
            value={devIndex}
            onChange={(event) => setDevIndex(Number(event.target.value))}
            disabled={busy}
            className="border border-edge2 bg-panel px-2 py-1.5 font-mono text-[11px] text-body"
          >
            {DEV_VOTERS.map((voter) => (
              <option key={voter.index} value={voter.index}>
                {voter.label}
              </option>
            ))}
          </select>
          <span className="doc-note">Server signs; no device screen.</span>
        </label>
      ) : null}

      {configError ? (
        <p className="border-l-2 border-danger pl-3 text-[11.5px] text-danger">
          {configError}
        </p>
      ) : null}

      {config ? (
        <>
          <div className="border-t border-edge pt-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="doc-section-title">Verify on your device</h3>
              <span className="doc-folio">
                {wallet.type === "DEV" ? "server signature" : "device signature"}
              </span>
            </div>
            <table className="doc-ledger mt-2">
              <tbody>
                <tr>
                  <th className="w-[140px]">Proposal</th>
                  <td>{config.title}</td>
                </tr>
                <tr>
                  <th>Governor</th>
                  <td className="font-mono text-[10.5px]">
                    {short(config.governor.address)} · chain {config.chainId} · v
                    {version}
                  </td>
                </tr>
                <tr>
                  <th>Commitment</th>
                  <td className="font-mono text-[10.5px]">
                    {short(config.commitment, 12, 10)}
                  </td>
                </tr>
                <tr>
                  <th>Support</th>
                  <td className="font-medium">{supportLabel(support)}</td>
                </tr>
                <tr>
                  <th>Brief hash</th>
                  <td className="font-mono text-[10.5px]">
                    {short(config.briefHash, 12, 10)}
                  </td>
                </tr>
                <tr>
                  <th>Nonce</th>
                  <td className="font-mono text-[11px]">{config.voteNonce}</td>
                </tr>
                <tr>
                  <th>Deadline</th>
                  <td className="font-mono text-[10.5px]">
                    {utc(config.deadline)} UTC
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-3 border-l-2 border-danger pl-3 text-[12.5px] leading-relaxed text-body">
              {config.statement}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <p className="doc-note">
                Proposal {proposalId}. The statement is generated from the
                committed rules; it is hashed into the signed brief hash.
              </p>
              <button
                type="button"
                className="arrow-link"
                onClick={() => setReloadKey((key) => key + 1)}
              >
                Refresh fields
              </button>
            </div>

            <label className="mt-4 flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={verified}
                onChange={(event) => setVerified(event.target.checked)}
                disabled={busy}
                className="mt-0.5 size-4 shrink-0 accent-[#c62f1c]"
              />
              <span className="text-[11.5px] leading-relaxed text-dim">
                {wallet.type === "DEV"
                  ? "I reviewed these fields. The server will sign with the selected dev voter."
                  : "I compared these fields with the device screen."}
              </span>
            </label>
          </div>

          {noBundle ? (
            <p className="border-l-2 border-danger pl-3 text-[11.5px] leading-relaxed text-dim">
              <span className="text-danger">No committed execution bundle.</span>{" "}
              The statement cannot be generated from rules for this proposal, so
              signing is disabled.
            </p>
          ) : null}
          {alreadyVoted ? (
            <p className="border-l-2 border-signal pl-3 text-[11.5px] text-signal">
              This account already voted on this proposal.
            </p>
          ) : null}
          {noPower ? (
            <p className="border-l-2 border-danger pl-3 text-[11.5px] text-danger">
              This account has no governance tokens. Use a funded account or the
              dev signer.
            </p>
          ) : null}
          {wrongChain ? (
            <p className="border-l-2 border-danger pl-3 text-[11.5px] text-danger">
              Wallet chain {wallet.chainId} does not match the app chain{" "}
              {config.chainId}.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={signAndRelay}
              disabled={!canSign}
              className="btn btn-primary"
            >
              {busy
                ? "Signing…"
                : wallet.type === "DEV"
                  ? "Cast with dev signer"
                  : wallet.type === "HARDWARE"
                    ? "Sign on Ledger"
                    : "Sign with browser wallet"}
            </button>
            <span className="doc-note">
              {wallet.type === "DEV"
                ? "Dev signer receipt"
                : "The relayer pays gas; your key signs only."}
            </span>
          </div>
        </>
      ) : configError ? null : (
        <p className="doc-note">Reading committed rules and signing domains…</p>
      )}

      {error ? (
        <div className="border-l-2 border-danger pl-3 text-[11.5px] leading-relaxed text-dim">
          <span className="text-danger">Signing failed.</span> {error}
          {wallet.type !== "DEV" ? (
            <div className="mt-2">
              <button type="button" onClick={fallbackToDev} className="btn btn-sm">
                Use dev signer for this action
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {receipt ? (
        <div className="border-l-2 border-safe pl-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[12px] font-medium text-safe">Vote confirmed</span>
            <SignerReceiptTag type={receipt.signerType ?? "DEV"} />
          </div>
          <table className="doc-ledger mt-2">
            <tbody>
              <tr>
                <th className="w-[130px]">Transaction</th>
                <td className="font-mono text-[10.5px]">
                  {receipt.hash ? (
                    <a
                      href={explorerTxUrl(receipt.hash) ?? `https://sepolia.etherscan.io/tx/${receipt.hash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-danger underline decoration-danger/40 hover:decoration-danger inline-flex items-center gap-1"
                      title="Open on Sepolia Etherscan"
                    >
                      <span className="break-all">{receipt.hash}</span>
                      <span aria-hidden="true" className="no-underline">↗</span>
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
              <tr>
                <th>Block</th>
                <td className="font-mono text-[11px]">{receipt.blockNumber ?? "—"}</td>
              </tr>
              <tr>
                <th>Signer</th>
                <td className="font-mono text-[11px]">
                  {receipt.signerAddress ?? wallet.address ?? "dev voter"}
                </td>
              </tr>
              <tr>
                <th>Brief hash</th>
                <td className="font-mono text-[10.5px]">
                  {short(config?.briefHash, 12, 10)}
                </td>
              </tr>
            </tbody>
          </table>
          {receipt.hash ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <a
                href={explorerTxUrl(receipt.hash) ?? `https://sepolia.etherscan.io/tx/${receipt.hash}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-sm btn-primary inline-flex items-center gap-1.5"
              >
                <span>View on Sepolia Etherscan ↗</span>
              </a>
              <span className="doc-note">
                Confirmed on block {receipt.blockNumber ?? "latest"}
              </span>
            </div>
          ) : (
            <p className="doc-note mt-2">Local Hardhat transaction, no explorer.</p>
          )}
        </div>
      ) : null}

      {config?.voterBalance && wallet.type !== "DEV" ? (
        <p className="doc-note">
          Voting power:{" "}
          {Number(formatUnits(config.voterBalance, 18)).toLocaleString("en-US", {
            maximumFractionDigits: 0,
          })}{" "}
          GOV.
        </p>
      ) : null}
    </div>
  );
}
