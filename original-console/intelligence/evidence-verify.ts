import { ethers } from "ethers";
import type { VerifySourceInput } from "./evidence";

export function hashEvidenceContent(content: string | Uint8Array): string {
  return ethers.keccak256(
    typeof content === "string" ? ethers.toUtf8Bytes(content) : content
  );
}

export function verifySourceContent(
  content: string | Uint8Array,
  { docHash, span }: VerifySourceInput
): boolean {
  if (hashEvidenceContent(content).toLowerCase() !== docHash.toLowerCase()) {
    return false;
  }
  const bytes = typeof content === "string" ? ethers.toUtf8Bytes(content) : content;
  const [start, end] = span;
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end >= start &&
    end <= bytes.length
  );
}
