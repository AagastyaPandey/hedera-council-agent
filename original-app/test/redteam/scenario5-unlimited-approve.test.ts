import { expect } from "chai";
import { ethers } from "hardhat";
import { deployAegisFixture, proposeAndQueue } from "./fixture";
import { Action, ActionRule, ActionKind } from "../../packages/shared/hash";

const CEILING = 5_000n * 1_000_000n;

function approveRule(usdc: string, spender: string): ActionRule {
  return {
    kind: ActionKind.ERC20_APPROVE,
    target: usdc,
    selector: "0x095ea7b3", // approve(address,uint256)
    counterparty: spender,
    maxAmount: CEILING,
    codeHash: ethers.ZeroHash,
    childCount: 0,
  };
}

describe("Red-Team Arena · Scenario 5: Unlimited Approval Disguised as Payment", () => {
  it("[S5] rejects an unlimited approve disguised as a bounded payment", async () => {
    const f = await deployAegisFixture();
    const usdcAddr = await f.usdc.getAddress();
    const executorAddr = await f.executor.getAddress();

    const approveCalldata = f.usdc.interface.encodeFunctionData("approve", [
      f.attacker.address,
      ethers.MaxUint256,
    ]);
    const attackActions: Action[] = [
      { target: usdcAddr, value: 0n, data: approveCalldata },
    ];
    const rules = [approveRule(usdcAddr, f.attacker.address)];

    const q = await proposeAndQueue(f, attackActions, rules, "Dev payment");

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
      .to.be.revertedWithCustomError(f.executor, "UnlimitedApprovalNotCommitted")
      .withArgs(f.attacker.address);

    expect(
      await f.usdc.allowance(executorAddr, f.attacker.address)
    ).to.equal(0n);
  });

  it("[S5] rejects an approve above the committed allowance ceiling", async () => {
    const f = await deployAegisFixture();
    const usdcAddr = await f.usdc.getAddress();
    const executorAddr = await f.executor.getAddress();

    const overLimit = CEILING + 1n;
    const approveCalldata = f.usdc.interface.encodeFunctionData("approve", [
      f.attacker.address,
      overLimit,
    ]);
    const attackActions: Action[] = [
      { target: usdcAddr, value: 0n, data: approveCalldata },
    ];
    const rules = [approveRule(usdcAddr, f.attacker.address)];

    const q = await proposeAndQueue(f, attackActions, rules, "Dev payment");

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
      .to.be.revertedWithCustomError(f.executor, "ExceedsSpendLimit")
      .withArgs(CEILING, overLimit);

    expect(
      await f.usdc.allowance(executorAddr, f.attacker.address)
    ).to.equal(0n);
  });
});
