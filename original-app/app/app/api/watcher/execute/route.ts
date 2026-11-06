import { NextResponse } from "next/server";
import { ethers } from "ethers";
import {
  bundleToActions,
  bundleToRules,
  getExecutionBundle,
} from "../../../../../sentinel/live-store";
import {
  ProposalState,
  decodeRevert,
  explorerTxUrl,
  getServerSigner,
  getIntentLockExecutor,
  getProvider,
} from "../../../../lib/chain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A manual gas limit is required on Sepolia: without it the node rejects the
// transaction before it is mined, so the failed attempt would have no hash or
// Etherscan link to show.
const FORCED_GAS_LIMIT = 8_000_000n;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { commitment?: unknown };
    if (typeof body.commitment !== "string" || !ethers.isHexString(body.commitment, 32)) {
      return NextResponse.json(
        { error: "A 32-byte commitment is required." },
        { status: 400 }
      );
    }

    const commitment = body.commitment;
    const bundle = getExecutionBundle(commitment);
    if (!bundle) {
      return NextResponse.json(
        { error: "No execution bundle is registered for this commitment." },
        { status: 404 }
      );
    }

    const executor = getIntentLockExecutor();
    const state = Number(await executor.getState(commitment));
    if (state !== ProposalState.Halted) {
      return NextResponse.json(
        {
          error:
            "Forced execution is available only after a guardian halt; the demonstration " +
            "does not submit executable transactions for live proposals.",
        },
        { status: 409 }
      );
    }

    const actions = bundleToActions(bundle);
    const rules = bundleToRules(bundle);
    const signer = await getServerSigner("deployer");
    const from = await signer.getAddress();
    const executorAddress = await executor.getAddress();
    const calldata = executor.interface.encodeFunctionData("execute", [
      BigInt(bundle.proposalId),
      BigInt(bundle.version),
      bundle.versionHash,
      bundle.disclosureHash,
      actions,
      rules,
    ]);

    let revertData = "0x";
    let txHash: string | null = null;
    let receiptStatus: number | null = null;
    const runner = executor.connect(signer) as any;

    try {
      const tx = await runner.execute(
        BigInt(bundle.proposalId),
        BigInt(bundle.version),
        bundle.versionHash,
        bundle.disclosureHash,
        actions,
        rules,
        { gasLimit: FORCED_GAS_LIMIT }
      );
      txHash = tx.hash;
      const receipt = await tx.wait();
      receiptStatus = receipt?.status ?? null;
    } catch (error) {
      txHash = extractTxHash(error) ?? txHash;
      revertData = extractRevertData(error);
    }

    if (revertData === "0x") {
      try {
        await getProvider().call({
          from,
          to: executorAddress,
          data: calldata,
          gasLimit: FORCED_GAS_LIMIT,
        });
      } catch (error) {
        revertData = extractRevertData(error);
      }
    }

    const decoded = decodeRevert(revertData);
    const rejected = receiptStatus !== 1;

    return NextResponse.json(
      {
        status: rejected ? "reverted" : "executed",
        label: rejected ? "Rejected by executor" : "Executor accepted",
        boundary: "executor",
        txHash,
        revertData,
        selector: decoded.selector,
        signature: decoded.signature,
        title: decoded.title,
        explanation: decoded.explanation,
        commitment,
        explorerUrl: txHash ? explorerTxUrl(txHash) : null,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function extractRevertData(error: unknown): string {
  const source = error as {
    data?: unknown;
    error?: { data?: unknown };
    info?: { error?: { data?: unknown } };
    revert?: { data?: unknown };
  };
  const candidates = [
    source?.data,
    source?.error?.data,
    source?.info?.error?.data,
    source?.revert?.data,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.startsWith("0x") && candidate.length >= 10) {
      return candidate;
    }
    if (
      candidate &&
      typeof candidate === "object" &&
      typeof (candidate as { data?: unknown }).data === "string"
    ) {
      return (candidate as { data: string }).data;
    }
  }
  return "0x";
}

function extractTxHash(error: unknown): string | null {
  const source = error as {
    transactionHash?: unknown;
    txHash?: unknown;
    receipt?: { hash?: unknown };
    transaction?: { hash?: unknown };
  };
  const candidates = [
    source?.transactionHash,
    source?.txHash,
    source?.receipt?.hash,
    source?.transaction?.hash,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.startsWith("0x")) return candidate;
  }
  return null;
}
