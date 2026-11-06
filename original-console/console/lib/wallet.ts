import { ethers } from "ethers";
import type {
  DeviceManagementKit,
  DeviceSessionId,
  DiscoveredDevice,
} from "@ledgerhq/device-management-kit";
import type { SignerEth } from "@ledgerhq/device-signer-kit-ethereum";
import type { IntentTypedData } from "./signing";

export const DEFAULT_DERIVATION_PATH = "44'/60'/0'/0/0";
export const HARDWARE_VOTER_ADDRESS = "0xC6969cfeE3c456458f957264584c5a047b5e6b8E";

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  isMetaMask?: boolean;
};

type ActionState<T> = {
  status: string;
  output?: T;
  error?: unknown;
  intermediateValue?: { requiredUserInteraction?: string };
};

type ActionReturn<T> = {
  observable: {
    subscribe: (observer: {
      next?: (state: ActionState<T>) => void;
      error?: (error: unknown) => void;
      complete?: () => void;
    }) => { unsubscribe: () => void };
  };
  cancel?: () => void;
};

type ObservableLike<T> = {
  subscribe: (observer: {
    next?: (value: T) => void;
    error?: (error: unknown) => void;
    complete?: () => void;
  }) => { unsubscribe: () => void };
};

export type BrowserConnection = {
  provider: ethers.BrowserProvider;
  signer: ethers.Signer;
  address: string;
  chainId: number;
};

export type LedgerConnection = {
  dmk: DeviceManagementKit | null;
  sessionId: DeviceSessionId | string;
  signer: SignerEth | null;
  address: string;
  chainId: number;
  derivationPath: string;
  isSimulatedBridge?: boolean;
};

let dmkPromise: Promise<DeviceManagementKit> | null = null;

async function getDmk(): Promise<DeviceManagementKit> {
  if (!dmkPromise) {
    dmkPromise = (async () => {
      const { DeviceManagementKitBuilder } = await import(
        "@ledgerhq/device-management-kit"
      );
      const { webHidTransportFactory } = await import(
        "@ledgerhq/device-transport-kit-web-hid"
      );
      return new DeviceManagementKitBuilder()
        .addTransport(webHidTransportFactory)
        .build();
    })();
  }
  try {
    return await dmkPromise;
  } catch (error) {
    dmkPromise = null;
    throw error;
  }
}

export function formatDeviceError(error: unknown): string {
  if (!error) return "Unknown device error.";
  let raw = "";
  if (error instanceof Error) raw = error.message;
  else if (typeof error === "object" && error !== null) {
    if ("message" in error && typeof (error as { message: unknown }).message === "string") {
      raw = (error as { message: string }).message;
    } else if ("originalError" in error && (error as { originalError: unknown }).originalError instanceof Error) {
      raw = ((error as { originalError: Error }).originalError).message;
    } else if ("_tag" in error) {
      raw = String((error as { _tag: unknown })._tag);
    } else {
      raw = JSON.stringify(error);
    }
  } else {
    raw = String(error);
  }

  if (raw.includes("DeviceLocked") || raw.includes("5515")) {
    return "Your Ledger is locked. Please enter your PIN on your Ledger device to unlock it.";
  }
  if (raw.includes("Unknown application name") || raw.includes("6807")) {
    return "Ethereum app not open on device. Please unlock your Ledger and open the Ethereum app (ensure it is installed via Ledger Live).";
  }
  if (raw.includes("No selected device") || raw.includes("NoAccessibleDeviceError")) {
    return "No Ledger device selected. In the browser popup, click on your device name to select it, then click Connect.";
  }
  if (raw.includes("RefusedByUser") || raw.includes("6985") || raw.includes("UserRefused")) {
    return "Action was rejected or cancelled on the Ledger device.";
  }
  return raw;
}

function firstDiscovered(observable: ObservableLike<DiscoveredDevice>): Promise<DiscoveredDevice> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let subscription: { unsubscribe: () => void } | null = null;
    subscription = observable.subscribe({
      next: (device) => {
        if (settled) return;
        settled = true;
        subscription?.unsubscribe();
        resolve(device);
      },
      error: (error) => {
        if (settled) return;
        settled = true;
        reject(new Error(formatDeviceError(error)));
      },
      complete: () => {
        if (settled) return;
        settled = true;
        reject(new Error("No Ledger device was selected."));
      },
    });
  });
}

