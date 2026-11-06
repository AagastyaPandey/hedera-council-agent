import { expect } from "chai";
import { ethers } from "hardhat";
import { deployAegisFixture, proposeAndQueue } from "./fixture";
import { Action, ActionRule, ActionKind } from "../../packages/shared/hash";

const AMOUNT = 5_000n * 1_000_000n;

describe("Red-Team Arena · Scenario 9: Stale Version Supersession", () => {
  it("[S9] rejects execution of a version superseded by an amendment", async () => {
    const f = await deployAegisFixture();
    const usdcAddr = await f.usdc.getAddress();

    const calldata = f.usdc.interface.encodeFunctionData("transfer", [
      f.devWallet.address,
      AMOUNT,
    ]);
    const actions: Action[] = [{ target: usdcAddr, value: 0n, data: calldata }];
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

    const q = await proposeAndQueue(f, actions, rules, "Proposal v1: Dev Grant");

    const newContentHash = ethers.keccak256(
      ethers.toUtf8Bytes("Proposal v2: Amended Scope")
    );
    await f.registry.connect(f.proposer).addVersion(
      q.proposalId,
      newContentHash,
      ethers.keccak256(ethers.toUtf8Bytes("evidence-v2.json")),
      ethers.keccak256(ethers.toUtf8Bytes("budget-v2")),
      ethers.keccak256(ethers.toUtf8Bytes("audit-v2")),
      q.intentHash,
      ethers.keccak256(ethers.toUtf8Bytes("wallets-v2"))
    );

    const latestVersion = await f.registry.latestVersionHash(q.proposalId);
    expect(latestVersion).to.not.equal(q.versionHash);
    expect(await f.registry.verifyChain(q.proposalId)).to.equal(true);

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
      .to.be.revertedWithCustomError(f.executor, "VersionSuperseded")
      .withArgs(q.proposalId, latestVersion, q.versionHash);

    expect(await f.usdc.balanceOf(f.devWallet.address)).to.equal(0n);
  });
});
