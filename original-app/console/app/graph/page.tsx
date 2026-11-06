import { PageHeader } from "@/components/ui";
import { GraphView } from "./GraphView";

export const metadata = { title: "Wallet graph" };

export default function GraphPage() {
  return (
    <>
      <PageHeader
        title="Disclosure graph"
        description="Four links, noisy-OR risk 0.88. Two wallets were disclosed; the graph finds three more. It is a risk signal with transactions attached, not a finding of wrongdoing."
        meta={
          <>
            <span className="doc-folio">AIP-042</span>
            <span className="doc-folio text-danger">simulated data</span>
            <span className="doc-folio">4 links</span>
          </>
        }
        actions={
          <>
            <a href="#challenge" className="arrow-link">
              Challenge payload
            </a>
            <a href="#links" className="arrow-link">
              Link evidence
            </a>
          </>
        }
      />
      <GraphView />
    </>
  );
}
