import { notFound } from "next/navigation";
import { getDemo } from "@/lib/demo";
import { ArenaDetail } from "@/components/ArenaDetail";

export const metadata = { title: "Violation report" };

export function generateStaticParams() {
  return getDemo().scenarioRows.map((row) => ({ id: row.scenario.id }));
}

export default async function ArenaScenarioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const demo = getDemo();
  const row = demo.scenarioRows.find((candidate) => candidate.scenario.id === id);

  if (!row) notFound();

  return <ArenaDetail scenarioId={id} />;
}
