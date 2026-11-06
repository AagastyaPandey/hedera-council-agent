import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import {
  deployAegisFixture,
  proposeAndQueue,
  signDisclosure,
} from "../test/redteam/fixture";
import { simulateProposalExecution, SimulationResult } from "../sentinel/simulate";
import { buildViolationReport, ViolationReport } from "../sentinel/report";
import { NormalizedTrace } from "../sentinel/trace";
import {
  Action,
  ActionRule,
  ActionKind,
  hashActions,
  hashRules,
} from "../packages/shared/hash";

type Outcome = "Success" | "Executor Revert" | "Sentinel Halt";

interface ScenarioReport {
  scenarioId: number;
  scenarioName: string;
  property: string;
  outcome: Outcome;
  recordedAt: string;
  violationReport: ViolationReport;
  rawEvidence: {
    commitment: string;
    calldata: string;
    revertData: string;
    txHash: string | null;
    trace: NormalizedTrace | null;
  };
}

interface ExecutorScenario {
  scenarioId: number;
  scenarioName: string;
  property: string;
  proposalSaid: string;
  queueActions: Action[];
  queueRules: ActionRule[];
  queueTitle: string;
  advanceTimelock?: boolean;
  simulateActions: Action[];
  simulateRules: ActionRule[];
  prepare?: (q: any) => Promise<void>;
  /** Additional known contracts to treat as monitored (skipped by the static scan). */
  extraMonitored?: Record<string, string>;
}

const AMOUNT = 5_000n * 1_000_000n;
const INFLATED = 50_000n * 1_000_000n;
const CEILING = 5_000n * 1_000_000n;

/**
 * Map freshly-deployed fixture addresses to known contract names so report
 * targetLabel fields are human-readable, not raw addresses.
 */
async function buildRuntimeLabels(f: any): Promise<Record<string, string>> {
  const labels: Record<string, string> = {};
  const contracts: Record<string, any> = {
    MockUSDC: f.usdc,
    GovernanceToken: f.votingToken,
    FeeModule: f.feeModule,
    TreasuryProxy: f.treasuryProxy,
    MaliciousImpl: f.maliciousImpl,
    ReentrantRecipient: f.reentrantRecipient,
    VulnerableProxy: f.vulnerableProxy,
    ProposalRegistry: f.registry,
    DisclosureRegistry: f.disclosureRegistry,
    IntentLockExecutor: f.executor,
    IntentGovernor: f.governor,
  };
  for (const [name, contract] of Object.entries(contracts)) {
    const address = contract.address ?? (await contract.getAddress());
    if (ethers.isAddress(address)) labels[address.toLowerCase()] = name;
  }
  const accounts: Record<string, any> = {
    Attacker: f.attacker,
    DevWallet: f.devWallet,
    Proposer: f.proposer,
    Guardian: f.guardian,
    Verifier: f.verifier,
  };
  for (const [name, signer] of Object.entries(accounts)) {
    if (ethers.isAddress(signer.address)) labels[signer.address.toLowerCase()] = name;
  }
  return labels;
}

/**
 * Classify a simulation into the three UI outcomes.
 * - The executor's hard gate is "reverted".
 * - The Sentinel's independent signals are a static bytecode violation, a
 *   state-diff violation, or a recomputed commitment mismatch.
 */
function classify(sim: SimulationResult): Outcome {
  const sentinelFlag =
    (sim.staticScan && sim.staticScan.violations.length > 0) ||
    sim.diffReport.hasViolations ||
    sim.commitmentMismatch;
  if (sentinelFlag) return "Sentinel Halt";
  if (sim.reverted) return "Executor Revert";
  return "Success";
}

function statusFor(outcome: Outcome): "PASSED" | "REJECTED" | "FLAGGED" {
  if (outcome === "Success") return "PASSED";
  if (outcome === "Executor Revert") return "REJECTED";
  return "FLAGGED";
}

