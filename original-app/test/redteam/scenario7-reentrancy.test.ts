import { expect } from "chai";
import { ethers } from "hardhat";
import { deployAegisFixture, proposeAndQueue } from "./fixture";
import { Action, ActionRule, ActionKind } from "../../packages/shared/hash";

describe("Red-Team Arena · Scenario 7: Re-entrancy", () => {
  it("[S7] rejects a re-entrant execute call with ReentrancyGuardReentrantCall", async () => {
    const f = await deployAegisFixture();
    const recipientAddr = await f.reentrantRecipient.getAddress();

    const attackCalldata = f.reentrantRecipient.interface.encodeFunctionData(
      "attackOnReceive"
    );
    const selector = f.reentrantRecipient.interface.getFunction(
      "attackOnReceive"
    )!.selector;

    const actions: Action[] = [
      { target: recipientAddr, value: 0n, data: attackCalldata },
    ];
    const rules: ActionRule[] = [
      {
        kind: ActionKind.PARAM_SET,
        target: recipientAddr,
        selector,
        counterparty: ethers.ZeroAddress,
        maxAmount: 0n,
        codeHash: ethers.ZeroHash,
        childCount: 0,
      },
    ];

    const q = await proposeAndQueue(
      f,
      actions,
      rules,
      "Proposal targeting reentrant contract"
    );

    await f.reentrantRecipient.setAttackParams(
      q.proposalId,
      q.version,
      q.versionHash,
      q.disclosureHash,
      actions,
      rules
    );

    // The recipient's callback re-enters execute(); the guard rejects it and
    // the recipient bubbles the revert, which the executor wraps.
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
      .to.be.revertedWithCustomError(f.executor, "ActionExecutionFailed")
      .withArgs(0n, recipientAddr, "0x3ee5aeb5"); // ReentrancyGuardReentrantCall()

    // The whole outer transaction rolled back, so the proposal is still queued.
    expect(await f.executor.getState(q.commitment)).to.equal(1n);
  });
});
