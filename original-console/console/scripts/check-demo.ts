import { getDemo } from "../lib/demo";

const demo = getDemo();

console.log("validation", {
  ok: demo.validation.ok,
  claims: demo.validation.totalClaims,
  linked: demo.validation.sourceLinked,
  rejected: demo.validation.rejected,
  warnings: demo.validation.warnings.length,
  actions: demo.validation.actionCount,
});

console.log("hashes", {
  intentHash: demo.intentHash,
  contentHash: demo.contentHash,
  actionsHash: demo.actionsHash,
  commitment: demo.commitment,
  disclosureHash: demo.disclosureHash,
  briefHash: demo.briefHash,
  evidenceRoot: demo.manifest.root,
});

console.log("claims", {
  committed: demo.claimsScoreCommitted,
  extracted: demo.claimsScoreAsExtracted,
});

console.log("coi", {
  risk: demo.graph.overallRisk,
  status: demo.graph.status,
  links: demo.graph.links.map((link) => ({
    type: link.type,
    strength: link.strength,
    evidence: link.evidenceEdgeIds,
  })),
});

console.log("voting", demo.voting.score, demo.voting.status, demo.voting.reason, demo.voting.metrics);

console.log("versions", demo.versions.map((version) => ({
  version: version.version,
  intentHash: version.intentHash,
  contentHash: version.contentHash,
  prev: version.prevVersionHash,
  evidenceRoot: version.evidenceRoot,
  technical: version.technicalAssessmentHash,
  assumptions: version.assumptions.map((a) => a.name),
})));

console.log("brief", {
  total: demo.brief.totalGrantsUsdc,
  runwayBefore: demo.brief.runwayBeforeMonths,
  runwayAfter: demo.brief.runwayAfterMonths,
  figures: demo.brief.figures.map((f) => ({ label: f.label, value: f.value, span: f.source.span })),
});

console.log("scenarios");
for (const row of demo.scenarioRows) {
  console.log(
    row.scenario.id,
    "expected",
    row.scenario.expected.status,
    row.scenario.expected.code,
    "actual",
    row.run.status,
    row.run.code,
    "match",
    row.matchesExpected,
    "msg",
    row.run.message.slice(0, 120),
  );
  if (!row.matchesExpected) {
    console.log("  steps", row.run.steps);
  }
}

console.log("chain", demo.chain.stages.map((stage) => ({
  stage: stage.stage,
  score: stage.score,
  status: stage.status,
  reason: stage.reason,
})));

console.log("main report", JSON.stringify(demo.mainRun.report, null, 2).slice(0, 1500));
