import { ethers } from "ethers";
import { ActionRule, ActionKind } from "../packages/shared/hash";
import { getExtcodehash } from "./scan";
import { NormalizedTrace } from "./trace";

export const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export const EIP1967_ADMIN_SLOT =
  "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
export const EIP1967_BEACON_SLOT =
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";

const VULNERABLE_ADMIN_SLOT = ethers.toBeHex(0, 32).toLowerCase();
const VULNERABLE_IMPL_SLOT = ethers.toBeHex(1, 32).toLowerCase();
const EIP1967_IMPL_SLOT_LOWER = EIP1967_IMPLEMENTATION_SLOT.toLowerCase();
const EIP1967_ADMIN_SLOT_LOWER = EIP1967_ADMIN_SLOT.toLowerCase();

export interface StateSnapshot {
  tokenBalances: Record<string, bigint>; // key: `${token}:${holder}` => balance
  allowances: Record<string, bigint>;    // key: `${token}:${owner}:${spender}` => allowance
  eip1967Impls: Record<string, string>;  // key: contract address => impl address
  eip1967Admins: Record<string, string>; // key: contract address => admin address
  owners: Record<string, string>;        // key: contract address => owner address
  codeHashes: Record<string, string>;    // key: lowercase address => extcodehash
  trackedStorage: Record<string, string>; // key: `${lowercase address}:${slot}` => value
}

export interface StateViolation {
  category:
    | "BALANCE"
    | "ALLOWANCE"
    | "UPGRADE"
    | "OWNERSHIP"
    | "RULE_MISMATCH"
    | "CODEHASH"
    | "STORAGE"
    | "TRANSFER"
    | "DELEGATECALL";
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  target: string;
  description: string;
  before: string;
  after: string;
  allowed?: string;
}

export interface DiffReport {
  timestamp: string;
  hasViolations: boolean;
  violations: StateViolation[];
  summary: string;
  traceSummary?: {
    source: string;
    calls: number;
    delegateCalls: number;
    tokenTransfers: number;
    tokenApprovals: number;
    storageWrites: number;
    criticalStorageWrites: number;
    failed: boolean;
  };
}

export interface DiffContext {
  trace?: NormalizedTrace;
  contracts?: {
    treasuryProxy?: string;
    vulnerableProxy?: string;
    feeModule?: string;
    executor?: string;
    usdc?: string;
  };
}

export interface MonitoredContracts {
  treasuryProxy?: string;
  vulnerableProxy?: string;
  feeModule?: string;
  executor?: string;
  usdc?: string;
}

/**
 * Capture state snapshot for monitored contracts and accounts.
 */
