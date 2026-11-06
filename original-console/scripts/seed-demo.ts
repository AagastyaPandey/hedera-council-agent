/**
 * scripts/seed-demo.ts
 *
 * Seeds the AegisDAO demo storyline against a running `npx hardhat node`.
 * Run with: npm run seed
 *
 * Re-running is safe: it redeploys the whole contract set (new addresses,
 * fresh registries) and rewrites demo-state.json. Evidence store directories
 * for the demo are cleared first, so Merkle roots are deterministic.
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { deployAll } from "./deploy";
import { cleanAbis } from "./clean-abis";
import { EvidenceStore } from "../intelligence/evidence";
import { extractIntentHeuristic } from "../intelligence/ai-draft";
import { assessConflictOfInterest, buildSeedData } from "../intelligence/graph";
import { simulateProposalExecution } from "../sentinel/simulate";
import { buildViolationReport, hashViolationReport } from "../sentinel/report";
import { haltProposal } from "../sentinel/halt";
import {
  appendSentinelEvent,
  readLiveReports,
  upsertExecutionBundle,
  writeLiveReports,
} from "../sentinel/live-store";
import { signDisclosure } from "../test/redteam/fixture";
import {
  Action,
  ActionRule,
  ActionKind,
  hashActions,
  hashRules,
} from "../packages/shared/hash";

const MIN_DELAY = 3600;
const VOTING_PERIOD = 3 * 86400;
const ZERO = ethers.ZeroHash;
// "hardware" leaves P2 queued with a pending Sentinel report so the guardian
// can sign the halt. "auto" keeps the original software guardian halt.
const GUARDIAN_MODE = (process.env.GUARDIAN_MODE ?? "hardware").toLowerCase();
const USDC = (whole: number) => ethers.parseUnits(String(whole), 6);

interface DemoEntry {
  title: string;
  govId: string | null;
  state: string;
  commitment: string | null;
  versionChain: string[];
  notes: string;
}

type DemoState = Record<string, DemoEntry>;

interface Ctx {
  registry: any;
  disclosure: any;
  executor: any;
  governor: any;
  usdc: any;
  feeModule: any;
  treasuryProxy: any;
  maliciousImpl: any;
  vulnerableProxy: any;
  proposer: any;
  guardian: any;
  verifier: any;
  challenger: any;
  devWallet: any;
  vendor: any;
  voter1: any;
  voter2: any;
  voter3: any;
  attacker: any;
  addresses: Record<string, string>;
}

const contentHash = (text: string) =>
  ethers.keccak256(ethers.toUtf8Bytes(text));

const short = (value: string) =>
  value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;

function freshEvidenceStore(name: string): EvidenceStore {
  const dir = path.join(__dirname, "..", "intelligence", "store", `demo-${name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  return new EvidenceStore({ storeDir: dir });
}

async function increaseTime(seconds: number): Promise<void> {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function submitDisclosure(
  ctx: Ctx,
  proposalId: bigint,
  walletListHash: string,
  interestsHash: string,
  bond: bigint
): Promise<string> {
  const signed = await signDisclosure(
    ctx.disclosure,
    ctx.proposer,
    proposalId,
    walletListHash,
    interestsHash,
    bond
  );
  await (
    await ctx.disclosure.connect(ctx.proposer).submitDisclosure(
      signed.proposalId,
      signed.proposer,
      signed.walletListHash,
      signed.interestsHash,
      signed.bondAmount,
      signed.nonce,
      signed.v,
      signed.r,
      signed.s,
      { value: bond }
    )
  ).wait();
  return ctx.disclosure.getDisclosureHash(proposalId);
}

async function createRegistryProposal(
  ctx: Ctx,
  proposalId: bigint,
  text: string,
  evidenceRoot: string,
  intentHash: string,
  disclosureHash: string
): Promise<void> {
  const next = await ctx.registry.nextProposalId();
  if (next !== proposalId) {
    throw new Error(`Expected proposal ${proposalId}, registry next is ${next}`);
  }
  await (
    await ctx.registry.connect(ctx.proposer).createProposal(
      contentHash(text),
      evidenceRoot,
      contentHash(`${text}|financial-assumptions`),
      contentHash(`${text}|technical-assessment`),
      intentHash,
      disclosureHash
    )
  ).wait();
  const after = await ctx.registry.nextProposalId();
  if (after !== proposalId + 1n) {
    throw new Error(`Registry proposal id did not advance to ${proposalId + 1n}`);
  }
}

async function appendRegistryVersion(
  ctx: Ctx,
  proposalId: bigint,
  text: string,
  evidenceRoot: string,
  intentHash: string,
  disclosureHash: string
): Promise<void> {
  await (
    await ctx.registry.connect(ctx.proposer).addVersion(
      proposalId,
      contentHash(text),
      evidenceRoot,
      contentHash(`${text}|financial-assumptions`),
      contentHash(`${text}|technical-assessment`),
      intentHash,
      disclosureHash
    )
  ).wait();
}

async function submitToGovernor(
  ctx: Ctx,
  proposalId: bigint,
  version: bigint,
  versionHash: string,
  actionsHash: string,
  intentHash: string,
  disclosureHash: string
): Promise<bigint> {
  await (
    await ctx.governor.connect(ctx.proposer).submitProposal(
      proposalId,
      version,
      versionHash,
      actionsHash,
      intentHash,
      disclosureHash
    )
  ).wait();
  return (await ctx.governor.nextGovId()) - 1n;
}

async function openVoting(ctx: Ctx, govId: bigint): Promise<void> {
  await (await ctx.governor.connect(ctx.proposer).openVoting(govId)).wait();
}

/**
 * Register the committed calldata for a proposal so the Pre-vote Effect
 * Preview can simulate the EXACT bytes the vote commits to. The executor only
 * stores hashes, so this is the demo-state half of the commitment.
 */
