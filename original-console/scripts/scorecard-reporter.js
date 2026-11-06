/**
 * Mocha reporter that emits the Governance Security Scorecard (bill of
 * work-division schema (d)):
 *
 *   [{ id, property, status: "PASS" | "FAIL" | "TEST_REQUIRED",
 *      testFile, durationMs }]
 *
 * Scenario tests opt in by prefixing their title with "[S<n>]". Every
 * scenario listed in packages/shared/scenarios.json is emitted; any scenario
 * without a passing test is reported as TEST_REQUIRED, never as a pass.
 */

const fs = require("fs");
const path = require("path");
const Mocha = require("mocha");

const ROOT = path.join(__dirname, "..");
const SCENARIOS = require(path.join(ROOT, "packages/shared/scenarios.json"));
const OUT_PATH = path.join(ROOT, "packages/shared/scorecard.json");

const TITLE_PATTERN = /^\[S(\d+)\]/;

class ScorecardReporter extends Mocha.reporters.Spec {
  constructor(runner, options) {
    super(runner, options);

    /** @type {Map<number, {passed: number, failed: number, pending: number, durationMs: number}>} */
    const results = new Map();
    const record = (test, key) => {
      const match = TITLE_PATTERN.exec(test.title || "");
      if (!match) return;

      const id = Number(match[1]);
      const entry =
        results.get(id) ||
        { passed: 0, failed: 0, pending: 0, durationMs: 0 };
      entry[key] += 1;
      entry.durationMs += test.duration || 0;
      results.set(id, entry);
    };

    runner.on("pass", (test) => record(test, "passed"));
    runner.on("fail", (test) => record(test, "failed"));
    runner.on("pending", (test) => record(test, "pending"));

    runner.on("end", () => {
      const scorecard = SCENARIOS.map((scenario) => {
        const entry = results.get(scenario.id);
        let status = "TEST_REQUIRED";
        if (entry) {
          if (entry.failed > 0) status = "FAIL";
          else if (entry.passed > 0 && entry.pending === 0) status = "PASS";
        }
        return {
          id: `S${scenario.id}`,
          property: scenario.property,
          status,
          testFile: scenario.testFile,
          durationMs: entry ? Math.round(entry.durationMs) : 0,
        };
      });

      fs.writeFileSync(OUT_PATH, JSON.stringify(scorecard, null, 2) + "\n");

      console.log("\nGovernance Security Scorecard");
      for (const row of scorecard) {
        console.log(
          `  ${row.id.padEnd(4)} ${row.status.padEnd(14)} ${String(
            row.durationMs
          ).padStart(6)}ms  ${row.property}`
        );
      }
      console.log(`\n  Written to ${OUT_PATH}`);
    });
  }
}

module.exports = ScorecardReporter;
