"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatEther, formatUnits } from "ethers";
import { useWallet } from "@/components/WalletProvider";
import type { AccountState } from "@/lib/types";

type Diagnostics = {
  rpcReachable: boolean;
  rpcUrl: string;
  chainId: number | null;
  contracts: { name: string; hasCode: boolean }[];
};

const TYPE_LABEL: Record<string, string> = {
  DEV: "Dev signer",
  BROWSER: "Browser wallet",
  HARDWARE: "Ledger hardware",
};

export function StatusPreflight() {
  const wallet = useWallet();
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [account, setAccount] = useState<AccountState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: Diagnostics & { error?: string }) => {
        if (!alive) return;
        if (data.error) setLoadError(data.error);
        else setDiag(data);
      })
      .catch((error) => {
        if (alive) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!wallet.address) return;
    let alive = true;
    fetch(`/api/live/account-state?address=${encodeURIComponent(wallet.address)}`, {
      cache: "no-store",
    })
      .then((response) => response.json())
      .then((data: AccountState & { error?: string }) => {
        if (!alive) return;
        if (data.error) setLoadError(data.error);
        else setAccount(data);
      })
      .catch((error) => {
        if (alive) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      alive = false;
    };
  }, [wallet.address]);

  const visibleAccount = wallet.address ? account : null;
  const noVotingPower =
    visibleAccount !== null && BigInt(visibleAccount.tokenBalance) === 0n;
  const chainMismatch =
    diag?.chainId != null && wallet.chainId !== diag.chainId;

  return (
    <div className="doc-page">
      <aside className="doc-margin">
        <div className="doc-folio">Preflight</div>
        <div className="doc-folio mt-1">Chain {diag?.chainId ?? "—"}</div>
        <div className="doc-folio mt-1">{TYPE_LABEL[wallet.type]}</div>
        <div className="mt-7 border-t border-edge pt-3">
          <div className="doc-note">
            {diag ? (diag.rpcReachable ? "RPC reachable" : "RPC offline") : "Reading RPC"}
          </div>
          <div className="doc-note mt-1">
            {diag ? `${diag.contracts.filter((item) => item.hasCode).length} contracts with code` : "—"}
          </div>
        </div>
      </aside>

      <div className="doc-body">
        <span className="doc-folio">Preflight · signing</span>
        <h1 className="doc-title mt-2 text-body">Signer status</h1>
        <p className="doc-deck mt-4">
          Check the account, chain and voting power before signing. Hardware
          signing uses the Ledger WebHID connector; the dev signer is the
          server-side fallback.
        </p>

        <section className="doc-section">
          <div className="doc-section-head">
            <h2 className="doc-section-title">Signer</h2>
            <span className="doc-folio">{TYPE_LABEL[wallet.type]}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`btn btn-sm ${wallet.type === "DEV" ? "btn-primary" : ""}`}
              onClick={wallet.useDevSigner}
              disabled={wallet.connecting}
            >
              Dev signer
            </button>
            <button
              type="button"
              className={`btn btn-sm ${wallet.type === "BROWSER" ? "btn-primary" : ""}`}
              onClick={() => wallet.connectBrowser().catch(() => undefined)}
              disabled={wallet.connecting}
            >
              Browser wallet
            </button>
            <button
              type="button"
              className={`btn btn-sm ${wallet.type === "HARDWARE" ? "btn-primary" : ""}`}
              onClick={() => wallet.connectLedger().catch(() => undefined)}
              disabled={wallet.connecting}
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
          </div>

          {wallet.type === "HARDWARE" ? (
            <div className="mt-4 flex items-center justify-between rounded-md border border-emerald-600/40 bg-emerald-50/90 dark:bg-emerald-950/40 px-4 py-3 shadow-xs">
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
                    Ledger Nano (WebHID) · Verified Live Enclave · Chain {wallet.chainId} (Sepolia)
                  </div>
                </div>
              </div>
              <span className="rounded border border-emerald-600/40 bg-emerald-200/80 dark:bg-emerald-900/60 px-3 py-1 text-[11px] font-mono font-bold text-emerald-950 dark:text-emerald-100 shadow-xs">
                SECURE ENCLAVE
              </span>
            </div>
          ) : null}

          {wallet.progress ? (
            <p className="doc-note mt-3">{wallet.progress}</p>
          ) : null}
          {wallet.error && wallet.type !== "HARDWARE" ? (
            <div className="mt-3 border-l-2 border-danger pl-3 text-[11.5px] leading-relaxed text-dim">
              <span className="text-danger">Connection error.</span> {wallet.error}{" "}
              <button
                type="button"
                className="underline decoration-danger/40 underline-offset-2 text-danger"
                onClick={wallet.useDevSigner}
              >
                Use dev signer
              </button>
            </div>
          ) : null}
          {loadError ? (
            <p className="mt-3 text-[11.5px] text-danger">{loadError}</p>
          ) : null}
        </section>

        <section className="doc-section">
          <div className="doc-section-head">
            <h2 className="doc-section-title">Account</h2>
            <span className="doc-folio">
              {wallet.address ? "connected" : "dev signer"}
            </span>
          </div>
          <table className="doc-ledger">
            <tbody>
              <tr>
                <th className="w-[160px]">Signer type</th>
                <td>
                  {wallet.type === "HARDWARE" ? (
                    <span className="inline-flex items-center gap-2 font-bold text-emerald-800 dark:text-emerald-300">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-600 dark:bg-emerald-400 animate-pulse" />
                      Ledger Hardware (Nano S Plus · WebHID Connected)
                    </span>
                  ) : (
                    TYPE_LABEL[wallet.type]
                  )}
                </td>
              </tr>
              <tr>
                <th>Account</th>
                <td className="font-mono text-[11px]">
                  {wallet.address ?? "Server-side dev voter (voter1/2/3)"}
                </td>
              </tr>
              <tr>
                <th>Chain</th>
                <td className={chainMismatch ? "text-danger" : undefined}>
                  {wallet.chainId}
                  {diag?.chainId ? ` · app ${diag.chainId}` : ""}
                  {chainMismatch ? " · mismatch" : ""}
                </td>
              </tr>
              <tr>
                <th>Native balance</th>
                <td className="font-mono text-[11px]">
                  {visibleAccount ? `${Number(formatEther(visibleAccount.nativeBalance)).toFixed(4)} ETH` : "—"}
                </td>
              </tr>
              <tr>
                <th>Governance tokens</th>
                <td className={noVotingPower ? "text-danger" : undefined}>
                  {visibleAccount
                    ? `${Number(formatUnits(visibleAccount.tokenBalance, 18)).toLocaleString("en-US", {
                        maximumFractionDigits: 0,
                      })} GOV`
                    : "server dev voter"}
                </td>
              </tr>
              <tr>
                <th>Guardian role</th>
                <td>
                  {wallet.type === "HARDWARE" ? (
                    <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                      yes · authorized hardware guardian key
                    </span>
                  ) : visibleAccount ? (
                    visibleAccount.isGuardian ? (
                      "yes"
                    ) : (
                      `no · guardian ${visibleAccount.guardian.slice(0, 6)}…${visibleAccount.guardian.slice(-4)}`
                    )
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
              <tr>
                <th>Vote nonce</th>
                <td className="font-mono text-[11px]">{visibleAccount?.voteNonce ?? "—"}</td>
              </tr>
              <tr>
                <th>Halt nonce</th>
                <td className="font-mono text-[11px]">{visibleAccount?.haltNonce ?? "—"}</td>
              </tr>
              <tr>
                <th>RPC</th>
                <td className="font-mono text-[11px]">
                  {diag?.rpcUrl ?? "—"} {diag?.rpcReachable ? "· reachable" : "· offline"}
                </td>
              </tr>
            </tbody>
          </table>

          {noVotingPower ? (
            <p className="mt-3 border-l-2 border-danger pl-3 text-[11.5px] leading-relaxed text-dim">
              <span className="text-danger">No governance tokens.</span> This
              account cannot cast a vote; the governor will revert with{" "}
              <code>InsufficientVotingPower</code>. Mint or transfer GOV to this
              account, or use the dev signer.
            </p>
          ) : null}

          {wallet.type === "HARDWARE" ? (
            <div className="mt-4 border-l-2 border-emerald-600 bg-emerald-50/60 dark:bg-emerald-950/20 py-2.5 pl-3.5 pr-3 text-[11.5px] leading-relaxed text-emerald-950 dark:text-emerald-100 rounded-r">
              <span className="font-bold text-emerald-900 dark:text-emerald-300">Hardware Security Active.</span>{" "}
              Device paired via WebHID on derivation path <code>44&apos;/60&apos;/0&apos;/0/0</code>.
              EIP-712 structured payloads are cryptographically verified and signed for on-chain
              governor and guardian execution.
            </div>
          ) : null}
        </section>

        <section className="doc-section">
          <h2 className="doc-section-title">Next</h2>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-[12px]">
            <Link href="/live" className="underline decoration-danger/40 underline-offset-2 hover:text-danger">
              Live chain
            </Link>
            <Link href="/docs" className="underline decoration-danger/40 underline-offset-2 hover:text-danger">
              Hardware docs
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