async function registerBundle(
  ctx: Ctx,
  args: {
    key: string;
    title: string;
    proposalId: bigint;
    govId: bigint;
    actions: Action[];
    rules: ActionRule[];
    labels?: Record<string, string>;
  }
): Promise<string> {
  const proposal = await ctx.governor.getGovProposal(args.govId);
  const commitment = String(proposal.commitment);
  upsertExecutionBundle({
    commitment,
    proposalId: args.proposalId.toString(),
    govId: args.govId.toString(),
    title: args.title,
    version: String(proposal.version),
    versionHash: String(proposal.versionHash),
    disclosureHash: String(proposal.disclosureHash),
    createdAt: new Date().toISOString(),
    source: "scripts/seed-demo.ts",
    actions: args.actions.map((action) => ({
      target: action.target,
      value: action.value.toString(),
      data: action.data,
    })),
    rules: args.rules.map((rule) => ({
      kind: Number(rule.kind),
      target: rule.target,
      selector: rule.selector,
      counterparty: rule.counterparty,
      maxAmount: rule.maxAmount.toString(),
      codeHash: rule.codeHash,
      childCount: Number(rule.childCount),
    })),
    labels: args.labels,
  });
  console.log(`  ✔ Registered committed calldata for P${args.key} (${short(commitment)})`);
  return commitment;
}

async function castVote(
  ctx: Ctx,
  govId: bigint,
  voter: any,
  support: number,
  informed: boolean
): Promise<void> {
  if (informed) {
    const briefHash = ethers.id(`brief:gov${govId}:${voter.address}`);
    await (
      await ctx.governor.connect(voter).voteWithBrief(govId, support, briefHash)
    ).wait();
  } else {
    await (await ctx.governor.connect(voter).castVote(govId, support)).wait();
  }
}

async function finalizeAndQueue(ctx: Ctx, govId: bigint): Promise<string> {
  await increaseTime(VOTING_PERIOD + 1);
  await (await ctx.governor.finalizeVote(govId)).wait();
  await (await ctx.governor.queueForExecution(govId)).wait();
  const proposal = await ctx.governor.getGovProposal(govId);
  return proposal.commitment as string;
}

