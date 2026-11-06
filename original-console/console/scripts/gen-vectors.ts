import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildVectorInputs } from "../packages/shared/hash-vectors";

const inputs = buildVectorInputs();

const output = {
  schema: "aegis-hash-vectors/v1",
  generatedBy: "scripts/gen-vectors.ts",
  note:
    "TypeScript reference vectors. Byte-parity with a Solidity implementation is TEST_REQUIRED until Person A's contract vectors land. Do not change these hashes without announcing it.",
  inputs: {
    intent: inputs.intent,
    calls: inputs.calls.map((call) => ({
      target: call.target,
      value: call.value.toString(),
      data: call.data,
    })),
    disclosure: inputs.disclosure,
    calldata: "0x12345678",
    docText: "aegisdao vector document\n",
  },
  expected: inputs.expected,
};

writeFileSync(
  join(process.cwd(), "packages", "shared", "fixtures", "hash-vectors.json"),
  `${JSON.stringify(output, null, 2)}\n`,
  "utf8",
);

console.log("Wrote hash vectors:");
for (const [key, value] of Object.entries(inputs.expected)) {
  console.log(`  ${key.padEnd(16)} ${value}`);
}