export async function captureStateSnapshot(
  provider: ethers.Provider,
  contracts: MonitoredContracts,
  accounts: string[],
  codeTargets: string[] = []
): Promise<StateSnapshot> {
  const snapshot: StateSnapshot = {
    tokenBalances: {},
    allowances: {},
    eip1967Impls: {},
    eip1967Admins: {},
    owners: {},
    codeHashes: {},
    trackedStorage: {},
  };

  const erc20Abi = [
    "function balanceOf(address account) external view returns (uint256)",
    "function allowance(address owner, address spender) external view returns (uint256)",
  ];

  if (contracts.usdc) {
    const token = new ethers.Contract(contracts.usdc, erc20Abi, provider);
    for (const acc of accounts) {
      try {
        const bal = await token.balanceOf(acc);
        snapshot.tokenBalances[`${contracts.usdc}:${acc}`] = BigInt(bal);
      } catch {}
    }

    const allowanceOwners = uniqueAddresses([
      contracts.executor,
      contracts.treasuryProxy,
      contracts.vulnerableProxy,
      contracts.feeModule,
    ]);
    for (const owner of allowanceOwners) {
      for (const spender of accounts) {
        try {
          const allow = await token.allowance(owner, spender);
          snapshot.allowances[`${contracts.usdc}:${owner}:${spender}`] = BigInt(allow);
        } catch {}
      }
    }
  }

  const proxies = uniqueAddresses([
    contracts.treasuryProxy,
    contracts.vulnerableProxy,
  ]);
  for (const proxy of proxies) {
    try {
      const implSlot = await provider.getStorage(proxy, EIP1967_IMPLEMENTATION_SLOT);
      snapshot.trackedStorage[
        `${proxy.toLowerCase()}:${EIP1967_IMPL_SLOT_LOWER}`
      ] = implSlot;
      const implAddr = ethers.getAddress("0x" + implSlot.slice(26));
      snapshot.eip1967Impls[proxy] = implAddr;
    } catch {}

    try {
      const adminSlot = await provider.getStorage(proxy, EIP1967_ADMIN_SLOT);
      snapshot.trackedStorage[
        `${proxy.toLowerCase()}:${EIP1967_ADMIN_SLOT_LOWER}`
      ] = adminSlot;
      snapshot.eip1967Admins[proxy] = ethers.getAddress("0x" + adminSlot.slice(26));
    } catch {}

    // Documented layout: VulnerableProxy.sol slot 0 = admin, slot 1 = implementation.
    if (contracts.vulnerableProxy && sameAddress(proxy, contracts.vulnerableProxy)) {
      try {
        const adminSlot = await provider.getStorage(proxy, 0);
        snapshot.trackedStorage[
          `${proxy.toLowerCase()}:${VULNERABLE_ADMIN_SLOT}`
        ] = adminSlot;
      } catch {}
      try {
        const implSlot = await provider.getStorage(proxy, 1);
        snapshot.trackedStorage[
          `${proxy.toLowerCase()}:${VULNERABLE_IMPL_SLOT}`
        ] = implSlot;
        const implAddr = ethers.getAddress("0x" + implSlot.slice(26));
        snapshot.eip1967Impls[proxy] = implAddr;
      } catch {}
    }

    try {
      const view = new ethers.Contract(
        proxy,
        ["function implementation() view returns (address)"],
        provider
      );
      const impl = await view.implementation();
      if (!isZeroAddress(impl)) snapshot.eip1967Impls[proxy] = impl;
    } catch {}
  }

  for (const contract of uniqueAddresses([
    contracts.feeModule,
    contracts.vulnerableProxy,
    contracts.treasuryProxy,
  ])) {
    try {
      const view = new ethers.Contract(
        contract,
        ["function owner() view returns (address)"],
        provider
      );
      snapshot.owners[contract] = await view.owner();
    } catch {}
  }

  const hashTargets = uniqueAddresses([
    contracts.treasuryProxy,
    contracts.vulnerableProxy,
    contracts.feeModule,
    contracts.executor,
    contracts.usdc,
    ...codeTargets,
  ]);
  for (const target of hashTargets) {
    try {
      snapshot.codeHashes[target.toLowerCase()] = await getExtcodehash(provider, target);
    } catch {}
  }

  return snapshot;
}

/**
 * Compare before and after state snapshots against committed ActionRules,
 * and cross-check the execution trace for unauthorized routing.
 */