async function seedP1(ctx: Ctx): Promise<{ id: bigint; entry: DemoEntry }> {
  const store = freshEvidenceStore("p1");
  const textV1 =
    "Q4 Development Grant (v1 draft): transfer 5,000 USDC to the development wallet for Q4 audits.";
  const textV2 =
    `Q4 Development Grant (v2 final): transfer 5,000 USDC to the development wallet ` +
    `${ctx.devWallet.address} for Q4 audits.`;

  store.addDocument(textV1);
  const root1 = store.buildManifest().evidenceRoot;

  const proposalId = await ctx.registry.nextProposalId();
  const walletListHash = contentHash(
    JSON.stringify([ctx.proposer.address, ctx.devWallet.address].sort())
  );
  const interestsHash = contentHash("no financial interests declared");
  const disclosureHash = await submitDisclosure(
    ctx,
    proposalId,
    walletListHash,
    interestsHash,
    0n
  );

  const actions: Action[] = [
    {
      target: ctx.addresses.MockUSDC,
      value: 0n,
      data: ctx.usdc.interface.encodeFunctionData("transfer", [
        ctx.devWallet.address,
        USDC(5000),
      ]),
    },
  ];
  const rules: ActionRule[] = [
    {
      kind: ActionKind.ERC20_TRANSFER,
      target: ctx.addresses.MockUSDC,
      selector: "0xa9059cbb",
      counterparty: ctx.devWallet.address,
      maxAmount: USDC(5000),
      codeHash: ZERO,
      childCount: 0,
    },
  ];
  const intentHash = hashRules(rules);
  const actionsHash = hashActions(actions);

  await createRegistryProposal(
    ctx,
    proposalId,
    textV1,
    root1,
    intentHash,
    disclosureHash
  );
  store.addDocument(textV2);
  const root2 = store.buildManifest().evidenceRoot;
  await appendRegistryVersion(
    ctx,
    proposalId,
    textV2,
    root2,
    intentHash,
    disclosureHash
  );

  const version = 2n;
  const versionHash = await ctx.registry.latestVersionHash(proposalId);
  const govId = await submitToGovernor(
    ctx,
    proposalId,
    version,
    versionHash,
    actionsHash,
    intentHash,
    disclosureHash
  );
  await registerBundle(ctx, {
    key: "1",
    title: "Q4 Development Grant",
    proposalId,
    govId,
    actions,
    rules,
    labels: { [ctx.devWallet.address.toLowerCase()]: "Dev wallet" },
  });
  await openVoting(ctx, govId);
  await castVote(ctx, govId, ctx.voter1, 1, true);
  await castVote(ctx, govId, ctx.voter2, 1, true);

  const commitment = await finalizeAndQueue(ctx, govId);
  await increaseTime(MIN_DELAY + 10);
  await (
    await ctx.executor.execute(
      proposalId,
      version,
      versionHash,
      disclosureHash,
      actions,
      rules
    )
  ).wait();
  await (await ctx.governor.syncFromExecutor(govId)).wait();

  const execState = Number(await ctx.executor.getState(commitment));
  const govState = Number((await ctx.governor.getGovProposal(govId)).state);
  if (execState !== 2 || govState !== 6) {
    throw new Error(`P1 unexpected states: executor=${execState} governor=${govState}`);
  }
  const chain = await ctx.registry.getVersionChain(proposalId);
  if (chain.length !== 2) {
    throw new Error(`P1 expected 2 versions, got ${chain.length}`);
  }

  return {
    id: proposalId,
    entry: {
      title: "Q4 Development Grant",
      govId: govId.toString(),
      state: "Executed",
      commitment,
      versionChain: chain,
      notes:
        `2 versions (draft -> final); evidenceRoots ${short(root1)} / ${short(root2)}; ` +
        `5,000 USDC executed to ${ctx.devWallet.address}.`,
    },
  };
}

