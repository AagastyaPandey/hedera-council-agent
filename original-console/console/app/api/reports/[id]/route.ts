import { errorMessage, findReport, parseScenarioId } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
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
    const report = findReport(scenarioId);
    if (!report) {
      return Response.json(
        { error: `No report found for scenario ${scenarioId}` },
        { status: 404 }
      );
    }
    return Response.json(report);
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
