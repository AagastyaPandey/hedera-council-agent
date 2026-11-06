import { expect } from "chai";
import { ethers } from "hardhat";
import { deployAegisFixture, proposeAndQueue } from "./redteam/fixture";
import { scanBytecode } from "../sentinel/scan";
import { simulateProposalExecution } from "../sentinel/simulate";
import { haltProposal } from "../sentinel/halt";
import { Action, ActionRule, ActionKind } from "../packages/shared/hash";

describe("Sentinel · Simulation, Bytecode Analysis & Guardian Halting", () => {
  it("scans bytecode and detects DELEGATECALL and SELFDESTRUCT in MaliciousImpl", async () => {
    const f = await deployAegisFixture();
    const maliciousAddr = await f.maliciousImpl.getAddress();

    const scan = await scanBytecode(ethers.provider, maliciousAddr);
    expect(scan.hasDelegateCall).to.be.true;
    expect(scan.hasSelfDestruct).to.be.true;
    expect(scan.violations.length).to.be.greaterThan(0);

    // Verify clean contract
    const usdcScan = await scanBytecode(ethers.provider, await f.usdc.getAddress());
    expect(usdcScan.hasDelegateCall).to.be.false;
    expect(usdcScan.hasSelfDestruct).to.be.false;
    expect(usdcScan.violations.length).to.equal(0);
  });

  it("simulates a benign transfer, captures the trace, and does not halt", async () => {
    const f = await deployAegisFixture();
    const usdcAddr = await f.usdc.getAddress();

    const rules: ActionRule[] = [
      {
        kind: ActionKind.ERC20_TRANSFER,
        target: usdcAddr,
        selector: "0xa9059cbb",
        counterparty: f.devWallet.address,
        maxAmount: 5_000n * 1_000_000n,
        codeHash: ethers.ZeroHash,
        childCount: 0,
      },
    ];

    const q = await proposeAndQueue(
      f,
      [
        {
          target: usdcAddr,
          value: 0n,
          data: f.usdc.interface.encodeFunctionData("transfer", [
            f.devWallet.address,
            5_000n * 1_000_000n,
          ]),
        },
      ],
      rules,
      "Benign Transfer"
    );

    const sim = await simulateProposalExecution(
      f.executor,
      q.proposalId,
      q.version,
      q.versionHash,
      q.disclosureHash,
      [
        {
          target: usdcAddr,
          value: 0n,
          data: f.usdc.interface.encodeFunctionData("transfer", [
            f.devWallet.address,
            5_000n * 1_000_000n,
          ]),
        },
      ],
      rules,
      {
        treasuryProxy: await f.treasuryProxy.getAddress(),
        feeModule: await f.feeModule.getAddress(),
        executor: await f.executor.getAddress(),
        usdc: usdcAddr,
      },
      [f.devWallet.address, f.attacker.address]
    );

    expect(sim.commitment).to.equal(q.commitment);
    expect(sim.commitmentMismatch).to.be.false;
    expect(sim.reverted).to.be.false;
    expect(sim.shouldHalt).to.be.false;
    expect(sim.trace).to.exist;
    expect(sim.trace!.tokenTransfers.length).to.be.greaterThan(0);
    expect(sim.diffReport.hasViolations).to.be.false;

    // evm_revert restored the queued state
    expect(await f.executor.getState(q.commitment)).to.equal(1);
  });

  it("warps the sandbox to the queue ETA without changing live chain time", async () => {
    const f = await deployAegisFixture();
    const usdcAddr = await f.usdc.getAddress();
    const amount = 5_000n * 1_000_000n;
    const rules: ActionRule[] = [
      {
        kind: ActionKind.ERC20_TRANSFER,
        target: usdcAddr,
        selector: "0xa9059cbb",
        counterparty: f.devWallet.address,
        maxAmount: amount,
        codeHash: ethers.ZeroHash,
        childCount: 0,
      },
    ];
    const actions = [
      {
        target: usdcAddr,
        value: 0n,
        data: f.usdc.interface.encodeFunctionData("transfer", [
          f.devWallet.address,
          amount,
        ]),
      },
    ];

    const q = await proposeAndQueue(f, actions, rules, "Warp Test", {
      advanceTimelock: false,
    });
    const before = await ethers.provider.getBlock("latest");
    expect(before).to.exist;

    const sim = await simulateProposalExecution(
      f.executor,
      q.proposalId,
      q.version,
      q.versionHash,
      q.disclosureHash,
      actions,
      rules,
      {
        treasuryProxy: await f.treasuryProxy.getAddress(),
        feeModule: await f.feeModule.getAddress(),
        executor: await f.executor.getAddress(),
        usdc: usdcAddr,
      },
      [f.devWallet.address, f.attacker.address],
      { signer: f.deployer, warpToEta: true }
    );

    expect(sim.commitment).to.equal(q.commitment);
    expect(sim.shouldHalt).to.be.false;
    expect(sim.reverted).to.be.false;
    expect(sim.txHash).to.exist;

    const after = await ethers.provider.getBlock("latest");
    expect(after!.number).to.equal(before!.number);
    expect(after!.timestamp).to.equal(before!.timestamp);
    expect(await f.executor.getState(q.commitment)).to.equal(1);
    expect(await f.usdc.balanceOf(f.devWallet.address)).to.equal(0n);
  });

  it("flags an on-chain-valid action that drains treasury funds as a side effect", async () => {
    const f = await deployAegisFixture();
    const treasuryAddr = await f.treasuryProxy.getAddress();
    const usdcAddr = await f.usdc.getAddress();
    const withdrawAmount = 50_000n * 1_000_000n;

    const withdrawSelector = f.treasuryProxy.interface.getFunction("withdrawERC20")!.selector;
    const rules: ActionRule[] = [
      {
        kind: ActionKind.PARAM_SET,
        target: treasuryAddr,
        selector: withdrawSelector,
        counterparty: ethers.ZeroAddress,
        // maxAmount = 0 disables ActionDecoder's first-uint256 bound check
        maxAmount: 0n,
        codeHash: ethers.ZeroHash,
        childCount: 0,
      },
    ];

    const drainAction: Action = {
      target: treasuryAddr,
      value: 0n,
      data: f.treasuryProxy.interface.encodeFunctionData("withdrawERC20", [
        usdcAddr,
        f.attacker.address,
        withdrawAmount,
      ]),
    };

    const q = await proposeAndQueue(
      f,
      [drainAction],
      rules,
      "Withdraw Treasury Funds"
    );

    const sim = await simulateProposalExecution(
      f.executor,
      q.proposalId,
      q.version,
      q.versionHash,
      q.disclosureHash,
      [drainAction],
      rules,
      {
        treasuryProxy: treasuryAddr,
        feeModule: await f.feeModule.getAddress(),
        executor: await f.executor.getAddress(),
        usdc: usdcAddr,
      },
      [f.devWallet.address, f.attacker.address]
    );

    // The on-chain typed rule accepts the call; the Sentinel catches the
    // token movement and balance drop through the trace and state diff.
    expect(sim.commitment).to.equal(q.commitment);
    expect(sim.reverted).to.be.false;
    expect(sim.shouldHalt).to.be.true;
    expect(sim.trace!.tokenTransfers.length).to.be.greaterThan(0);
    expect(sim.diffReport.violations.map((v) => v.category)).to.include("TRANSFER");
    expect(sim.diffReport.violations.map((v) => v.category)).to.include("BALANCE");

    const receipt = await haltProposal(f.executor, f.guardian, q.commitment, sim);
    expect(receipt.txHash).to.exist;
    expect(receipt.report.layer).to.equal("sentinel");
    expect(receipt.report.status).to.equal("FLAGGED");
    expect(receipt.report.evidence.commitment).to.equal(q.commitment);
    expect(receipt.report.submitted[0].function).to.include("withdrawERC20");
    expect(receipt.report.violatedConstraint.code).to.not.equal("None");

    expect(await f.executor.getState(q.commitment)).to.equal(3);
  });

  it("simulates queued proposal in sandbox, detects violation, and executes guardian halt", async () => {
    const f = await deployAegisFixture();
    const feeModuleAddr = await f.feeModule.getAddress();
    const maliciousImplAddr = await f.maliciousImpl.getAddress();

    // 1. Proposal queued with benign rules
    const legitRules: ActionRule[] = [
      {
        kind: ActionKind.PARAM_SET,
        target: feeModuleAddr,
        selector: "0x694b8e39",
        counterparty: ethers.ZeroAddress,
        maxAmount: 50n,
        codeHash: ethers.ZeroHash,
        childCount: 0,
      },
    ];

    const q = await proposeAndQueue(
      f,
      [
        {
          target: feeModuleAddr,
          value: 0n,
          data: f.feeModule.interface.encodeFunctionData("setFee", [20]),
        },
      ],
      legitRules,
      "Monitored Proposal"
    );

    // 2. Attacker prepares malicious payload
    const attackActions: Action[] = [
      {
        target: maliciousImplAddr,
        value: 0n,
        data: f.maliciousImpl.interface.encodeFunctionData("backdoorDrain", [
          await f.usdc.getAddress(),
        ]),
      },
    ];

    // 3. Sentinel runs simulation
    const simResult = await simulateProposalExecution(
      f.executor,
      q.proposalId,
      q.version,
      q.versionHash,
      q.disclosureHash,
      attackActions,
      legitRules,
      {
        treasuryProxy: await f.treasuryProxy.getAddress(),
        feeModule: feeModuleAddr,
        executor: await f.executor.getAddress(),
        usdc: await f.usdc.getAddress(),
      },
      [f.devWallet.address, f.attacker.address]
    );

    expect(simResult.shouldHalt).to.be.true;
    expect(simResult.haltReason).to.exist;

    // 4. Guardian executes halt during timelock
    const receipt = await haltProposal(
      f.executor,
      f.guardian,
      q.commitment,
      simResult
    );

    expect(receipt.txHash).to.exist;

    // 5. Executor state is now Halted (3)
    const state = await f.executor.getState(q.commitment);
    expect(state).to.equal(3); // Halted

    // 6. Attempting to execute reverts because state is Halted
    await expect(
      f.executor.execute(
        q.proposalId,
        q.version,
        q.versionHash,
        q.disclosureHash,
        attackActions,
        legitRules
      )
    ).to.be.revertedWithCustomError(f.executor, "ProposalNotInState");
  });
});
