import { PageHeader } from "@/components/ui";
import { VoteView } from "./VoteView";
import { getDemo } from "@/lib/demo";
import { formatPercent } from "@/packages/shared/format";

const demo = getDemo();

export const metadata = { title: "Informed voting" };

export default function VotePage() {
  return (
    <>
      <PageHeader
        title="Vote record"
        description="59% of cast weight saw the current brief. One 90,000-weight FOR voter overlaps a flagged wallet. The execution gate stays on the ballot."
        meta={
          <>
            <span className="doc-folio">AIP-042</span>
            <span className="doc-folio">
              informed {formatPercent(demo.voting.metrics.informedRatio)}
            </span>
            <span className="doc-folio text-danger">execution blocked</span>
          </>
        }
        actions={
          <>
            <a href="#brief" className="arrow-link">
              Read the brief
            </a>
            <a href="#cast" className="btn btn-primary">
              Cast a vote
            </a>
          </>
        }
      />
      <VoteView />
    </>
  );
}