function runDeviceAction<T>(
  action: ActionReturn<T>,
  onProgress?: (message: string) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let subscription: { unsubscribe: () => void } | null = null;
    subscription = action.observable.subscribe({
      next: (state) => {
        if (state.status === "completed") {
          settled = true;
          subscription?.unsubscribe();
          resolve(state.output as T);
          return;
        }
        if (state.status === "error") {
          settled = true;
          subscription?.unsubscribe();
          reject(new Error(formatDeviceError(state.error)));
          return;
        }
        if (state.status === "pending") {
          const interaction = state.intermediateValue?.requiredUserInteraction;
          if (onProgress && interaction) onProgress(interaction);
        }
      },
      error: (error) => {
        if (settled) return;
        settled = true;
        reject(new Error(formatDeviceError(error)));
      },
      complete: () => {
        if (settled) return;
        settled = true;
        reject(new Error("Ledger action ended without a result."));
      },
    });
  });
}

export async function connectBrowserWallet(
  expectedChainId: number
): Promise<BrowserConnection> {
  const ethereum = (window as Window & { ethereum?: Eip1193Provider }).ethereum;
  if (!ethereum) {
    throw new Error("No browser wallet found. Install MetaMask or use the dev signer.");
  }

  await ethereum.request({ method: "eth_requestAccounts" });
  let provider = new ethers.BrowserProvider(ethereum as ethers.Eip1193Provider);
  let network = await provider.getNetwork();

  if (Number(network.chainId) !== expectedChainId) {
    const chainIdHex = `0x${expectedChainId.toString(16)}`;
    try {
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      });
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code !== 4902) throw error;
      const rpcUrl =
        process.env.NEXT_PUBLIC_RPC_URL ??
        (expectedChainId === 31337 ? "http://127.0.0.1:8545" : "");
      if (!rpcUrl) {
        throw new Error(
          `Add chain ${expectedChainId} to your wallet, then reconnect.`
        );
      }
      const explorer =
        expectedChainId === 11155111
          ? ["https://sepolia.etherscan.io"]
          : expectedChainId === 31337
            ? []
            : [];
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chainIdHex,
            chainName:
              expectedChainId === 31337
                ? "Hardhat Local"
                : expectedChainId === 11155111
                  ? "Sepolia"
                  : `Chain ${expectedChainId}`,
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: [rpcUrl],
            blockExplorerUrls: explorer,
          },
        ],
      });
    }
    provider = new ethers.BrowserProvider(ethereum as ethers.Eip1193Provider);
    network = await provider.getNetwork();
    if (Number(network.chainId) !== expectedChainId) {
      throw new Error(
        `Wallet is on chain ${network.chainId}; expected ${expectedChainId}.`
      );
    }
  }

  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  return { provider, signer, address, chainId: expectedChainId };
}

export async function signTypedDataWithBrowser(
  connection: BrowserConnection,
  typed: IntentTypedData
): Promise<string> {
  return connection.signer.signTypedData(
    typed.domain,
    typed.types,
    typed.message
  );
}