async function seedP2(ctx: Ctx): Promise<{ id: bigint; entry: DemoEntry }> {
  const store = freshEvidenceStore("p2");
  const text = "Routine parameter tuning of the fee module: set the fee to 35 bps.";
  store.addDocument(text);
  store.addDocument(
    "Committed intent: PARAM_SET setFee(uint256) on FeeModule, max value 100."
  );
  const root = store.buildManifest().evidenceRoot;

  const proposalId = await ctx.registry.nextProposalId();
  const walletListHash = contentHash(JSON.stringify([ctx.proposer.address]));
  const interestsHash = contentHash("no financial interests declared");
  const disclosureHash = await submitDisclosure(
    ctx,
    proposalId,
    walletListHash,
    interestsHash,
    0n
  );

  const benignActions: Action[] = [
    {
      target: ctx.addresses.FeeModule,
      value: 0n,
      data: ctx.feeModule.interface.encodeFunctionData("setFee", [35]),
    },
  ];
  const benignRules: ActionRule[] = [
    {
      kind: ActionKind.PARAM_SET,
      target: ctx.addresses.FeeModule,
      selector: "0x69fe0e2d",
      counterparty: ethers.ZeroAddress,
      maxAmount: 100n,
      codeHash: ZERO,
      childCount: 0,
    },
  ];
  const intentHash = hashRules(benignRules);
  const actionsHash = hashActions(benignActions);

  await createRegistryProposal(
    ctx,
    proposalId,
    text,
    root,
    intentHash,
    disclosureHash
  );
  const version = 1n;
  const versionHash = await ctx.registry.latestVersionHash(proposalId);
  const govId = await submitToGovernor(
    ctx,
    proposalId,
    version,
    versionHash,
    actionsHash,
    intentHash,
    disclosureHash
  );
  await registerBundle(ctx, {
    key: "2",
    title: "Routine parameter tuning of the fee module",
    proposalId,
    govId,
    actions: benignActions,
    rules: benignRules,
  });
  await openVoting(ctx, govId);
  await castVote(ctx, govId, ctx.voter1, 1, true);
  await castVote(ctx, govId, ctx.voter2, 1, true);
  const commitment = await finalizeAndQueue(ctx, govId);

  const maliciousActions: Action[] = [
    {
      target: ctx.addresses.TreasuryProxy,
      value: 0n,
      data: ctx.treasuryProxy.interface.encodeFunctionData("upgradeTo", [
        ctx.addresses.MaliciousImpl,
      ]),
    },
  ];
  const simulation = await simulateProposalExecution(
    ctx.executor,
    proposalId,
    version,
    versionHash,
    disclosureHash,
    maliciousActions,
    benignRules,
    {
      treasuryProxy: ctx.addresses.TreasuryProxy,
      feeModule: ctx.addresses.FeeModule,
      executor: ctx.addresses.IntentLockExecutor,
      usdc: ctx.addresses.MockUSDC,
      vulnerableProxy: ctx.addresses.VulnerableProxy,
    },
    [ctx.devWallet.address, ctx.challenger.address]
  );

  const labels: Record<string, string> = {
    [ctx.addresses.TreasuryProxy.toLowerCase()]: "TreasuryProxy",
    [ctx.addresses.FeeModule.toLowerCase()]: "FeeModule",
    [ctx.addresses.MaliciousImpl.toLowerCase()]: "MaliciousImpl",
    [ctx.addresses.IntentLockExecutor.toLowerCase()]: "IntentLockExecutor",
    [ctx.addresses.MockUSDC.toLowerCase()]: "MockUSDC",
    [ctx.proposer.address.toLowerCase()]: "Proposer",
  };
  const report = buildViolationReport(simulation, {
    proposalId: proposalId.toString(),
    scenarioId: "P2",
    proposalSaid: text,
    targetLabels: labels,
    layer: "sentinel",
    status: "FLAGGED",
  });
  report.evidence.commitment = commitment;
  const chain = await ctx.registry.getVersionChain(proposalId);
  const reportHash = hashViolationReport(report);
  let entryState: string;
  let notes: string;

  if (GUARDIAN_MODE === "auto") {
    const halt = await haltProposal(ctx.executor, ctx.guardian, commitment, report);
    await (await ctx.governor.syncFromExecutor(govId)).wait();

    const execState = Number(await ctx.executor.getState(commitment));
    const govState = Number((await ctx.governor.getGovProposal(govId)).state);
    if (execState !== 3 || govState !== 7) {
      throw new Error(`P2 unexpected states: executor=${execState} governor=${govState}`);
    }
    entryState = "Halted";
    notes =
      `Queued benign setFee(35); malicious upgradeTo(${short(ctx.addresses.MaliciousImpl)}) ` +
      `was presented and flagged by the Sentinel (${simulation.haltReason ?? "violation"}); ` +
      `guardian halt ${short(halt.reportHash)}; evidenceRoot ${short(root)}.`;
  } else {
    const execState = Number(await ctx.executor.getState(commitment));
    const govState = Number((await ctx.governor.getGovProposal(govId)).state);
    if (execState !== 1 || govState !== 5) {
      throw new Error(
        `P2 hardware mode expected Queued, got executor=${execState} governor=${govState}`
      );
    }

    const reports = readLiveReports();
    reports.watcher = null;
    reports.events = [];
    reports.results = {};
    const now = new Date().toISOString();
    appendSentinelEvent(
      reports,
      {
        id: `p2-pending-${Date.now()}`,
        at: now,
        phase: "VIOLATION",
        proposalId: proposalId.toString(),
        govId: govId.toString(),
        commitment,
        title: "Routine parameter tuning of the fee module",
        blockNumber: null,
        txHash: null,
        detail:
          "Sentinel flagged an uncommitted upgrade in the queued bundle. " +
          "Awaiting guardian signature.",
        reportHash,
        report,
      },
      {
        proposalId: proposalId.toString(),
        govId: govId.toString(),
        commitment,
        title: "Routine parameter tuning of the fee module",
        status: "OBSERVED",
        updatedAt: now,
        reason: "Uncommitted upgradeTo in the queued execution bundle",
        reportHash,
        report,
      }
    );
    writeLiveReports(reports);

    entryState = "Queued";
    notes =
      `Queued benign setFee(35); malicious upgradeTo(${short(ctx.addresses.MaliciousImpl)}) ` +
      `was presented and flagged by the Sentinel (${simulation.haltReason ?? "violation"}); ` +
      `report ${short(reportHash)} is awaiting a guardian signature (hardware-confirmed mode); ` +
      `evidenceRoot ${short(root)}.`;
  }

  return {
    id: proposalId,
    entry: {
      title: "Routine parameter tuning of the fee module",
      govId: govId.toString(),
      state: entryState,
      commitment,
      versionChain: chain,
      notes,
    },
  };
}

