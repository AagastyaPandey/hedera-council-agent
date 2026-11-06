"use client";

import { ArenaControl } from "@/components/ArenaControl";
import { PageHeader } from "@/components/ui/PageHeader";

export default function ArenaPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Adversarial verification"
        title="Red-Team Arena"
        description="Run each attack against the scenario suite. The scorecard updates from the result; a benign run must succeed."
      />
      <ArenaControl />
    </div>
  );
}
