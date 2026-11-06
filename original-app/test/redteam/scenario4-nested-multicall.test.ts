import { expect } from "chai";
import { ethers } from "hardhat";
import { deployAegisFixture, proposeAndQueue } from "./fixture";
import { Action, ActionRule, ActionKind } from "../../packages/shared/hash";

describe("Red-Team Arena · Scenario 4: Nested Multicall Hiding Ownership Transfer", () => {
  it("[S4] executes a fully committed multicall", async () => {
    const f = await deployAegisFixture();
    const feeModuleAddr = await f.feeModule.getAddress();

    const setFeeData = f.feeModule.interface.encodeFunctionData("setFee", [40]);
    const multicallData = f.feeModule.interface.encodeFunctionData("multicall", [
      [setFeeData],
    ]);
    const multicallSelector = f.feeModule.interface.getFunction("multicall")!
      .selector;
    const setFeeSelector = f.feeModule.interface.getFunction("setFee")!.selector;

    const actions: Action[] = [
      { target: feeModuleAddr, value: 0n, data: multicallData },
    ];
    const rules: ActionRule[] = [
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

    const q = await proposeAndQueue(f, actions, rules, "Tweak Fee via Multicall");

    await f.executor.execute(
      q.proposalId,
      q.version,
      q.versionHash,
      q.disclosureHash,
      actions,
      rules
    );

    expect(await f.feeModule.feeBps()).to.equal(40n);
  });

  it("[S4] rejects a multicall with more inner calls than committed child rules", async () => {
    const f = await deployAegisFixture();
    const feeModuleAddr = await f.feeModule.getAddress();

    const setFeeData = f.feeModule.interface.encodeFunctionData("setFee", [40]);
    const transferOwnershipData = f.feeModule.interface.encodeFunctionData(
      "transferOwnership",
      [f.attacker.address]
    );
    const attackData = f.feeModule.interface.encodeFunctionData("multicall", [
      [setFeeData, transferOwnershipData],
    ]);
    const multicallSelector = f.feeModule.interface.getFunction("multicall")!
      .selector;
    const setFeeSelector = f.feeModule.interface.getFunction("setFee")!.selector;

    const attackActions: Action[] = [
      { target: feeModuleAddr, value: 0n, data: attackData },
    ];
    const rules: ActionRule[] = [
      {
        kind: ActionKind.MULTICALL,
        target: feeModuleAddr,
        selector: multicallSelector,
        counterparty: ethers.ZeroAddress,
        maxAmount: 0n,
        codeHash: ethers.ZeroHash,
        childCount: 1, // exactly one child was committed
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

    const q = await proposeAndQueue(
      f,
      attackActions,
      rules,
      "Tweak Fee via Multicall (payload committed)"
    );

    await expect(
      f.executor.execute(
        q.proposalId,
        q.version,
        q.versionHash,
        q.disclosureHash,
        attackActions,
        rules
      )
    )
      .to.be.revertedWithCustomError(f.executor, "MulticallChildCountMismatch")
      .withArgs(1n, 2n);

    expect(await f.feeModule.owner()).to.equal(
      await f.executor.getAddress()
    );
  });

  it("[S4] rejects a hidden transferOwnership inside a multicall", async () => {
    const f = await deployAegisFixture();
    const feeModuleAddr = await f.feeModule.getAddress();
    const executorAddr = await f.executor.getAddress();

    const setFeeData = f.feeModule.interface.encodeFunctionData("setFee", [40]);
    const transferOwnershipData = f.feeModule.interface.encodeFunctionData(
      "transferOwnership",
      [f.attacker.address]
    );
    const attackData = f.feeModule.interface.encodeFunctionData("multicall", [
      [setFeeData, transferOwnershipData],
    ]);
    const multicallSelector = f.feeModule.interface.getFunction("multicall")!
      .selector;
    const setFeeSelector = f.feeModule.interface.getFunction("setFee")!.selector;
    const transferOwnershipSelector =
      f.feeModule.interface.getFunction("transferOwnership")!.selector;

    const attackActions: Action[] = [
      { target: feeModuleAddr, value: 0n, data: attackData },
    ];
    // Child count matches the payload, so the hidden call reaches selector
    // enforcement instead of being rejected by the count check.
    const rules: ActionRule[] = [
      {
        kind: ActionKind.MULTICALL,
        target: feeModuleAddr,
        selector: multicallSelector,
        counterparty: ethers.ZeroAddress,
        maxAmount: 0n,
        codeHash: ethers.ZeroHash,
        childCount: 2,
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

    const q = await proposeAndQueue(
      f,
      attackActions,
      rules,
      "Tweak Fee via Multicall (hidden call)"
    );

    await expect(
      f.executor.execute(
        q.proposalId,
        q.version,
        q.versionHash,
        q.disclosureHash,
        attackActions,
        rules
      )
    )
      .to.be.revertedWithCustomError(f.executor, "SelectorNotAllowed")
      .withArgs(setFeeSelector, transferOwnershipSelector);

    expect(await f.feeModule.owner()).to.equal(executorAddr);
  });
});
