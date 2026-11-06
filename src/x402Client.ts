// Fresh code, written 2026-11-06 for ETHGlobal Mumbai.
// Agent-side x402 client: pays for a proposal check through the real
// x402 protocol v2, via the official facilitator.
// Uses @x402/fetch wrapFetchWithPayment with an @x402/hedera Exact
// scheme signer. On 402 the client signs a USDC transfer to the seller,
// retries with the payment header, and the seller's middleware has the
// facilitator verify and settle it on Hedera. The settlement (with the
// Hedera transaction id) comes back in the PAYMENT-RESPONSE header.

import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { createClientHederaSigner } from "@x402/hedera";
import { PrivateKey } from "@hiero-ledger/sdk";

export interface X402Settlement {
  success: boolean;
  transaction: string;
  network: string;
  payer?: string;
  errorReason?: string;
}

export async function x402Check(
  url: string,
  proposal: unknown,
  config: {
    accountId: string;
    privateKey: string;
    network: "hedera:testnet" | "hedera:mainnet";
    maxAmountAtomic: number;
  },
): Promise<{ status: number; body: unknown; settlement: X402Settlement | null }> {
  const signer = createClientHederaSigner(config.accountId, PrivateKey.fromString(config.privateKey), {
    network: config.network,
  });
  const client = new x402Client()
    .register(config.network, new ExactHederaScheme(signer))
    // Never pay more than the configured check price, whatever the seller asks.
    .registerPolicy((_version, reqs) => reqs.filter((r) => BigInt(r.amount) <= BigInt(config.maxAmountAtomic)));
  const fetchWithPay = wrapFetchWithPayment(fetch, client);
  const res = await fetchWithPay(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(proposal),
  });
  const body: unknown = await res.json().catch(() => null);
  const header = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
  const settlement = header ? (decodePaymentResponseHeader(header) as X402Settlement) : null;
  return { status: res.status, body, settlement };
}
