import { expect } from "chai";
import { ethers } from "hardhat";
import { deployAegisFixture, proposeAndQueue } from "./redteam/fixture";
import {
  Action,
  ActionRule,
  ActionKind,
} from "../packages/shared/hash";
import { computePreviewHash, previewProposal } from "../sentinel/preview";
import { signDisclosure } from "./redteam/fixture";
import type { EffectPreview } from "../packages/shared/schemas/effect-preview";
import type { ExecutionBundle } from "../sentinel/live-store";

// The adapter is imported for its brief-hash helper; pin it to recorded mode so
// an ambient NEXT_PUBLIC_DATA_MODE=live cannot turn fixture lookups into fetches.
process.env.NEXT_PUBLIC_DATA_MODE = "mock";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { computeBriefHash } = require("../app/lib/data") as typeof import("../app/lib/data");

const USDC = (whole: number) => ethers.parseUnits(String(whole), 6);
const ZERO = ethers.ZeroHash;

async function bundleFrom(
  governor: any,
  govId: bigint,
  actions: Action[],
  rules: ActionRule[],
  labels?: Record<string, string>
): Promise<ExecutionBundle> {
  const proposal = await governor.getGovProposal(govId);
  return {
    commitment: String(proposal.commitment),
    proposalId: String(proposal.proposalId),
    govId: govId.toString(),
    title: "preview test bundle",
    version: String(proposal.version),
    versionHash: String(proposal.versionHash),
    disclosureHash: String(proposal.disclosureHash),
    createdAt: new Date().toISOString(),
    source: "test/preview.test.ts",
    actions: actions.map((action) => ({
      target: action.target,
      value: action.value.toString(),
      data: action.data,
    })),
    rules: rules.map((rule) => ({
      kind: Number(rule.kind),
      target: rule.target,
      selector: rule.selector,
      counterparty: rule.counterparty,
      maxAmount: rule.maxAmount.toString(),
      codeHash: rule.codeHash,
      childCount: Number(rule.childCount),
    })),
    labels,
  };
}

/** Everything the preview could have changed, read straight from the chain. */
async function observableState(
  usdc: any,
  treasury: any,
  executorAddress: string
) {
  const provider = ethers.provider;
  return {
    balance: (await usdc.balanceOf(executorAddress)).toString(),
    owner: await treasury.owner(),
    implSlot: await provider.getStorage(
      await treasury.getAddress(),
      "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
    ),
    nonce: await provider.getTransactionCount(executorAddress),
    blockNumber: await provider.getBlockNumber(),
  };
}

