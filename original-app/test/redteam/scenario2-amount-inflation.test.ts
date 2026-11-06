import { expect } from "chai";
import { ethers } from "hardhat";
import { deployAegisFixture, proposeAndQueue } from "./fixture";
import { Action, ActionRule, ActionKind } from "../../packages/shared/hash";

const APPROVED = 5_000n * 1_000_000n;
const INFLATED = 50_000n * 1_000_000n;

function transferRule(usdc: string, recipient: string, maxAmount: bigint): ActionRule {
  return {
    kind: ActionKind.ERC20_TRANSFER,
    target: usdc,
    selector: "0xa9059cbb",
    counterparty: recipient,
    maxAmount,
    codeHash: ethers.ZeroHash,
    childCount: 0,
  };
}

describe("Red-Team Arena · Scenario 2: Amount Inflation", () => {
  it("[S2] rejects an amount above the committed ceiling at rule enforcement", async () => {
    const f = await deployAegisFixture();
    const usdcAddr = await f.usdc.getAddress();
    const executorAddr = await f.executor.getAddress();

    // The inflated amount is what got committed, but the ceiling stays 5,000.
    const attackCalldata = f.usdc.interface.encodeFunctionData("transfer", [
      f.devWallet.address,
      INFLATED,
    ]);
    const attackActions: Action[] = [
      { target: usdcAddr, value: 0n, data: attackCalldata },
    ];
    const rules = [transferRule(usdcAddr, f.devWallet.address, APPROVED)];

    const q = await proposeAndQueue(f, attackActions, rules, "Dev Grant 5000");

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
      .withArgs(APPROVED, INFLATED);

    expect(await f.usdc.balanceOf(f.devWallet.address)).to.equal(0n);
    expect(await f.usdc.balanceOf(executorAddr)).to.equal(100_000n * 1_000_000n);
  });

  it("[S2] rejects a post-vote amount change at commitment verification", async () => {
    const f = await deployAegisFixture();
    const usdcAddr = await f.usdc.getAddress();

    const legitCalldata = f.usdc.interface.encodeFunctionData("transfer", [
      f.devWallet.address,
      APPROVED,
    ]);
    const legitActions: Action[] = [
      { target: usdcAddr, value: 0n, data: legitCalldata },
    ];
    const rules = [transferRule(usdcAddr, f.devWallet.address, APPROVED)];

    const q = await proposeAndQueue(f, legitActions, rules, "Dev Grant 5000");

    const inflatedCalldata = f.usdc.interface.encodeFunctionData("transfer", [
      f.devWallet.address,
      INFLATED,
    ]);
    const attackActions: Action[] = [
      { target: usdcAddr, value: 0n, data: inflatedCalldata },
    ];

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
      .to.be.revertedWithCustomError(f.executor, "ProposalNotInState")
      .withArgs(1n, 0n);

    expect(await f.usdc.balanceOf(f.devWallet.address)).to.equal(0n);
  });
});
