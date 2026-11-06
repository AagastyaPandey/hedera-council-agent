import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  deployAegisFixture,
  proposeAndOpenVoting,
  proposeAndQueue,
} from "./fixture";
import { Action, ActionRule, ActionKind } from "../../packages/shared/hash";
import {
  buildIntentHaltTypedData,
  buildIntentVoteTypedData,
} from "../../console/lib/signing";

const VOTE_STATEMENT =
  "Signed vote test: transfer 5,000 USDC to the approved development wallet.";

async function openVoteProposal(f: Awaited<ReturnType<typeof deployAegisFixture>>) {
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

  const q = await proposeAndOpenVoting(f, actions, rules, "Signed vote proposal");
  const briefHash = ethers.id("risk-brief-v1");
  const deadline = BigInt((await time.latest()) + 3600);
  const nonce = await f.governor.nonces(f.voter1.address);
  const typed = buildIntentVoteTypedData({
    chainId: Number(f.chainId),
    verifyingContract: await f.governor.getAddress(),
    govId: q.govId,
    commitment: q.commitment,
    support: 1,
    briefHash,
    statement: VOTE_STATEMENT,
    nonce,
    deadline,
  });

  return { q, actions, rules, briefHash, deadline, nonce, typed };
}

async function queuedProposal(f: Awaited<ReturnType<typeof deployAegisFixture>>) {
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
  const q = await proposeAndQueue(f, actions, rules, "Guardian halt proposal");
  return { q, actions, rules };
}

async function guardianHaltTyped(
  f: Awaited<ReturnType<typeof deployAegisFixture>>,
  commitment: string,
  overrides: Partial<{
    reportHash: string;
    reason: string;
    nonce: bigint;
    deadline: bigint;
    verifyingContract: string;
    chainId: number;
  }> = {}
) {
  const reportHash = overrides.reportHash ?? ethers.id("sentinel-report");
  const reason =
    overrides.reason ??
    "Sentinel detected an uncommitted treasury upgrade.";
  const nonce = overrides.nonce ?? (await f.executor.haltNonces(f.guardian.address));
  const deadline = overrides.deadline ?? BigInt((await time.latest()) + 3600);
  const typed = buildIntentHaltTypedData({
    chainId: overrides.chainId ?? Number(f.chainId),
    verifyingContract:
      overrides.verifyingContract ?? (await f.executor.getAddress()),
    commitment,
    reportHash,
    reason,
    nonce,
    deadline,
  });
  const signature = await f.guardian.signTypedData(
    typed.domain,
    typed.types,
    typed.message
  );
  return { reportHash, reason, nonce, deadline, typed, signature };
}

