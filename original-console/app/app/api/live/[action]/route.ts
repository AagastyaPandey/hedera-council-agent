import { NextResponse } from "next/server";
import {
  liveCastVote,
  liveFileChallenge,
  liveGetDisclosureState,
  liveGetExecutionState,
  liveGetProposals,
  liveGetVersionChain,
  liveGetVotingState,
  livePublishDisclosure,
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

  try {
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
      return NextResponse.json(
        await liveCastVote(body.govId, body.withBrief, briefHash, accountIndex)
      );
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
