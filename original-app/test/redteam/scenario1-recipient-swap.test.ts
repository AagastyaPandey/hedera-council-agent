import { expect } from "chai";
import { ethers } from "hardhat";
import { deployAegisFixture, proposeAndQueue } from "./fixture";
import { Action, ActionRule, ActionKind } from "../../packages/shared/hash";

const AMOUNT = 5_000n * 1_000_000n;

function transferRule(usdc: string, recipient: string): ActionRule {
  return {
    kind: ActionKind.ERC20_TRANSFER,
    target: usdc,
    selector: "0xa9059cbb",
    counterparty: recipient,
    maxAmount: AMOUNT,
    codeHash: ethers.ZeroHash,
    childCount: 0,
  };
}

describe("Red-Team Arena · Scenario 1: Post-Vote Recipient Substitution", () => {
  it("[S1] rejects an unqueued commitment when calldata is swapped after the vote", async () => {
    const f = await deployAegisFixture();
    const usdcAddr = await f.usdc.getAddress();

    const legitCalldata = f.usdc.interface.encodeFunctionData("transfer", [
      f.devWallet.address,
      AMOUNT,
    ]);
    const legitActions: Action[] = [
      { target: usdcAddr, value: 0n, data: legitCalldata },
    ];
    const legitRules = [transferRule(usdcAddr, f.devWallet.address)];

    const q = await proposeAndQueue(f, legitActions, legitRules, "Dev Grant");

    // Attacker swaps the recipient after the vote. The recomputed commitment
    // no longer matches the queued one, so there is no queued proposal at all.
    const attackCalldata = f.usdc.interface.encodeFunctionData("transfer", [
      f.attacker.address,
      AMOUNT,
    ]);
    const attackActions: Action[] = [
      { target: usdcAddr, value: 0n, data: attackCalldata },
    ];

    await expect(
      f.executor.execute(
        q.proposalId,
        q.version,
        q.versionHash,
        q.disclosureHash,
        attackActions,
        legitRules
      )
    )
      .to.be.revertedWithCustomError(f.executor, "ProposalNotInState")
      .withArgs(1n, 0n); // expected Queued, actual Empty

    expect(await f.usdc.balanceOf(f.attacker.address)).to.equal(0n);
  });

  it("[S1] rejects the substituted recipient at rule enforcement", async () => {
    const f = await deployAegisFixture();
    const usdcAddr = await f.usdc.getAddress();

    // The malicious payload is the one committed (actionsHash binds it), but
    // the committed intent rule only authorises the approved dev wallet.
    const attackCalldata = f.usdc.interface.encodeFunctionData("transfer", [
      f.attacker.address,
      AMOUNT,
    ]);
    const attackActions: Action[] = [
      { target: usdcAddr, value: 0n, data: attackCalldata },
    ];
    const rules = [transferRule(usdcAddr, f.devWallet.address)];

    const q = await proposeAndQueue(
      f,
      attackActions,
      rules,
      "Dev Grant (recipient committed)"
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
      .to.be.revertedWithCustomError(f.executor, "UnauthorizedRecipient")
      .withArgs(f.devWallet.address, f.attacker.address);

    expect(await f.usdc.balanceOf(f.attacker.address)).to.equal(0n);
    expect(await f.executor.getState(q.commitment)).to.equal(1n); // still Queued
  });
});
