/**
 * One-command live demo of the P2 jargon-upgrade attack.
 *
 * Creates a fresh proposal whose description says "fee parameter tuning" while
 * the queued calldata upgrades the treasury proxy to MaliciousImpl. The
 * Sentinel watcher sees ProposalQueued, verifies the execution bundle against
 * the commitment, simulates it, and asks the guardian to halt.
 *
 * Run with: npm run demo:attack
 */

import { ethers } from "hardhat";
import type { Contract, ContractRunner, InterfaceAbi, Signer } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  Action,
  ActionRule,
  ActionKind,
  hashActions,
  hashRules,
} from "../packages/shared/hash";
import { signDisclosure } from "../test/redteam/fixture";
import {
  readLiveReports,
  repositoryRoot,
  upsertExecutionBundle,
  type LiveReports,
} from "../sentinel/live-store";

const ZERO_HASH = ethers.ZeroHash;
const HALT_TIMEOUT_MS = 30_000;

interface ManifestContract {
  address: string;
  abi: InterfaceAbi;
}

interface Deployment {
  chainId: number;
  contracts: Record<string, ManifestContract>;
}

function loadDeployment(): Deployment {
  const file = path.join(repositoryRoot(), "deployments", "local.json");
  if (!fs.existsSync(file)) {
    throw new Error(`Deployment manifest not found: ${file}. Run npm run deploy first.`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as Deployment;
}

function contract(
  deployment: Deployment,
  name: string,
  runner: ContractRunner
): Contract {
  const entry = deployment.contracts[name];
  if (!entry?.address || !entry.abi) {
    throw new Error(`Contract ${name} is missing from deployments/local.json`);
  }
  return new ethers.Contract(entry.address, entry.abi, runner);
}

const contentHash = (text: string) => ethers.keccak256(ethers.toUtf8Bytes(text));

async function increaseTime(seconds: number): Promise<void> {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

function short(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function readDemoState(): Record<string, Record<string, unknown>> {
  const file = path.join(repositoryRoot(), "packages", "shared", "fixtures", "demo-state.json");
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, Record<string, unknown>>;
}

function writeDemoState(state: Record<string, Record<string, unknown>>): void {
  const file = path.join(repositoryRoot(), "packages", "shared", "fixtures", "demo-state.json");
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n", "utf8");
}

async function pickVoters(
  governanceToken: Contract,
  signers: Signer[],
  proposer: Signer
): Promise<Signer[]> {
  const proposerAddress = (await proposer.getAddress()).toLowerCase();
  const funded: { signer: Signer; balance: bigint }[] = [];
  for (const signer of signers) {
    const address = await signer.getAddress();
    if (address.toLowerCase() === proposerAddress) continue;
    const balance: bigint = await governanceToken.balanceOf(address);
    if (balance > 0n) funded.push({ signer, balance });
  }
  funded.sort((a, b) => (a.balance === b.balance ? 0 : a.balance > b.balance ? -1 : 1));
  return funded.slice(0, 2).map((entry) => entry.signer);
}

async function waitForHalt(
  commitment: string
): Promise<{ reportHash?: string; haltTxHash?: string; haltBlockNumber?: number }> {
  const started = Date.now();
  let lastPhase = "";
  let lastError = "";
  while (Date.now() - started < HALT_TIMEOUT_MS) {
    const store: LiveReports = readLiveReports();
    const result = store.results[commitment.toLowerCase()];
    const recent = [...store.events]
      .reverse()
      .find((event) => event.commitment.toLowerCase() === commitment.toLowerCase());
    if (recent && recent.phase !== lastPhase) {
      lastPhase = recent.phase;
      console.log(`  [watcher] ${recent.phase.padEnd(10)} ${recent.detail}`);
    }
    if (result?.status === "HALTED") {
      return {
        reportHash: result.reportHash,
        haltTxHash: result.haltTxHash,
        haltBlockNumber: result.haltBlockNumber,
      };
    }
    if (result?.status === "ERROR") {
      lastError = result.reason;
    }
    if (result?.status === "CLEAN") {
      throw new Error("Sentinel simulation was clean; expected the jargon-upgrade attack to be halted.");
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(
    `No guardian halt observed for ${commitment} within ${HALT_TIMEOUT_MS / 1000}s.` +
      (lastError ? ` Last Sentinel error: ${lastError}` : "") +
      ` Start the watcher first: npm run sentinel:watch`
  );
}

async function main(): Promise<void> {
  const deployment = loadDeployment();
  const network = await ethers.provider.getNetwork();
  if (Number(network.chainId) !== deployment.chainId) {
    throw new Error(
      `Connected chain ${network.chainId} does not match manifest chain ${deployment.chainId}.`
    );
  }

  const signers = await ethers.getSigners();
  const [deployer] = signers;
  const proposer = signers[3] ?? deployer;
  if (!deployer || !proposer) throw new Error("No Hardhat signers available.");

  const registry = contract(deployment, "ProposalRegistry", proposer);
  const disclosure = contract(deployment, "DisclosureRegistry", proposer);
  const executor = contract(deployment, "IntentLockExecutor", deployer);
  const governor = contract(deployment, "IntentGovernor", proposer);
  const treasuryProxy = contract(deployment, "TreasuryProxy", proposer);
  const feeModule = contract(deployment, "FeeModule", proposer);
  const maliciousImpl = contract(deployment, "MaliciousImpl", proposer);
  const governanceToken = contract(deployment, "GovernanceToken", deployer);

  const guardianAddress = String(await executor.guardian());
  const guardian = signers.find(
    (signer) => signer.address.toLowerCase() === guardianAddress.toLowerCase()
  );
  if (!guardian) {
    throw new Error(`Guardian ${guardianAddress} is not an unlocked Hardhat signer.`);
  }

  const voters = await pickVoters(governanceToken, signers, proposer);
  if (voters.length === 0) {
    throw new Error(
      "No funded governance voters found. Run `npm run seed` on the local chain first."
    );
  }

  const proposalId: bigint = await registry.nextProposalId();
  const proposalText =
    "routine parameter tuning of the fee module. Set the fee to 35 bps. " +
    "No treasury, ownership, or recipient changes are requested.";
  const version = 1n;

  const maliciousAddress = await maliciousImpl.getAddress();
  const treasuryAddress = await treasuryProxy.getAddress();
  const feeModuleAddress = await feeModule.getAddress();

  const attackActions: Action[] = [
    {
      target: treasuryAddress,
      value: 0n,
      data: treasuryProxy.interface.encodeFunctionData("upgradeTo", [maliciousAddress]),
    },
  ];
  const approvedRules: ActionRule[] = [
    {
      kind: ActionKind.PARAM_SET,
      target: feeModuleAddress,
      selector: "0x69fe0e2d", // setFee(uint256)
      counterparty: ethers.ZeroAddress,
      maxAmount: 100n,
      codeHash: ZERO_HASH,
      childCount: 0,
    },
  ];
  const actionsHash = hashActions(attackActions);
  const intentHash = hashRules(approvedRules);

  const walletListHash = contentHash(
    JSON.stringify([await proposer.getAddress()].map((address) => address.toLowerCase()).sort())
  );
  const interestsHash = contentHash("no financial interests declared");
  const evidenceRoot = contentHash(`${proposalText}|evidence|${Date.now()}`);
  const financialHash = contentHash(`${proposalText}|financial`);
  const technicalHash = contentHash(`${proposalText}|technical`);

  console.log("AEGIS LIVE ATTACK · JARGON UPGRADE");
  console.log(`  Proposal ID: ${proposalId}`);
  console.log(`  Proposer:    ${await proposer.getAddress()}`);
  console.log(`  Guardian:    ${guardianAddress}`);
  console.log(`  Attack:      upgradeTo(${maliciousAddress}) on TreasuryProxy`);
  console.log(`  Claimed:     setFee(35) on FeeModule\n`);

  const signed = await signDisclosure(
    disclosure,
    proposer as any,
    proposalId,
    walletListHash,
    interestsHash,
    0n
  );
  await (
    await disclosure.submitDisclosure(
      signed.proposalId,
      signed.proposer,
      signed.walletListHash,
      signed.interestsHash,
      signed.bondAmount,
      signed.nonce,
      signed.v,
      signed.r,
      signed.s
    )
  ).wait();
  const disclosureHash: string = await disclosure.getDisclosureHash(proposalId);

  await (
    await registry.createProposal(
      contentHash(proposalText),
      evidenceRoot,
      financialHash,
      technicalHash,
      intentHash,
      disclosureHash
    )
  ).wait();

  const versionHash: string = await registry.latestVersionHash(proposalId);

  await (
    await governor.submitProposal(
      proposalId,
      version,
      versionHash,
      actionsHash,
      intentHash,
      disclosureHash
    )
  ).wait();
  const govId: bigint = (await governor.nextGovId()) - 1n;

  await (await governor.openVoting(govId)).wait();
  const briefHash = ethers.id(`p2-live-brief:${govId}:${Date.now()}`);
  for (const voter of voters) {
    const voterGovernor = governor.connect(voter) as Contract;
    await (await voterGovernor.voteWithBrief(govId, 1, briefHash)).wait();
  }

  const votingPeriod: bigint = await governor.votingPeriod();
  await increaseTime(Number(votingPeriod) + 1);
  await (await governor.finalizeVote(govId)).wait();

  const govProposal = await governor.getGovProposal(govId);
  const commitment = String(govProposal.commitment);

  upsertExecutionBundle({
    commitment,
    proposalId: proposalId.toString(),
    govId: govId.toString(),
    title: "Fee Tuning: attack (live)",
    version: version.toString(),
    versionHash,
    disclosureHash,
    createdAt: new Date().toISOString(),
    source: "scripts/demo-attack.ts",
    actions: attackActions.map((action) => ({
      target: action.target,
      value: action.value.toString(),
      data: action.data,
    })),
    rules: approvedRules.map((rule) => ({
      kind: Number(rule.kind),
      target: rule.target,
      selector: rule.selector,
      counterparty: rule.counterparty,
      maxAmount: rule.maxAmount.toString(),
      codeHash: rule.codeHash,
      childCount: rule.childCount,
    })),
  });

  console.log(`  Bundle:      ${short(commitment)} registered for the Sentinel`);
  console.log("  Queueing through IntentGovernor...\n");

  await (await governor.queueForExecution(govId)).wait();

  const halt = await waitForHalt(commitment);

  const chain: string[] = await registry.getVersionChain(proposalId);
  const demoState = readDemoState();
  demoState[proposalId.toString()] = {
    title: "Fee Tuning: attack (live)",
    govId: govId.toString(),
    state: "Halted",
    commitment,
    versionChain: chain,
    notes:
      `Description claimed fee tuning; queued calldata upgraded TreasuryProxy to ${maliciousAddress}. ` +
      `Watcher report ${halt.reportHash ?? "unknown"}; guardian halt transaction ` +
      `${halt.haltTxHash ?? "unknown"} in block ${halt.haltBlockNumber ?? "unknown"}.`,
  };
  writeDemoState(demoState);

  console.log("\nLIVE HALT CONFIRMED");
  console.log(`  Commitment:  ${commitment}`);
  console.log(`  Report hash: ${halt.reportHash}`);
  console.log(`  Halt tx:     ${halt.haltTxHash} (block ${halt.haltBlockNumber})`);
  console.log(`  Executor state: ${Number(await executor.getState(commitment))} (Halted)`);
  console.log(
    `  Treasury implementation remains ${short(
      String(await treasuryProxy.implementation())
    )}.`
  );
  console.log("\nThe Decision Trail should now show the halted proposal.");
  console.log("Use \"Try to execute anyway\" to display the executor-side reject.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
