import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  Action,
  ActionRule,
  ActionKind,
  hashActions,
  hashRules,
} from "../../packages/shared/hash";

export interface DeployFixture {
  deployer: SignerWithAddress;
  proposer: SignerWithAddress;
  voter1: SignerWithAddress;
  voter2: SignerWithAddress;
  devWallet: SignerWithAddress;
  attacker: SignerWithAddress;
  guardian: SignerWithAddress;
  verifier: SignerWithAddress;
  usdc: any;
  feeModule: any;
  treasuryProxy: any;
  maliciousImpl: any;
  reentrantRecipient: any;
  vulnerableProxy: any;
  registry: any;
  disclosureRegistry: any;
  executor: any;
  governor: any;
  votingToken: any;
  chainId: bigint;
}

export const MIN_DELAY = 3600; // 1 hour
export const MAX_DELAY = 14 * 86400; // 14 days
export const VOTING_PERIOD = 3 * 86400; // 3 days
export const QUORUM = ethers.parseEther("1000");
export const CHALLENGE_WINDOW = 2 * 86400; // 2 days
export const CHALLENGE_EXTENSION = 3 * 86400; // 3 days

export async function deployAegisFixture(): Promise<DeployFixture> {
  const [deployer, proposer, voter1, voter2, devWallet, attacker, guardian, verifier] =
    await ethers.getSigners();

  const net = await ethers.provider.getNetwork();
  const chainId = net.chainId;

  // 1. Tokens
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();

  const MockToken = await ethers.getContractFactory("MockUSDC");
  const votingToken = await MockToken.deploy();

  // 2. Proposal Registry
  const ProposalRegistry = await ethers.getContractFactory("ProposalRegistry");
  const registry = await ProposalRegistry.deploy();

  // 3. Disclosure Registry
  const DisclosureRegistry = await ethers.getContractFactory("DisclosureRegistry");
  const disclosureRegistry = await DisclosureRegistry.deploy(
    verifier.address,
    CHALLENGE_WINDOW,
    CHALLENGE_EXTENSION
  );

  // 4. IntentLockExecutor (governor set later)
  const IntentLockExecutor = await ethers.getContractFactory("IntentLockExecutor");
  const executor = await IntentLockExecutor.deploy(
    await registry.getAddress(),
    guardian.address,
    deployer.address, // temporary governor
    MIN_DELAY,
    MAX_DELAY
  );

  // 5. IntentGovernor
  const IntentGovernor = await ethers.getContractFactory("IntentGovernor");
  const governor = await IntentGovernor.deploy(
    await votingToken.getAddress(),
    await registry.getAddress(),
    await disclosureRegistry.getAddress(),
    await executor.getAddress(),
    VOTING_PERIOD,
    QUORUM,
    MIN_DELAY
  );

  // Set real governor on executor
  await (executor as any).connect(deployer).setGovernor(await governor.getAddress());

  // 6. Test helpers
  const FeeModule = await ethers.getContractFactory("FeeModule");
  const feeModule = await FeeModule.deploy(30, await executor.getAddress());

  const MaliciousImpl = await ethers.getContractFactory("MaliciousImpl");
  const maliciousImpl = await MaliciousImpl.deploy(attacker.address);

  const TreasuryProxy = await ethers.getContractFactory("TreasuryProxy");
  const treasuryProxy = await TreasuryProxy.deploy(
    await executor.getAddress(),
    await feeModule.getAddress()
  );

  const ReentrantRecipient = await ethers.getContractFactory("ReentrantRecipient");
  const reentrantRecipient = await ReentrantRecipient.deploy(await executor.getAddress());

  const VulnerableProxy = await ethers.getContractFactory("VulnerableProxy");
  const vulnerableProxy = await VulnerableProxy.deploy(
    await executor.getAddress(),
    await feeModule.getAddress()
  );

  // Fund voters with governance token
  await votingToken.mint(voter1.address, ethers.parseEther("600"));
  await votingToken.mint(voter2.address, ethers.parseEther("600"));

  // Fund executor / treasury with USDC
  await usdc.mint(await executor.getAddress(), 100_000n * 1_000_000n); // 100,000 USDC
  await usdc.mint(await treasuryProxy.getAddress(), 100_000n * 1_000_000n);

  return {
    deployer,
    proposer,
    voter1,
    voter2,
    devWallet,
    attacker,
    guardian,
    verifier,
    usdc,
    feeModule,
    treasuryProxy,
    maliciousImpl,
    reentrantRecipient,
    vulnerableProxy,
    registry,
    disclosureRegistry,
    executor,
    governor,
    votingToken,
    chainId,
  };
}

/**
 * Sign an EIP-712 disclosure with proposer private key.
 */
export async function signDisclosure(
  disclosureRegistry: any,
  proposer: SignerWithAddress,
  proposalId: bigint,
  walletListHash: string,
  interestsHash: string,
  bondAmount: bigint
) {
  const nonce = await disclosureRegistry.nonces(proposer.address);
  const net = await ethers.provider.getNetwork();

  const domain = {
    name: "AegisDAO DisclosureRegistry",
    version: "1",
    chainId: net.chainId,
    verifyingContract: await disclosureRegistry.getAddress(),
  };

  const types = {
    Disclosure: [
      { name: "proposalId", type: "uint256" },
      { name: "proposer", type: "address" },
      { name: "walletListHash", type: "bytes32" },
      { name: "interestsHash", type: "bytes32" },
      { name: "bondAmount", type: "uint256" },
      { name: "nonce", type: "uint256" },
    ],
  };

  const value = {
    proposalId,
    proposer: proposer.address,
    walletListHash,
    interestsHash,
    bondAmount,
    nonce,
  };

  const signature = await proposer.signTypedData(domain, types, value);
  const sig = ethers.Signature.from(signature);

  return {
    proposalId,
    proposer: proposer.address,
    walletListHash,
    interestsHash,
    bondAmount,
    nonce,
    v: sig.v,
    r: sig.r,
    s: sig.s,
  };
}

