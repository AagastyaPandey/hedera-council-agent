/**
 * Minimal EVM bytecode reader used by the Red-Team bytecode assertions.
 *
 * Scanning raw hex for a byte value is unsound because PUSH immediates and
 * the trailing CBOR metadata blob can contain the same byte. These helpers
 * strip compiler metadata and step over PUSH data before matching opcodes.
 */

export const OPCODE_DELEGATECALL = 0xf4;
export const OPCODE_SELFDESTRUCT = 0xff;
export const OPCODE_CALL = 0xf1;
export const OPCODE_CALLCODE = 0xf2;

function stripMetadata(bytecode: string): string {
  const hex = bytecode.startsWith("0x") ? bytecode.slice(2) : bytecode;
  if (hex.length < 4) return hex;

  // Solidity appends CBOR metadata followed by its 2-byte big-endian length.
  const metadataLength = parseInt(hex.slice(-4), 16);
  if (!Number.isFinite(metadataLength) || metadataLength === 0) return hex;

  const end = hex.length - 2 * (metadataLength + 2);
  return end > 0 ? hex.slice(0, end) : hex;
}

/** True when the executable portion of `bytecode` contains `opcode`. */
export function hasOpcode(bytecode: string, opcode: number): boolean {
  const hex = stripMetadata(bytecode);

  let i = 0;
  while (i < hex.length) {
    const op = parseInt(hex.slice(i, i + 2), 16);
    if (op === opcode) return true;

    // PUSH1..PUSH32 carry 1..32 immediate bytes that are not opcodes.
    i += op >= 0x60 && op <= 0x7f ? 2 + 2 * (op - 0x5f) : 2;
  }
  return false;
}
