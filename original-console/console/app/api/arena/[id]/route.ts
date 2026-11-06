import { errorMessage, parseScenarioId, runScenario } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const scenarioId = parseScenarioId(id);
  if (scenarioId === null) {
    return Response.json(
      { error: `Scenario id must be an integer from 0 to 10 (received "${id}")` },
      { status: 400 }
    );
  }

  try {
    const result = await runScenario(scenarioId);
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
