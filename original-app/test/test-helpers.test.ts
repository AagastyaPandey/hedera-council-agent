import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Test Helpers Unit Test Suite", () => {
  let deployer: SignerWithAddress;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let attacker: SignerWithAddress;

  beforeEach(async () => {
    [deployer, owner, user, attacker] = await ethers.getSigners();
  });

  // ──────────────────────────────────────────
  // 1. MockUSDC
  // ──────────────────────────────────────────
  describe("MockUSDC", () => {
    it("has 6 decimals, correct name/symbol, and allows minting & burning", async () => {
      const MockUSDC = await ethers.getContractFactory("MockUSDC");
      const usdc = await MockUSDC.deploy();

      expect(await usdc.name()).to.equal("USD Coin");
      expect(await usdc.symbol()).to.equal("USDC");
      expect(await usdc.decimals()).to.equal(6);

      // Mint 5,000 USDC
      const mintAmount = 5_000n * 1_000_000n;
      await usdc.mint(user.address, mintAmount);
      expect(await usdc.balanceOf(user.address)).to.equal(mintAmount);
      expect(await usdc.totalSupply()).to.equal(mintAmount);

      // Transfer
      await (usdc.connect(user) as any).transfer(owner.address, 1_000n * 1_000_000n);
      expect(await usdc.balanceOf(owner.address)).to.equal(1_000n * 1_000_000n);
      expect(await usdc.balanceOf(user.address)).to.equal(4_000n * 1_000_000n);

      // Burn
      await (usdc.connect(user) as any).burn(user.address, 500n * 1_000_000n);
      expect(await usdc.balanceOf(user.address)).to.equal(3_500n * 1_000_000n);
    });
  });

  // ──────────────────────────────────────────
  // 2. FeeModule
  // ──────────────────────────────────────────
  describe("FeeModule", () => {
    it("enforces owner-only setFee and bounds fee to 10%", async () => {
      const FeeModule = await ethers.getContractFactory("FeeModule");
      const feeModule = await FeeModule.deploy(30, owner.address);

      expect(await feeModule.feeBps()).to.equal(30);
      expect(await feeModule.owner()).to.equal(owner.address);

      // Owner updates fee
      await (feeModule.connect(owner) as any).setFee(45);
      expect(await feeModule.feeBps()).to.equal(45);

      // Non-owner cannot update fee
      await expect((feeModule.connect(user) as any).setFee(50)).to.be.revertedWithCustomError(
        feeModule,
        "OnlyOwner"
      );

      // Cannot set fee higher than 1000 bps (10%)
      await expect((feeModule.connect(owner) as any).setFee(1001)).to.be.revertedWithCustomError(
        feeModule,
        "FeeTooHigh"
      );

      // Transfer ownership
      await (feeModule.connect(owner) as any).transferOwnership(user.address);
      expect(await feeModule.owner()).to.equal(user.address);
    });
  });

  // ──────────────────────────────────────────
  // 3. TreasuryProxy
  // ──────────────────────────────────────────
  describe("TreasuryProxy", () => {
    it("manages EIP-1967 admin and implementation slots, exposes owner(), and supports upgradeTo", async () => {
      const FeeModule = await ethers.getContractFactory("FeeModule");
      const impl1 = await FeeModule.deploy(25, owner.address);
      const impl2 = await FeeModule.deploy(50, owner.address);

      const TreasuryProxy = await ethers.getContractFactory("TreasuryProxy");
      const proxy = await TreasuryProxy.deploy(owner.address, await impl1.getAddress());

      // Check admin and owner
      expect(await proxy.admin()).to.equal(owner.address);
      expect(await proxy.owner()).to.equal(owner.address);
      expect(await proxy.implementation()).to.equal(await impl1.getAddress());

      // Upgrade implementation by owner
      await (proxy.connect(owner) as any).upgradeTo(await impl2.getAddress());
      expect(await proxy.implementation()).to.equal(await impl2.getAddress());

      // Non-owner cannot upgrade
      await expect(
        (proxy.connect(user) as any).upgradeTo(await impl1.getAddress())
      ).to.be.revertedWithCustomError(proxy, "Unauthorized");

      // Transfer ownership / admin
      await (proxy.connect(owner) as any).transferOwnership(user.address);
      expect(await proxy.owner()).to.equal(user.address);
      expect(await proxy.admin()).to.equal(user.address);
    });
  });

  // ──────────────────────────────────────────
  // 4. MaliciousImpl
  // ──────────────────────────────────────────
  describe("MaliciousImpl", () => {
    it("contains backdoor drain, delegatecall payload, and selfdestruct", async () => {
      const MaliciousImpl = await ethers.getContractFactory("MaliciousImpl");
      const malicious = await MaliciousImpl.deploy(attacker.address);

      expect(await malicious.attacker()).to.equal(attacker.address);

      // Fund malicious contract with MockUSDC
      const MockUSDC = await ethers.getContractFactory("MockUSDC");
      const usdc = await MockUSDC.deploy();
      await usdc.mint(await malicious.getAddress(), 10_000n * 1_000_000n);

      // Backdoor drain to attacker
      const attackerBeforeBal = await usdc.balanceOf(attacker.address);
      await malicious.backdoorDrain(await usdc.getAddress());
      const attackerAfterBal = await usdc.balanceOf(attacker.address);
      expect(attackerAfterBal - attackerBeforeBal).to.equal(10_000n * 1_000_000n);

      // Verify dangerous opcodes exist in bytecode
      const bytecode = await ethers.provider.getCode(await malicious.getAddress());
      // 0xf4 = DELEGATECALL
      expect(bytecode.toLowerCase()).to.include("f4");
      // 0xff = SELFDESTRUCT
      expect(bytecode.toLowerCase()).to.include("ff");
    });
  });

  // ──────────────────────────────────────────
  // 5. ReentrantRecipient
  // ──────────────────────────────────────────
  describe("ReentrantRecipient", () => {
    it("stores attack parameters and executes re-entrancy callback on receive/attack", async () => {
      const MockToken = await ethers.getContractFactory("MockUSDC");
      const mockExec = await MockToken.deploy(); // dummy address

      const ReentrantRecipient = await ethers.getContractFactory("ReentrantRecipient");
      const reentrant = await ReentrantRecipient.deploy(await mockExec.getAddress());

      expect(await reentrant.executor()).to.equal(await mockExec.getAddress());
      expect(await reentrant.attacked()).to.be.false;

      // Set attack parameters
      await reentrant.setAttackParams(
        1n,
        1n,
        ethers.ZeroHash,
        ethers.ZeroHash,
        [],
        []
      );
      expect(await reentrant.attackProposalId()).to.equal(1n);

      // Disable bubbleRevert so we can inspect state after the attempted attack
      await reentrant.setBubbleRevert(false);
      await reentrant.attackOnReceive();
      expect(await reentrant.attacked()).to.be.true;

      // With bubbleRevert = true, receiving funds or calling attack bubbles up the revert
      await reentrant.setBubbleRevert(true);
      // reset attacked flag for next attempt
      const ReentrantFactory = await ethers.getContractFactory("ReentrantRecipient");
      const reentrant2 = await ReentrantFactory.deploy(await mockExec.getAddress());
      await expect(reentrant2.attackOnReceive()).to.be.reverted;
    });
  });

  // ──────────────────────────────────────────
  // 6. VulnerableProxy
  // ──────────────────────────────────────────
  describe("VulnerableProxy", () => {
    it("verifies explicit storage layout at slots 0, 1, 2, and 3", async () => {
      const FeeModule = await ethers.getContractFactory("FeeModule");
      const impl = await FeeModule.deploy(30, owner.address);

      const VulnerableProxy = await ethers.getContractFactory("VulnerableProxy");
      const proxy = await VulnerableProxy.deploy(owner.address, await impl.getAddress());

      const proxyAddr = await proxy.getAddress();

      // Slot 0: admin
      const slot0 = await ethers.provider.getStorage(proxyAddr, 0);
      const storedAdmin = ethers.getAddress("0x" + slot0.slice(26));
      expect(storedAdmin).to.equal(owner.address);
      expect(await proxy.admin()).to.equal(owner.address);
      expect(await proxy.owner()).to.equal(owner.address);

      // Slot 1: implementation
      const slot1 = await ethers.provider.getStorage(proxyAddr, 1);
      const storedImpl = ethers.getAddress("0x" + slot1.slice(26));
      expect(storedImpl).to.equal(await impl.getAddress());
      expect(await proxy.implementation()).to.equal(await impl.getAddress());

      // Slot 2: feeBps (30)
      const slot2 = await ethers.provider.getStorage(proxyAddr, 2);
      expect(BigInt(slot2)).to.equal(30n);
      expect(await proxy.feeBps()).to.equal(30n);

      // Slot 3: paused (false = 0)
      const slot3 = await ethers.provider.getStorage(proxyAddr, 3);
      expect(BigInt(slot3)).to.equal(0n);
      expect(await proxy.paused()).to.equal(false);

      // Update fee via admin
      await (proxy.connect(owner) as any).setFee(75);
      expect(await proxy.feeBps()).to.equal(75n);
      const slot2Updated = await ethers.provider.getStorage(proxyAddr, 2);
      expect(BigInt(slot2Updated)).to.equal(75n);
    });
  });
});