describe("Hardware-signature flows · EIP-712 votes", () => {
  it("[HS1] a relayer-submitted signature counts with the voter's full weight", async () => {
    const f = await deployAegisFixture();
    const { q, briefHash, deadline, nonce, typed } = await openVoteProposal(f);
    const signature = await f.voter1.signTypedData(
      typed.domain,
      typed.types,
      typed.message
    );

    await expect(
      f.governor
        .connect(f.deployer)
        .voteBySig(
          q.govId,
          f.voter1.address,
          1,
          briefHash,
          VOTE_STATEMENT,
          nonce,
          deadline,
          signature
        )
    )
      .to.emit(f.governor, "VoteRelayed")
      .withArgs(q.govId, f.voter1.address, f.deployer.address, briefHash);

    const vote = await f.governor.votes(q.govId, f.voter1.address);
    const weight = await f.votingToken.balanceOf(f.voter1.address);
    const proposal = await f.governor.getGovProposal(q.govId);

    expect(vote.hasVoted).to.equal(true);
    expect(vote.support).to.equal(1n);
    expect(vote.weight).to.equal(weight);
    expect(vote.briefHash).to.equal(briefHash);
    expect(proposal.forVotes).to.equal(weight);
    expect(proposal.informedForVotes).to.equal(weight);
    expect(proposal.totalBriefAcks).to.equal(1n);
    expect(await f.governor.nonces(f.voter1.address)).to.equal(nonce + 1n);
  });

  it("[HS2] rejects a signature from a different address", async () => {
    const f = await deployAegisFixture();
    const { q, briefHash, deadline, nonce, typed } = await openVoteProposal(f);
    const wrongSignature = await f.voter2.signTypedData(
      typed.domain,
      typed.types,
      typed.message
    );

    await expect(
      f.governor
        .connect(f.deployer)
        .voteBySig(
          q.govId,
          f.voter1.address,
          1,
          briefHash,
          VOTE_STATEMENT,
          nonce,
          deadline,
          wrongSignature
        )
    ).to.be.revertedWithCustomError(f.governor, "BadSignature");
  });

  it("[HS3] rejects an expired signature", async () => {
    const f = await deployAegisFixture();
    const { q, briefHash, nonce, typed } = await openVoteProposal(f);
    const expiredDeadline = BigInt((await time.latest()) - 1);
    const expiredTyped = buildIntentVoteTypedData({
      chainId: Number(f.chainId),
      verifyingContract: await f.governor.getAddress(),
      govId: q.govId,
      commitment: q.commitment,
      support: 1,
      briefHash,
      statement: VOTE_STATEMENT,
      nonce,
      deadline: expiredDeadline,
    });
    const signature = await f.voter1.signTypedData(
      expiredTyped.domain,
      expiredTyped.types,
      expiredTyped.message
    );

    await expect(
      f.governor
        .connect(f.deployer)
        .voteBySig(
          q.govId,
          f.voter1.address,
          1,
          briefHash,
          VOTE_STATEMENT,
          nonce,
          expiredDeadline,
          signature
        )
    )
      .to.be.revertedWithCustomError(f.governor, "SignatureExpired")
      .withArgs(expiredDeadline);
  });

  it("[HS4] rejects a replayed nonce", async () => {
    const f = await deployAegisFixture();
    const { q, briefHash, deadline, nonce, typed } = await openVoteProposal(f);
    const signature = await f.voter1.signTypedData(
      typed.domain,
      typed.types,
      typed.message
    );

    await f.governor
      .connect(f.deployer)
      .voteBySig(
        q.govId,
        f.voter1.address,
        1,
        briefHash,
        VOTE_STATEMENT,
        nonce,
        deadline,
        signature
      );

    await expect(
      f.governor
        .connect(f.deployer)
        .voteBySig(
          q.govId,
          f.voter1.address,
          1,
          briefHash,
          VOTE_STATEMENT,
          nonce,
          deadline,
          signature
        )
    )
      .to.be.revertedWithCustomError(f.governor, "NonceUsed")
      .withArgs(f.voter1.address, nonce);
  });

  it("[HS5] rejects a signature from another chain or verifying contract", async () => {
    const f = await deployAegisFixture();
    const { q, briefHash, deadline, nonce, typed } = await openVoteProposal(f);

    const otherChain = buildIntentVoteTypedData({
      chainId: Number(f.chainId) + 1,
      verifyingContract: await f.governor.getAddress(),
      govId: q.govId,
      commitment: q.commitment,
      support: 1,
      briefHash,
      statement: VOTE_STATEMENT,
      nonce,
      deadline,
    });
    const otherContract = buildIntentVoteTypedData({
      chainId: Number(f.chainId),
      verifyingContract: await f.executor.getAddress(),
      govId: q.govId,
      commitment: q.commitment,
      support: 1,
      briefHash,
      statement: VOTE_STATEMENT,
      nonce,
      deadline,
    });

    for (const wrongDomain of [otherChain, otherContract]) {
      const signature = await f.voter1.signTypedData(
        wrongDomain.domain,
        wrongDomain.types,
        wrongDomain.message
      );
      await expect(
        f.governor
          .connect(f.deployer)
          .voteBySig(
            q.govId,
            f.voter1.address,
            1,
            briefHash,
            VOTE_STATEMENT,
            nonce,
            deadline,
            signature
          )
      ).to.be.revertedWithCustomError(f.governor, "BadSignature");
    }
  });

  it("[HS6] rejects tampered support or commitment", async () => {
    const f = await deployAegisFixture();
    const { q, briefHash, deadline, nonce, typed } = await openVoteProposal(f);

    const signature = await f.voter1.signTypedData(
      typed.domain,
      typed.types,
      typed.message
    );
    await expect(
      f.governor
        .connect(f.deployer)
        .voteBySig(
          q.govId,
          f.voter1.address,
          0,
          briefHash,
          VOTE_STATEMENT,
          nonce,
          deadline,
          signature
        )
    ).to.be.revertedWithCustomError(f.governor, "BadSignature");

    const otherCommitment = buildIntentVoteTypedData({
      chainId: Number(f.chainId),
      verifyingContract: await f.governor.getAddress(),
      govId: q.govId,
      commitment: ethers.id("another-commitment"),
      support: 1,
      briefHash,
      statement: VOTE_STATEMENT,
      nonce,
      deadline,
    });
    const commitmentSignature = await f.voter1.signTypedData(
      otherCommitment.domain,
      otherCommitment.types,
      otherCommitment.message
    );
    await expect(
      f.governor
        .connect(f.deployer)
        .voteBySig(
          q.govId,
          f.voter1.address,
          1,
          briefHash,
          VOTE_STATEMENT,
          nonce,
          deadline,
          commitmentSignature
        )
    ).to.be.revertedWithCustomError(f.governor, "BadSignature");
  });

  it("[HS7] rejects a second signed vote from the same voter", async () => {
    const f = await deployAegisFixture();
    const { q, briefHash, deadline, nonce, typed } = await openVoteProposal(f);
    const firstSignature = await f.voter1.signTypedData(
      typed.domain,
      typed.types,
      typed.message
    );
    await f.governor
      .connect(f.deployer)
      .voteBySig(
        q.govId,
        f.voter1.address,
        1,
        briefHash,
        VOTE_STATEMENT,
        nonce,
        deadline,
        firstSignature
      );

    const nextNonce = nonce + 1n;
    const nextTyped = buildIntentVoteTypedData({
      chainId: Number(f.chainId),
      verifyingContract: await f.governor.getAddress(),
      govId: q.govId,
      commitment: q.commitment,
      support: 1,
      briefHash,
      statement: VOTE_STATEMENT,
      nonce: nextNonce,
      deadline,
    });
    const secondSignature = await f.voter1.signTypedData(
      nextTyped.domain,
      nextTyped.types,
      nextTyped.message
    );

    await expect(
      f.governor
        .connect(f.deployer)
        .voteBySig(
          q.govId,
          f.voter1.address,
          1,
          briefHash,
          VOTE_STATEMENT,
          nextNonce,
          deadline,
          secondSignature
        )
    )
      .to.be.revertedWithCustomError(f.governor, "AlreadyVoted")
      .withArgs(f.voter1.address);
    expect(await f.governor.nonces(f.voter1.address)).to.equal(nextNonce);
  });
});

