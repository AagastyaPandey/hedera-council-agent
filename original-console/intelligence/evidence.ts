/**
 * intelligence/evidence.ts
 *
 * Content-addressed document store + OpenZeppelin-compatible Merkle manifest.
 *
 * addDocument(content)          -> keccak256 docHash, file persisted to intelligence/store/<hash>
 * buildManifest()               -> { evidenceRoot, leaves, docHashes }
 * getProof(docHash)             -> bytes32[] sibling proof
 * verifyProof(root,proof,leaf)  -> boolean
 * verifySource({ docHash, span }) -> boolean  (re-hashes content, validates span bounds)
 *
 * OZ MerkleProof compatibility:
 *   Leaves sorted lexicographically before tree construction.
 *   Pair hash = keccak256(abi.encodePacked(min, max)) matching OZ _hashPair.
 */

import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { verifySourceContent } from "./evidence-verify";

const DEFAULT_STORE_DIR = path.join(__dirname, "store");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvidenceManifest {
  evidenceRoot: string;
  leaves: string[];
  docHashes: string[];
}

export interface VerifySourceInput {
  docHash: string;
  /** Byte span [start, end). end is exclusive. */
  span: [number, number];
}

export interface EvidenceStoreOptions {
  storeDir?: string;
  /** Skip disk I/O (unit tests). */
  memoryOnly?: boolean;
}

// ---------------------------------------------------------------------------
// EvidenceStore
// ---------------------------------------------------------------------------

export class EvidenceStore {
  private readonly storeDir: string;
  private readonly memoryOnly: boolean;
  private readonly cache = new Map<string, Buffer>();
  private manifest: EvidenceManifest | null = null;

  constructor(options: EvidenceStoreOptions = {}) {
    this.storeDir = options.storeDir ?? DEFAULT_STORE_DIR;
    this.memoryOnly = options.memoryOnly ?? false;
    if (!this.memoryOnly) {
      fs.mkdirSync(this.storeDir, { recursive: true });
    }
  }

  /**
   * Store a document and return its keccak256 hash.
   * Idempotent: re-adding the same content returns the same hash.
   */
  addDocument(content: string | Uint8Array): string {
    const buf: Buffer =
      typeof content === "string"
        ? Buffer.from(content, "utf8")
        : Buffer.from(content);

    const docHash = ethers.keccak256(buf);
    if (!this.cache.has(docHash)) {
      this.cache.set(docHash, buf);
      if (!this.memoryOnly) {
        fs.writeFileSync(path.join(this.storeDir, docHash), buf);
      }
      this.manifest = null; // invalidate
    }
    return docHash;
  }

  /** Build (or return cached) the Merkle manifest over all stored docHashes. */
  buildManifest(): EvidenceManifest {
    if (this.manifest) return this.manifest;
    const docHashes = [...this.cache.keys()].sort();
    const root = buildMerkleRoot(docHashes);
    this.manifest = { evidenceRoot: root, leaves: docHashes, docHashes };
    return this.manifest;
  }

  /** Return the Merkle sibling proof for a given docHash. */
  getProof(docHash: string): string[] {
    const { docHashes } = this.buildManifest();
    const idx = docHashes.indexOf(docHash);
    if (idx === -1) throw new Error(`docHash not found in manifest: ${docHash}`);
    return getMerkleProof(docHashes, idx);
  }

  /** Verify a proof against the current manifest root. */
  verifyProof(proof: string[], leaf: string): boolean {
    const { evidenceRoot } = this.buildManifest();
    return verifyMerkleProof(evidenceRoot, proof, leaf);
  }

  /**
   * Re-hash stored content and confirm the cited span exists within it.
   * Returns false (never throws) for any failure mode.
   */
  verifySource({ docHash, span }: VerifySourceInput): boolean {
    const buf = this.load(docHash);
    return buf ? verifySourceContent(buf, { docHash, span }) : false;
  }

  private load(docHash: string): Buffer | null {
    if (this.cache.has(docHash)) return this.cache.get(docHash)!;
    if (!this.memoryOnly) {
      const fp = path.join(this.storeDir, docHash);
      if (fs.existsSync(fp)) {
        const buf = fs.readFileSync(fp);
        this.cache.set(docHash, buf);
        return buf;
      }
    }
    return null;
  }

  get knownHashes(): string[] {
    return [...this.cache.keys()];
  }
}

// ---------------------------------------------------------------------------
// Standalone Merkle helpers
// ---------------------------------------------------------------------------

/**
 * OZ-compatible pair hash: keccak256(abi.encodePacked(min(a,b), max(a,b)))
 * Sorting by lowercase hex ensures determinism regardless of call order.
 */
export function hashPair(a: string, b: string): string {
  const [lo, hi] = a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([lo, hi]));
}

/**
 * Build a Merkle root from pre-sorted bytes32 leaf strings.
 * Empty array -> ethers.ZeroHash (a known UNKNOWN sentinel, not a pass state).
 */
export function buildMerkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return ethers.ZeroHash;
  if (leaves.length === 1) return leaves[0];

  let layer = [...leaves];
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 < layer.length) {
        next.push(hashPair(layer[i], layer[i + 1]));
      } else {
        next.push(layer[i]); // odd leaf promoted
      }
    }
    layer = next;
  }
  return layer[0];
}

/**
 * Generate the Merkle proof (sibling path) for leaves[index].
 */
export function getMerkleProof(leaves: string[], index: number): string[] {
  if (index < 0 || index >= leaves.length) {
    throw new RangeError(`Index ${index} out of range for ${leaves.length} leaves`);
  }
  const proof: string[] = [];
  let layer = [...leaves];
  let idx = index;

  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 < layer.length) {
        next.push(hashPair(layer[i], layer[i + 1]));
        if (i === idx) {
          proof.push(layer[i + 1]);
          idx = next.length - 1;
        } else if (i + 1 === idx) {
          proof.push(layer[i]);
          idx = next.length - 1;
        }
      } else {
        next.push(layer[i]);
        if (i === idx) idx = next.length - 1;
      }
    }
    layer = next;
  }
  return proof;
}

/** Verify a Merkle proof: recompute root from leaf + siblings, compare. */
export function verifyMerkleProof(
  expectedRoot: string,
  proof: string[],
  leaf: string
): boolean {
  let hash = leaf;
  for (const sibling of proof) {
    hash = hashPair(hash, sibling);
  }
  return hash.toLowerCase() === expectedRoot.toLowerCase();
}

// Default disk-backed singleton for scripts.
export const defaultStore = new EvidenceStore();
