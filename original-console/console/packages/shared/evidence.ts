import { verifyMerkleProof } from "../../evidence/merkle";
import { computeDocHash } from "./hash";
import type { Intent, SourceRef, UnresolvedItem, Assumption, ActionSpec } from "./schemas";
import type { Hex } from "viem";

export type EvidenceDocument = {
  key: string;
  title: string;
  filename: string;
  mime: string;
  docHash: Hex;
  bytes: number;
  pageCount: number;
  text: string;
};

export type EvidenceManifest = {
  root: Hex;
  generator: string;
  generatedAt: string;
  docs: EvidenceDocument[];
  proofs: Record<string, Hex[]>;
};

export function findDoc(manifest: EvidenceManifest, docKey: string): EvidenceDocument {
  const doc = manifest.docs.find((candidate) => candidate.key === docKey);
  if (!doc) throw new Error(`Unknown evidence document: ${docKey}`);
  return doc;
}

export function hydrateSource(source: SourceRef, manifest: EvidenceManifest): SourceRef {
  const doc = findDoc(manifest, source.docKey);
  const start = doc.text.indexOf(source.quote);
  if (start < 0) {
    throw new Error(`Source quote not found in ${source.docKey}: ${source.quote}`);
  }
  return {
    ...source,
    docHash: doc.docHash,
    span: [start, start + source.quote.length],
  };
}

function hydrateAction(action: ActionSpec, manifest: EvidenceManifest): ActionSpec {
  return {
    ...action,
    source: hydrateSource(action.source, manifest),
    children: action.children?.map((child) => hydrateAction(child, manifest)),
  };
}

export function hydrateIntent(intent: Intent, manifest: EvidenceManifest): Intent {
  return {
    ...intent,
    actions: intent.actions.map((action) => hydrateAction(action, manifest)),
    unresolved: intent.unresolved.map(
      (item: UnresolvedItem): UnresolvedItem => ({
        ...item,
        source: hydrateSource(item.source, manifest),
      }),
    ),
    assumptions: intent.assumptions.map(
      (assumption: Assumption): Assumption => ({
        ...assumption,
        source: hydrateSource(assumption.source, manifest),
      }),
    ),
  };
}

export function verifyDocument(
  doc: EvidenceDocument,
  manifest: EvidenceManifest,
): { hashMatches: boolean; proofValid: boolean; computedHash: Hex; root: Hex } {
  const computedHash = computeDocHash(doc.text);
  const proof = manifest.proofs[doc.key] ?? [];
  return {
    hashMatches: computedHash.toLowerCase() === doc.docHash.toLowerCase(),
    proofValid: verifyMerkleProof(computedHash, proof, manifest.root),
    computedHash,
    root: manifest.root,
  };
}