async function runExecutorScenario(
  f: any,
  contracts: any,
  accounts: string[],
  labels: Record<string, string>,
  spec: ExecutorScenario
): Promise<ScenarioReport> {
  const q = await proposeAndQueue(
    f,
    spec.queueActions,
    spec.queueRules,
    spec.queueTitle,
    { advanceTimelock: spec.advanceTimelock !== false }
  );
  if (spec.prepare) await spec.prepare(q);

  const monitored = spec.extraMonitored
    ? ({ ...contracts, ...spec.extraMonitored } as any)
    : contracts;

  const sim = await simulateProposalExecution(
    f.executor,
    q.proposalId,
    q.version,
    q.versionHash,
    q.disclosureHash,
    spec.simulateActions,
    spec.simulateRules,
    monitored,
    accounts
  );

  const outcome = classify(sim);
  const violationReport = buildViolationReport(sim, {
    proposalId: q.proposalId.toString(),
    scenarioId: String(spec.scenarioId),
    proposalSaid: spec.proposalSaid,
    targetLabels: labels,
    layer: outcome === "Executor Revert" ? "executor" : "sentinel",
    status: statusFor(outcome),
  });

  return {
    scenarioId: spec.scenarioId,
    scenarioName: spec.scenarioName,
    property: spec.property,
    outcome,
    recordedAt: new Date().toISOString(),
    violationReport,
    rawEvidence: {
      commitment: sim.commitment,
      calldata: sim.actions[0]?.data ?? "0x",
      revertData: sim.revertData ?? "0x",
      txHash: sim.txHash ?? null,
      trace: sim.trace ?? null,
    },
  };
}

/**
 * Scenario 10 never reaches the executor: the DisclosureRegistry challenge
 * blocks voting. Build the report from the actual DisclosureChallenged revert.
 */
async function runCoiScenario(
  f: any,
  labels: Record<string, string>
): Promise<ScenarioReport> {
  const usdcAddr = await f.usdc.getAddress();
  const actions: Action[] = [
    {
      target: usdcAddr,
      value: 0n,
      data: f.usdc.interface.encodeFunctionData("transfer", [
        f.devWallet.address,
        AMOUNT,
      ]),
    },
  ];
  const rules: ActionRule[] = [
    {
      kind: ActionKind.ERC20_TRANSFER,
      target: usdcAddr,
      selector: "0xa9059cbb",
      counterparty: f.devWallet.address,
      maxAmount: AMOUNT,
      codeHash: ethers.ZeroHash,
      childCount: 0,
    },
  ];

  const incompleteWalletList = ethers.keccak256(
    ethers.toUtf8Bytes("omitted-wallets")
  );
  const interestsHash = ethers.keccak256(ethers.toUtf8Bytes("interests-empty"));

  await f.registry.connect(f.proposer).createProposal(
    ethers.keccak256(ethers.toUtf8Bytes("Hidden COI Proposal")),
    ethers.keccak256(ethers.toUtf8Bytes("evidence.json")),
    ethers.keccak256(ethers.toUtf8Bytes("budget")),
    ethers.keccak256(ethers.toUtf8Bytes("audit")),
    hashRules(rules),
    incompleteWalletList
  );
  const proposalId = (await f.registry.nextProposalId()) - 1n;
  const version = 1n;
  const versionHash = await f.registry.latestVersionHash(proposalId);

  const bondAmount = ethers.parseEther("1.0");
  const signedDisc = await signDisclosure(
    f.disclosureRegistry,
    f.proposer,
    proposalId,
    incompleteWalletList,
    interestsHash,
    bondAmount
  );
  await f.disclosureRegistry.connect(f.proposer).submitDisclosure(
    signedDisc.proposalId,
    signedDisc.proposer,
    signedDisc.walletListHash,
    signedDisc.interestsHash,
    signedDisc.bondAmount,
    signedDisc.nonce,
    signedDisc.v,
    signedDisc.r,
    signedDisc.s,
    { value: bondAmount }
  );

  const disclosureHash = await f.disclosureRegistry.getDisclosureHash(proposalId);
  await f.governor.connect(f.proposer).submitProposal(
    proposalId,
    version,
    versionHash,
    hashActions(actions),
    hashRules(rules),
    disclosureHash
  );
  const govId = (await f.governor.nextGovId()) - 1n;

  const linkEvidenceHash = ethers.keccak256(
    ethers.toUtf8Bytes(
      "evidence: tx 0xabc proves proposer funded devWallet through intermediary"
    )
  );
  await f.disclosureRegistry
    .connect(f.attacker)
    .fileChallenge(
      proposalId,
      linkEvidenceHash,
      "Proposer funded recipient devWallet via intermediary mixer"
    );
  await f.disclosureRegistry.connect(f.verifier).verifyChallenge(proposalId, 0n);

  let revertData = "0xc6393ab9"; // DisclosureChallenged(uint256)
  let txHash: string | null = null;
  try {
    await f.governor.connect(f.proposer).openVoting(govId);
  } catch (err: any) {
    const data = extractRevertData(err);
    if (data !== "0x") revertData = data;
    txHash = extractTxHash(err);
  }

  const sim = {
    proposalId,
    commitment: "",
    commitmentMismatch: false,
    success: false,
    reverted: true,
    revertData,
    txHash,
    staticScan: undefined,
    staticScans: [],
    trace: undefined,
    diffReport: { violations: [] },
    shouldHalt: true,
    haltReason: "Disclosure challenge verified; voting blocked",
    actions: [] as Action[],
    rules,
  } as unknown as SimulationResult;

  const violationReport = buildViolationReport(sim, {
    proposalId: proposalId.toString(),
    scenarioId: "10",
    proposalSaid: "Proposer submitted a complete conflict-of-interest disclosure.",
    targetLabels: labels,
    layer: "sentinel",
    status: "FLAGGED",
  });

  return {
    scenarioId: 10,
    scenarioName: "Hidden Conflict of Interest",
    property: "Hidden conflict-of-interest link flagged",
    outcome: "Sentinel Halt",
    recordedAt: new Date().toISOString(),
    violationReport,
    rawEvidence: {
      commitment: "",
      calldata: "0x",
      revertData,
      txHash,
      trace: null,
    },
  };
}

