import { expect } from "chai";
import { ethers } from "hardhat";
import { deployAegisFixture, proposeAndQueue } from "./fixture";
import { Action, ActionRule, ActionKind } from "../../packages/shared/hash";
import { OPCODE_DELEGATECALL, hasOpcode } from "./evm";

describe("Red-Team Arena · Scenario 6: Delegatecall Payload Protection", () => {
  it("[S6] executor runtime bytecode contains no DELEGATECALL opcode", async () => {
    const f = await deployAegisFixture();
    const executorCode = await ethers.provider.getCode(
      await f.executor.getAddress()
    );
    const maliciousCode = await ethers.provider.getCode(
      await f.maliciousImpl.getAddress()
    );

    expect(executorCode.length).to.be.greaterThan(2);
    expect(hasOpcode(executorCode, OPCODE_DELEGATECALL)).to.equal(false);

    // Sanity check: the scanner does detect the opcode where it exists.
    expect(hasOpcode(maliciousCode, OPCODE_DELEGATECALL)).to.equal(true);
  });

  it("[S6] rejects a delegatecall payload routed through an uncommitted target", async () => {
    const f = await deployAegisFixture();
    const feeModuleAddr = await f.feeModule.getAddress();
    const maliciousImplAddr = await f.maliciousImpl.getAddress();

    const stealOwnership = f.feeModule.interface.encodeFunctionData(
      "transferOwnership",
      [f.attacker.address]
    );
    const attackCalldata = f.maliciousImpl.interface.encodeFunctionData(
      "executeArbitrary",
      [feeModuleAddr, stealOwnership]
    );
    const attackActions: Action[] = [
      { target: maliciousImplAddr, value: 0n, data: attackCalldata },
    ];

    // The committed intent only authorises the fee module.
    const rules: ActionRule[] = [
      {
        kind: ActionKind.PARAM_SET,
        target: feeModuleAddr,
        selector: "0x694b8e39",
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
      "Legitimate parameter update"
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
      .to.be.revertedWithCustomError(f.executor, "UnauthorizedTarget")
      .withArgs(feeModuleAddr, maliciousImplAddr);

    expect(await f.feeModule.owner()).to.equal(
      await f.executor.getAddress()
    );
  });
});
