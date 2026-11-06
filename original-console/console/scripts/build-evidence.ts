import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildMerkleProof, buildMerkleTree } from "../evidence/merkle";
import { computeDocHash } from "../packages/shared/hash";
import type { EvidenceManifest } from "../packages/shared/evidence";

const root = process.cwd();
const documentsDir = join(root, "evidence", "documents");
const outputDir = join(root, "packages", "shared", "fixtures");

const definitions = [
  {
    key: "forum-post",
    title: "AIP-042 forum post",
    filename: "forum-post.md",
    mime: "text/markdown",
    pageCount: 1,
  },
  {
    key: "growthlabs-letter",
    title: "GrowthLabs grant letter",
    filename: "growthlabs-letter.md",
    mime: "text/markdown",
    pageCount: 2,
  },
  {
    key: "financial-model",
    title: "Financial assumptions",
    filename: "financial-model.csv",
    mime: "text/csv",
    pageCount: 1,
  },
  {
    key: "technical-assessment",
    title: "Technical assessment",
    filename: "technical-assessment.md",
    mime: "text/markdown",
    pageCount: 2,
  },
] as const;

const docs = definitions.map((definition) => {
  const text = readFileSync(join(documentsDir, definition.filename), "utf8");
  return {
    key: definition.key,
    title: definition.title,
    filename: definition.filename,
    mime: definition.mime,
    pageCount: definition.pageCount,
    text,
    bytes: Buffer.byteLength(text, "utf8"),
    docHash: computeDocHash(text),
  };
});

const tree = buildMerkleTree(docs.map((doc) => doc.docHash));
const proofs = Object.fromEntries(
  docs.map((doc, index) => [doc.key, buildMerkleProof(tree, index)]),
);

const manifest: EvidenceManifest = {
  root: tree.root,
  generator: "scripts/build-evidence.ts",
  generatedAt: new Date().toISOString(),
  docs,
  proofs,
};

mkdirSync(outputDir, { recursive: true });
writeFileSync(
  join(outputDir, "evidence-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(`Evidence root: ${manifest.root}`);
for (const doc of docs) {
  console.log(`  ${doc.key.padEnd(22)} ${doc.docHash}  ${doc.bytes} bytes`);
}
