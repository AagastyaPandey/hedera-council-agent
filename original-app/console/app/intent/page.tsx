import { PageHeader } from "@/components/ui";
import { IntentReview } from "./IntentReview";

export const metadata = { title: "Intent review" };

export default function IntentPage() {
  return (
    <>
      <PageHeader
        title="Intent review"
        description="Seven claims, two unresolved. The reviewer's choices change the rule set, the intent hash and the commitment."
        meta={
          <>
            <span className="doc-folio">AIP-042</span>
            <span className="doc-folio">v3</span>
            <span className="doc-folio">pre-baked extraction, validator live</span>
          </>
        }
        actions={
          <>
            <a href="#claims" className="arrow-link">
              Claims
            </a>
            <a href="#review" className="arrow-link">
              Resolve ambiguities
            </a>
          </>
        }
      />
      <IntentReview />
    </>
  );
}
