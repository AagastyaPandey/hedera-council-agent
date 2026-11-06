"use client";

import { Scorecard } from "@/components/Scorecard";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SCENARIO_IDS } from "@/lib/data";

export default function ScorecardPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Security scorecard"
        title="Governance security properties"
        description="Results emitted by the Red-Team runner. TEST_REQUIRED is amber, never green."
        actions={
          <StatusBadge tone="info">{SCENARIO_IDS.length} scenarios</StatusBadge>
        }
      />
      <Scorecard />
    </div>
  );
}
