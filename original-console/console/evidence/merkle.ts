import { concat, keccak256, type Hex } from "viem";

function hashPair(a: Hex, b: Hex): Hex {
  const [left, right] = a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a];
  return keccak256(concat([left, right]));
}

export type MerkleTree = {
  root: Hex;
  layers: Hex[][];
};

export function buildMerkleTree(leaves: Hex[]): MerkleTree {
  if (leaves.length === 0) throw new Error("Merkle tree requires at least one leaf");
  const layers: Hex[][] = [[...leaves]];
  let layer = [...leaves];
  while (layer.length > 1) {
    const next: Hex[] = [];
    for (let index = 0; index < layer.length; index += 2) {
      const left = layer[index];
      const right = layer[index + 1] ?? layer[index];
      next.push(hashPair(left, right));
    }
    layers.push(next);
    layer = next;
  }
  return { root: layer[0], layers };
}

export function buildMerkleProof(tree: MerkleTree, leafIndex: number): Hex[] {
  const proof: Hex[] = [];
  let index = leafIndex;
  for (let level = 0; level < tree.layers.length - 1; level += 1) {
    const layer = tree.layers[level];
    const sibling = index ^ 1;
    proof.push(layer[sibling] ?? layer[index]);
    index = Math.floor(index / 2);
  }
  return proof;
}

export function verifyMerkleProof(leaf: Hex, proof: Hex[], root: Hex): boolean {
  let computed = leaf;
  for (const sibling of proof) {
    computed = hashPair(computed, sibling);
  }
  return computed.toLowerCase() === root.toLowerCase();
}
