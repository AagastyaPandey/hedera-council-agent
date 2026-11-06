/**
 * scripts/decide.ts
 *
 * The local-AI decision CLI: one recommendation in, ACCEPT or DENY out, and
 * for an ACCEPT, the executable plan.
 *
 * No network. No LLM. No API key. The classifier is the 9-feature logistic
 * regression in intelligence/tiny-model.ts; the plan is produced by the
 * repo's own intent-bridge, so a decision never invents an action.
 *
 * Usage:
 *   npm run decide -- "Transfer 5,000 USDC to 0xabc... for the audit"
 *   npm run decide -- --file rec.json
 *   npm run decide -- --fixtures
 *   npm run decide -- --train
 */

import { readFileSync } from "fs";
import * as path from "path";

import {
  decideRecommendation,
  featuresFromRecommendation,
  type Decision,
  type Recommendation,
} from "../intelligence/recommendation";

import {
  DEFAULT_MODEL,
  accuracy,
  modelToJson,
  trainTinyModel,
  type BenefitFeatures,
  type TinyModel,
  type TrainingExample,
} from "../intelligence/tiny-model";

import { bridgeIntent, BridgeError } from "../intelligence/intent-bridge";

// ---------------------------------------------------------------------------
// Terminal helpers
// ---------------------------------------------------------------------------

const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const RED = "\u001b[31m";
const GREEN = "\u001b[32m";
const CYAN = "\u001b[36m";
const RESET = "\u001b[0m";

const FIXTURE_PATH = path.join(__dirname, "..", "intelligence", "fixtures", "recommendations.json");

// ---------------------------------------------------------------------------
// Plan: turn an ACCEPTed recommendation into execution-ready calldata
// ---------------------------------------------------------------------------

export interface Plan {
  intentHash: string;
  actionsHash: string;
  actions: Array<{ target: string; value: string; data: string }>;
}

export function buildPlan(decision: Decision): Plan | { blocked: string[] } {
  try {
    const bridged = bridgeIntent(decision.intent);
    return {
      intentHash: bridged.intentHash,
      actionsHash: bridged.actionsHash,
      actions: bridged.actions.map((action) => ({
        target: action.target,
        value: action.value.toString(),
        data: action.data,
      })),
    };
  } catch (error) {
    if (error instanceof BridgeError) {
      // The unresolved questions live on the intent, not on the error.
      const questions = decision.intent.unresolved.map((item) => item.question);
      return { blocked: questions.length > 0 ? questions : [error.message] };
    }
    throw error;
  }
}

function printPlan(decision: Decision): void {
  const plan = buildPlan(decision);

  if ("blocked" in plan) {
    console.log(`\n${DIM}PLAN${RESET}  ${RED}blocked${RESET} — the recommendation is not specific enough to execute:`);
    for (const question of plan.blocked) console.log(`  ${RED}?${RESET} ${question}`);
    return;
  }

  console.log(`\n${DIM}PLAN${RESET}  ${plan.actions.length} action(s) ready to execute`);
  console.log(`  intentHash   ${plan.intentHash}`);
  console.log(`  actionsHash  ${plan.actionsHash}`);
  plan.actions.forEach((action, index) => {
    console.log(`  [${index}] ${action.target}  value=${action.value}`);
    console.log(`      data=${action.data}`);
  });
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

function loadFixtures(): Array<Recommendation & { id: string; label: 0 | 1 }> {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
}

function decideOne(rec: Recommendation, model: TinyModel): Decision {
  return decideRecommendation(rec, model);
}

function printDecision(decision: Decision): void {
  const colour = decision.decision === "ACCEPT" ? GREEN : RED;
  console.log(`\n${BOLD}${colour}DECISION · ${decision.decision}${RESET}  ${DIM}benefit ${(decision.benefit * 100).toFixed(1)}%${RESET}`);
  console.log(`${DIM}user:${RESET} ${decision.user}`);
  console.log(`\n${decision.recommendation}`);
  console.log(`\n${DIM}WHY${RESET}`);
  for (const reason of decision.reasons) console.log(`  ${reason}`);
  console.log(`\n${DIM}FEATURES${RESET}`);
  for (const [name, value] of Object.entries(decision.features)) {
    console.log(`  ${name.padEnd(20)} ${value.toFixed(3)}`);
  }
}

function runFixtures(): void {
  const fixtures = loadFixtures();
  let correct = 0;

  console.log(`${BOLD}Local AI decision engine — ${fixtures.length} labelled recommendations${RESET}\n`);

  for (const fixture of fixtures) {
    const decision = decideOne(fixture, DEFAULT_MODEL);
    const expected = fixture.label === 1 ? "ACCEPT" : "DENY";
    const ok = decision.decision === expected;
    if (ok) correct++;
    const colour = ok ? GREEN : RED;
    const mark = ok ? "ok" : "MISMATCH";
    console.log(
      `  ${fixture.id.padEnd(4)} ${decision.decision.padEnd(7)} benefit ${(decision.benefit * 100)
        .toFixed(1)
        .padStart(6)}%   expected ${expected.padEnd(7)} ${colour}${mark}${RESET}`
    );
  }

  console.log(
    `\n  ${correct}/${fixtures.length} correct  (${((correct / fixtures.length) * 100).toFixed(1)}%)\n`
  );
}

function runTrain(): void {
  const fixtures = loadFixtures();
  const examples: TrainingExample[] = fixtures.map((fixture) => ({
    features: decisionFeatures(fixture),
    label: fixture.label,
  }));

  const trained = trainTinyModel(examples);
  const score = accuracy(trained, examples);

  console.log(`${BOLD}Trained tiny model${RESET}`);
  console.log(`  examples     ${examples.length}`);
  console.log(`  accuracy     ${(score * 100).toFixed(1)}%`);
  console.log(`  epochs       800   lr 0.25   l2 0.001   (deterministic)`);
  console.log(`\n${modelToJson(trained)}\n`);
}

/** Feature extraction, re-exported so the training path matches the decision path. */
function decisionFeatures(rec: Recommendation): BenefitFeatures {
  // featuresFromRecommendation is the single source of truth for the vector.
  return featuresFromRecommendation(rec);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main(): void {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
  const positional = argv.filter((arg) => !arg.startsWith("--"));

  if (flags.has("--train")) {
    runTrain();
    return;
  }

  if (flags.has("--fixtures")) {
    runFixtures();
    return;
  }

  const fileFlagIndex = argv.indexOf("--file");
  let rec: Recommendation;

  if (fileFlagIndex >= 0) {
    const file = argv[fileFlagIndex + 1];
    if (!file) throw new Error("--file needs a path");
    rec = JSON.parse(readFileSync(file, "utf8"));
  } else if (positional.length > 0) {
    rec = { user: "cli", text: positional.join(" ") };
  } else {
    console.log(
      `${BOLD}Local AI decision engine${RESET}\n\n` +
        `  npm run decide -- "Transfer 5,000 USDC to 0xabc... for the audit"\n` +
        `  npm run decide -- --file rec.json\n` +
        `  npm run decide -- --fixtures\n` +
        `  npm run decide -- --train\n`
    );
    return;
  }

  const decision = decideOne(rec, DEFAULT_MODEL);
  printDecision(decision);
  if (decision.decision === "ACCEPT") printPlan(decision);
  console.log();
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`${RED}error${RESET}: ${(error as Error).message}`);
    process.exit(1);
  }
}
