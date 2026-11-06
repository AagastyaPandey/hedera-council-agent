import { encodeErrorResult, parseAbi, type Hex } from "viem";
import { ERROR_BY_NAME, ERROR_DEFINITIONS, type ErrorName } from "../packages/shared/addresses";

const ERROR_ABI = parseAbi(
  ERROR_DEFINITIONS.map((definition) => `error ${definition.signature}`),
);

export type ViolationInput = {
  code: string;
  message: string;
  args?: unknown[];
};

export function encodeViolationError(violation: ViolationInput): Hex {
  if (!(violation.code in ERROR_BY_NAME)) return "0x";
  return encodeErrorResult({
    abi: ERROR_ABI,
    errorName: violation.code as ErrorName,
    args: violation.args ?? [],
  });
}

export function violationSelector(code: string): Hex | undefined {
  return code in ERROR_BY_NAME ? (ERROR_BY_NAME[code as ErrorName].selector as Hex) : undefined;
}

export function errorDefinition(code: string) {
  return code in ERROR_BY_NAME ? ERROR_BY_NAME[code as ErrorName] : undefined;
}
