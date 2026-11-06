import { expect } from "chai";
import { ethers } from "hardhat";
import { deployAegisFixture, signDisclosure } from "./fixture";
import {
  Action,
  ActionRule,
  ActionKind,
  hashActions,
  hashRules,
} from "../../packages/shared/hash";

describe("Red-Team Arena · Scenario 10: Hidden Conflict of Interest", () => {
  it("[S10] flags a proposal after an undisclosed wallet link is proven", async () => {
    const f = await deployAegisFixture();
    const usdcAddr = await f.usdc.getAddress();
    const amount = 5_000n * 1_000_000n;

    const actions: Action[] = [
      {
        target: usdcAddr,
        value: 0n,
        data: f.usdc.interface.encodeFunctionData("transfer", [
          f.devWallet.address,
          amount,
        ]),
      },
    ];
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

    const incompleteWalletList = ethers.keccak256(
      ethers.toUtf8Bytes("omitted-wallets")
    );
    const interestsHash = ethers.keccak256(
      ethers.toUtf8Bytes("interests-empty")
    );

    await f.registry.connect(f.proposer).createProposal(
      ethers.keccak256(ethers.toUtf8Bytes("Hidden COI Proposal")),
      ethers.keccak256(ethers.toUtf8Bytes("evidence.json")),
      ethers.keccak256(ethers.toUtf8Bytes("budget")),
      ethers.keccak256(ethers.toUtf8Bytes("audit")),
      hashRules(rules),
      incompleteWalletList
    );
    const proposalId = (await f.registry.nextProposalId()) - 1n;
    const version = 1n;
    const versionHash = await f.registry.latestVersionHash(proposalId);

    // Proposer publishes a disclosure that omits the intermediary link,
    // bonded with 1 ETH.
    const bondAmount = ethers.parseEther("1.0");
    const signedDisc = await signDisclosure(
      f.disclosureRegistry,
      f.proposer,
      proposalId,
      incompleteWalletList,
      interestsHash,
      bondAmount
    );
    await f.disclosureRegistry.connect(f.proposer).submitDisclosure(
      signedDisc.proposalId,
      signedDisc.proposer,
      signedDisc.walletListHash,
      signedDisc.interestsHash,
      signedDisc.bondAmount,
      signedDisc.nonce,
      signedDisc.v,
      signedDisc.r,
      signedDisc.s,
      { value: bondAmount }
    );

    const disclosureHash = await f.disclosureRegistry.getDisclosureHash(
      proposalId
    );

    await f.governor.connect(f.proposer).submitProposal(
      proposalId,
      version,
      versionHash,
      hashActions(actions),
      hashRules(rules),
      disclosureHash
    );
    const govId = (await f.governor.nextGovId()) - 1n;

    // A challenger submits transaction evidence for the omitted link.
    const linkEvidenceHash = ethers.keccak256(
      ethers.toUtf8Bytes(
        "evidence: tx 0xabc proves proposer funded devWallet through intermediary"
      )
    );
    await f.disclosureRegistry
      .connect(f.attacker)
      .fileChallenge(
        proposalId,
        linkEvidenceHash,
        "Proposer funded recipient devWallet via intermediary mixer"
      );

    const challengerBefore = await ethers.provider.getBalance(f.attacker.address);
    await f.disclosureRegistry
      .connect(f.verifier)
      .verifyChallenge(proposalId, 0n);

    expect(await f.disclosureRegistry.isChallenged(proposalId)).to.equal(true);
    expect(await ethers.provider.getBalance(f.attacker.address)).to.be.greaterThan(
      challengerBefore
    );

    // Voting cannot open while the disclosure is challenged.
    await expect(
      f.governor.connect(f.proposer).openVoting(govId)
    ).to.be.revertedWithCustomError(f.governor, "DisclosureChallenged");
  });
});