/** Provider that fails a chosen JSON-RPC method, to test the mid-flight path. */
function failingProvider(base: any, method: string): any {
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === "send") {
        return async (called: string, params: any[]) => {
          if (called === method) throw new Error(`forced failure on ${called}`);
          return target.send(called, params);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("Pre-vote Effect Preview", () => {
  it("[preview] benign grant: exactly the committed transfer, zero mismatches", async () => {
    const f = await deployAegisFixture();
    const devWallet = f.devWallet.address;
    const usdcAddress = await f.usdc.getAddress();

    const actions: Action[] = [
      {
        target: usdcAddress,
        value: 0n,
        data: f.usdc.interface.encodeFunctionData("transfer", [devWallet, USDC(5000)]),
      },
    ];
    const rules: ActionRule[] = [
      {
        kind: ActionKind.ERC20_TRANSFER,
        target: usdcAddress,
        selector: "0xa9059cbb",
        counterparty: devWallet,
        maxAmount: USDC(5000),
        codeHash: ZERO,
        childCount: 0,
      },
    ];

    const queued = await proposeAndQueue(f, actions, rules, "Benign grant");
    const bundle = await bundleFrom(f.governor, queued.govId, actions, rules, {
      [devWallet.toLowerCase()]: "Dev wallet",
    });

    const preview = await previewProposal(queued.proposalId, {
      provider: ethers.provider,
      governor: f.governor,
      executor: f.executor,
      bundle,
      noCache: true,
    });

    expect(preview.status).to.equal("OK");
    expect(preview.statedVsSimulated.mismatchCount).to.equal(0);
    expect(preview.statedVsSimulated.mismatches).to.have.length(0);
    expect(preview.effects).to.have.length(2);
    expect(preview.effects.every((effect) => effect.severity === "EXPECTED")).to.equal(true);
    expect(preview.effects.every((effect) => effect.matchedRuleIndex === 0)).to.equal(true);

    const deltas = preview.effects
      .map((effect) => BigInt(effect.delta ?? "0"))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(deltas[0]).to.equal(-USDC(5000));
    expect(deltas[1]).to.equal(USDC(5000));
    expect(preview.statedVsSimulated.statedSummary).to.contain("Transfer up to");
    expect(preview.traceFindings).to.have.length(0);
  });

  it("[preview] obfuscated proposal: CRITICAL owner + implementation before any vote", async () => {
    const f = await deployAegisFixture();
    const treasuryAddress = await f.treasuryProxy.getAddress();
    const attacker = f.attacker.address;

    const upgradeData = f.treasuryProxy.interface.encodeFunctionData("upgradeTo", [
      await f.maliciousImpl.getAddress(),
    ]);
    const ownershipData = f.treasuryProxy.interface.encodeFunctionData(
      "transferOwnership",
      [attacker]
    );
    const attackActions: Action[] = [
      {
        target: treasuryAddress,
        value: 0n,
        data: f.treasuryProxy.interface.encodeFunctionData("multicall", [
          [upgradeData, ownershipData],
        ]),
      },
    ];

    // The stated intent: a bounded fee-parameter change, nothing else.
    const statedRules: ActionRule[] = [
      {
        kind: ActionKind.PARAM_SET,
        target: await f.feeModule.getAddress(),
        selector: "0x69fe0e2d",
        counterparty: ethers.ZeroAddress,
        maxAmount: 100n,
        codeHash: ZERO,
        childCount: 0,
      },
    ];

    const queued = await proposeAndQueue(f, attackActions, statedRules, "Obfuscated");
    const bundle = await bundleFrom(f.governor, queued.govId, attackActions, statedRules, {
      [attacker.toLowerCase()]: "Attacker wallet",
    });

    const preview = await previewProposal(queued.proposalId, {
      provider: ethers.provider,
      governor: f.governor,
      executor: f.executor,
      bundle,
      noCache: true,
    });

    expect(preview.status).to.equal("OK");
    expect(preview.statedVsSimulated.mismatchCount).to.be.greaterThan(0);

    const kinds = preview.effects.map((effect) => effect.kind);
    expect(kinds).to.include("IMPLEMENTATION");
    expect(kinds).to.include("ADMIN");

    const implementation = preview.effects.find((effect) => effect.kind === "IMPLEMENTATION")!;
    expect(implementation.severity).to.equal("CRITICAL");
    expect(implementation.before.toLowerCase()).to.not.equal(implementation.after.toLowerCase());
    expect(implementation.matchedRuleIndex).to.equal(null);

    const owner = preview.effects.find((effect) => effect.kind === "ADMIN")!;
    expect(owner.severity).to.equal("CRITICAL");
    expect(owner.after.toLowerCase()).to.equal(attacker.toLowerCase());

    const findings = preview.traceFindings.join(" | ");
    expect(findings).to.match(/DELEGATECALL/i);
    expect(findings).to.match(/SELFDESTRUCT/i);
    expect(preview.statedVsSimulated.mismatches.join(" ")).to.match(/Not in the stated intent/);
  });

  it("[preview] leaves chain state untouched, including reverts and mid-flight failures", async () => {
    const f = await deployAegisFixture();
    const executorAddress = await f.executor.getAddress();
    const usdcAddress = await f.usdc.getAddress();
    const treasuryAddress = await f.treasuryProxy.getAddress();

    // 1. A benign preview.
    const benignActions: Action[] = [
      {
        target: usdcAddress,
        value: 0n,
        data: f.usdc.interface.encodeFunctionData("transfer", [
          f.devWallet.address,
          USDC(5000),
        ]),
      },
    ];
    const benignRules: ActionRule[] = [
      {
        kind: ActionKind.ERC20_TRANSFER,
        target: usdcAddress,
        selector: "0xa9059cbb",
        counterparty: f.devWallet.address,
        maxAmount: USDC(5000),
        codeHash: ZERO,
        childCount: 0,
      },
    ];
    const benign = await proposeAndQueue(f, benignActions, benignRules, "Benign");
    const benignBundle = await bundleFrom(f.governor, benign.govId, benignActions, benignRules);

    const before = await observableState(f.usdc, f.treasuryProxy, executorAddress);
    await previewProposal(benign.proposalId, {
      provider: ethers.provider,
      governor: f.governor,
      executor: f.executor,
      bundle: benignBundle,
      noCache: true,
    });
    expect(await observableState(f.usdc, f.treasuryProxy, executorAddress)).to.deep.equal(before);

    // 2. An obfuscated preview that changes owner + implementation inside the snapshot.
    const upgradeData = f.treasuryProxy.interface.encodeFunctionData("upgradeTo", [
      await f.maliciousImpl.getAddress(),
    ]);
    const ownershipData = f.treasuryProxy.interface.encodeFunctionData(
      "transferOwnership",
      [f.attacker.address]
    );
    const attackActions: Action[] = [
      {
        target: treasuryAddress,
        value: 0n,
        data: f.treasuryProxy.interface.encodeFunctionData("multicall", [
          [upgradeData, ownershipData],
        ]),
      },
    ];
    const statedRules: ActionRule[] = [
      {
        kind: ActionKind.PARAM_SET,
        target: await f.feeModule.getAddress(),
        selector: "0x69fe0e2d",
        counterparty: ethers.ZeroAddress,
        maxAmount: 100n,
        codeHash: ZERO,
        childCount: 0,
      },
    ];
    const obfuscated = await proposeAndQueue(f, attackActions, statedRules, "Obfuscated");
    const obfuscatedBundle = await bundleFrom(
      f.governor,
      obfuscated.govId,
      attackActions,
      statedRules
    );

    const beforeObfuscated = await observableState(f.usdc, f.treasuryProxy, executorAddress);
    const obfuscatedPreview = await previewProposal(obfuscated.proposalId, {
      provider: ethers.provider,
      governor: f.governor,
      executor: f.executor,
      bundle: obfuscatedBundle,
      noCache: true,
    });
    expect(obfuscatedPreview.statedVsSimulated.mismatchCount).to.be.greaterThan(0);
    // The simulation really did move state inside the snapshot...
    expect(obfuscatedPreview.effects.some((effect) => effect.kind === "ADMIN")).to.equal(true);
    // ...and the chain is exactly as it was.
    expect(await observableState(f.usdc, f.treasuryProxy, executorAddress)).to.deep.equal(beforeObfuscated);

    // 3. An action that reverts inside the sandbox.
    const revertActions: Action[] = [
      {
        target: await f.executor.getAddress(),
        value: 0n,
        data: f.executor.interface.encodeFunctionData("setGovernor", [
          f.attacker.address,
        ]),
      },
    ];
    const revertQueued = await proposeAndQueue(f, revertActions, statedRules, "Reverting");
    const revertBundle = await bundleFrom(
      f.governor,
      revertQueued.govId,
      revertActions,
      statedRules
    );
    const beforeRevert = await observableState(f.usdc, f.treasuryProxy, executorAddress);
    const revertPreview = await previewProposal(revertQueued.proposalId, {
      provider: ethers.provider,
      governor: f.governor,
      executor: f.executor,
      bundle: revertBundle,
      noCache: true,
    });
    expect(revertPreview.status).to.equal("FAILED_SIMULATION");
    expect(await observableState(f.usdc, f.treasuryProxy, executorAddress)).to.deep.equal(beforeRevert);

    // 4. A failure after the action already executed inside the snapshot.
    const beforeFault = await observableState(f.usdc, f.treasuryProxy, executorAddress);
    const faulted = await previewProposal(benign.proposalId, {
      provider: failingProvider(ethers.provider, "eth_getTransactionReceipt"),
      governor: f.governor,
      executor: f.executor,
      bundle: benignBundle,
      noCache: true,
    });
    expect(faulted.status).to.equal("UNAVAILABLE");
    expect(faulted.reason ?? "").to.match(/forced failure/);
    expect(await observableState(f.usdc, f.treasuryProxy, executorAddress)).to.deep.equal(beforeFault);
  });

  it("[preview] reverting action yields FAILED_SIMULATION with the decoded error", async () => {
    const f = await deployAegisFixture();
    const actions: Action[] = [
      {
        target: await f.executor.getAddress(),
        value: 0n,
        data: f.executor.interface.encodeFunctionData("setGovernor", [
          f.attacker.address,
        ]),
      },
    ];
    const rules: ActionRule[] = [
      {
        kind: ActionKind.PARAM_SET,
        target: await f.feeModule.getAddress(),
        selector: "0x69fe0e2d",
        counterparty: ethers.ZeroAddress,
        maxAmount: 100n,
        codeHash: ZERO,
        childCount: 0,
      },
    ];
    const queued = await proposeAndQueue(f, actions, rules, "Reverting action");
    const bundle = await bundleFrom(f.governor, queued.govId, actions, rules);

    const preview = await previewProposal(queued.proposalId, {
      provider: ethers.provider,
      governor: f.governor,
      executor: f.executor,
      bundle,
      noCache: true,
    });

    expect(preview.status).to.equal("FAILED_SIMULATION");
    expect(preview.revert).to.not.equal(undefined);
    expect(preview.revert!.code).to.equal("NotGuardian");
    expect(preview.revert!.title.length).to.be.greaterThan(0);
    expect(preview.revert!.explanation.length).to.be.greaterThan(0);
    expect(ethers.dataLength(preview.revert!.revertData)).to.be.greaterThan(4);
    // Only actions before the revert can contribute effects; this one is first.
    expect(preview.effects).to.have.length(0);
  });

  it("[preview] failed reads land in unobserved and are never reported as zero", async () => {
    const f = await deployAegisFixture();
    const RevertingView = await ethers.getContractFactory("RevertingView");
    const reverting = await RevertingView.deploy();
    await reverting.waitForDeployment();
    const revertingAddress = await reverting.getAddress();

    const actions: Action[] = [
      {
        target: revertingAddress,
        value: 0n,
        data: reverting.interface.encodeFunctionData("noop", []),
      },
    ];
    const queued = await proposeAndQueue(f, actions, [], "Reverting view");
    const bundle = await bundleFrom(f.governor, queued.govId, actions, []);

    const preview = await previewProposal(queued.proposalId, {
      provider: ethers.provider,
      governor: f.governor,
      executor: f.executor,
      bundle,
      noCache: true,
    });

    expect(preview.status).to.equal("OK");
    expect(preview.unobserved.length).to.be.greaterThan(0);
    const ownerRead = preview.unobserved.find(
      (entry) =>
        entry.includes("owner()") &&
        entry.toLowerCase().includes(revertingAddress.toLowerCase())
    );
    expect(ownerRead, "the reverting owner() read must be listed").to.not.equal(undefined);
    // Nothing may be invented for the read that failed.
    expect(preview.effects.some((effect) => effect.subject.toLowerCase() === revertingAddress.toLowerCase())).to.equal(false);
  });

  it("[preview] previewHash is stable for identical inputs and effect-sensitive", async () => {
    const f = await deployAegisFixture();
    const usdcAddress = await f.usdc.getAddress();
    const actions: Action[] = [
      {
        target: usdcAddress,
        value: 0n,
        data: f.usdc.interface.encodeFunctionData("transfer", [
          f.devWallet.address,
          USDC(5000),
        ]),
      },
    ];
    const rules: ActionRule[] = [
      {
        kind: ActionKind.ERC20_TRANSFER,
        target: usdcAddress,
        selector: "0xa9059cbb",
        counterparty: f.devWallet.address,
        maxAmount: USDC(5000),
        codeHash: ZERO,
        childCount: 0,
      },
    ];
    const queued = await proposeAndQueue(f, actions, rules, "Stable hash");
    const bundle = await bundleFrom(f.governor, queued.govId, actions, rules);

    const options = {
      provider: ethers.provider,
      governor: f.governor,
      executor: f.executor,
      bundle,
      noCache: true,
    };
    const first = await previewProposal(queued.proposalId, options);
    const second = await previewProposal(queued.proposalId, options);

    expect(first.previewHash).to.equal(second.previewHash);
    expect(first.simulatedAt).to.not.equal(undefined);

    // A different effect set produces a different hash.
    const mutated: EffectPreview = JSON.parse(JSON.stringify(first));
    mutated.effects[0].after = "1";
    mutated.effects[0].delta = "+1";
    expect(computePreviewHash(mutated)).to.not.equal(first.previewHash);

    // Re-hashing the untouched preview reproduces the same value.
    expect(computePreviewHash(first)).to.equal(first.previewHash);
  });

  it("[preview] mutated calldata is refused with UNAVAILABLE", async () => {
    const f = await deployAegisFixture();
    const usdcAddress = await f.usdc.getAddress();
    const actions: Action[] = [
      {
        target: usdcAddress,
        value: 0n,
        data: f.usdc.interface.encodeFunctionData("transfer", [
          f.devWallet.address,
          USDC(5000),
        ]),
      },
    ];
    const rules: ActionRule[] = [
      {
        kind: ActionKind.ERC20_TRANSFER,
        target: usdcAddress,
        selector: "0xa9059cbb",
        counterparty: f.devWallet.address,
        maxAmount: USDC(5000),
        codeHash: ZERO,
        childCount: 0,
      },
    ];
    const queued = await proposeAndQueue(f, actions, rules, "Mutated calldata");
    const bundle = await bundleFrom(f.governor, queued.govId, actions, rules);

    // Same commitment, different calldata: the recipient is swapped.
    const mutated = JSON.parse(JSON.stringify(bundle)) as ExecutionBundle;
    mutated.actions[0].data = f.usdc.interface.encodeFunctionData("transfer", [
      f.attacker.address,
      USDC(5000),
    ]);

    const preview = await previewProposal(queued.proposalId, {
      provider: ethers.provider,
      governor: f.governor,
      executor: f.executor,
      bundle: mutated,
      noCache: true,
    });

    expect(preview.status).to.equal("UNAVAILABLE");
    expect(preview.effects).to.have.length(0);
    expect(preview.reason ?? "").to.match(/committed/i);
  });

  it("[preview] a vote with a brief records the previewHash the voter acknowledged", async () => {
    const f = await deployAegisFixture();
    const usdcAddress = await f.usdc.getAddress();
    const actions: Action[] = [
      {
        target: usdcAddress,
        value: 0n,
        data: f.usdc.interface.encodeFunctionData("transfer", [
          f.devWallet.address,
          USDC(5000),
        ]),
      },
    ];
    const rules: ActionRule[] = [
      {
        kind: ActionKind.ERC20_TRANSFER,
        target: usdcAddress,
        selector: "0xa9059cbb",
        counterparty: f.devWallet.address,
        maxAmount: USDC(5000),
        codeHash: ZERO,
        childCount: 0,
      },
    ];

    // A voting-open proposal, created without casting a vote yet.
    const proposalId = await f.registry.nextProposalId();
    const walletListHash = ethers.keccak256(ethers.toUtf8Bytes("wallets"));
    const interestsHash = ethers.keccak256(ethers.toUtf8Bytes("interests"));
    const signed = await signDisclosure(
      f.disclosureRegistry,
      f.proposer,
      proposalId,
      walletListHash,
      interestsHash,
      0n
    );
    await f.disclosureRegistry.connect(f.proposer).submitDisclosure(
      signed.proposalId,
      signed.proposer,
      signed.walletListHash,
      signed.interestsHash,
      signed.bondAmount,
      signed.nonce,
      signed.v,
      signed.r,
      signed.s
    );
    const disclosureHash = await f.disclosureRegistry.getDisclosureHash(proposalId);
    const { hashActions, hashRules } = await import("../packages/shared/hash");
    await f.registry.connect(f.proposer).createProposal(
      ethers.keccak256(ethers.toUtf8Bytes("Benign")),
      ethers.keccak256(ethers.toUtf8Bytes("evidence")),
      ethers.keccak256(ethers.toUtf8Bytes("budget")),
      ethers.keccak256(ethers.toUtf8Bytes("audit")),
      hashRules(rules),
      disclosureHash
    );
    const versionHash = await f.registry.latestVersionHash(proposalId);
    await f.governor.connect(f.proposer).submitProposal(
      proposalId,
      1n,
      versionHash,
      hashActions(actions),
      hashRules(rules),
      disclosureHash
    );
    const govId = (await f.governor.nextGovId()) - 1n;
    await f.governor.connect(f.proposer).openVoting(govId);

    const bundle = await bundleFrom(f.governor, govId, actions, rules);
    const preview = await previewProposal(proposalId, {
      provider: ethers.provider,
      governor: f.governor,
      executor: f.executor,
      bundle,
      noCache: true,
    });
    expect(preview.status).to.equal("OK");

    const evaluation = {
      proposalId: proposalId.toString(),
      stages: [
        {
          stage: "CLAIMS" as const,
          score: 1,
          status: "GREEN" as const,
          reason: "test",
          factors: [],
          drilldown: "test",
        },
      ],
    };
    const briefHash = computeBriefHash(evaluation, preview.previewHash);
    const evaluationOnly = computeBriefHash(evaluation, null);
    expect(briefHash).to.not.equal(evaluationOnly);

    await f.governor.connect(f.voter1).voteWithBrief(govId, 1, briefHash);
    const record = await f.governor.getVote(govId, f.voter1.address);
    expect(record.hasVoted).to.equal(true);
    expect(record.briefHash).to.equal(briefHash);
    expect(record.briefHash).to.not.equal(evaluationOnly);
  });

  it("[preview] mutated rules are refused with UNAVAILABLE", async () => {
    const f = await deployAegisFixture();
    const usdcAddress = await f.usdc.getAddress();
    const actions: Action[] = [
      {
        target: usdcAddress,
        value: 0n,
        data: f.usdc.interface.encodeFunctionData("transfer", [
          f.devWallet.address,
          USDC(5000),
        ]),
      },
    ];
    const rules: ActionRule[] = [
      {
        kind: ActionKind.ERC20_TRANSFER,
        target: usdcAddress,
        selector: "0xa9059cbb",
        counterparty: f.devWallet.address,
        maxAmount: USDC(5000),
        codeHash: ZERO,
        childCount: 0,
      },
    ];
    const queued = await proposeAndQueue(f, actions, rules, "Mutated rules");
    const bundle = await bundleFrom(f.governor, queued.govId, actions, rules);
    bundle.rules[0].maxAmount = USDC(1_000_000).toString();

    const preview = await previewProposal(queued.proposalId, {
      provider: ethers.provider,
      governor: f.governor,
      executor: f.executor,
      bundle,
      noCache: true,
    });

    expect(preview.status).to.equal("UNAVAILABLE");
    expect(preview.reason ?? "").to.match(/rules hash/i);
  });
});