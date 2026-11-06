/**
 * scripts/seed-sepolia.ts
 *
 * Seeds the AegisDAO demo storyline on Sepolia against an existing deployment
 * (deployments/sepolia.json). Unlike scripts/seed-demo.ts this never advances
 * time and never redeploys: it polls the chain until the voting period and
 * timelock have really elapsed.
 *
 * Resumable: every step checks on-chain state first, and the logical proposal
 * ids are checkpointed in packages/shared/fixtures/sepolia-seed-progress.json.
 * Re-run the same command after an interruption to continue.
 *
 * Run: npx hardhat run scripts/seed-sepolia.ts --network sepolia
 */

import { ethers } from "hardhat";
import type { Contract, Wallet } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";
import { EvidenceStore } from "../intelligence/evidence";
import { extractIntentHeuristic } from "../intelligence/ai-draft";
import { assessConflictOfInterest, buildSeedData } from "../intelligence/graph";
import { haltProposal } from "../sentinel/halt";
import { upsertExecutionBundle } from "../sentinel/live-store";
import {
  Action,
  ActionRule,
  ActionKind,
  hashActions,
  hashRules,
} from "../packages/shared/hash";

const NETWORK = "sepolia";
const ZERO = ethers.ZeroHash;
const POLL_MS = Number(process.env.SEED_POLL_MS ?? 10_000);
const USDC = (whole: number) => ethers.parseUnits(String(whole), 6);

interface ManifestContract {
  address: string;
  abi: unknown[];
}

interface Manifest {
  network: string;
  chainId: number;
  contracts: Record<string, ManifestContract>;
}

interface DemoEntry {
  title: string;
  govId: string | null;
  state: string;
  commitment: string | null;
  versionChain: string[];
  notes: string;
}

type DemoState = Record<string, DemoEntry>;

interface Progress {
  network: string;
  chainId: number;
  updatedAt: string;
  contracts: Record<string, string>;
  proposals: Record<string, { proposalId: string; govId?: string; step?: string }>;
}

interface Ctx {
  registry: any;
  disclosure: any;
  executor: any;
  governor: any;
  usdc: any;
  votingToken: any;
  feeModule: any;
  treasuryProxy: any;
  maliciousImpl: any;
  vulnerableProxy: any;
  addresses: Record<string, string>;
  deployer: Wallet;
  proposer: Wallet;
  guardian: Wallet | null;
  verifier: Wallet;
  challenger: Wallet;
  voter1: Wallet;
  voter2: Wallet;
  voter3: Wallet;
  attacker: string;
  devWallet: string;
  vendor: string;
}

const root = path.join(__dirname, "..");
const demoPath = path.join(root, "packages", "shared", "fixtures", "demo-state.json");
const progressPath = path.join(
  root,
  "packages",
  "shared",
  "fixtures",
  "sepolia-seed-progress.json"
);

const contentHash = (text: string) => ethers.keccak256(ethers.toUtf8Bytes(text));
const short = (value: string) =>
  value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const details = error as Error & { shortMessage?: string };
    return details.shortMessage ?? details.message;
  }
  return String(error);
}

function isRetryable(message: string): boolean {
  return /429|rate.?limit|timeout|timed out|SERVER_ERROR|could not coalesce|ECONNRESET|ETIMEDOUT|network error|502|503|504/i.test(
    message
  );
}

async function retry(
  label: string,
  fn: () => Promise<any>,
  attempts = 6
): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = errorMessage(error);
      if (!isRetryable(message) || attempt === attempts - 1) throw error;
      const wait = Math.min(30_000, 2_000 * 2 ** attempt);
      console.log(`  … ${label}: ${message} (retry in ${wait / 1000}s)`);
      await sleep(wait);
    }
  }
  throw lastError;
}

async function send(
  label: string,
  fn: () => Promise<{ hash: string; wait: (n?: number) => Promise<unknown> }>
): Promise<string> {
  const tx = await retry(label, fn);
  await retry(`${label} receipt`, () => tx.wait(1) as Promise<unknown>);
  console.log(`  ✔ ${label} (${short(tx.hash)})`);
  return tx.hash;
}

function normalizeKey(key: string): string {
  return key.startsWith("0x") ? key : `0x${key}`;
}

function requireWallet(name: string): Wallet {
  const key = process.env[name];
  if (!key) {
    throw new Error(`Missing ${name} in .env (see .env.example).`);
  }
  return new ethers.Wallet(normalizeKey(key), ethers.provider);
}

function optionalWallet(name: string): Wallet | null {
  const key = process.env[name];
  if (!key) return null;
  return new ethers.Wallet(normalizeKey(key), ethers.provider);
}

function addressFrom(addressEnv: string, keyEnv: string, fallback: string): string {
  const address = process.env[addressEnv];
  if (address) {
    if (!ethers.isAddress(address)) throw new Error(`${addressEnv} is not an address`);
    return ethers.getAddress(address);
  }
  const key = process.env[keyEnv];
  if (key) return new ethers.Wallet(normalizeKey(key)).address;
  return fallback;
}

