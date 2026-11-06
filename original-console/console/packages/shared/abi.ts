import { parseAbi } from "viem";

export const erc20Abi = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
]);

export const proxyAbi = parseAbi([
  "function upgradeTo(address newImplementation)",
  "function upgradeToAndCall(address newImplementation, bytes data) payable",
]);

export const ownableAbi = parseAbi(["function transferOwnership(address newOwner)"]);

export const multicallAbi = parseAbi([
  "function multicall((address target, bytes data)[] calls)",
]);

export const executorAbi = parseAbi([
  "function execute(uint256 proposalId, uint256 version, bytes[] calls)",
  "function halt(uint256 proposalId, bytes32 reportHash)",
]);