async function seedP3(ctx: Ctx): Promise<{ id: bigint; entry: DemoEntry }> {
  const store = freshEvidenceStore("p3");
  const graphSeed = buildSeedData();
  const proposalId = await ctx.registry.nextProposalId();
  graphSeed.proposalId = proposalId.toString();
  const coi = assessConflictOfInterest(graphSeed);
  const recipient =
    graphSeed.nodes.find((node) => node.role === "recipient")?.id ?? ethers.ZeroAddress;
  const [walletA, , walletB] = graphSeed.disclosure.disclosedWallets;

  store.addDocument(
    `P3 disclosure: wallets ${walletA} and ${walletB}; interests: none. ` +
      "The disclosure omits the intermediary path to the recipient."
  );
  const evidenceDocHash = store.addDocument(coi.challengePayload.canonicalEvidence);
  if (
    evidenceDocHash.toLowerCase() !==
    coi.challengePayload.linkEvidenceHash.toLowerCase()
  ) {
    throw new Error("P3 challenge evidence hash does not match the graph payload");
  }
  const root = store.buildManifest().evidenceRoot;

  const walletListHash = contentHash(JSON.stringify([walletA, walletB].sort()));
  const interestsHash = contentHash("no financial interests declared");
  const disclosureHash = await submitDisclosure(
    ctx,
    proposalId,
    walletListHash,
    interestsHash,
    ethers.parseEther("1")
  );

  const text =
    "Ecosystem grant with hidden link: 7,500 USDC to the ecosystem recipient.";
  const actions: Action[] = [
    {
      target: ctx.addresses.MockUSDC,
      value: 0n,
      data: ctx.usdc.interface.encodeFunctionData("transfer", [
        recipient,
        USDC(7500),
      ]),
    },
  ];
  const rules: ActionRule[] = [
    {
      kind: ActionKind.ERC20_TRANSFER,
      target: ctx.addresses.MockUSDC,
      selector: "0xa9059cbb",
      counterparty: recipient,
      maxAmount: USDC(7500),
      codeHash: ZERO,
      childCount: 0,
    },
  ];
  const intentHash = hashRules(rules);
  const actionsHash = hashActions(actions);

  await createRegistryProposal(
    ctx,
    proposalId,
    text,
    root,
    intentHash,
    disclosureHash
  );
  const versionHash = await ctx.registry.latestVersionHash(proposalId);
  const govId = await submitToGovernor(
    ctx,
    proposalId,
    1n,
    versionHash,
    actionsHash,
    intentHash,
    disclosureHash
  );
  await registerBundle(ctx, {
    key: "3",
    title: "Ecosystem grant with hidden link",
    proposalId,
    govId,
    actions,
    rules,
    labels: { [recipient.toLowerCase()]: "Ecosystem recipient" },
  });
  await openVoting(ctx, govId);
  await castVote(ctx, govId, ctx.voter1, 1, true);

  await (
    await ctx.disclosure
      .connect(ctx.challenger)
      .fileChallenge(
        proposalId,
        coi.challengePayload.linkEvidenceHash,
        coi.challengePayload.reason
      )
  ).wait();
  await (
    await ctx.disclosure.connect(ctx.verifier).verifyChallenge(proposalId, 0n)
  ).wait();

  const challenged = await ctx.disclosure.isChallenged(proposalId);
  const govProposal = await ctx.governor.getGovProposal(govId);
  const govState = Number(govProposal.state);
  if (!challenged || govState !== 2) {
    throw new Error(
      `P3 expected VotingOpen + challenged, got governor=${govState} challenged=${challenged}`
    );
  }
  const chain = await ctx.registry.getVersionChain(proposalId);

  return {
    id: proposalId,
    entry: {
      title: "Ecosystem grant with hidden link",
      govId: govId.toString(),
      state: "Challenged",
      commitment: govProposal.commitment,
      versionChain: chain,
      notes:
        `Governor state VotingOpen; disclosure challenged and verified (1 ETH bond slashed to challenger); ` +
        `linkEvidenceHash ${short(coi.challengePayload.linkEvidenceHash)}; evidenceRoot ${short(root)}; ` +
        "intermediary path is SIMULATED graph data.",
    },
  };
}