export interface ProposeOptions {
  /** Advance time past the executor timelock after queuing (default true). */
  advanceTimelock?: boolean;
}

/**
 * Standard pipeline: Register version, sign disclosure, submit to governor,
 * vote, finalize, queue in executor, and optionally advance time past the
 * timelock.
 */
export async function proposeAndOpenVoting(
  f: DeployFixture,
  actions: Action[],
  rules: ActionRule[],
  title: string = "Signature Proposal"
) {
  const actionsHash = hashActions(actions);
  const intentHash = hashRules(rules);

  const contentHash = ethers.keccak256(ethers.toUtf8Bytes(title));
  const evidenceRoot = ethers.keccak256(ethers.toUtf8Bytes("evidence.json"));
  const financialAssumptionsHash = ethers.keccak256(ethers.toUtf8Bytes("budget"));
  const technicalAssessmentHash = ethers.keccak256(ethers.toUtf8Bytes("audit"));
  const walletListHash = ethers.keccak256(ethers.toUtf8Bytes("wallets-list"));
  const interestsHash = ethers.keccak256(ethers.toUtf8Bytes("interests-none"));

  await (
    await f.registry.connect(f.proposer).createProposal(
      contentHash,
      evidenceRoot,
      financialAssumptionsHash,
      technicalAssessmentHash,
      intentHash,
      walletListHash
    )
  ).wait();
  const proposalId = (await f.registry.nextProposalId()) - 1n;
  const versionHash = await f.registry.latestVersionHash(proposalId);
  const version = 1n;

  const signedDisc = await signDisclosure(
    f.disclosureRegistry,
    f.proposer,
    proposalId,
    walletListHash,
    interestsHash,
    0n
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
    signedDisc.s
  );
  const disclosureHash = await f.disclosureRegistry.getDisclosureHash(proposalId);

  await (
    await f.governor
      .connect(f.proposer)
      .submitProposal(
        proposalId,
        version,
        versionHash,
        actionsHash,
        intentHash,
        disclosureHash
      )
  ).wait();
  const govId = (await f.governor.nextGovId()) - 1n;
  await f.governor.connect(f.proposer).openVoting(govId);

  const govProp = await f.governor.getGovProposal(govId);

  return {
    proposalId,
    version,
    versionHash,
    actionsHash,
    intentHash,
    disclosureHash,
    commitment: govProp.commitment,
    govId,
  };
}

export async function proposeAndQueue(
  f: DeployFixture,
  actions: Action[],
  rules: ActionRule[],
  title: string = "Standard Proposal",
  options: ProposeOptions = {}
) {
  const actionsHash = hashActions(actions);
  const intentHash = hashRules(rules);

  const contentHash = ethers.keccak256(ethers.toUtf8Bytes(title));
  const evidenceRoot = ethers.keccak256(ethers.toUtf8Bytes("evidence.json"));
  const financialAssumptionsHash = ethers.keccak256(ethers.toUtf8Bytes("budget"));
  const technicalAssessmentHash = ethers.keccak256(ethers.toUtf8Bytes("audit"));
  const walletListHash = ethers.keccak256(ethers.toUtf8Bytes("wallets-list"));
  const interestsHash = ethers.keccak256(ethers.toUtf8Bytes("interests-none"));

  // 1. Create proposal
  const txProp = await f.registry
    .connect(f.proposer)
    .createProposal(
      contentHash,
      evidenceRoot,
      financialAssumptionsHash,
      technicalAssessmentHash,
      intentHash,
      walletListHash
    );
  const rc = await txProp.wait();
  // Get proposal ID from registry
  const proposalId = (await f.registry.nextProposalId()) - 1n;
  const versionHash = await f.registry.latestVersionHash(proposalId);
  const version = 1n;

  // 2. Submit signed disclosure
  const signedDisc = await signDisclosure(
    f.disclosureRegistry,
    f.proposer,
    proposalId,
    walletListHash,
    interestsHash,
    0n
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
    signedDisc.s
  );

  const disclosureHash = await f.disclosureRegistry.getDisclosureHash(proposalId);

  // 3. Submit proposal to governor
  const txGov = await f.governor
    .connect(f.proposer)
    .submitProposal(
      proposalId,
      version,
      versionHash,
      actionsHash,
      intentHash,
      disclosureHash
    );
  await txGov.wait();
  const govId = (await f.governor.nextGovId()) - 1n;

  // 4. Open voting
  await f.governor.connect(f.proposer).openVoting(govId);

  // 5. Vote
  const briefHash = ethers.keccak256(ethers.toUtf8Bytes("brief-ack"));
  await f.governor.connect(f.voter1).voteWithBrief(govId, 1, briefHash);
  await f.governor.connect(f.voter2).voteWithBrief(govId, 1, briefHash);

  // 6. Finalize
  await time.increase(VOTING_PERIOD + 1);
  await f.governor.finalizeVote(govId);

  // 7. Queue
  await f.governor.queueForExecution(govId);

  // 8. Timelock delay (skipped for early-execution scenarios)
  if (options.advanceTimelock !== false) {
    await time.increase(MIN_DELAY + 10);
  }

  const govProp = await f.governor.getGovProposal(govId);

  return {
    proposalId,
    version,
    versionHash,
    actionsHash,
    intentHash,
    disclosureHash,
    commitment: govProp.commitment,
    govId,
  };
}