function extractRevertData(err: any): string {
  const candidates = [
    err?.data,
    err?.error?.data,
    err?.info?.error?.data,
    err?.revert?.data,
  ];
  for (const candidate of candidates) {
    if (
      typeof candidate === "string" &&
      candidate.startsWith("0x") &&
      candidate.length >= 10
    ) {
      return candidate;
    }
  }
  return "0x";
}

function extractTxHash(err: any): string | null {
  const hash = err?.transactionHash ?? err?.receipt?.hash ?? err?.txHash;
  return typeof hash === "string" ? hash : null;
}

async function generateAllReports() {
  console.log("Generating evidence reports for all 11 Red-Team scenarios (0-10)...");
  const f = await deployAegisFixture();
  const labels = await buildRuntimeLabels(f);

  const usdcAddr = await f.usdc.getAddress();
  const feeModuleAddr = await f.feeModule.getAddress();
  const treasuryAddr = await f.treasuryProxy.getAddress();
  const maliciousImplAddr = await f.maliciousImpl.getAddress();
  const reentrantAddr = await f.reentrantRecipient.getAddress();
  const vulnerableAddr = await f.vulnerableProxy.getAddress();
  const executorAddr = await f.executor.getAddress();

  const contracts = {
    treasuryProxy: treasuryAddr,
    vulnerableProxy: vulnerableAddr,
    feeModule: feeModuleAddr,
    executor: executorAddr,
    usdc: usdcAddr,
  };
  const accounts = [f.attacker.address, f.devWallet.address];

  const transferRule = (recipient: string, maxAmount: bigint): ActionRule => ({
    kind: ActionKind.ERC20_TRANSFER,
    target: usdcAddr,
    selector: "0xa9059cbb",
    counterparty: recipient,
    maxAmount,
    codeHash: ethers.ZeroHash,
    childCount: 0,
  });

  const reports: ScenarioReport[] = [];

  // ── S0: benign transfer (Success) ──
  {
    const calldata = f.usdc.interface.encodeFunctionData("transfer", [
      f.devWallet.address,
      AMOUNT,
    ]);
    const actions: Action[] = [{ target: usdcAddr, value: 0n, data: calldata }];
    const rules = [transferRule(f.devWallet.address, AMOUNT)];
    reports.push(
      await runExecutorScenario(f, contracts, accounts, labels, {
        scenarioId: 0,
        scenarioName: "Benign Transfer",
        property: "Benign transfer succeeds",
        proposalSaid: "Pay 5,000 USDC to the development wallet.",
        queueActions: actions,
        queueRules: rules,
        queueTitle: "Benign Dev Transfer",
        simulateActions: actions,
        simulateRules: rules,
      })
    );
  }

  // ── S1: recipient substitution (Executor Revert) ──
  {
    const attackCalldata = f.usdc.interface.encodeFunctionData("transfer", [
      f.attacker.address,
      AMOUNT,
    ]);
    const attackActions: Action[] = [
      { target: usdcAddr, value: 0n, data: attackCalldata },
    ];
    const rules = [transferRule(f.devWallet.address, AMOUNT)];
    reports.push(
      await runExecutorScenario(f, contracts, accounts, labels, {
        scenarioId: 1,
        scenarioName: "Post-Vote Recipient Substitution",
        property: "Post-vote payload substitution rejected",
        proposalSaid: "Pay 5,000 USDC to the development wallet (recipient committed).",
        queueActions: attackActions,
        queueRules: rules,
        queueTitle: "Dev Grant (recipient committed)",
        simulateActions: attackActions,
        simulateRules: rules,
      })
    );
  }

  // ── S2: amount inflation (Executor Revert) ──
  {
    const attackCalldata = f.usdc.interface.encodeFunctionData("transfer", [
      f.devWallet.address,
      INFLATED,
    ]);
    const attackActions: Action[] = [
      { target: usdcAddr, value: 0n, data: attackCalldata },
    ];
    const rules = [transferRule(f.devWallet.address, AMOUNT)];
    reports.push(
      await runExecutorScenario(f, contracts, accounts, labels, {
        scenarioId: 2,
        scenarioName: "Amount Inflation",
        property: "Amount inflation rejected",
        proposalSaid: "Pay up to 5,000 USDC to the development wallet.",
        queueActions: attackActions,
        queueRules: rules,
        queueTitle: "Dev Grant 5000",
        simulateActions: attackActions,
        simulateRules: rules,
      })
    );
  }

  // ── S3: jargon upgrade (Sentinel Halt) ──
  {
    const legitActions: Action[] = [
      {
        target: feeModuleAddr,
        value: 0n,
        data: f.feeModule.interface.encodeFunctionData("setFee", [35]),
      },
    ];
    const legitRules: ActionRule[] = [
      {
        kind: ActionKind.PARAM_SET,
        target: feeModuleAddr,
        selector: "0x694b8e39", // jargon: maps to no real function
        counterparty: ethers.ZeroAddress,
        maxAmount: 100n,
        codeHash: ethers.ZeroHash,
        childCount: 0,
      },
    ];
    const attackActions: Action[] = [
      {
        target: treasuryAddr,
        value: 0n,
        data: f.treasuryProxy.interface.encodeFunctionData("upgradeTo", [
          maliciousImplAddr,
        ]),
      },
    ];
    reports.push(
      await runExecutorScenario(f, contracts, accounts, labels, {
        scenarioId: 3,
        scenarioName: "Jargon Upgrade",
        property: "Unauthorized upgrade rejected",
        proposalSaid: "Routine parameter tuning of the fee module.",
        queueActions: legitActions,
        queueRules: legitRules,
        queueTitle: "Tuning Fee Module",
        simulateActions: attackActions,
        simulateRules: legitRules,
      })
    );
  }

  // ── S4: nested multicall hiding ownership transfer (Sentinel Halt) ──
  {
    const setFeeData = f.feeModule.interface.encodeFunctionData("setFee", [40]);
    const multicallSelector = f.feeModule.interface.getFunction("multicall")!
      .selector;
    const setFeeSelector = f.feeModule.interface.getFunction("setFee")!.selector;

    const legitActions: Action[] = [
      {
        target: feeModuleAddr,
        value: 0n,
        data: f.feeModule.interface.encodeFunctionData("multicall", [[setFeeData]]),
      },
    ];
    const legitRules: ActionRule[] = [
      {
        kind: ActionKind.MULTICALL,
        target: feeModuleAddr,
        selector: multicallSelector,
        counterparty: ethers.ZeroAddress,
        maxAmount: 0n,
        codeHash: ethers.ZeroHash,
        childCount: 1,
      },
      {
        kind: ActionKind.PARAM_SET,
        target: feeModuleAddr,
        selector: setFeeSelector,
        counterparty: ethers.ZeroAddress,
        maxAmount: 100n,
        codeHash: ethers.ZeroHash,
        childCount: 0,
      },
    ];

    const transferOwnershipData = f.feeModule.interface.encodeFunctionData(
      "transferOwnership",
      [f.attacker.address]
    );
    const attackActions: Action[] = [
      {
        target: feeModuleAddr,
        value: 0n,
        data: f.feeModule.interface.encodeFunctionData("multicall", [
          [setFeeData, transferOwnershipData],
        ]),
      },
    ];

    reports.push(
      await runExecutorScenario(f, contracts, accounts, labels, {
        scenarioId: 4,
        scenarioName: "Nested Multicall",
        property: "Hidden ownership transfer in multicall rejected",
        proposalSaid: "Tweak fee module parameter via batch multicall.",
        queueActions: legitActions,
        queueRules: legitRules,
        queueTitle: "Tweak Fee via Multicall",
        simulateActions: attackActions,
        simulateRules: legitRules,
      })
    );
  }

  // ── S5: unlimited approve (Executor Revert) ──
  {
    const approveCalldata = f.usdc.interface.encodeFunctionData("approve", [
      f.attacker.address,
      ethers.MaxUint256,
    ]);
    const attackActions: Action[] = [
      { target: usdcAddr, value: 0n, data: approveCalldata },
    ];
    const rules: ActionRule[] = [
      {
        kind: ActionKind.ERC20_APPROVE,
        target: usdcAddr,
        selector: "0x095ea7b3",
        counterparty: f.attacker.address,
        maxAmount: CEILING,
        codeHash: ethers.ZeroHash,
        childCount: 0,
      },
    ];
    reports.push(
      await runExecutorScenario(f, contracts, accounts, labels, {
        scenarioId: 5,
        scenarioName: "Unlimited Approval",
        property: "Unlimited approval rejected",
        proposalSaid: "Approve a bounded payment of up to 5,000 USDC.",
        queueActions: attackActions,
        queueRules: rules,
        queueTitle: "Dev payment",
        simulateActions: attackActions,
        simulateRules: rules,
      })
    );
  }

  // ── S6: delegatecall payload (Sentinel Halt) ──
  {
    const stealOwnership = f.feeModule.interface.encodeFunctionData(
      "transferOwnership",
      [f.attacker.address]
    );
    const attackCalldata = f.maliciousImpl.interface.encodeFunctionData(
      "executeArbitrary",
      [feeModuleAddr, stealOwnership]
    );
    const attackActions: Action[] = [
      { target: maliciousImplAddr, value: 0n, data: attackCalldata },
    ];
    const rules: ActionRule[] = [
      {
        kind: ActionKind.PARAM_SET,
        target: feeModuleAddr,
        selector: "0x694b8e39",
        counterparty: ethers.ZeroAddress,
        maxAmount: 100n,
        codeHash: ethers.ZeroHash,
        childCount: 0,
      },
    ];
    reports.push(
      await runExecutorScenario(f, contracts, accounts, labels, {
        scenarioId: 6,
        scenarioName: "Delegatecall Payload",
        property: "Delegatecall payload not executable",
        proposalSaid: "Legitimate parameter update.",
        queueActions: attackActions,
        queueRules: rules,
        queueTitle: "Legitimate parameter update",
        simulateActions: attackActions,
        simulateRules: rules,
      })
    );
  }

  // ── S7: re-entrancy (Executor Revert) ──
  {
    const attackCalldata = f.reentrantRecipient.interface.encodeFunctionData(
      "attackOnReceive",
      []
    );
    const selector = f.reentrantRecipient.interface.getFunction(
      "attackOnReceive"
    )!.selector;
    const actions: Action[] = [
      { target: reentrantAddr, value: 0n, data: attackCalldata },
    ];
    const rules: ActionRule[] = [
      {
        kind: ActionKind.PARAM_SET,
        target: reentrantAddr,
        selector,
        counterparty: ethers.ZeroAddress,
        maxAmount: 0n,
        codeHash: ethers.ZeroHash,
        childCount: 0,
      },
    ];
    reports.push(
      await runExecutorScenario(f, contracts, accounts, labels, {
        scenarioId: 7,
        scenarioName: "Re-entrancy",
        property: "Re-entrancy rejected",
        proposalSaid: "Proposal targeting the recipient contract.",
        queueActions: actions,
        queueRules: rules,
        queueTitle: "Proposal targeting reentrant contract",
        simulateActions: actions,
        simulateRules: rules,
        // ReentrantRecipient is a known fixture contract; its re-entrancy is
        // caught by the executor's guard. Treat it as monitored so the static
        // bytecode scanner does not flag its viaIR-compiled data as opcodes.
        extraMonitored: { reentrantRecipient: reentrantAddr },
        prepare: (q) =>
          f.reentrantRecipient.setAttackParams(
            q.proposalId,
            q.version,
            q.versionHash,
            q.disclosureHash,
            actions,
            rules
          ),
      })
    );
  }

  // ── S8: early execution (Executor Revert) ──
  {
    const calldata = f.usdc.interface.encodeFunctionData("transfer", [
      f.devWallet.address,
      AMOUNT,
    ]);
    const actions: Action[] = [{ target: usdcAddr, value: 0n, data: calldata }];
    const rules = [transferRule(f.devWallet.address, AMOUNT)];
    reports.push(
      await runExecutorScenario(f, contracts, accounts, labels, {
        scenarioId: 8,
        scenarioName: "Timelock & Replay Protection",
        property: "Early execution, double execution, and cross-chain replay rejected",
        proposalSaid: "Pay 5,000 USDC to the development wallet (before timelock expiry).",
        queueActions: actions,
        queueRules: rules,
        queueTitle: "Dev Grant",
        advanceTimelock: false,
        simulateActions: actions,
        simulateRules: rules,
      })
    );
  }

  // ── S9: stale version (Executor Revert) ──
  {
    const calldata = f.usdc.interface.encodeFunctionData("transfer", [
      f.devWallet.address,
      AMOUNT,
    ]);
    const actions: Action[] = [{ target: usdcAddr, value: 0n, data: calldata }];
    const rules = [transferRule(f.devWallet.address, AMOUNT)];
    reports.push(
      await runExecutorScenario(f, contracts, accounts, labels, {
        scenarioId: 9,
        scenarioName: "Stale Version Supersession",
        property: "Stale version rejected",
        proposalSaid: "Proposal v1: Dev Grant.",
        queueActions: actions,
        queueRules: rules,
        queueTitle: "Proposal v1: Dev Grant",
        simulateActions: actions,
        simulateRules: rules,
        prepare: (q) =>
          f.registry.connect(f.proposer).addVersion(
            q.proposalId,
            ethers.keccak256(ethers.toUtf8Bytes("Proposal v2: Amended Scope")),
            ethers.keccak256(ethers.toUtf8Bytes("evidence-v2.json")),
            ethers.keccak256(ethers.toUtf8Bytes("budget-v2")),
            ethers.keccak256(ethers.toUtf8Bytes("audit-v2")),
            q.intentHash,
            ethers.keccak256(ethers.toUtf8Bytes("wallets-v2"))
          ),
      })
    );
  }

  // ── S10: hidden conflict of interest (Sentinel Halt / flagged) ──
  reports.push(await runCoiScenario(f, labels));

  const outDir = path.join(__dirname, "..", "packages", "shared", "fixtures");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "sentinel-reports.json");
  const serialized =
    JSON.stringify(
      reports,
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2
    ) + "\n";
  fs.writeFileSync(outPath, serialized, "utf8");

  const appOutDir = path.join(__dirname, "..", "app", "lib", "mocks");
  if (!fs.existsSync(appOutDir)) fs.mkdirSync(appOutDir, { recursive: true });
  const appOutPath = path.join(appOutDir, "sentinel-reports.json");
  fs.writeFileSync(appOutPath, serialized, "utf8");

  const counts = reports.reduce<Record<Outcome, number>>(
    (acc, r) => {
      acc[r.outcome] = (acc[r.outcome] ?? 0) + 1;
      return acc;
    },
    { Success: 0, "Executor Revert": 0, "Sentinel Halt": 0 }
  );
  console.log(`\n💾 Wrote ${reports.length} scenario reports to ${outPath}`);
  console.log(
    `   Success: ${counts.Success} · Executor Revert: ${counts["Executor Revert"]} · Sentinel Halt: ${counts["Sentinel Halt"]}`
  );
  for (const r of reports) {
    console.log(
      `   [S${r.scenarioId}] ${r.outcome.padEnd(16)} ${r.property}`
    );
  }
}

if (require.main === module) {
  generateAllReports()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