async function seedP4(ctx: Ctx): Promise<{ id: bigint; entry: DemoEntry }> {
  const proposalId = await ctx.registry.nextProposalId();
  const walletListHash = contentHash(
    JSON.stringify([ctx.proposer.address, ctx.vendor.address].sort())
  );
  const interestsHash = contentHash("no financial interests declared");
  const disclosureHash = await submitDisclosure(
    ctx,
    proposalId,
    walletListHash,
    interestsHash,
    0n
  );

  const text = "Infrastructure budget: 10,000 USDC to the infrastructure vendor.";
  const actions: Action[] = [
    {
      target: ctx.addresses.MockUSDC,
      value: 0n,
      data: ctx.usdc.interface.encodeFunctionData("transfer", [
        ctx.vendor.address,
        USDC(10000),
      ]),
    },
  ];
  const rules: ActionRule[] = [
    {
      kind: ActionKind.ERC20_TRANSFER,
      target: ctx.addresses.MockUSDC,
      selector: "0xa9059cbb",
      counterparty: ctx.vendor.address,
      maxAmount: USDC(10000),
      codeHash: ZERO,
      childCount: 0,
    },
  ];
  const intentHash = hashRules(rules);
  const actionsHash = hashActions(actions);

  await createRegistryProposal(
    ctx,
    proposalId,
    text,
    ZERO,
    intentHash,
    disclosureHash
  );
  const versionHash = await ctx.registry.latestVersionHash(proposalId);
  const govId = await submitToGovernor(
    ctx,
    proposalId,
    1n,
    versionHash,
    actionsHash,
    intentHash,
    disclosureHash
  );
  await registerBundle(ctx, {
    key: "4",
    title: "Infrastructure budget",
    proposalId,
    govId,
    actions,
    rules,
    labels: { [ctx.vendor.address.toLowerCase()]: "Vendor" },
  });
  await openVoting(ctx, govId);
  await castVote(ctx, govId, ctx.voter1, 1, true);
  await castVote(ctx, govId, ctx.voter2, 1, false);
  await castVote(ctx, govId, ctx.voter3, 0, true);

  const govProposal = await ctx.governor.getGovProposal(govId);
  const govState = Number(govProposal.state);
  const challenged = await ctx.disclosure.isChallenged(proposalId);
  if (govState !== 2 || challenged) {
    throw new Error(
      `P4 expected VotingOpen + no challenge, got governor=${govState} challenged=${challenged}`
    );
  }
  const chain = await ctx.registry.getVersionChain(proposalId);

  return {
    id: proposalId,
    entry: {
      title: "Infrastructure budget",
      govId: govId.toString(),
      state: "VotingOpen",
      commitment: govProposal.commitment,
      versionChain: chain,
      notes:
        "Voting open with mixed informed/uninformed votes; no disclosure challenge and no Sentinel halt; awaiting finalization.",
    },
  };
}

async function seedP5(ctx: Ctx): Promise<{ id: bigint; entry: DemoEntry }> {
  const text = `Proposal: Community Grants Expansion

Allocate a reasonable amount to promising ecosystem teams. The recipient list may evolve at the team's discretion. Grants are expected to recur quarterly.`;
  const draft = extractIntentHeuristic(text);
  const proposalId = await ctx.registry.nextProposalId();
  const intentHash = contentHash(JSON.stringify(draft));

  await createRegistryProposal(ctx, proposalId, text, ZERO, intentHash, ZERO);

  const chain = await ctx.registry.getVersionChain(proposalId);
  const questions = draft.unresolved.map((item) => item.question);
  if (questions.length === 0) {
    throw new Error("P5 expected unresolved intent items");
  }

  return {
    id: proposalId,
    entry: {
      title: draft.title,
      govId: null,
      state: "Drafted",
      commitment: null,
      versionChain: chain,
      notes:
        `Draft only (not submitted to governor). ${questions.length} UNRESOLVED item(s): ` +
        questions.join(" "),
    },
  };
}

