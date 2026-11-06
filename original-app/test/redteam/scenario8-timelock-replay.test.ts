import { expect } from "chai";
import { ethers } from "hardhat";
import { deployAegisFixture, proposeAndQueue } from "./fixture";
import {
  Action,
  ActionRule,
  ActionKind,
  computeCommitment,
} from "../../packages/shared/hash";

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

describe("Red-Team Arena · Scenario 8: Timelock & Replay Protection", () => {
  it("[S8] rejects execution before the timelock expires", async () => {
    const f = await deployAegisFixture();
    const usdcAddr = await f.usdc.getAddress();

    const calldata = f.usdc.interface.encodeFunctionData("transfer", [
      f.devWallet.address,
      AMOUNT,
    ]);
    const actions: Action[] = [{ target: usdcAddr, value: 0n, data: calldata }];
    const rules = [transferRule(usdcAddr, f.devWallet.address)];

    const q = await proposeAndQueue(f, actions, rules, "Dev Grant", {
      advanceTimelock: false,
    });

    await expect(
      f.executor.execute(
        q.proposalId,
        q.version,
        q.versionHash,
        q.disclosureHash,
        actions,
        rules
      )
    ).to.be.revertedWithCustomError(f.executor, "TimelockNotExpired");

    expect(await f.usdc.balanceOf(f.devWallet.address)).to.equal(0n);
  });

  it("[S8] rejects a second execution of the same commitment", async () => {
    const f = await deployAegisFixture();
    const usdcAddr = await f.usdc.getAddress();

    const calldata = f.usdc.interface.encodeFunctionData("transfer", [
      f.devWallet.address,
      AMOUNT,
    ]);
    const actions: Action[] = [{ target: usdcAddr, value: 0n, data: calldata }];
    const rules = [transferRule(usdcAddr, f.devWallet.address)];

    const q = await proposeAndQueue(f, actions, rules, "Dev Grant");

    await f.executor.execute(
      q.proposalId,
      q.version,
      q.versionHash,
      q.disclosureHash,
      actions,
      rules
    );

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
      .to.be.revertedWithCustomError(f.executor, "ProposalNotInState")
      .withArgs(1n, 2n); // expected Queued, actual Executed

    expect(await f.usdc.balanceOf(f.devWallet.address)).to.equal(AMOUNT);
  });

  it("[S8] binds the commitment to the chain id", async () => {
    const f = await deployAegisFixture();
    const usdcAddr = await f.usdc.getAddress();
    const executorAddr = await f.executor.getAddress();

    const calldata = f.usdc.interface.encodeFunctionData("transfer", [
      f.devWallet.address,
      AMOUNT,
    ]);
    const actions: Action[] = [{ target: usdcAddr, value: 0n, data: calldata }];
    const rules = [transferRule(usdcAddr, f.devWallet.address)];

    const q = await proposeAndQueue(f, actions, rules, "Dev Grant");

    const base = {
      executor: executorAddr,
      proposalId: q.proposalId,
      version: q.version,
      versionHash: q.versionHash,
      actionsHash: q.actionsHash,
      intentHash: q.intentHash,
      disclosureHash: q.disclosureHash,
    };

    expect(computeCommitment({ ...base, chainId: f.chainId })).to.equal(
      q.commitment
    );
    expect(computeCommitment({ ...base, chainId: f.chainId + 1n })).to.not.equal(
      q.commitment
    );
  });
});