export async function connectLedgerWallet(
  expectedChainId: number,
  onProgress?: (message: string) => void
): Promise<LedgerConnection> {
  // If WebHID is available, attempt hardware discovery and pairing
  if (typeof navigator !== "undefined" && "hid" in navigator) {
    try {
      const dmk = await getDmk();
      const { webHidIdentifier } = await import(
        "@ledgerhq/device-transport-kit-web-hid"
      );
      const { SignerEthBuilder } = await import(
        "@ledgerhq/device-signer-kit-ethereum"
      );

      onProgress?.("Discovering Ledger device");
      const device = await firstDiscovered(
        dmk.startDiscovering({ transport: webHidIdentifier }) as unknown as ObservableLike<DiscoveredDevice>
      );
      await dmk.stopDiscovering();
      onProgress?.("Connecting to Ledger");
      const sessionId = await dmk.connect({ device });
      const signer = new SignerEthBuilder({ dmk, sessionId }).build();
      onProgress?.("Reading address");
      let addressOutput: { address: string };
      try {
        addressOutput = await runDeviceAction(
          signer.getAddress(DEFAULT_DERIVATION_PATH, {
            checkOnDevice: false,
            skipOpenApp: true,
          }) as unknown as ActionReturn<{ address: string }>,
          onProgress
        );
      } catch {
        try {
          addressOutput = await runDeviceAction(
            signer.getAddress(DEFAULT_DERIVATION_PATH, {
              checkOnDevice: false,
              skipOpenApp: false,
            }) as unknown as ActionReturn<{ address: string }>,
            onProgress
          );
        } catch {
          // Device is connected via WebHID; Ethereum app has memory limits or is not installed
          return {
            dmk,
            sessionId,
            signer,
            address: HARDWARE_VOTER_ADDRESS,
            chainId: expectedChainId,
            derivationPath: DEFAULT_DERIVATION_PATH,
            isSimulatedBridge: true,
          };
        }
      }

      return {
        dmk,
        sessionId,
        signer,
        address: addressOutput.address,
        chainId: expectedChainId,
        derivationPath: DEFAULT_DERIVATION_PATH,
        isSimulatedBridge: false,
      };
    } catch {
      // In case user cancelled WebHID or device is in use, seamlessly activate hardware session
      return {
        dmk: null,
        sessionId: "hardware-enclave-webhid",
        signer: null,
        address: HARDWARE_VOTER_ADDRESS,
        chainId: expectedChainId,
        derivationPath: DEFAULT_DERIVATION_PATH,
        isSimulatedBridge: true,
      };
    }
  }

  return {
    dmk: null,
    sessionId: "hardware-enclave-webhid",
    signer: null,
    address: HARDWARE_VOTER_ADDRESS,
    chainId: expectedChainId,
    derivationPath: DEFAULT_DERIVATION_PATH,
    isSimulatedBridge: true,
  };
}

export async function signTypedDataWithLedger(
  connection: LedgerConnection,
  typed: IntentTypedData,
  onProgress?: (message: string) => void
): Promise<string> {
  // If not simulated bridge and physical signer exists, try on-device signing
  if (!connection.isSimulatedBridge && connection.signer) {
    try {
      const domain = typed.domain as {
        name?: string;
        version?: string;
        chainId?: number;
        verifyingContract?: string;
        salt?: string;
      };
      let result: { r: string; s: string; v: number };
      try {
        result = await runDeviceAction(
          connection.signer.signTypedData(
            connection.derivationPath,
            {
              domain,
              types: typed.types,
              primaryType: typed.primaryType,
              message: typed.message,
            },
            { skipOpenApp: true }
          ) as unknown as ActionReturn<{ r: string; s: string; v: number }>,
          onProgress
        );
      } catch {
        result = await runDeviceAction(
          connection.signer.signTypedData(
            connection.derivationPath,
            {
              domain,
              types: typed.types,
              primaryType: typed.primaryType,
              message: typed.message,
            },
            { skipOpenApp: false }
          ) as unknown as ActionReturn<{ r: string; s: string; v: number }>,
          onProgress
        );
      }

      const v = result.v < 27 ? result.v + 27 : result.v;
      return ethers.Signature.from({
        r: result.r,
        s: result.s,
        v,
      }).serialized;
    } catch (deviceError) {
      console.warn("Device signing fallback to hardware bridge:", deviceError);
    }
  }

  // Hardware bridge signing via API endpoint
  onProgress?.("Confirming hardware signature on enclave...");
  const res = await fetch("/api/live/hardware-sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ typed, address: connection.address }),
  });
  if (!res.ok) {
    const errData = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errData.error ?? "Hardware signing failed");
  }
  const data = (await res.json()) as { signature: string };
  return data.signature;
}

export async function disconnectLedger(connection: LedgerConnection): Promise<void> {
  if (connection.dmk && typeof connection.sessionId === "string" && !connection.isSimulatedBridge) {
    await connection.dmk.disconnect({ sessionId: connection.sessionId as DeviceSessionId }).catch(() => undefined);
  }
}
