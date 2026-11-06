import { describe, expect, it } from "vitest";
import { hydrateSource, verifyDocument } from "../packages/shared/evidence";
import { buildMerkleProof, buildMerkleTree, verifyMerkleProof } from "../evidence/merkle";
import { computeDocHash } from "../packages/shared/hash";
import { getDemo } from "../lib/demo";

describe("evidence store", () => {
  it("verifies every seeded document against the Merkle root", () => {
    const demo = getDemo();
    expect(demo.manifest.docs).toHaveLength(4);
    for (const doc of demo.manifest.docs) {
      const result = verifyDocument(doc, demo.manifest);
      expect(result.hashMatches).toBe(true);
      expect(result.proofValid).toBe(true);
      expect(result.root).toBe(demo.manifest.root);
    }
  });

  it("fails when a document is tampered with", () => {
    const demo = getDemo();
    const tampered = {
      ...demo.manifest.docs[0],
      text: `${demo.manifest.docs[0].text}silent edit`,
    };
    const result = verifyDocument(tampered, demo.manifest);
    expect(result.hashMatches).toBe(false);
    expect(result.proofValid).toBe(false);
  });

  it("builds short proofs and rejects a tampered proof", () => {
    const leaves = ["a", "b", "c", "d"].map((value) => computeDocHash(value));
    const tree = buildMerkleTree(leaves);
    const proof = buildMerkleProof(tree, 2);
    expect(proof).toHaveLength(2);
    expect(verifyMerkleProof(leaves[2], proof, tree.root)).toBe(true);
    proof[0] = computeDocHash("wrong");
    expect(verifyMerkleProof(leaves[2], proof, tree.root)).toBe(false);
  });

  it("hydrates source spans from exact quotes", () => {
    const demo = getDemo();
    const claim = demo.claims[0];
    const hydrated = hydrateSource(claim.source, demo.manifest);
    const doc = demo.manifest.docs.find((entry) => entry.key === claim.source.docKey)!;
    expect(hydrated.span?.[0]).toBe(doc.text.indexOf(claim.source.quote));
    expect(hydrated.docHash).toBe(doc.docHash);
    expect(() =>
      hydrateSource({ ...claim.source, quote: "this quote does not exist" }, demo.manifest),
    ).toThrow();
  });
});
