import { getDemo } from "../lib/demo";

const argument = process.argv[2] ?? "3";
const demo = getDemo();
const row = demo.scenarioRows.find(
  (candidate) => candidate.scenario.id === argument || String(candidate.scenario.index) === argument,
);

if (!row) {
  console.error(
    `Unknown scenario "${argument}". Available: ${demo.scenarioRows
      .map((candidate) => `${candidate.scenario.index}`)
      .join(", ")}`,
  );
  process.exit(1);
}

const { scenario, run } = row;

console.log(`AIP-042 / arena / ${scenario.id}`);
console.log(`Layer: ${run.layer}`);
console.log(`Expected: ${scenario.expected.status} ${scenario.expected.code}`);
console.log(`Actual:   ${run.status} ${run.code} — ${run.label}`);
console.log("");
for (const step of run.steps) {
  console.log(`[${step.status.padEnd(4)}] ${step.label}: ${step.detail}`);
}
console.log("");
console.log("PROPOSAL SAID");
console.log(`  ${run.report.proposalSaid}`);
console.log("");
console.log("ACTUALLY DOES");
for (const action of run.report.submitted) {
  console.log(`  ${action.humanText}`);
  for (const child of action.nested) {
    console.log(`    ↳ ${child.humanText}`);
  }
}
console.log("");
console.log("EVIDENCE");
console.log(`  commitment:          ${run.approvedCommitment}`);
console.log(`  submittedCommitment: ${run.submittedCommitment}`);
console.log(`  calldataHash:        ${run.calldataHash}`);
console.log(`  revertData:          ${run.revertData}`);
console.log(`  txHash:              ${run.txHash ?? "— (not executed)"}`);
console.log(`  traceRef:            ${run.traceRef ?? "—"}`);
console.log("");
console.log("REPORT JSON");
console.log(JSON.stringify(run.report, null, 2));