describe("Hardware-signature flows · guardian halt", () => {
  it("[HH1] a relayer-submitted guardian signature halts a queued commitment", async () => {
    const f = await deployAegisFixture();
    const { q, actions, rules } = await queuedProposal(f);
    const halt = await guardianHaltTyped(f, q.commitment);

    await expect(
      f.executor
        .connect(f.deployer)
        .haltBySig(
          q.commitment,
          halt.reportHash,
          halt.reason,
          halt.nonce,
          halt.deadline,
          halt.signature
        )
    )
      .to.emit(f.executor, "HaltRelayed")
      .withArgs(
        q.commitment,
        f.guardian.address,
        f.deployer.address,
        halt.reportHash,
        halt.reason
      );

    expect(await f.executor.getState(q.commitment)).to.equal(3n); // Halted
    expect(
      await f.executor.haltNonces(f.guardian.address)
    ).to.equal(halt.nonce + 1n);

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
      .withArgs(1, 3);
  });

  it("[HH2] rejects a valid signature from a non-guardian", async () => {
    const f = await deployAegisFixture();
    const { q } = await queuedProposal(f);
    const nonce = await f.executor.haltNonces(f.voter1.address);
    const deadline = BigInt((await time.latest()) + 3600);
    const typed = buildIntentHaltTypedData({
      chainId: Number(f.chainId),
      verifyingContract: await f.executor.getAddress(),
      commitment: q.commitment,
      reportHash: ethers.id("non-guardian-report"),
      reason: "Not the guardian",
      nonce,
      deadline,
    });
    const signature = await f.voter1.signTypedData(
      typed.domain,
      typed.types,
      typed.message
    );

    await expect(
      f.executor
        .connect(f.deployer)
        .haltBySig(
          q.commitment,
          ethers.id("non-guardian-report"),
          "Not the guardian",
          nonce,
          deadline,
          signature
        )
    )
      .to.be.revertedWithCustomError(f.executor, "NotGuardian")
      .withArgs(f.voter1.address);
  });

  it("[HH3] rejects expired, replayed, or tampered guardian payloads", async () => {
    const f = await deployAegisFixture();
    const { q } = await queuedProposal(f);

    const expired = await guardianHaltTyped(f, q.commitment, {
      deadline: BigInt((await time.latest()) - 1),
    });
    await expect(
      f.executor
        .connect(f.deployer)
        .haltBySig(
          q.commitment,
          expired.reportHash,
          expired.reason,
          expired.nonce,
          expired.deadline,
          expired.signature
        )
    )
      .to.be.revertedWithCustomError(f.executor, "SignatureExpired")
      .withArgs(expired.deadline);

    const tamperedReason = await guardianHaltTyped(f, q.commitment);
    await expect(
      f.executor
        .connect(f.deployer)
        .haltBySig(
          q.commitment,
          tamperedReason.reportHash,
          "A different reason",
          tamperedReason.nonce,
          tamperedReason.deadline,
          tamperedReason.signature
        )
    ).to.be.revertedWithCustomError(f.executor, "NotGuardian");

    const tamperedCommitment = await guardianHaltTyped(f, q.commitment);
    await expect(
      f.executor
        .connect(f.deployer)
        .haltBySig(
          ethers.id("a-different-commitment"),
          tamperedCommitment.reportHash,
          tamperedCommitment.reason,
          tamperedCommitment.nonce,
          tamperedCommitment.deadline,
          tamperedCommitment.signature
        )
    ).to.be.revertedWithCustomError(f.executor, "NotGuardian");

    const replay = await guardianHaltTyped(f, q.commitment);
    await f.executor
      .connect(f.deployer)
      .haltBySig(
        q.commitment,
        replay.reportHash,
        replay.reason,
        replay.nonce,
        replay.deadline,
        replay.signature
      );
    await expect(
      f.executor
        .connect(f.deployer)
        .haltBySig(
          q.commitment,
          replay.reportHash,
          replay.reason,
          replay.nonce,
          replay.deadline,
          replay.signature
        )
    )
      .to.be.revertedWithCustomError(f.executor, "NonceUsed")
      .withArgs(f.guardian.address, replay.nonce);
  });

  it("[HH4] a guardian signature cannot execute or edit a commitment", async () => {
    const f = await deployAegisFixture();
    const { q, actions, rules } = await queuedProposal(f);
    const before = await f.usdc.balanceOf(f.devWallet.address);
    const halt = await guardianHaltTyped(f, q.commitment);

    await f.executor
      .connect(f.deployer)
      .haltBySig(
        q.commitment,
        halt.reportHash,
        halt.reason,
        halt.nonce,
        halt.deadline,
        halt.signature
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
    ).to.be.revertedWithCustomError(f.executor, "ProposalNotInState");
    expect(await f.usdc.balanceOf(f.devWallet.address)).to.equal(before);
  });
});
