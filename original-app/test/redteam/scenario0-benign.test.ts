import { expect } from "chai";
import { ethers } from "hardhat";
import { deployAegisFixture, proposeAndQueue } from "./fixture";
import { Action, ActionRule, ActionKind } from "../../packages/shared/hash";

describe("Red-Team Arena · Scenario 0: Benign Transfer", () => {
  it("[S0] executes a 5,000 USDC transfer to the approved dev wallet", async () => {
    const f = await deployAegisFixture();
    const usdcAddr = await f.usdc.getAddress();
    const executorAddr = await f.executor.getAddress();
    const amount = 5_000n * 1_000_000n;

    const calldata = f.usdc.interface.encodeFunctionData("transfer", [
      f.devWallet.address,
      amount,
    ]);

    const actions: Action[] = [{ target: usdcAddr, value: 0n, data: calldata }];
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

    const q = await proposeAndQueue(f, actions, rules, "Benign Dev Transfer");
    const executorBalanceBefore = await f.usdc.balanceOf(executorAddr);

    await expect(
      f.executor.execute(
        q.proposalId,
        q.version,
        q.versionHash,
        q.disclosureHash,
        actions,
        rules
      )
    )
      .to.emit(f.executor, "ProposalExecuted")
      .withArgs(q.commitment, q.proposalId);

    expect(await f.usdc.balanceOf(f.devWallet.address)).to.equal(amount);
    expect(await f.usdc.balanceOf(executorAddr)).to.equal(
      executorBalanceBefore - amount
    );
    expect(await f.executor.getState(q.commitment)).to.equal(2n); // Executed
  });
});
