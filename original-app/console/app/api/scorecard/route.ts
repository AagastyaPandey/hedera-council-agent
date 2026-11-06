import { errorMessage, readScorecard } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(readScorecard());
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