async function seedP6(ctx: Ctx): Promise<{ id: bigint; entry: DemoEntry }> {
  const title = "Routine parameter tuning (obfuscated)";
  const text =
    "Routine parameter tuning (obfuscated): set the fee module parameter to 35 bps. " +
    "No upgrade and no ownership change is proposed.";
  const store = freshEvidenceStore("p6");
  store.addDocument(text);
  store.addDocument(
    "Committed intent: PARAM_SET setFee(uint256) on FeeModule, max value 100."
  );
  const root = store.buildManifest().evidenceRoot;

  const proposalId = await ctx.registry.nextProposalId();
  const walletListHash = contentHash(JSON.stringify([ctx.proposer.address]));
  const interestsHash = contentHash("no financial interests declared");
  const disclosureHash = await submitDisclosure(
    ctx,
    proposalId,
    walletListHash,
    interestsHash,
    0n
  );

  // The stated intent: a bounded fee-parameter change, nothing else.
  const statedRules: ActionRule[] = [
    {
      kind: ActionKind.PARAM_SET,
      target: ctx.addresses.FeeModule,
      selector: "0x69fe0e2d",
      counterparty: ethers.ZeroAddress,
      maxAmount: 100n,
      codeHash: ZERO,
      childCount: 0,
    },
  ];
  const intentHash = hashRules(statedRules);

  // The committed calldata: an opaque multicall that installs MaliciousImpl and
  // hands ownership of the treasury proxy to the attacker wallet.
  const upgradeData = ctx.treasuryProxy.interface.encodeFunctionData("upgradeTo", [
    ctx.addresses.MaliciousImpl,
  ]);
  const ownershipData = ctx.treasuryProxy.interface.encodeFunctionData(
    "transferOwnership",
    [ctx.attacker.address]
  );
  const attackActions: Action[] = [
    {
      target: ctx.addresses.TreasuryProxy,
      value: 0n,
      data: ctx.treasuryProxy.interface.encodeFunctionData("multicall", [
        [upgradeData, ownershipData],
      ]),
    },
  ];
  const actionsHash = hashActions(attackActions);

  await createRegistryProposal(
    ctx,
    proposalId,
    text,
    root,
    intentHash,
    disclosureHash
  );
  const versionHash = await ctx.registry.latestVersionHash(proposalId);
  const govId = await submitToGovernor(
    ctx,
    proposalId,
    1n,
    versionHash,
    actionsHash,
    intentHash,
    disclosureHash
  );
  await registerBundle(ctx, {
    key: "6",
    title,
    proposalId,
    govId,
    actions: attackActions,
    rules: statedRules,
    labels: {
      [ctx.addresses.MaliciousImpl.toLowerCase()]: "MaliciousImpl (not in the stated intent)",
      [ctx.attacker.address.toLowerCase()]: "Attacker wallet",
    },
  });
  await openVoting(ctx, govId);
  await castVote(ctx, govId, ctx.voter1, 1, true);

  const govProposal = await ctx.governor.getGovProposal(govId);
  if (Number(govProposal.state) !== 2) {
    throw new Error(`P6 expected VotingOpen, got ${Number(govProposal.state)}`);
  }
  const chain = await ctx.registry.getVersionChain(proposalId);

  return {
    id: proposalId,
    entry: {
      title,
      govId: govId.toString(),
      state: "VotingOpen",
      commitment: govProposal.commitment,
      versionChain: chain,
      notes:
        "Committed calldata is a multicall([upgradeTo, transferOwnership]) while the " +
        "stated intent and committed rules describe only setFee(35). The pre-vote " +
        "effect preview must flag the implementation and owner changes BEFORE the vote.",
    },
  };
}

async function verifyDemoState(ctx: Ctx, demo: DemoState): Promise<void> {
  for (const [key, entry] of Object.entries(demo)) {
    const id = BigInt(key);
    const chain = await ctx.registry.getVersionChain(id);
    assertEqual(JSON.stringify(chain), JSON.stringify(entry.versionChain), `P${key} version chain`);
    if (!(await ctx.registry.verifyChain(id))) {
      throw new Error(`P${key} registry hash chain is invalid`);
    }

    if (entry.govId) {
      const gov = await ctx.governor.getGovProposal(BigInt(entry.govId));
      assertEqual(gov.commitment, entry.commitment, `P${key} commitment`);
      const govState = Number(gov.state);

      if (key === "1") {
        assertEqual(Number(await ctx.executor.getState(gov.commitment)), 2, "P1 executor state");
        assertEqual(govState, 6, "P1 governor state");
      } else if (key === "2") {
        const expectedExec = GUARDIAN_MODE === "auto" ? 3 : 1;
        const expectedGov = GUARDIAN_MODE === "auto" ? 7 : 5;
        assertEqual(
          Number(await ctx.executor.getState(gov.commitment)),
          expectedExec,
          "P2 executor state"
        );
        assertEqual(govState, expectedGov, "P2 governor state");
      } else if (key === "3") {
        assertEqual(govState, 2, "P3 governor state");
        if (!(await ctx.disclosure.isChallenged(id))) {
          throw new Error("P3 disclosure is not challenged");
        }
      } else if (key === "4") {
        assertEqual(govState, 2, "P4 governor state");
        if (await ctx.disclosure.isChallenged(id)) {
          throw new Error("P4 disclosure should not be challenged");
        }
      } else if (key === "6") {
        assertEqual(govState, 2, "P6 governor state");
        if (await ctx.disclosure.isChallenged(id)) {
          throw new Error("P6 disclosure should not be challenged");
        }
      }
    } else {
      assertEqual(Number(await ctx.registry.versionCount(id)), 1, `P${key} version count`);
    }
  }

  const states = Object.values(demo).map((entry) => entry.state);
  if (new Set(states).size < 5) {
    throw new Error(`Expected at least five distinct states, got: ${states.join(", ")}`);
  }
}