function loadManifest(): Manifest {
  const file = path.join(root, "deployments", `${NETWORK}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `Deployment manifest not found: ${file}. Run ` +
        `"npx hardhat run scripts/deploy.ts --network sepolia" first.`
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as Manifest;
}

function loadProgress(chainId: number, contracts: Record<string, string>): Progress {
  if (fs.existsSync(progressPath)) {
    const stored = JSON.parse(fs.readFileSync(progressPath, "utf8")) as Progress;
    if (stored.chainId === chainId) {
      return { ...stored, contracts };
    }
    console.log("  ℹ Existing seed progress is for another chain; starting fresh.");
  }
  return {
    network: NETWORK,
    chainId,
    updatedAt: new Date().toISOString(),
    contracts,
    proposals: {},
  };
}

function saveProgress(progress: Progress): void {
  progress.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(progressPath), { recursive: true });
  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2) + "\n", "utf8");
}

function loadDemoState(): DemoState {
  if (!fs.existsSync(demoPath)) return {};
  return JSON.parse(fs.readFileSync(demoPath, "utf8")) as DemoState;
}

function saveDemoState(demo: DemoState): void {
  fs.mkdirSync(path.dirname(demoPath), { recursive: true });
  fs.writeFileSync(demoPath, JSON.stringify(demo, null, 2) + "\n", "utf8");
}

function evidenceStore(name: string): EvidenceStore {
  return new EvidenceStore({
    storeDir: path.join(root, "intelligence", "store", `sepolia-${name}`),
  });
}

async function latestTimestamp(): Promise<bigint> {
  const block = await retry("getBlock", () => ethers.provider.getBlock("latest"));
  return BigInt(block?.timestamp ?? 0);
}

async function waitUntil(timestamp: bigint, label: string): Promise<void> {
  let lastLog = 0;
  for (;;) {
    const now = await latestTimestamp();
    if (now > timestamp) return;
    const remaining = Number(timestamp - now);
    if (Date.now() - lastLog > 20_000) {
      console.log(`  … ${label}: waiting ${remaining}s on-chain time`);
      lastLog = Date.now();
    }
    await sleep(POLL_MS);
  }
}

async function waitForExecutorState(
  executor: Contract,
  commitment: string,
  expected: number,
  timeoutMs: number,
  label: string
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = Number(await retry("getState", () => executor.getState(commitment)));
    if (state === expected) return;
    if (Date.now() > deadline) {
      throw new Error(`${label} timed out (executor state ${state}, expected ${expected})`);
    }
    await sleep(POLL_MS);
  }
}

async function findGovId(governor: Contract, proposalId: bigint): Promise<bigint | null> {
  const next: bigint = await retry("nextGovId", () => governor.nextGovId());
  for (let gid = 1n; gid < next; gid++) {
    const p = await retry("getGovProposal", () => governor.getGovProposal(gid));
    if (BigInt(p.proposalId) === proposalId) return gid;
  }
  return null;
}

async function proposalIdFor(
  ctx: Ctx,
  progress: Progress,
  key: string
): Promise<bigint> {
  const stored = progress.proposals[key]?.proposalId;
  if (stored) return BigInt(stored);

  const next: bigint = await retry("nextProposalId", () => ctx.registry.nextProposalId());
  progress.proposals[key] = { proposalId: next.toString() };
  saveProgress(progress);
  return next;
}

async function ensureDisclosure(
  ctx: Ctx,
  proposalId: bigint,
  walletListHash: string,
  interestsHash: string,
  bondAmount: bigint
): Promise<string> {
  if (await retry("hasDisclosure", () => ctx.disclosure.hasDisclosure(proposalId))) {
    return (await retry("getDisclosureHash", () =>
      ctx.disclosure.getDisclosureHash(proposalId)
    )) as string;
  }

  const nonce: bigint = await retry("nonces", () =>
    ctx.disclosure.nonces(ctx.proposer.address)
  );
  const network = await retry("getNetwork", () => ethers.provider.getNetwork());
  const signature = await ctx.proposer.signTypedData(
    {
      name: "AegisDAO DisclosureRegistry",
      version: "1",
      chainId: Number(network.chainId),
      verifyingContract: await ctx.disclosure.getAddress(),
    },
    {
      Disclosure: [
        { name: "proposalId", type: "uint256" },
        { name: "proposer", type: "address" },
        { name: "walletListHash", type: "bytes32" },
        { name: "interestsHash", type: "bytes32" },
        { name: "bondAmount", type: "uint256" },
        { name: "nonce", type: "uint256" },
      ],
    },
    {
      proposalId,
      proposer: ctx.proposer.address,
      walletListHash,
      interestsHash,
      bondAmount,
      nonce,
    }
  );
  const sig = ethers.Signature.from(signature);

  await send("submitDisclosure", () =>
    ctx.disclosure.connect(ctx.proposer).submitDisclosure(
      proposalId,
      ctx.proposer.address,
      walletListHash,
      interestsHash,
      bondAmount,
      nonce,
      sig.v,
      sig.r,
      sig.s,
      { value: bondAmount }
    )
  );

  return (await retry("getDisclosureHash", () =>
    ctx.disclosure.getDisclosureHash(proposalId)
  )) as string;
}

async function ensureGovTokens(ctx: Ctx, wallets: Wallet[]): Promise<void> {
  const target = ethers.parseUnits(process.env.GOV_TOKEN_MINT_TOKENS ?? "1000", 18);
  for (const wallet of wallets) {
    const balance: bigint = await retry("balanceOf", () =>
      ctx.votingToken.balanceOf(wallet.address)
    );
    if (balance >= target) continue;
    await send(`mint GOV to ${short(wallet.address)}`, () =>
      ctx.votingToken.connect(ctx.proposer).mint(wallet.address, target - balance)
    );
  }
}

/** Open voting (if needed), cast any missing votes, wait, finalize, queue. */
async function passAndQueue(
  ctx: Ctx,
  govId: bigint,
  voters: { wallet: Wallet; support: number; informed: boolean }[]
): Promise<{ commitment: string; onChainVersion: bigint; versionHash: string; disclosureHash: string }> {
  let p = await retry("getGovProposal", () => ctx.governor.getGovProposal(govId));

  if (Number(p.state) === 1) {
    await send("openVoting", () => ctx.governor.connect(ctx.proposer).openVoting(govId));
    p = await retry("getGovProposal", () => ctx.governor.getGovProposal(govId));
  }

  if (Number(p.state) === 2) {
    for (const vote of voters) {
      const existing = await retry("getVote", () =>
        ctx.governor.getVote(govId, vote.wallet.address)
      );
      if (existing.hasVoted) continue;
      if (vote.informed) {
        const briefHash = ethers.id(`sepolia-brief:gov${govId}:${vote.wallet.address}`);
        await send(`voteWithBrief ${short(vote.wallet.address)}`, () =>
          ctx.governor.connect(vote.wallet).voteWithBrief(govId, vote.support, briefHash)
        );
      } else {
        await send(`castVote ${short(vote.wallet.address)}`, () =>
          ctx.governor.connect(vote.wallet).castVote(govId, vote.support)
        );
      }
    }

    p = await retry("getGovProposal", () => ctx.governor.getGovProposal(govId));
    await waitUntil(BigInt(p.voteEnd), `voting on govId ${govId}`);
    await send("finalizeVote", () => ctx.governor.finalizeVote(govId));
    p = await retry("getGovProposal", () => ctx.governor.getGovProposal(govId));
  }

  if (Number(p.state) === 3) {
    throw new Error(`govId ${govId} was defeated (quorum or margin failed)`);
  }

  if (Number(p.state) === 4) {
    await send("queueForExecution", () => ctx.governor.queueForExecution(govId));
    p = await retry("getGovProposal", () => ctx.governor.getGovProposal(govId));
  }

  if (Number(p.state) === 5) {
    return {
      commitment: String(p.commitment),
      onChainVersion: BigInt(p.version),
      versionHash: String(p.versionHash),
      disclosureHash: String(p.disclosureHash),
    };
  }

  if (Number(p.state) === 6) {
    // Already executed in a previous run; the commitment still identifies it.
    return {
      commitment: String(p.commitment),
      onChainVersion: BigInt(p.version),
      versionHash: String(p.versionHash),
      disclosureHash: String(p.disclosureHash),
    };
  }

  throw new Error(`govId ${govId} is in unexpected state ${Number(p.state)}`);
}

async function ensureRegistryVersions(
  ctx: Ctx,
  proposalId: bigint,
  versions: { text: string; evidenceRoot: string; intentHash: string; disclosureHash: string }[]
): Promise<string[]> {
  let count = Number(await retry("versionCount", () => ctx.registry.versionCount(proposalId)));

  if (count === 0) {
    const first = versions[0];
    await send("createProposal", () =>
      ctx.registry.connect(ctx.proposer).createProposal(
        contentHash(first.text),
        first.evidenceRoot,
        contentHash(`${first.text}|financial-assumptions`),
        contentHash(`${first.text}|technical-assessment`),
        first.intentHash,
        first.disclosureHash
      )
    );
    count = 1;
  }

  for (let index = count; index < versions.length; index++) {
    const version = versions[index];
    await send(`addVersion v${index + 1}`, () =>
      ctx.registry.connect(ctx.proposer).addVersion(
        proposalId,
        contentHash(version.text),
        version.evidenceRoot,
        contentHash(`${version.text}|financial-assumptions`),
        contentHash(`${version.text}|technical-assessment`),
        version.intentHash,
        version.disclosureHash
      )
    );
  }

  return (await retry("getVersionChain", () =>
    ctx.registry.getVersionChain(proposalId)
  )) as string[];
}

async function ensureSubmitted(
  ctx: Ctx,
  progress: Progress,
  key: string,
  proposalId: bigint,
  actionsHash: string,
  intentHash: string,
  disclosureHash: string
): Promise<bigint> {
  const version: bigint = await retry("versionCount", () => ctx.registry.versionCount(proposalId));
  const versionHash = String(
    await retry("latestVersionHash", () => ctx.registry.latestVersionHash(proposalId))
  );

  let govId = await findGovId(ctx.governor, proposalId);
  if (govId === null) {
    await send("submitProposal", () =>
      ctx.governor.connect(ctx.proposer).submitProposal(
        proposalId,
        version,
        versionHash,
        actionsHash,
        intentHash,
        disclosureHash
      )
    );
    govId = (await retry("nextGovId", () => ctx.governor.nextGovId())) as bigint;
    govId = govId - 1n;
  }

  progress.proposals[key] = {
    ...(progress.proposals[key] ?? { proposalId: proposalId.toString() }),
    govId: govId.toString(),
    step: "submitted",
  };
  saveProgress(progress);
  return govId;
}

/**
 * Register the committed calldata for a proposal so the Pre-vote Effect
 * Preview can simulate the EXACT bytes the vote commits to.
 */
function registerBundle(
  ctx: Ctx,
  args: {
    key: string;
    title: string;
    proposalId: bigint;
    govId: bigint;
    proposal: any;
    actions: Action[];
    rules: ActionRule[];
    labels?: Record<string, string>;
  }
): string {
  const commitment = String(args.proposal.commitment);
  upsertExecutionBundle({
    commitment,
    proposalId: args.proposalId.toString(),
    govId: args.govId.toString(),
    title: args.title,
    version: String(args.proposal.version),
    versionHash: String(args.proposal.versionHash),
    disclosureHash: String(args.proposal.disclosureHash),
    createdAt: new Date().toISOString(),
    source: "scripts/seed-sepolia.ts",
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

// ─────────────────────────────────────────────────────────────────────────────
// Proposals
// ─────────────────────────────────────────────────────────────────────────────

async function seedP1(ctx: Ctx, progress: Progress): Promise<DemoEntry> {
  const proposalId = await proposalIdFor(ctx, progress, "1");
  const store = evidenceStore("p1");
  const textV1 =
    "Q4 Development Grant (v1 draft): transfer 5,000 USDC to the development wallet for Q4 audits.";
  const textV2 =
    `Q4 Development Grant (v2 final): transfer 5,000 USDC to the development wallet ` +
    `${ctx.devWallet} for Q4 audits.`;

  const actions: Action[] = [
    {
      target: ctx.addresses.MockUSDC,
      value: 0n,
      data: ctx.usdc.interface.encodeFunctionData("transfer", [
        ctx.devWallet,
        USDC(5000),
      ]),
    },
  ];
  const rules: ActionRule[] = [
    {
      kind: ActionKind.ERC20_TRANSFER,
      target: ctx.addresses.MockUSDC,
      selector: "0xa9059cbb",
      counterparty: ctx.devWallet,
      maxAmount: USDC(5000),
      codeHash: ZERO,
      childCount: 0,
    },
  ];
  const intentHash = hashRules(rules);
  const actionsHash = hashActions(actions);

  const walletListHash = contentHash(
    JSON.stringify([ctx.proposer.address, ctx.devWallet].sort())
  );
  const disclosureHash = await ensureDisclosure(
    ctx,
    proposalId,
    walletListHash,
    contentHash("no financial interests declared"),
    0n
  );

  store.addDocument(textV1);
  const root1 = store.buildManifest().evidenceRoot;
  store.addDocument(textV2);
  const root2 = store.buildManifest().evidenceRoot;

  const chain = await ensureRegistryVersions(ctx, proposalId, [
    { text: textV1, evidenceRoot: root1, intentHash, disclosureHash },
    { text: textV2, evidenceRoot: root2, intentHash, disclosureHash },
  ]);

  const govId = await ensureSubmitted(
    ctx,
    progress,
    "1",
    proposalId,
    actionsHash,
    intentHash,
    disclosureHash
  );

  const p1Proposal = await retry("getGovProposal", () =>
    ctx.governor.getGovProposal(govId)
  );
  registerBundle(ctx, {
    key: "1",
    title: "Q4 Development Grant",
    proposalId,
    govId,
    proposal: p1Proposal,
    actions,
    rules,
    labels: { [ctx.devWallet.toLowerCase()]: "Dev wallet" },
  });

  await ensureGovTokens(ctx, [ctx.voter1, ctx.voter2]);
  const { commitment } = await passAndQueue(ctx, govId, [
    { wallet: ctx.voter1, support: 1, informed: true },
    { wallet: ctx.voter2, support: 1, informed: true },
  ]);

  let execState = Number(await retry("executor state", () => ctx.executor.getState(commitment)));
  if (execState === 1) {
    const queued = await retry("getProposal", () => ctx.executor.getProposal(commitment));
    await waitUntil(BigInt(queued.eta), "P1 timelock");
    await send("execute P1", () =>
      ctx.executor.execute(
        proposalId,
        BigInt(queued.version),
        queued.versionHash,
        queued.disclosureHash,
        actions,
        rules,
        { gasLimit: 3_000_000 }
      )
    );
    execState = Number(await retry("executor state", () => ctx.executor.getState(commitment)));
  }

  let govState = Number(
    (await retry("getGovProposal", () => ctx.governor.getGovProposal(govId))).state
  );
  if (govState === 5 && execState === 2) {
    await send("syncFromExecutor P1", () => ctx.governor.syncFromExecutor(govId));
    govState = Number(
      (await retry("getGovProposal", () => ctx.governor.getGovProposal(govId))).state
    );
  }

  if (execState !== 2 || govState !== 6) {
    throw new Error(`P1 expected Executed/Executed, got executor=${execState} governor=${govState}`);
  }

  return {
    title: "Q4 Development Grant",
    govId: govId.toString(),
    state: "Executed",
    commitment,
    versionChain: chain,
    notes:
      `2 versions on Sepolia; evidenceRoots ${short(root1)} / ${short(root2)}; ` +
      `5,000 USDC executed to ${ctx.devWallet}.`,
  };
}

async function seedP2(ctx: Ctx, progress: Progress): Promise<DemoEntry> {
  const proposalId = await proposalIdFor(ctx, progress, "2");
  const store = evidenceStore("p2");
  const text = "Routine parameter tuning of the fee module: set the fee to 35 bps.";
  const title = "Routine parameter tuning of the fee module";

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

  const walletListHash = contentHash(JSON.stringify([ctx.proposer.address]));
  const disclosureHash = await ensureDisclosure(
    ctx,
    proposalId,
    walletListHash,
    contentHash("no financial interests declared"),
    0n
  );

  store.addDocument(text);
  store.addDocument(
    "Committed intent: PARAM_SET setFee(uint256) on FeeModule, max value 100."
  );
  const evidenceRoot = store.buildManifest().evidenceRoot;

  const chain = await ensureRegistryVersions(ctx, proposalId, [
    { text, evidenceRoot, intentHash, disclosureHash },
  ]);

  // Resume path: a previous run already queued and halted this proposal.
  const existingGovId = await findGovId(ctx.governor, proposalId);
  if (existingGovId !== null) {
    const existing = await retry("getGovProposal", () =>
      ctx.governor.getGovProposal(existingGovId)
    );
    if (Number(existing.state) === 7) {
      return {
        title,
        govId: existingGovId.toString(),
        state: "Halted",
        commitment: String(existing.commitment),
        versionChain: chain,
        notes:
          `Queued benign setFee(35); malicious upgradeTo(${short(ctx.addresses.MaliciousImpl)}) ` +
          `was flagged by the Sentinel and halted by the guardian on Sepolia.`,
      };
    }
  }

  const govId = await ensureSubmitted(
    ctx,
    progress,
    "2",
    proposalId,
    actionsHash,
    intentHash,
    disclosureHash
  );

  const proposal = await retry("getGovProposal", () => ctx.governor.getGovProposal(govId));
  const commitment = String(proposal.commitment);

  // Register the malicious bundle before the proposal is queued so the
  // Sentinel can decode it the moment ProposalQueued is observed.
  upsertExecutionBundle({
    commitment,
    proposalId: proposalId.toString(),
    govId: govId.toString(),
    title,
    version: String(proposal.version),
    versionHash: String(proposal.versionHash),
    disclosureHash: String(proposal.disclosureHash),
    createdAt: new Date().toISOString(),
    source: "scripts/seed-sepolia.ts",
    actions: [
      {
        target: ctx.addresses.TreasuryProxy,
        value: "0",
        data: ctx.treasuryProxy.interface.encodeFunctionData("upgradeTo", [
          ctx.addresses.MaliciousImpl,
        ]),
      },
    ],
    rules: [
      {
        kind: ActionKind.PARAM_SET,
        target: ctx.addresses.FeeModule,
        selector: "0x69fe0e2d",
        counterparty: ethers.ZeroAddress,
        maxAmount: "100",
        codeHash: ZERO,
        childCount: 0,
      },
    ],
  });

  await ensureGovTokens(ctx, [ctx.voter1, ctx.voter2]);
  const queued = await passAndQueue(ctx, govId, [
    { wallet: ctx.voter1, support: 1, informed: true },
    { wallet: ctx.voter2, support: 1, informed: true },
  ]);

  let execState = Number(
    await retry("executor state", () => ctx.executor.getState(queued.commitment))
  );

  if (execState === 1) {
    const timeoutMs = Number(process.env.P2_HALT_TIMEOUT_SECONDS ?? 600) * 1000;
    console.log(
      `  … Waiting for the Sentinel (FORK=1) to halt ${short(queued.commitment)} ` +
        `(timeout ${timeoutMs / 1000}s)`
    );
    try {
      await waitForExecutorState(ctx.executor, queued.commitment, 3, timeoutMs, "P2 halt");
      execState = 3;
    } catch (error) {
      if (process.env.SEED_ALLOW_DIRECT_HALT !== "1") {
        throw new Error(
          `${errorMessage(error)}. Start the Sentinel on the Sepolia fork in another ` +
            `terminal (see docs/SEPOLIA.md), then re-run this command to resume. ` +
            `Set SEED_ALLOW_DIRECT_HALT=1 to let the seeder submit the guardian halt itself.`
        );
      }
      if (!ctx.guardian) {
        throw new Error("SEED_ALLOW_DIRECT_HALT=1 requires GUARDIAN_KEY in .env");
      }
      console.log("  ⚠ Sentinel did not halt in time; submitting guardian halt directly.");
      const report = {
        proposalId: proposalId.toString(),
        scenarioId: "P2-sepolia",
        layer: "sentinel",
        status: "FLAGGED",
        proposalSaid: text,
        approved: [],
        submitted: [],
        violatedConstraint: {
          code: "UnmatchedRule",
          message:
            "Submitted calldata upgrades TreasuryProxy although only setFee(uint256) was committed.",
        },
        evidence: {
          commitment: queued.commitment,
          calldataHash: actionsHash,
          calldata: "0x",
          revertData: "0x",
          txHash: null,
          traceRef: null,
        },
      };
      const receipt = await haltProposal(
        ctx.executor.connect(ctx.guardian),
        ctx.guardian,
        queued.commitment,
        report as never
      );
      console.log(`  ✔ Guardian halt ${receipt.txHash}`);
      execState = 3;
    }
  }

  let govState = Number(
    (await retry("getGovProposal", () => ctx.governor.getGovProposal(govId))).state
  );
  if (govState === 5 && execState === 3) {
    await send("syncFromExecutor P2", () => ctx.governor.syncFromExecutor(govId));
    govState = Number(
      (await retry("getGovProposal", () => ctx.governor.getGovProposal(govId))).state
    );
  }

  if (execState !== 3 || govState !== 7) {
    throw new Error(`P2 expected Halted/Halted, got executor=${execState} governor=${govState}`);
  }

  return {
    title,
    govId: govId.toString(),
    state: "Halted",
    commitment: queued.commitment,
    versionChain: chain,
    notes:
      `Queued benign setFee(35); malicious upgradeTo(${short(ctx.addresses.MaliciousImpl)}) ` +
      `was flagged by the Sentinel and halted by the guardian on Sepolia.`,
  };
}

async function seedP3(ctx: Ctx, progress: Progress): Promise<DemoEntry> {
  const proposalId = await proposalIdFor(ctx, progress, "3");
  const store = evidenceStore("p3");
  const graphSeed = buildSeedData();
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
  if (evidenceDocHash.toLowerCase() !== coi.challengePayload.linkEvidenceHash.toLowerCase()) {
    throw new Error("P3 challenge evidence hash does not match the graph payload");
  }
  const evidenceRoot = store.buildManifest().evidenceRoot;

  const text = "Ecosystem grant with hidden link: 7,500 USDC to the ecosystem recipient.";
  const actions: Action[] = [
    {
      target: ctx.addresses.MockUSDC,
      value: 0n,
      data: ctx.usdc.interface.encodeFunctionData("transfer", [recipient, USDC(7500)]),
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

  const walletListHash = contentHash(JSON.stringify([walletA, walletB].sort()));
  const disclosureHash = await ensureDisclosure(
    ctx,
    proposalId,
    walletListHash,
    contentHash("no financial interests declared"),
    ethers.parseEther("1")
  );

  const chain = await ensureRegistryVersions(ctx, proposalId, [
    { text, evidenceRoot, intentHash, disclosureHash },
  ]);

  const govId = await ensureSubmitted(
    ctx,
    progress,
    "3",
    proposalId,
    actionsHash,
    intentHash,
    disclosureHash
  );

  let p = await retry("getGovProposal", () => ctx.governor.getGovProposal(govId));
  registerBundle(ctx, {
    key: "3",
    title: "Ecosystem grant with hidden link",
    proposalId,
    govId,
    proposal: p,
    actions,
    rules,
    labels: { [recipient.toLowerCase()]: "Ecosystem recipient" },
  });
  if (Number(p.state) === 1) {
    await send("openVoting P3", () => ctx.governor.connect(ctx.proposer).openVoting(govId));
    p = await retry("getGovProposal", () => ctx.governor.getGovProposal(govId));
  }

  if (Number(p.state) === 2) {
    await ensureGovTokens(ctx, [ctx.voter1]);
    const existing = await retry("getVote", () =>
      ctx.governor.getVote(govId, ctx.voter1.address)
    );
    if (!existing.hasVoted) {
      const briefHash = ethers.id(`sepolia-brief:gov${govId}:${ctx.voter1.address}`);
      await send("voteWithBrief P3", () =>
        ctx.governor.connect(ctx.voter1).voteWithBrief(govId, 1, briefHash)
      );
    }
  }

  if (!(await retry("isChallenged", () => ctx.disclosure.isChallenged(proposalId)))) {
    const challenges = await retry("getChallenges", () =>
      ctx.disclosure.getChallenges(proposalId)
    );
    if ((challenges as unknown[]).length === 0) {
      await send("fileChallenge", () =>
        ctx.disclosure.connect(ctx.challenger).fileChallenge(
          proposalId,
          coi.challengePayload.linkEvidenceHash,
          coi.challengePayload.reason
        )
      );
    }
    await send("verifyChallenge", () =>
      ctx.disclosure.connect(ctx.verifier).verifyChallenge(proposalId, 0n)
    );
  }

  const challenged = await retry("isChallenged", () => ctx.disclosure.isChallenged(proposalId));
  p = await retry("getGovProposal", () => ctx.governor.getGovProposal(govId));
  if (!challenged || Number(p.state) !== 2) {
    throw new Error(`P3 expected VotingOpen + challenged, got governor=${Number(p.state)} challenged=${challenged}`);
  }

  return {
    title: "Ecosystem grant with hidden link",
    govId: govId.toString(),
    state: "Challenged",
    commitment: String(p.commitment),
    versionChain: chain,
    notes:
      `Governor state VotingOpen; disclosure challenged and verified on Sepolia ` +
      `(1 ETH bond slashed to challenger); linkEvidenceHash ` +
      `${short(coi.challengePayload.linkEvidenceHash)}; intermediary path is SIMULATED graph data.`,
  };
}

async function seedP4(ctx: Ctx, progress: Progress): Promise<DemoEntry> {
  const proposalId = await proposalIdFor(ctx, progress, "4");
  const text = "Infrastructure budget: 10,000 USDC to the infrastructure vendor.";
  const actions: Action[] = [
    {
      target: ctx.addresses.MockUSDC,
      value: 0n,
      data: ctx.usdc.interface.encodeFunctionData("transfer", [ctx.vendor, USDC(10000)]),
    },
  ];
  const rules: ActionRule[] = [
    {
      kind: ActionKind.ERC20_TRANSFER,
      target: ctx.addresses.MockUSDC,
      selector: "0xa9059cbb",
      counterparty: ctx.vendor,
      maxAmount: USDC(10000),
      codeHash: ZERO,
      childCount: 0,
    },
  ];
  const intentHash = hashRules(rules);
  const actionsHash = hashActions(actions);

  const walletListHash = contentHash(
    JSON.stringify([ctx.proposer.address, ctx.vendor].sort())
  );
  const disclosureHash = await ensureDisclosure(
    ctx,
    proposalId,
    walletListHash,
    contentHash("no financial interests declared"),
    0n
  );

  const chain = await ensureRegistryVersions(ctx, proposalId, [
    { text, evidenceRoot: ZERO, intentHash, disclosureHash },
  ]);

  const govId = await ensureSubmitted(
    ctx,
    progress,
    "4",
    proposalId,
    actionsHash,
    intentHash,
    disclosureHash
  );

  let p = await retry("getGovProposal", () => ctx.governor.getGovProposal(govId));
  registerBundle(ctx, {
    key: "4",
    title: "Infrastructure budget",
    proposalId,
    govId,
    proposal: p,
    actions,
    rules,
    labels: { [ctx.vendor.toLowerCase()]: "Vendor" },
  });
  if (Number(p.state) === 1) {
    await send("openVoting P4", () => ctx.governor.connect(ctx.proposer).openVoting(govId));
    p = await retry("getGovProposal", () => ctx.governor.getGovProposal(govId));
  }

  if (Number(p.state) === 2) {
    await ensureGovTokens(ctx, [ctx.voter1, ctx.voter2, ctx.voter3]);
    const votes = [
      { wallet: ctx.voter1, support: 1, informed: true },
      { wallet: ctx.voter2, support: 1, informed: false },
      { wallet: ctx.voter3, support: 0, informed: true },
    ];
    for (const vote of votes) {
      const existing = await retry("getVote", () =>
        ctx.governor.getVote(govId, vote.wallet.address)
      );
      if (existing.hasVoted) continue;
      if (vote.informed) {
        const briefHash = ethers.id(`sepolia-brief:gov${govId}:${vote.wallet.address}`);
        await send(`voteWithBrief ${short(vote.wallet.address)}`, () =>
          ctx.governor.connect(vote.wallet).voteWithBrief(govId, vote.support, briefHash)
        );
      } else {
        await send(`castVote ${short(vote.wallet.address)}`, () =>
          ctx.governor.connect(vote.wallet).castVote(govId, vote.support)
        );
      }
    }
    p = await retry("getGovProposal", () => ctx.governor.getGovProposal(govId));
  }

  if (Number(p.state) !== 2) {
    throw new Error(`P4 expected VotingOpen, got ${Number(p.state)}`);
  }

  return {
    title: "Infrastructure budget",
    govId: govId.toString(),
    state: "VotingOpen",
    commitment: String(p.commitment),
    versionChain: chain,
    notes:
      "Voting open with mixed informed/uninformed votes; no challenge and no Sentinel halt.",
  };
}

async function seedP5(ctx: Ctx, progress: Progress): Promise<DemoEntry> {
  const proposalId = await proposalIdFor(ctx, progress, "5");
  const text = `Proposal: Community Grants Expansion

Allocate a reasonable amount to promising ecosystem teams. The recipient list may evolve at the team's discretion. Grants are expected to recur quarterly.`;
  const draft = extractIntentHeuristic(text);
  const intentHash = contentHash(JSON.stringify(draft));

  const chain = await ensureRegistryVersions(ctx, proposalId, [
    { text, evidenceRoot: ZERO, intentHash, disclosureHash: ZERO },
  ]);

  return {
    title: draft.title,
    govId: null,
    state: "Drafted",
    commitment: null,
    versionChain: chain,
    notes: `Draft only (not submitted to governor). ${draft.unresolved.length} UNRESOLVED item(s).`,
  };
}

async function seedP6(ctx: Ctx, progress: Progress): Promise<DemoEntry> {
  const proposalId = await proposalIdFor(ctx, progress, "6");
  const title = "Routine parameter tuning (obfuscated)";
  const text =
    "Routine parameter tuning (obfuscated): set the fee module parameter to 35 bps. " +
    "No upgrade and no ownership change is proposed.";
  const store = evidenceStore("p6");
  store.addDocument(text);
  store.addDocument(
    "Committed intent: PARAM_SET setFee(uint256) on FeeModule, max value 100."
  );
  const evidenceRoot = store.buildManifest().evidenceRoot;

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
    [ctx.attacker]
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

  const walletListHash = contentHash(JSON.stringify([ctx.proposer.address]));
  const disclosureHash = await ensureDisclosure(
    ctx,
    proposalId,
    walletListHash,
    contentHash("no financial interests declared"),
    0n
  );

  const chain = await ensureRegistryVersions(ctx, proposalId, [
    { text, evidenceRoot, intentHash, disclosureHash },
  ]);

  const govId = await ensureSubmitted(
    ctx,
    progress,
    "6",
    proposalId,
    actionsHash,
    intentHash,
    disclosureHash
  );

  const proposal = await retry("getGovProposal", () =>
    ctx.governor.getGovProposal(govId)
  );
  registerBundle(ctx, {
    key: "6",
    title,
    proposalId,
    govId,
    proposal,
    actions: attackActions,
    rules: statedRules,
    labels: {
      [ctx.addresses.MaliciousImpl.toLowerCase()]: "MaliciousImpl (not in the stated intent)",
      [ctx.attacker.toLowerCase()]: "Attacker wallet",
    },
  });

  let p = proposal;
  if (Number(p.state) === 1) {
    await send("openVoting P6", () => ctx.governor.connect(ctx.proposer).openVoting(govId));
    p = await retry("getGovProposal", () => ctx.governor.getGovProposal(govId));
  }
  if (Number(p.state) === 2) {
    await ensureGovTokens(ctx, [ctx.voter1]);
    const existing = await retry("getVote", () =>
      ctx.governor.getVote(govId, ctx.voter1.address)
    );
    if (!existing.hasVoted) {
      const briefHash = ethers.id(`sepolia-brief:gov${govId}:${ctx.voter1.address}`);
      await send("voteWithBrief P6", () =>
        ctx.governor.connect(ctx.voter1).voteWithBrief(govId, 1, briefHash)
      );
    }
    p = await retry("getGovProposal", () => ctx.governor.getGovProposal(govId));
  }
  if (Number(p.state) !== 2) {
    throw new Error(`P6 expected VotingOpen, got ${Number(p.state)}`);
  }

  return {
    title,
    govId: govId.toString(),
    state: "VotingOpen",
    commitment: String(p.commitment),
    versionChain: chain,
    notes:
      "Committed calldata is a multicall([upgradeTo, transferOwnership]) while the " +
      "stated intent and committed rules describe only setFee(35). The pre-vote effect " +
      "preview must flag the implementation and owner changes BEFORE the vote.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const manifest = loadManifest();
  const network = await retry("getNetwork", () => ethers.provider.getNetwork());
  const chainId = Number(network.chainId);

  if (chainId !== manifest.chainId) {
    throw new Error(
      `Connected chain ${chainId} does not match manifest chain ${manifest.chainId}. ` +
        `Pass --network sepolia.`
    );
  }

  const addresses: Record<string, string> = {};
  for (const [name, entry] of Object.entries(manifest.contracts)) {
    addresses[name] = entry.address;
  }

  const deployer = requireWallet("DEPLOYER_KEY");
  const proposer = requireWallet("PROPOSER_KEY");
  const verifier = requireWallet("VERIFIER_KEY");
  const challenger = requireWallet("CHALLENGER_KEY");
  const voter1 = requireWallet("VOTER1_KEY");
  const voter2 = requireWallet("VOTER2_KEY");
  const voter3 = requireWallet("VOTER3_KEY");
  const guardian = optionalWallet("GUARDIAN_KEY");
  const devWallet = addressFrom("DEV_WALLET_ADDRESS", "DEV_WALLET_KEY", proposer.address);
  const vendor = addressFrom("VENDOR_ADDRESS", "VENDOR_KEY", proposer.address);
  const attacker = addressFrom("ATTACKER_ADDRESS", "ATTACKER_KEY", proposer.address);

  console.log(`Seeding demo on Sepolia (chain ${chainId})`);
  console.log(`  Proposer: ${proposer.address}`);
  console.log(`  Voters:   ${voter1.address}, ${voter2.address}, ${voter3.address}`);
  console.log(`  Dev wallet: ${devWallet}`);

  const get = (name: string) =>
    ethers.getContractAt(name, addresses[name]) as Promise<any>;

  const ctx: Ctx = {
    registry: await get("ProposalRegistry"),
    disclosure: await get("DisclosureRegistry"),
    executor: await get("IntentLockExecutor"),
    governor: await get("IntentGovernor"),
    usdc: await get("MockUSDC"),
    votingToken: await get("GovernanceToken"),
    feeModule: await get("FeeModule"),
    treasuryProxy: await get("TreasuryProxy"),
    maliciousImpl: await get("MaliciousImpl"),
    vulnerableProxy: await get("VulnerableProxy"),
    addresses,
    deployer,
    proposer,
    guardian,
    verifier,
    challenger,
    voter1,
    voter2,
    voter3,
    devWallet,
    vendor,
    attacker,
  };

  const progress = loadProgress(chainId, addresses);
  const demo = loadDemoState();

  const seeds: { key: string; run: () => Promise<DemoEntry> }[] = [
    { key: "1", run: () => seedP1(ctx, progress) },
    { key: "2", run: () => seedP2(ctx, progress) },
    { key: "3", run: () => seedP3(ctx, progress) },
    { key: "4", run: () => seedP4(ctx, progress) },
    { key: "5", run: () => seedP5(ctx, progress) },
    { key: "6", run: () => seedP6(ctx, progress) },
  ];

  for (const seed of seeds) {
    console.log(`\n▶ Proposal P${seed.key}`);
    const entry = await seed.run();
    demo[progress.proposals[seed.key].proposalId] = entry;
    progress.proposals[seed.key].step = "done";
    saveProgress(progress);
    saveDemoState(demo);
    console.log(`  ✔ P${seed.key}: ${entry.title} -> ${entry.state}`);
  }

  console.log("\nSeeded proposals (Sepolia):");
  for (const [id, entry] of Object.entries(demo)) {
    console.log(`  P${id}: ${entry.title} — ${entry.state}`);
  }
  console.log(`\nUI index written to: ${demoPath}`);
  console.log(`Resume progress:     ${progressPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    console.error(
      "\nSeeding stopped. Re-run the same command to resume from on-chain state."
    );
    process.exit(1);
  });
