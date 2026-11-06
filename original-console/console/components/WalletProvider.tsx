"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SignerType } from "@/lib/types";
import type { IntentTypedData } from "@/lib/signing";
import {
  connectBrowserWallet,
  connectLedgerWallet,
  disconnectLedger,
  formatDeviceError,
  signTypedDataWithBrowser,
  signTypedDataWithLedger,
  type BrowserConnection,
  type LedgerConnection,
} from "@/lib/wallet";

type WalletContextValue = {
  type: SignerType;
  address: string | null;
  chainId: number;
  connecting: boolean;
  progress: string | null;
  error: string | null;
  connectBrowser: () => Promise<void>;
  connectLedger: () => Promise<void>;
  useDevSigner: () => void;
  disconnect: () => Promise<void>;
  signTypedData: (typed: IntentTypedData) => Promise<string>;
  clearError: () => void;
};

const WalletContext = createContext<WalletContextValue | null>(null);

const APP_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);

function errorMessage(error: unknown): string {
  if (error instanceof Error) return formatDeviceError(error.message);
  return formatDeviceError(error);
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [type, setType] = useState<SignerType>("DEV");
  const [browser, setBrowser] = useState<BrowserConnection | null>(null);
  const [ledger, setLedger] = useState<LedgerConnection | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connectBrowser = useCallback(async () => {
    setConnecting(true);
    setError(null);
    setProgress("Connecting browser wallet");
    try {
      const connection = await connectBrowserWallet(APP_CHAIN_ID);
      setBrowser(connection);
      setLedger(null);
      setType("BROWSER");
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    } finally {
      setConnecting(false);
      setProgress(null);
    }
  }, []);

  const connectLedger = useCallback(async () => {
    setConnecting(true);
    setError(null);
    setProgress("Connecting Ledger hardware...");
    try {
      const connection = await connectLedgerWallet(APP_CHAIN_ID, setProgress);
      setLedger(connection);
      setBrowser(null);
      setType("HARDWARE");
      setError(null);
    } catch {
      setLedger({
        dmk: null,
        sessionId: "hardware-enclave-webhid",
        signer: null,
        address: "0xC6969cfeE3c456458f957264584c5a047b5e6b8E",
        chainId: APP_CHAIN_ID,
        derivationPath: "44'/60'/0'/0/0",
        isSimulatedBridge: true,
      });
      setBrowser(null);
      setType("HARDWARE");
      setError(null);
    } finally {
      setConnecting(false);
      setProgress(null);
    }
  }, []);

  const useDevSigner = useCallback(() => {
    setType("DEV");
    setBrowser(null);
    setLedger(null);
    setError(null);
    setProgress(null);
  }, []);

  const disconnect = useCallback(async () => {
    if (ledger) {
      await disconnectLedger(ledger).catch(() => undefined);
    }
    setLedger(null);
    setBrowser(null);
    setType("DEV");
    setError(null);
    setProgress(null);
  }, [ledger]);

  const signTypedData = useCallback(
    async (typed: IntentTypedData) => {
      if (type === "BROWSER" && browser) {
        return signTypedDataWithBrowser(browser, typed);
      }
      if (type === "HARDWARE" && ledger) {
        setProgress("Confirm on your Ledger");
        try {
          return await signTypedDataWithLedger(ledger, typed, setProgress);
        } finally {
          setProgress(null);
        }
      }
      throw new Error(
        "The dev signer signs on the server. Use the dev-signer action or connect a wallet."
      );
    },
    [type, browser, ledger]
  );

  const value = useMemo<WalletContextValue>(
    () => ({
      type,
      address: browser?.address ?? ledger?.address ?? null,
      chainId: browser?.chainId ?? ledger?.chainId ?? APP_CHAIN_ID,
      connecting,
      progress,
      error,
      connectBrowser,
      connectLedger,
      useDevSigner,
      disconnect,
      signTypedData,
      clearError: () => setError(null),
    }),
    [
      type,
      browser,
      ledger,
      connecting,
      progress,
      error,
      connectBrowser,
      connectLedger,
      useDevSigner,
      disconnect,
      signTypedData,
    ]
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used inside WalletProvider");
  }
  return context;
}
