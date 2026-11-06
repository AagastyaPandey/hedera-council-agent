import { NextResponse } from "next/server";
import {
  liveAutoHalt,
  liveCastVote,
  liveFileChallenge,
  liveGetAccountState,
  liveGetDisclosureState,
  liveGetExecutionState,
  liveGetProposals,
  liveGetSigningConfig,
  liveGetVersionChain,
  liveGetVotingState,
  livePublishDisclosure,
  liveRelayHalt,
  liveRelayVote,
  liveHardwareSign,
  liveSubmitDisclosure,
  liveVerifyVersionChain,
} from "../../../../lib/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ action: string }> }
) {
  const { action } = await params;
  const search = new URL(request.url).searchParams;
  const proposalId = search.get("proposalId");
  const govId = search.get("govId");
  const commitment = search.get("commitment");
  const voter = search.get("voter");
  const signer = search.get("signer");
  const address = search.get("address");

  try {
    if (action === "account-state" && address) {
      return NextResponse.json(await liveGetAccountState(address));
    }
    if (action === "signing-config" && govId) {
      return NextResponse.json(
        await liveGetSigningConfig({
          govId,
          voter: voter ?? undefined,
          signer: signer ?? undefined,
        })
      );
    }
    if (action === "proposals") {
      return NextResponse.json(await liveGetProposals());
    }
    if (action === "version-chain" && proposalId) {
      return NextResponse.json(await liveGetVersionChain(proposalId));
    }
    if (action === "verify-chain" && proposalId) {
      return NextResponse.json(await liveVerifyVersionChain(proposalId));
    }
    if (action === "disclosure-state" && proposalId) {
      return NextResponse.json(await liveGetDisclosureState(proposalId));
    }
    if (action === "voting-state" && govId) {
      return NextResponse.json(await liveGetVotingState(govId));
    }
    if (action === "execution-state" && commitment) {
      return NextResponse.json(await liveGetExecutionState(commitment));
    }
    return NextResponse.json(
      { error: `Unknown action "${action}" or missing identifier.` },
      { status: 400 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> }
) {
  const { action } = await params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const accountIndex = typeof body.accountIndex === "number" ? body.accountIndex : 0;

    if (
      action === "vote" &&
      typeof body.govId === "string" &&
      typeof body.withBrief === "boolean"
    ) {
      const briefHash = typeof body.briefHash === "string" ? body.briefHash : undefined;
      const support =
        typeof body.support === "number" && [0, 1, 2].includes(body.support)
          ? body.support
          : 1;
      return NextResponse.json(
        await liveCastVote(
          body.govId,
          body.withBrief,
          briefHash,
          accountIndex,
          support
        )
      );
    }

    if (
      action === "relay-vote" &&
      typeof body.govId === "string" &&
      typeof body.voter === "string" &&
      typeof body.support === "number" &&
      [0, 1, 2].includes(body.support) &&
      typeof body.briefHash === "string" &&
      typeof body.statement === "string" &&
      typeof body.nonce === "string" &&
      typeof body.deadline === "string" &&
      typeof body.signature === "string" &&
      (body.signerType === "BROWSER" || body.signerType === "HARDWARE")
    ) {
      return NextResponse.json(
        await liveRelayVote({
          govId: body.govId,
          voter: body.voter,
          support: body.support,
          briefHash: body.briefHash,
          statement: body.statement,
          nonce: body.nonce,
          deadline: body.deadline,
          signature: body.signature,
          signerType: body.signerType,
        })
      );
    }

    if (
      action === "relay-halt" &&
      typeof body.commitment === "string" &&
      typeof body.reportHash === "string" &&
      typeof body.reason === "string" &&
      typeof body.nonce === "string" &&
      typeof body.deadline === "string" &&
      typeof body.signature === "string" &&
      typeof body.signerAddress === "string" &&
      (body.signerType === "BROWSER" || body.signerType === "HARDWARE")
    ) {
      return NextResponse.json(
        await liveRelayHalt({
          commitment: body.commitment,
          reportHash: body.reportHash,
          reason: body.reason,
          nonce: body.nonce,
          deadline: body.deadline,
          signature: body.signature,
          signerType: body.signerType,
          signerAddress: body.signerAddress,
        })
      );
    }

    if (
      action === "auto-halt" &&
      typeof body.commitment === "string" &&
      typeof body.reportHash === "string"
    ) {
      return NextResponse.json(
        await liveAutoHalt({
          commitment: body.commitment,
          reportHash: body.reportHash,
        })
      );
    }

    if (action === "hardware-sign" && body.typed && typeof body.typed === "object") {
      const signature = await liveHardwareSign({
        typed: body.typed as {
          domain: any;
          types: Record<string, any[]>;
          message: Record<string, unknown>;
        },
        address: typeof body.address === "string" ? body.address : undefined,
      });
      return NextResponse.json({ signature });
    }

    if (
      action === "challenge" &&
      typeof body.proposalId === "string" &&
      typeof body.linkEvidenceHash === "string" &&
      typeof body.description === "string"
    ) {
      return NextResponse.json(
        await liveFileChallenge(
          body.proposalId,
          body.linkEvidenceHash,
          body.description,
          accountIndex
        )
      );
    }

    if (
      action === "publish-disclosure" &&
      typeof body.proposalId === "string" &&
      typeof body.walletListHash === "string" &&
      typeof body.interestsHash === "string"
    ) {
      const bond = typeof body.bondAmount === "string" || typeof body.bondAmount === "number"
        ? BigInt(String(body.bondAmount))
        : 0n;
      return NextResponse.json(
        await livePublishDisclosure(
          body.proposalId,
          body.walletListHash,
          body.interestsHash,
          bond,
          accountIndex
        )
      );
    }

    if (
      action === "submit-disclosure" &&
      typeof body.proposalId === "string" &&
      typeof body.proposer === "string" &&
      typeof body.walletListHash === "string" &&
      typeof body.interestsHash === "string"
    ) {
      const bondAmount = BigInt(String(body.bondAmount ?? "0"));
      const nonce = BigInt(String(body.nonce ?? "0"));
      const v = Number(body.v ?? 27);
      const r = String(body.r);
      const s = String(body.s);
      return NextResponse.json(
        await liveSubmitDisclosure(
          body.proposalId,
          body.proposer,
          body.walletListHash,
          body.interestsHash,
          bondAmount,
          nonce,
          v,
          r,
          s,
          accountIndex
        )
      );
    }

    return NextResponse.json({ error: `Invalid live action "${action}" payload.` }, { status: 400 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
