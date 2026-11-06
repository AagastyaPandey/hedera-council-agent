import { PageHeader } from "@/components/ui";
import { TimelineView } from "./TimelineView";

export const metadata = { title: "Proposal timeline" };

export default function TimelinePage() {
  return (
    <>
      <PageHeader
        title="Version history"
        description="v2 raised the GrowthLabs amount and added two actions. v3 added the technical assessment. The rules did not change between v2 and v3; the content hash and evidence root did."
        meta={
          <>
            <span className="doc-folio">AIP-042</span>
            <span className="doc-folio">3 versions</span>
            <span className="doc-folio">4 evidence documents</span>
          </>
        }
        actions={
          <>
            <a href="#evidence" className="arrow-link">
              Verify evidence
            </a>
            <a href="#disclosure" className="arrow-link">
              Disclosure
            </a>
          </>
        }
      />
      <TimelineView />
    </>
  );
}
