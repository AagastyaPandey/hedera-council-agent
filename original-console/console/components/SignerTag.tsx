"use client";

import Link from "next/link";
import type { SignerType } from "@/lib/types";
import { useWallet } from "@/components/WalletProvider";

const LABEL: Record<string, string> = {
  DEV: "DEV SIGNER",
  BROWSER: "BROWSER WALLET",
  HARDWARE: "HARDWARE CONNECTED",
};

const SHORT: Record<string, string> = {
  DEV: "DEV",
  BROWSER: "BROWSER",
  HARDWARE: "HW CONNECTED",
};

const TONE: Record<string, string> = {
  DEV: "text-faint",
  BROWSER: "text-info",
  HARDWARE: "text-emerald-800 font-bold dark:text-emerald-300",
};

export function SignerTag() {
  const { type, address } = useWallet();

  return (
    <Link
      href="/status"
      className={`signer-tag ${TONE[type]}`}
      title={address ? `${LABEL[type]} · ${address}` : "Open preflight"}
    >
      <span
        className={`signer-mark ${
          type === "HARDWARE" ? "rounded-full !bg-emerald-500 animate-pulse" : ""
        }`}
        aria-hidden="true"
      />
      <span className="hidden sm:inline">{LABEL[type]}</span>
      <span className="sm:hidden">{SHORT[type]}</span>
    </Link>
  );
}

export function SignerReceiptTag({ type }: { type: SignerType }) {
  return (
    <span className={`signer-tag ${TONE[type]}`}>
      <span
        className={`signer-mark ${
          type === "HARDWARE" ? "rounded-full !bg-emerald-500 animate-pulse" : ""
        }`}
        aria-hidden="true"
      />
      {LABEL[type]}
    </span>
  );
}
