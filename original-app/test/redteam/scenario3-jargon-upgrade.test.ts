import { expect } from "chai";
import { ethers } from "hardhat";
import { deployAegisFixture, proposeAndQueue } from "./fixture";
import { Action, ActionRule, ActionKind } from "../../packages/shared/hash";

describe("Red-Team Arena · Scenario 3: Jargon Upgrade", () => {
  it("[S3] rejects an upgrade selector disguised as parameter tuning", async () => {
    const f = await deployAegisFixture();
    const treasuryAddr = await f.treasuryProxy.getAddress();
    const maliciousImplAddr = await f.maliciousImpl.getAddress();

    // Proposal text says "routine parameter tuning"; the committed rule only
    // authorises setFee(uint256) on the fee module.
    const upgradeCalldata = f.treasuryProxy.interface.encodeFunctionData(
      "upgradeTo",
      [maliciousImplAddr]
    );
    const attackActions: Action[] = [
      { target: treasuryAddr, value: 0n, data: upgradeCalldata },
    ];
    const rules: ActionRule[] = [
      {
        kind: ActionKind.PARAM_SET,
        target: treasuryAddr,
        selector: "0x694b8e39", // setFee(uint256)
        counterparty: ethers.ZeroAddress,
        maxAmount: 100n,
        codeHash: ethers.ZeroHash,
        childCount: 0,
      },
    ];

    const q = await proposeAndQueue(f, attackActions, rules, "Parameter Tuning");

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
      .withArgs("0x694b8e39", "0x3659cfe6");

    expect(await f.treasuryProxy.implementation()).to.not.equal(maliciousImplAddr);
  });

  it("[S3] rejects an upgrade whose implementation code hash is not committed", async () => {
    const f = await deployAegisFixture();
    const treasuryAddr = await f.treasuryProxy.getAddress();
    const maliciousImplAddr = await f.maliciousImpl.getAddress();
    const feeModuleAddr = await f.feeModule.getAddress();

    const upgradeCalldata = f.treasuryProxy.interface.encodeFunctionData(
      "upgradeTo",
      [maliciousImplAddr]
    );
    const attackActions: Action[] = [
      { target: treasuryAddr, value: 0n, data: upgradeCalldata },
    ];

    // The rule names the malicious implementation but commits to a different
    // code hash, as if the implementation was swapped after the vote.
    const uncommittedCodeHash = ethers.keccak256(
      ethers.toUtf8Bytes("a-different-implementation")
    );
    const actualCodeHash = ethers.keccak256(
      await ethers.provider.getCode(maliciousImplAddr)
    );
    expect(uncommittedCodeHash).to.not.equal(actualCodeHash);

    const rules: ActionRule[] = [
      {
        kind: ActionKind.UPGRADE,
        target: treasuryAddr,
        selector: "0x3659cfe6", // upgradeTo(address)
        counterparty: maliciousImplAddr,
        maxAmount: 0n,
        codeHash: uncommittedCodeHash,
        childCount: 0,
      },
    ];

    const q = await proposeAndQueue(
      f,
      attackActions,
      rules,
      "Parameter Tuning (upgrade committed)"
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
      .to.be.revertedWithCustomError(f.executor, "CodeHashMismatch")
      .withArgs(uncommittedCodeHash, actualCodeHash);

    expect(await f.treasuryProxy.implementation()).to.equal(feeModuleAddr);
  });
});
