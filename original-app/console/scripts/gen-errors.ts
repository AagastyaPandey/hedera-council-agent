import { ERROR_DEFINITIONS } from "../packages/shared/addresses";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const output = {
  generatedBy: "scripts/gen-errors.ts",
  note: "Custom error selectors are stable. Person B maps these selectors to human text; Person A must not rename them without announcing it.",
  errors: ERROR_DEFINITIONS,
};

writeFileSync(
  join(process.cwd(), "packages", "shared", "fixtures", "errors.json"),
  `${JSON.stringify(output, null, 2)}\n`,
  "utf8",
);

console.log(`Wrote ${ERROR_DEFINITIONS.length} error selectors.`);
