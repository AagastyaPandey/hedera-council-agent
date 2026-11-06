import { ethers } from "ethers";

export interface BytecodeScanResult {
  target: string;
  codeHash: string;
  expectedCodeHash?: string;
  hasDelegateCall: boolean;
  hasSelfDestruct: boolean;
  hasCallCode: boolean;
  codeSize: number;
  violations: string[];
}

/**
 * Scan contract runtime bytecode for dangerous opcodes and codehash matching.
 * EVM Opcodes:
 * 0xf4 = DELEGATECALL
 * 0xff = SELFDESTRUCT
 * 0xf2 = CALLCODE
 */
export async function scanBytecode(
  provider: ethers.Provider,
  target: string,
  expectedCodeHash?: string
): Promise<BytecodeScanResult> {
  const bytecode = await provider.getCode(target);
  // extcodehash semantics: empty accounts have hash 0, not keccak256("0x").
  const codeHash =
    bytecode === "0x" ? ethers.ZeroHash : ethers.keccak256(bytecode);

  const violations: string[] = [];

  if (bytecode === "0x" || bytecode.length <= 2) {
    violations.push(`Target ${target} has no deployed bytecode (EOA or selfdestructed)`);
    return {
      target,
      codeHash,
      expectedCodeHash,
      hasDelegateCall: false,
      hasSelfDestruct: false,
      hasCallCode: false,
      codeSize: 0,
      violations,
    };
  }

  const codeSize = (bytecode.length - 2) / 2;
  // Solidity appends CBOR metadata that can contain arbitrary bytes. Strip it
  // before opcode scanning so metadata cannot masquerade as an instruction.
  const cleanHex = stripMetadata(bytecode.slice(2).toLowerCase());
  const bytes = Buffer.from(cleanHex, "hex");

  let hasDelegateCall = false;
  let hasSelfDestruct = false;
  let hasCallCode = false;

  // Linear scan across bytecode instructions (skipping push data)
  for (let i = 0; i < bytes.length; i++) {
    const opcode = bytes[i];

    // PUSH1 (0x60) to PUSH32 (0x7f)
    if (opcode >= 0x60 && opcode <= 0x7f) {
      const pushBytes = opcode - 0x5f;
      i += pushBytes; // skip pushed literal bytes
      continue;
    }

    if (opcode === 0xf4) {
      hasDelegateCall = true;
    } else if (opcode === 0xff) {
      hasSelfDestruct = true;
    } else if (opcode === 0xf2) {
      hasCallCode = true;
    }
  }

  if (hasDelegateCall) {
    violations.push("Dangerous opcode detected: DELEGATECALL (0xf4) in implementation bytecode");
  }
  if (hasSelfDestruct) {
    violations.push("Dangerous opcode detected: SELFDESTRUCT (0xff) in implementation bytecode");
  }
  if (hasCallCode) {
    violations.push("Dangerous opcode detected: CALLCODE (0xf2) in implementation bytecode");
  }

  if (expectedCodeHash && expectedCodeHash !== ethers.ZeroHash) {
    if (codeHash.toLowerCase() !== expectedCodeHash.toLowerCase()) {
      violations.push(
        `Code hash mismatch: expected ${expectedCodeHash}, found actual ${codeHash}`
      );
    }
  }

  return {
    target,
    codeHash,
    expectedCodeHash,
    hasDelegateCall,
    hasSelfDestruct,
    hasCallCode,
    codeSize,
    violations,
  };
}

/**
 * Hash of deployed bytecode with extcodehash semantics (empty code => 0x0).
 */
export async function getExtcodehash(
  provider: ethers.Provider,
  target: string
): Promise<string> {
  const bytecode = await provider.getCode(target);
  return bytecode === "0x" ? ethers.ZeroHash : ethers.keccak256(bytecode);
}

function stripMetadata(hex: string): string {
  if (hex.length < 4) return hex;

  const raw = Buffer.from(hex, "hex");
  if (raw.length < 2) return hex;

  const metadataLength = raw.readUInt16BE(raw.length - 2);
  const totalLength = metadataLength + 2;
  if (totalLength <= raw.length) {
    return raw.subarray(0, raw.length - totalLength).toString("hex");
  }
  return hex;
}