function printSummary(demo: DemoState, demoPath: string): void {
  console.log("\nSeeded proposals (verified against the chain):");
  console.log(
    "ID  Gov  State        Versions  Commitment          Title"
  );
  for (const [id, entry] of Object.entries(demo)) {
    const commitment = entry.commitment ? short(entry.commitment) : "—";
    console.log(
      `${id.padEnd(3)} ${String(entry.govId ?? "—").padEnd(4)} ` +
        `${entry.state.padEnd(12)} ${String(entry.versionChain.length).padEnd(9)} ` +
        `${commitment.padEnd(19)} ${entry.title}`
    );
  }
  console.log("\nNotes:");
  for (const [id, entry] of Object.entries(demo)) {
    console.log(`  P${id}: ${entry.notes}`);
  }
  console.log(`\nUI index written to: ${demoPath}`);
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (String(actual).toLowerCase() !== String(expected).toLowerCase()) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
  }
}

async function main(): Promise<void> {
  const signers = await ethers.getSigners();
  const [
    deployer,
    guardian,
    verifier,
    proposer,
    voter1,
    voter2,
    voter3,
    devWallet,
    challenger,
    vendor,
    attacker,
  ] = signers;
  const network = await ethers.provider.getNetwork();
  console.log(`Seeding demo on chain ${network.chainId} as ${deployer.address}`);

  const deployment = await deployAll("local");
  cleanAbis();

  const addresses: Record<string, string> = {};
  for (const [name, contract] of Object.entries(deployment.contracts)) {
    addresses[name] = (contract as { address: string }).address;
  }

  const usdc = await ethers.getContractAt("MockUSDC", addresses.MockUSDC);
  const votingToken = await ethers.getContractAt(
    "MockUSDC",
    addresses.GovernanceToken
  );
  for (const voter of [voter1, voter2, voter3]) {
    await (
      await votingToken.mint(voter.address, ethers.parseEther("1000"))
    ).wait();
  }

  const ctx: Ctx = {
    registry: await ethers.getContractAt(
      "ProposalRegistry",
      addresses.ProposalRegistry
    ),
    disclosure: await ethers.getContractAt(
      "DisclosureRegistry",
      addresses.DisclosureRegistry
    ),
    executor: await ethers.getContractAt(
      "IntentLockExecutor",
      addresses.IntentLockExecutor
    ),
    governor: await ethers.getContractAt(
      "IntentGovernor",
      addresses.IntentGovernor
    ),
    usdc,
    feeModule: await ethers.getContractAt("FeeModule", addresses.FeeModule),
    treasuryProxy: await ethers.getContractAt(
      "TreasuryProxy",
      addresses.TreasuryProxy
    ),
    maliciousImpl: await ethers.getContractAt(
      "MaliciousImpl",
      addresses.MaliciousImpl
    ),
    vulnerableProxy: await ethers.getContractAt(
      "VulnerableProxy",
      addresses.VulnerableProxy
    ),
    proposer,
    guardian,
    verifier,
    challenger,
    devWallet,
    vendor,
    voter1,
    voter2,
    voter3,
    attacker,
    addresses,
  };

  const demo: DemoState = {};
  for (const seed of [seedP1, seedP2, seedP3, seedP4, seedP5, seedP6]) {
    const { id, entry } = await seed(ctx);
    demo[id.toString()] = entry;
    console.log(`  ✔ P${id}: ${entry.title} -> ${entry.state}`);
  }

  await verifyDemoState(ctx, demo);

  const demoPath = path.join(
    __dirname,
    "..",
    "packages",
    "shared",
    "fixtures",
    "demo-state.json"
  );
  fs.mkdirSync(path.dirname(demoPath), { recursive: true });
  fs.writeFileSync(demoPath, JSON.stringify(demo, null, 2) + "\n", "utf8");

  printSummary(demo, demoPath);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