export function computeStateDiff(
  before: StateSnapshot,
  after: StateSnapshot,
  rules: ActionRule[],
  context: DiffContext = {}
): DiffReport {
  const violations: StateViolation[] = [];
  const trace = context.trace;

  // 1. Critical storage slots (EIP-1967 + documented VulnerableProxy layout)
  const trackedAdminContracts = new Set<string>();
  for (const [key, beforeValue] of Object.entries(before.trackedStorage)) {
    const afterValue = after.trackedStorage[key] ?? beforeValue;
    if (beforeValue.toLowerCase() === afterValue.toLowerCase()) continue;

    const separator = key.lastIndexOf(":");
    const contract = key.slice(0, separator);
    const slot = key.slice(separator + 1);
    const newAddress = slotAddress(afterValue);

    if (isImplementationSlot(slot)) {
      const allowed = rules.find(
        (r) =>
          r.kind === ActionKind.UPGRADE &&
          sameAddress(r.target, contract) &&
          sameAddress(r.counterparty, newAddress)
      );
      if (!allowed) {
        violations.push({
          category: "UPGRADE",
          severity: "CRITICAL",
          target: contract,
          description: `Unauthorized implementation slot change to ${newAddress}`,
          before: slotAddress(beforeValue),
          after: newAddress,
          allowed: "No matching UPGRADE rule",
        });
      }
    } else if (isAdminSlot(slot)) {
      trackedAdminContracts.add(contract);
      const allowed = rules.find(
        (r) =>
          r.kind === ActionKind.OWNERSHIP_TRANSFER &&
          sameAddress(r.target, contract) &&
          sameAddress(r.counterparty, newAddress)
      );
      if (!allowed) {
        violations.push({
          category: "OWNERSHIP",
          severity: "CRITICAL",
          target: contract,
          description: `Unauthorized admin storage slot change to ${newAddress}`,
          before: slotAddress(beforeValue),
          after: newAddress,
          allowed: "No matching OWNERSHIP_TRANSFER rule",
        });
      }
    }
  }

  // 2. Ownership (contracts whose admin slot is not already tracked)
  for (const [contractAddr, beforeOwner] of Object.entries(before.owners)) {
    if (trackedAdminContracts.has(contractAddr.toLowerCase())) continue;
    const afterOwner = after.owners[contractAddr];
    if (afterOwner && !sameAddress(beforeOwner, afterOwner)) {
      const ownerRule = rules.find(
        (r) =>
          r.kind === ActionKind.OWNERSHIP_TRANSFER &&
          sameAddress(r.target, contractAddr) &&
          sameAddress(r.counterparty, afterOwner)
      );

      if (!ownerRule) {
        violations.push({
          category: "OWNERSHIP",
          severity: "CRITICAL",
          target: contractAddr,
          description: `Unauthorized ownership transfer to ${afterOwner}`,
          before: beforeOwner,
          after: afterOwner,
          allowed: "No ownership transfer rule committed",
        });
      }
    }
  }

  // 3. Allowances
  for (const [key, beforeAllow] of Object.entries(before.allowances)) {
    const afterAllow = after.allowances[key] ?? 0n;
    if (afterAllow > beforeAllow) {
      const parts = key.split(":");
      const token = parts[0];
      const spender = parts[2];

      const approveRule = rules.find(
        (r) =>
          r.kind === ActionKind.ERC20_APPROVE &&
          (isZeroAddress(r.target) || sameAddress(r.target, token)) &&
          sameAddress(r.counterparty, spender)
      );

      if (!approveRule) {
        violations.push({
          category: "ALLOWANCE",
          severity: "CRITICAL",
          target: key,
          description: `Unauthorized token allowance granted to ${spender}`,
          before: beforeAllow.toString(),
          after: afterAllow.toString(),
          allowed: "0",
        });
      } else if (
        afterAllow === ethers.MaxUint256 &&
        approveRule.maxAmount !== ethers.MaxUint256
      ) {
        violations.push({
          category: "ALLOWANCE",
          severity: "CRITICAL",
          target: key,
          description: `Unlimited allowance granted to ${spender} without an unlimited commitment`,
          before: beforeAllow.toString(),
          after: afterAllow.toString(),
          allowed: approveRule.maxAmount.toString(),
        });
      } else if (afterAllow > approveRule.maxAmount) {
        violations.push({
          category: "ALLOWANCE",
          severity: "CRITICAL",
          target: key,
          description: `Allowance granted to ${spender} exceeds committed limit`,
          before: beforeAllow.toString(),
          after: afterAllow.toString(),
          allowed: approveRule.maxAmount.toString(),
        });
      }
    }
  }

  // 4. Balance drains (ceiling is per token)
  for (const [key, beforeBal] of Object.entries(before.tokenBalances)) {
    const afterBal = after.tokenBalances[key] ?? beforeBal;
    if (afterBal < beforeBal) {
      const token = key.split(":")[0];
      const tokenCeiling = rules
        .filter(
          (r) =>
            r.kind === ActionKind.ERC20_TRANSFER &&
            (isZeroAddress(r.target) || sameAddress(r.target, token))
        )
        .reduce((acc, r) => acc + r.maxAmount, 0n);

      const delta = beforeBal - afterBal;
      if (delta > tokenCeiling) {
        violations.push({
          category: "BALANCE",
          severity: "CRITICAL",
          target: key,
          description: `Balance drop of ${delta} exceeds approved spend ceiling of ${tokenCeiling}`,
          before: beforeBal.toString(),
          after: afterBal.toString(),
          allowed: tokenCeiling.toString(),
        });
      }
    }
  }

  // 5. Code hashes: changed code and committed extcodehash mismatches
  for (const [address, beforeHash] of Object.entries(before.codeHashes)) {
    const afterHash = after.codeHashes[address];
    if (afterHash && !hashEquals(beforeHash, afterHash)) {
      violations.push({
        category: "CODEHASH",
        severity: "CRITICAL",
        target: address,
        description: "Contract bytecode changed during execution",
        before: beforeHash,
        after: afterHash,
        allowed: "Code hash must remain stable",
      });
    }
  }

  for (const rule of rules) {
    if (
      !rule.codeHash ||
      hashEquals(rule.codeHash, ethers.ZeroHash) ||
      rule.kind === ActionKind.MULTICALL
    ) {
      continue;
    }

    const expectedAddress =
      rule.kind === ActionKind.UPGRADE ? rule.counterparty : rule.target;
    if (!expectedAddress || isZeroAddress(expectedAddress)) continue;

    const actual = after.codeHashes[expectedAddress.toLowerCase()];
    if (actual && !hashEquals(actual, rule.codeHash)) {
      violations.push({
        category: "CODEHASH",
        severity: "CRITICAL",
        target: expectedAddress,
        description: "extcodehash does not match the committed code hash",
        before: rule.codeHash,
        after: actual,
        allowed: rule.codeHash,
      });
    }
  }

  // 6. Trace: delegatecall routing
  const delegateKeys = new Set<string>();
  if (trace) {
    const impls = implementationMap(before, after);
    for (const call of trace.delegateCalls) {
      const codeTarget = call.codeTarget ?? call.to;
      const key = `${call.to.toLowerCase()}:${codeTarget.toLowerCase()}`;
      if (delegateKeys.has(key)) continue;
      delegateKeys.add(key);

      const allowedTargets = new Set<string>([call.to.toLowerCase()]);
      for (const impl of impls.get(call.to.toLowerCase()) ?? []) {
        allowedTargets.add(impl.toLowerCase());
      }
      for (const rule of rules) {
        if (
          rule.kind === ActionKind.UPGRADE &&
          sameAddress(rule.target, call.to) &&
          !isZeroAddress(rule.counterparty)
        ) {
          allowedTargets.add(rule.counterparty.toLowerCase());
        }
      }

      if (!allowedTargets.has(codeTarget.toLowerCase())) {
        violations.push({
          category: "DELEGATECALL",
          severity: "CRITICAL",
          target: call.to,
          description: `Unauthorized delegatecall from ${call.to} to ${codeTarget}`,
          before: "No committed delegatecall target",
          after: codeTarget,
          allowed: [...allowedTargets].join(", "),
        });
      }
    }
  }

  // 7. Trace: token transfers and approvals out of monitored contracts
  const transferKeys = new Set<string>();
  if (trace) {
    const monitored = new Set(
      Object.values(context.contracts ?? {})
        .filter((value): value is string => typeof value === "string" && ethers.isAddress(value))
        .map((value) => value.toLowerCase())
    );

    for (const transfer of trace.tokenTransfers) {
      if (!monitored.has(transfer.from.toLowerCase())) continue;

      const key = `${transfer.token.toLowerCase()}:${transfer.from.toLowerCase()}:${transfer.to.toLowerCase()}:${transfer.amount ?? "unknown"}`;
      if (transferKeys.has(key)) continue;
      transferKeys.add(key);

      const matching = rules.filter(
        (r) =>
          r.kind === ActionKind.ERC20_TRANSFER &&
          sameAddress(r.target, transfer.token) &&
          sameAddress(r.counterparty, transfer.to)
      );

      if (matching.length === 0) {
        violations.push({
          category: "TRANSFER",
          severity: "CRITICAL",
          target: transfer.token,
          description: `Trace shows token transfer from ${transfer.from} to ${transfer.to} with no matching rule`,
          before: "No committed transfer rule",
          after: transfer.amount?.toString() ?? "amount in event",
          allowed: "No recipient authorized",
        });
      } else if (
        transfer.amount !== undefined &&
        !matching.some((r) => transfer.amount! <= r.maxAmount)
      ) {
        const ceiling = matching.reduce(
          (max, r) => (r.maxAmount > max ? r.maxAmount : max),
          0n
        );
        violations.push({
          category: "TRANSFER",
          severity: "CRITICAL",
          target: transfer.token,
          description: `Trace shows transfer of ${transfer.amount} to ${transfer.to} above committed ceiling`,
          before: ceiling.toString(),
          after: transfer.amount.toString(),
          allowed: ceiling.toString(),
        });
      }
    }

    const approvalKeys = new Set<string>();
    for (const approval of trace.tokenApprovals) {
      if (!monitored.has(approval.owner.toLowerCase())) continue;

      const key = `${approval.token.toLowerCase()}:${approval.owner.toLowerCase()}:${approval.spender.toLowerCase()}:${approval.amount ?? "unknown"}`;
      if (approvalKeys.has(key)) continue;
      approvalKeys.add(key);

      const matching = rules.find(
        (r) =>
          r.kind === ActionKind.ERC20_APPROVE &&
          sameAddress(r.target, approval.token) &&
          sameAddress(r.counterparty, approval.spender)
      );

      if (!matching) {
        violations.push({
          category: "ALLOWANCE",
          severity: "CRITICAL",
          target: approval.token,
          description: `Trace shows allowance granted by ${approval.owner} to ${approval.spender} with no matching rule`,
          before: "No committed approve rule",
          after: approval.amount?.toString() ?? "amount in event",
          allowed: "No spender authorized",
        });
      } else if (approval.amount !== undefined) {
        if (
          approval.amount === ethers.MaxUint256 &&
          matching.maxAmount !== ethers.MaxUint256
        ) {
          violations.push({
            category: "ALLOWANCE",
            severity: "CRITICAL",
            target: approval.token,
            description: `Trace shows unlimited approval granted to ${approval.spender}`,
            before: matching.maxAmount.toString(),
            after: approval.amount.toString(),
            allowed: matching.maxAmount.toString(),
          });
        } else if (approval.amount > matching.maxAmount) {
          violations.push({
            category: "ALLOWANCE",
            severity: "CRITICAL",
            target: approval.token,
            description: `Trace shows approval to ${approval.spender} above committed limit`,
            before: matching.maxAmount.toString(),
            after: approval.amount.toString(),
            allowed: matching.maxAmount.toString(),
          });
        }
      }
    }
  }

  const hasViolations = violations.length > 0;
  const summary = hasViolations
    ? `Sentinel detected ${violations.length} state invariant violation(s): ${[...new Set(violations.map((v) => v.category))].join(", ")}`
    : "Simulation passed all state invariant and rule checks.";

  const report: DiffReport = {
    timestamp: new Date().toISOString(),
    hasViolations,
    violations,
    summary,
  };

  if (trace) {
    const criticalSlots = new Set([
      EIP1967_IMPL_SLOT_LOWER,
      EIP1967_ADMIN_SLOT_LOWER,
      VULNERABLE_ADMIN_SLOT,
      VULNERABLE_IMPL_SLOT,
    ]);
    report.traceSummary = {
      source: trace.source,
      calls: trace.calls.length,
      delegateCalls: trace.delegateCalls.length,
      tokenTransfers: trace.tokenTransfers.length,
      tokenApprovals: trace.tokenApprovals.length,
      storageWrites: trace.storageWrites.length,
      criticalStorageWrites: trace.storageWrites.filter((w) =>
        criticalSlots.has(w.slot.toLowerCase())
      ).length,
      failed: trace.failed,
    };
  }

  return report;
}

