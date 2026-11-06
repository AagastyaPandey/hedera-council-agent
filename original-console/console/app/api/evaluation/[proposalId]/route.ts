import { NextResponse } from "next/server";
import { liveGetEvaluationChain } from "../../../../lib/live";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ proposalId: string }> }
) {
  const { proposalId } = await params;
  try {
    const chain = await liveGetEvaluationChain(proposalId);
    return NextResponse.json(chain);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}