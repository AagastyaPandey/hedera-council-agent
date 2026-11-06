import { PageHeader } from "@/components/ui";
import { ScorecardView } from "./ScorecardView";
import scorecardJson from "@/packages/shared/fixtures/scorecard.json";
import type { ScorecardEntry } from "@/packages/shared/schemas";

const entries = scorecardJson as unknown as ScorecardEntry[];
const failed = entries.filter((entry) => entry.status === "FAIL").length;
const required = entries.filter((entry) => entry.status === "TEST_REQUIRED").length;

export const metadata = { title: "Security scorecard" };

export default function ScorecardPage() {
  return (
    <>
      <PageHeader
        title="Scorecard"
        description="25 pass, 0 fail, 9 require the Solidity layer. Rows marked TEST_REQUIRED are not green and will not be until the contracts land."
        meta={
          <>
            <span className="doc-folio">{entries.length} properties</span>
            <span className="doc-folio">{failed} failed</span>
            <span className="doc-folio text-danger">{required} required</span>
            <span className="doc-folio">reference model</span>
          </>
        }
        actions={
          <>
            <a href="#checks" className="arrow-link">
              Checks
            </a>
            <a href="#gaps" className="arrow-link">
              Gaps
            </a>
          </>
        }
      />
      <ScorecardView />
    </>
  );
}
