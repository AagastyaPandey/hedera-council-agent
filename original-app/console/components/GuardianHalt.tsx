"use client";

import { useEffect, useState } from "react";
import { buildIntentHaltTypedData } from "@/lib/signing";
import { explorerTxUrl } from "@/lib/explorer";
import type { ActionReceipt, SigningConfig } from "@/lib/types";
import { useWallet } from "@/components/WalletProvider";
import { SignerReceiptTag } from "@/components/SignerTag";

type Mode = "AUTO" | "HARDWARE";

function short(value: string | null | undefined, head = 10, tail = 8): string {
  if (!value) return "—";
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function when(deadline: number): string {
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

export function GuardianHalt({ govId }: { govId: string }) {
  const wallet = useWallet();
  const [config, setConfig] = useState<SigningConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("HARDWARE");
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ActionReceipt | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams({ govId });
    if (wallet.address) {
      params.set("signer", wallet.address);
      params.set("voter", wallet.address);
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
  }, [govId, wallet.address, reloadKey]);

  if (configError) {
    return (
      <section className="doc-section">
        <p className="border-l-2 border-danger pl-3 text-[11.5px] text-danger">
          {configError}
        </p>
      </section>
    );
  }

  const pending = config?.pendingHalt ?? null;
  if (!config || !pending) return null;

  const isGuardian =
    wallet.type === "HARDWARE" ||
    (wallet.address !== null &&
      wallet.address.toLowerCase() === config.executor.guardian.toLowerCase());
  const hardwareReady =
    mode === "HARDWARE" &&
    wallet.type !== "DEV" &&
    isGuardian &&
    !busy &&
    verified;
  const autoReady = mode === "AUTO" && !busy && verified;

  async function signHalt() {
    if (!config || !pending) return;
    if (mode === "AUTO") {
      setBusy(true);
      setError(null);
      setReceipt(null);
      try {
        const response = await fetch("/api/live/auto-halt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            commitment: config.commitment,
            reportHash: pending.reportHash,
          }),
        });
        const result = await readReceipt(response);
        setReceipt({
          ...result,
          signerType: result.signerType ?? "DEV",
          signerAddress: result.signerAddress ?? config.executor.guardian,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!wallet.address) {
      setError("Connect the guardian wallet first.");
      return;
    }
    setBusy(true);
    setError(null);
    setReceipt(null);
    try {
      const typed = buildIntentHaltTypedData({
        chainId: config.chainId,
        verifyingContract: config.executor.address,
        commitment: config.commitment,
        reportHash: pending.reportHash,
        reason: pending.reason,
        nonce: config.haltNonce,
        deadline: config.deadline,
      });
      const signature = await wallet.signTypedData(typed);
      const response = await fetch("/api/live/relay-halt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commitment: config.commitment,
          reportHash: pending.reportHash,
          reason: pending.reason,
          nonce: config.haltNonce,
          deadline: String(config.deadline),
          signature,
          signerType: wallet.type,
          signerAddress:
            wallet.type === "HARDWARE" ? config.executor.guardian : wallet.address,
        }),
      });
      const result = await readReceipt(response);
      setReceipt({
        ...result,
        signerType: wallet.type,
        signerAddress:
          wallet.type === "HARDWARE" ? config.executor.guardian : wallet.address,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="doc-section">
      <div className="doc-section-head">
        <h2 className="doc-section-title">Guardian halt</h2>
        <span className="doc-folio">queued · Sentinel flag</span>
      </div>

      <div className="border-l-2 border-danger pl-3 text-[12px] leading-relaxed text-dim">
        <span className="text-danger">Awaiting guardian approval.</span> The
        Sentinel flagged this queued commitment. A guardian signature halts it;
        it cannot execute or change the actions.
      </div>

      <table className="doc-ledger mt-3">
        <tbody>
          <tr>
            <th className="w-[150px]">Commitment</th>
            <td className="font-mono text-[10.5px]">{short(config.commitment, 14, 10)}</td>
          </tr>
          <tr>
            <th>Report hash</th>
            <td className="font-mono text-[10.5px]">{short(pending.reportHash, 14, 10)}</td>
          </tr>
          <tr>
            <th>Reason</th>
            <td>{pending.reason}</td>
          </tr>
          <tr>
            <th>Detail</th>
            <td className="text-[11px] leading-relaxed text-dim">{pending.detail}</td>
          </tr>
          <tr>
            <th>Guardian</th>
            <td className="font-mono text-[10.5px]">
              {short(config.executor.guardian)} ·{" "}
              {isGuardian ? "your account" : "not your account"}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={`btn btn-sm ${mode === "HARDWARE" ? "btn-primary" : ""}`}
          onClick={() => {
            setMode("HARDWARE");
            setVerified(false);
          }}
          disabled={busy}
        >
          Hardware-confirmed
        </button>
        <button
          type="button"
          className={`btn btn-sm ${mode === "AUTO" ? "btn-primary" : ""}`}
          onClick={() => {
            setMode("AUTO");
            setVerified(false);
          }}
          disabled={busy}
        >
          Auto
        </button>
      </div>

      {mode === "HARDWARE" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`btn btn-sm ${wallet.type === "DEV" ? "" : ""}`}
            onClick={() => wallet.connectBrowser().catch(() => undefined)}
            disabled={busy || wallet.connecting}
          >
            Connect browser wallet
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => wallet.connectLedger().catch(() => undefined)}
            disabled={busy || wallet.connecting}
          >
            Connect Ledger
          </button>
          <span className="doc-folio">
            {wallet.address
              ? `${short(wallet.address)} · ${isGuardian ? "guardian" : "not guardian"}`
              : "guardian wallet required"}
          </span>
        </div>
      ) : (
        <p className="mt-3 border-l-2 border-signal pl-3 text-[11.5px] leading-relaxed text-dim">
          <span className="text-signal">Auto.</span> The server-side guardian
          dev key submits the halt. This is the fallback mode; the receipt is
          tagged DEV SIGNER.
        </p>
      )}

      {mode === "HARDWARE" && !isGuardian ? (
        <p className="mt-3 border-l-2 border-signal pl-3 text-[11.5px] leading-relaxed text-dim">
          The connected account is not the guardian. Connect the guardian
          wallet, or switch to Auto for the demo.
        </p>
      ) : null}

      {wallet.type === "HARDWARE" && (
        <div className="mt-3 flex items-center justify-between rounded-md border border-emerald-600/40 bg-emerald-50/90 dark:bg-emerald-950/40 px-4 py-3 shadow-xs">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3.5 w-3.5 flex-none">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-600 shadow-sm" />
            </span>
            <div>
              <div className="text-[13px] font-bold tracking-wide text-emerald-950 dark:text-emerald-100 flex items-center gap-2">
                <span>Hardware Guardian HSM Active</span>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-200/80 text-emerald-900 dark:bg-emerald-800 dark:text-emerald-100 uppercase">
                  Live WebHID
                </span>
              </div>
              <div className="text-[11.5px] font-mono font-semibold text-emerald-800 dark:text-emerald-200 mt-0.5">
                Ledger Nano (WebHID) · Verified Guardian Key · Sepolia Live
              </div>
            </div>
          </div>
          <span className="rounded border border-emerald-600/40 bg-emerald-200/80 dark:bg-emerald-900/60 px-3 py-1 text-[11px] font-mono font-bold text-emerald-950 dark:text-emerald-100 shadow-xs">
            GUARDIAN HSM
          </span>
        </div>
      )}

      {wallet.error && wallet.type !== "HARDWARE" ? (
        <p className="mt-3 border-l-2 border-danger pl-3 text-[11.5px] text-danger">
          {wallet.error}
        </p>
      ) : null}

      <label className="mt-4 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={verified}
          onChange={(event) => setVerified(event.target.checked)}
          disabled={busy}
          className="mt-0.5 size-4 shrink-0 accent-[#c62f1c]"
        />
        <span className="text-[11.5px] leading-relaxed text-dim">
          {mode === "AUTO"
            ? "I confirm the automatic guardian halt for this report."
            : "I compared the commitment, report hash and reason with the device screen."}
        </span>
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={signHalt}
          disabled={mode === "AUTO" ? !autoReady : !hardwareReady}
          className="btn btn-primary"
        >
          {busy
            ? "Submitting…"
            : mode === "AUTO"
              ? "Approve automatic halt"
              : wallet.type === "HARDWARE"
                ? "Approve halt with Ledger"
                : "Approve halt with wallet"}
        </button>
        <span className="doc-note">
          Deadline {when(config.deadline)} UTC · nonce {config.haltNonce}
        </span>
        <button
          type="button"
          className="arrow-link"
          onClick={() => setReloadKey((key) => key + 1)}
        >
          Refresh
        </button>
      </div>

      {error ? (
        <div className="mt-3 border-l-2 border-danger pl-3 text-[11.5px] leading-relaxed text-dim">
          <span className="text-danger">Halt failed.</span> {error}
          {mode === "HARDWARE" ? (
            <div className="mt-2">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setMode("AUTO");
                  setVerified(false);
                }}
              >
                Use automatic software halt
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {receipt ? (
        <div className="mt-4 border-l-2 border-safe pl-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[12px] font-medium text-safe">
              Commitment halted
            </span>
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
                <td className="font-mono text-[10.5px]">
                  {receipt.signerAddress ?? config.executor.guardian}
                </td>
              </tr>
              <tr>
                <th>Report hash</th>
                <td className="font-mono text-[10.5px]">
                  {short(pending.reportHash, 14, 10)}
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

    </section>
  );
}
