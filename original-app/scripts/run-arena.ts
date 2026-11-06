/**
 * Red-Team Arena runner.
 *
 * The arena is the Hardhat test suite: every scenario is a real test that
 * asserts a specific on-chain outcome. There are no hardcoded results here.
 *
 *   npm run arena            # all scenarios, writes packages/shared/scorecard.json
 *   npm run arena -- 3       # run one scenario test file
 *
 * Hardhat 2 does not expose a --reporter flag on its test task, so the suite
 * is driven through Mocha directly with the scorecard reporter attached.
 */

import Mocha from "mocha";
import hre from "hardhat";
import * as path from "path";
import scenarios from "../packages/shared/scenarios.json";

const ROOT = path.join(__dirname, "..");

// Plain CJS module: the reporter extends Mocha's Spec reporter.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ScorecardReporter = require("./scorecard-reporter.js");

async function main(): Promise<number> {
  const scenarioArg = process.argv.slice(2).find((arg) => !arg.startsWith("-"));

  let testTargets = scenarios.map((s) => s.testFile);
  let reporter: unknown = ScorecardReporter;

  if (scenarioArg !== undefined) {
    const scenario = scenarios.find((s) => s.id === Number(scenarioArg));
    if (!scenario) {
      console.error(`Unknown scenario id: ${scenarioArg}`);
      console.error(`Valid ids: ${scenarios.map((s) => s.id).join(", ")}`);
      return 1;
    }
    testTargets = [scenario.testFile];
    // Running one scenario would mark every other property TEST_REQUIRED,
    // so it does not write the full scorecard.
    reporter = undefined;
  }

  console.log(
    scenarioArg === undefined
      ? "\nRunning the full Red-Team Arena suite...\n"
      : `\nRunning Red-Team Arena scenario ${scenarioArg}...\n`
  );

  await hre.run("compile");

  const mocha = new Mocha({
    timeout: 120_000,
    ...(reporter ? { reporter: reporter as any } : {}),
  });
  for (const target of testTargets) {
    mocha.addFile(path.join(ROOT, target));
  }

  return await new Promise<number>((resolve) => {
    mocha.run((failures) => resolve(failures > 0 ? 1 : 0));
  });
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
