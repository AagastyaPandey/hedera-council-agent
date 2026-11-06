import Link from "next/link";
import { getDemo } from "@/lib/demo";
import { ModelBadge, PageHeader } from "@/components/ui";
import { ArenaRunner } from "./ArenaRunner";

export const metadata = { title: "Red-team arena" };

export default function ArenaPage() {
  const demo = getDemo();
  const summary = demo.arenaSummary;
  const executorCount = demo.scenarioRows.filter(
    (row) => row.scenario.layer === "executor",
  ).length;
  const sentinelCount = demo.scenarioRows.filter(
    (row) => row.scenario.layer === "sentinel",
  ).length;
  const disclosureCount = demo.scenarioRows.filter(
    (row) => row.scenario.layer === "disclosure",
  ).length;

  return (
    <>
      <PageHeader
        title="Red-team arena"
        description={`Eleven scenarios: ${executorCount} executor, ${sentinelCount} Sentinel, ${disclosureCount} disclosure. Each row prints expected next to actual, and every verdict carries its layer.`}
        meta={
          <>
            <ModelBadge />
            <span className="doc-folio">No chain running</span>
          </>
        }
        actions={
          <>
            <Link href="/arena/03-jargon-upgrade" className="btn btn-primary">
              Trace scenario 03
            </Link>
            <a href="#scenarios" className="arrow-link">
              Scenario ledger
            </a>
          </>
        }
      />

      <div className="mb-6 border-l-2 border-danger pl-3 text-[12px] leading-relaxed text-dim">
        <span className="text-danger">Reference model.</span> Verdicts come from
        calldata encoding and rule checks in TypeScript. No chain is running here;
        the live local chain is at{" "}
        <Link href="/live" className="underline decoration-danger/40 underline-offset-2">
          /live
        </Link>
        .
      </div>

      <p className="doc-folio mb-6">
        {summary.total} scenarios, {summary.rejected} rejected ·{" "}
        {summary.flagged} flagged, {summary.passed} passed ·{" "}
        {summary.mismatches} mismatches
      </p>

      <ArenaRunner />
    </>
  );
}