function implementationMap(
  before: StateSnapshot,
  after: StateSnapshot
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const source of [before.eip1967Impls, after.eip1967Impls]) {
    for (const [proxy, impl] of Object.entries(source)) {
      if (!impl || isZeroAddress(impl)) continue;
      const key = proxy.toLowerCase();
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(impl);
    }
  }
  return map;
}

function isImplementationSlot(slot: string): boolean {
  const normalized = slot.toLowerCase();
  return (
    normalized === EIP1967_IMPL_SLOT_LOWER || normalized === VULNERABLE_IMPL_SLOT
  );
}

function isAdminSlot(slot: string): boolean {
  const normalized = slot.toLowerCase();
  return normalized === EIP1967_ADMIN_SLOT_LOWER || normalized === VULNERABLE_ADMIN_SLOT;
}

function slotAddress(value: string): string {
  const hex = value.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  return ethers.getAddress("0x" + hex.slice(-40));
}

function sameAddress(a: string, b: string): boolean {
  if (!ethers.isAddress(a) || !ethers.isAddress(b)) return false;
  return a.toLowerCase() === b.toLowerCase();
}

function isZeroAddress(value: string): boolean {
  return !value || /^0x0{40}$/i.test(value);
}

function hashEquals(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function uniqueAddresses(values: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || !ethers.isAddress(value)) continue;
    const normalized = ethers.getAddress(value);
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}
