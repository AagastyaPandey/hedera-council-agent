import hre, { ethers } from "hardhat";
import type { ContractFactory } from "ethers";
import * as fs from "fs";
import * as path from "path";

export interface ManifestArg {
  type: string;
  value: string;
}

export interface ManifestContract {
  address: string;
  abi: unknown[];
  args: ManifestArg[];
  blockNumber: number;
  txHash: string;
  deployer: string;
}

export interface DeploymentManifest {
  network: string;
  chainId: number;
  deployer: string;
  deployedAt: string;
  deploymentBlock: number;
  dryRun?: boolean;
  timing?: Record<string, string | number>;
  setup?: Record<string, unknown>;
  contracts: Record<string, ManifestContract>;
}

const SEOPLIA_CHAIN_ID = 11155111n;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number (received "${raw}")`);
  }
  return Math.trunc(parsed);
}

function normalizeKey(key: string): string {
  return key.startsWith("0x") ? key : `0x${key}`;
}

function keyAddress(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new ethers.Wallet(normalizeKey(value.trim())).address;
  } catch {
    return null;
  }
}

function envAddress(name: string): string | null {
  const value = process.env[name];
  if (!value) return null;
  if (!ethers.isAddress(value)) {
    throw new Error(`${name} is not a valid address: ${value}`);
  }
  return ethers.getAddress(value);
}

/** Address env wins, then the key env, then the fallback. */
function resolveAddress(addressEnv: string, keyEnv: string, fallback: string): string {
  return envAddress(addressEnv) ?? keyAddress(process.env[keyEnv]) ?? fallback;
}

function defaultNetworkName(): string {
  // The console and the seeder read deployments/local.json for local mode.
  if (hre.network.name === "hardhat" || hre.network.name === "localhost") {
    return "local";
  }
  return hre.network.name;
}

function addrArg(value: string): ManifestArg {
  return { type: "address", value: value };
}

function uintArg(value: bigint | number): ManifestArg {
  return { type: "uint256", value: String(value) };
}

async function artifactAbi(artifactName: string): Promise<unknown[]> {
  try {
    return (await hre.artifacts.readArtifact(artifactName)).abi as unknown[];
  } catch {
    return [];
  }
}

export async function deployAll(
  networkName: string = defaultNetworkName(),
  options: { dryRun?: boolean } = {}
): Promise<DeploymentManifest> {
  const isSepolia = networkName === "sepolia";
  const dryRun = options.dryRun === true;

  console.log(`\n🚀 Deploying AegisDAO IntentLock contracts to [${networkName}]...`);

  const signers = await ethers.getSigners();
  const deployer = signers[0];
  if (!deployer) {
    throw new Error(
      `No signer available on "${networkName}". ` +
        `Set DEPLOYER_KEY in .env (and SEPOLIA_RPC_URL for Sepolia).`
    );
  }

  const net = await ethers.provider.getNetwork();
  if (isSepolia && net.chainId !== SEOPLIA_CHAIN_ID) {
    throw new Error(
      `Network "${networkName}" resolved to chain ${net.chainId}, expected ${SEOPLIA_CHAIN_ID}.`
    );
  }

  const deployerAddress = await deployer.getAddress();
  const guardianAddress = isSepolia
    ? resolveAddress("GUARDIAN_ADDRESS", "GUARDIAN_KEY", deployerAddress)
    : signers[1]
      ? await signers[1].getAddress()
      : deployerAddress;
  const verifierAddress = isSepolia
    ? resolveAddress("VERIFIER_ADDRESS", "VERIFIER_KEY", deployerAddress)
    : signers[2]
      ? await signers[2].getAddress()
      : deployerAddress;
  const proposerAddress = isSepolia
    ? resolveAddress("PROPOSER_ADDRESS", "PROPOSER_KEY", deployerAddress)
    : signers[3]
      ? await signers[3].getAddress()
      : deployerAddress;
  const voterAddresses = isSepolia
    ? [
        resolveAddress("VOTER1_ADDRESS", "VOTER1_KEY", deployerAddress),
        resolveAddress("VOTER2_ADDRESS", "VOTER2_KEY", deployerAddress),
        resolveAddress("VOTER3_ADDRESS", "VOTER3_KEY", deployerAddress),
      ]
    : signers[4] && signers[5] && signers[6]
      ? [
          await signers[4].getAddress(),
          await signers[5].getAddress(),
          await signers[6].getAddress(),
        ]
      : [deployerAddress, deployerAddress, deployerAddress];

  // Testnet timing is short enough to demo the full lifecycle; local keeps
  // the long timing the red-team suite was written against.
  const timelockDelay = envInt("TIMELOCK_DELAY_SECONDS", isSepolia ? 120 : 3600);
  const maxDelay = envInt("MAX_DELAY_SECONDS", 14 * 86400);
  const votingPeriod = envInt("VOTING_PERIOD_SECONDS", isSepolia ? 300 : 3 * 86400);
  const challengeWindow = envInt("CHALLENGE_WINDOW_SECONDS", isSepolia ? 300 : 2 * 86400);
  const challengeExtension = envInt("CHALLENGE_EXTENSION_SECONDS", isSepolia ? 600 : 3 * 86400);
  const quorumTokens = process.env.QUORUM_TOKENS ?? "1000";
  const quorum = ethers.parseUnits(quorumTokens, 18);
  const governanceMint = ethers.parseUnits(
    process.env.GOV_TOKEN_MINT_TOKENS ?? quorumTokens,
    18
  );

  console.log(`  Deployer: ${deployerAddress}`);
  console.log(`  Guardian: ${guardianAddress}`);
  console.log(`  Verifier: ${verifierAddress}`);
  console.log(`  Proposer: ${proposerAddress}`);
  console.log(`  Voters:   ${voterAddresses.join(", ")}`);
  console.log(`  Chain ID: ${net.chainId}`);
  console.log(
    `  Timing:   timelock ${timelockDelay}s, voting ${votingPeriod}s, ` +
      `challenge ${challengeWindow}s`
  );

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const ProposalRegistry = await ethers.getContractFactory("ProposalRegistry");
  const DisclosureRegistry = await ethers.getContractFactory("DisclosureRegistry");
  const IntentLockExecutor = await ethers.getContractFactory("IntentLockExecutor");
  const IntentGovernor = await ethers.getContractFactory("IntentGovernor");
  const FeeModule = await ethers.getContractFactory("FeeModule");
  const TreasuryProxy = await ethers.getContractFactory("TreasuryProxy");
  const MaliciousImpl = await ethers.getContractFactory("MaliciousImpl");
  const ReentrantRecipient = await ethers.getContractFactory("ReentrantRecipient");
  const VulnerableProxy = await ethers.getContractFactory("VulnerableProxy");

  const estimate = await estimateDeployGas(deployerAddress);
  if (estimate) printGasTable(estimate);

  const contracts: Record<string, ManifestContract> = {};
  const deployBlocks: number[] = [];

  async function deploy(
    name: string,
    artifactName: string,
    factory: ContractFactory,
    args: unknown[],
    argSpecs: ManifestArg[]
  ): Promise<string> {
    const contract = await factory.deploy(...(args as unknown[] as any[]));
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    const tx = contract.deploymentTransaction();
    const txHash = tx?.hash ?? "";
    const receipt = txHash ? await ethers.provider.getTransactionReceipt(txHash) : null;
    const blockNumber = receipt?.blockNumber ?? 0;
    const abi = await artifactAbi(artifactName);
    contracts[name] = {
      address,
      abi,
      args: argSpecs,
      blockNumber,
      txHash,
      deployer: deployerAddress,
    };
    if (blockNumber > 0) deployBlocks.push(blockNumber);
    console.log(`  ✔ ${name.padEnd(20)} ${address}  block ${blockNumber || "-"}`);
    return address;
  }

  if (dryRun) {
    console.log("\n🧪 Dry run: no transactions sent.");
    return {
      network: networkName,
      chainId: Number(net.chainId),
      deployer: deployerAddress,
      deployedAt: new Date().toISOString(),
      deploymentBlock: 0,
      dryRun: true,
      timing: {
        timelockDelay,
        maxDelay,
        votingPeriod,
        challengeWindow,
        challengeExtension,
        quorum: quorum.toString(),
      },
      contracts: {},
    };
  }

  // 1. Mock tokens
  const usdcAddr = await deploy("MockUSDC", "MockUSDC", MockUSDC, [], []);
  const votingTokenAddr = await deploy(
    "GovernanceToken",
    "MockUSDC",
    MockUSDC,
    [],
    []
  );

  // 2. Proposal registry
  const registryAddr = await deploy(
    "ProposalRegistry",
    "ProposalRegistry",
    ProposalRegistry,
    [],
    []
  );

  // 3. Disclosure registry
  const disclosureAddr = await deploy(
    "DisclosureRegistry",
    "DisclosureRegistry",
    DisclosureRegistry,
    [verifierAddress, challengeWindow, challengeExtension],
    [addrArg(verifierAddress), uintArg(challengeWindow), uintArg(challengeExtension)]
  );

  // 4. Executor
  const executorAddr = await deploy(
    "IntentLockExecutor",
    "IntentLockExecutor",
    IntentLockExecutor,
    [registryAddr, guardianAddress, deployerAddress, timelockDelay, maxDelay],
    [
      addrArg(registryAddr),
      addrArg(guardianAddress),
      addrArg(deployerAddress),
      uintArg(timelockDelay),
      uintArg(maxDelay),
    ]
  );

  // 5. Governor
  const governorAddr = await deploy(
    "IntentGovernor",
    "IntentGovernor",
    IntentGovernor,
    [
      votingTokenAddr,
      registryAddr,
      disclosureAddr,
      executorAddr,
      votingPeriod,
      quorum,
      timelockDelay,
    ],
    [
      addrArg(votingTokenAddr),
      addrArg(registryAddr),
      addrArg(disclosureAddr),
      addrArg(executorAddr),
      uintArg(votingPeriod),
      uintArg(quorum),
      uintArg(timelockDelay),
    ]
  );

  const executor = await ethers.getContractAt("IntentLockExecutor", executorAddr);
  const setGovernorTx = await (executor as any).setGovernor(governorAddr);
  const setGovernorReceipt = await setGovernorTx.wait();
  console.log(`  ✔ Executor governor updated to IntentGovernor (block ${setGovernorReceipt?.blockNumber})`);

  // 6. Demo / test helpers
  const feeModuleAddr = await deploy(
    "FeeModule",
    "FeeModule",
    FeeModule,
    [30, executorAddr],
    [uintArg(30), addrArg(executorAddr)]
  );
  const treasuryAddr = await deploy(
    "TreasuryProxy",
    "TreasuryProxy",
    TreasuryProxy,
    [executorAddr, feeModuleAddr],
    [addrArg(executorAddr), addrArg(feeModuleAddr)]
  );
  const maliciousImplAddr = await deploy(
    "MaliciousImpl",
    "MaliciousImpl",
    MaliciousImpl,
    [deployerAddress],
    [addrArg(deployerAddress)]
  );
  const reentrantAddr = await deploy(
    "ReentrantRecipient",
    "ReentrantRecipient",
    ReentrantRecipient,
    [executorAddr],
    [addrArg(executorAddr)]
  );
  const vulnerableAddr = await deploy(
    "VulnerableProxy",
    "VulnerableProxy",
    VulnerableProxy,
    [executorAddr, feeModuleAddr],
    [addrArg(executorAddr), addrArg(feeModuleAddr)]
  );

  // Seed funds
  const usdc = await ethers.getContractAt("MockUSDC", usdcAddr);
  await (await usdc.mint(executorAddr, 500_000n * 1_000_000n)).wait();
  await (await usdc.mint(treasuryAddr, 1_000_000n * 1_000_000n)).wait();
  console.log("  ✔ Seeded 500,000 USDC to executor, 1,000,000 USDC to treasury");

  // Governance token: mint enough for quorum to the proposer and voters.
  const votingToken = await ethers.getContractAt("MockUSDC", votingTokenAddr);
  const mintTargets = [...new Set([proposerAddress, ...voterAddresses])];
  const governanceMints: { to: string; amount: string; txHash: string }[] = [];
  for (const to of mintTargets) {
    const tx = await votingToken.mint(to, governanceMint);
    await tx.wait();
    governanceMints.push({ to, amount: governanceMint.toString(), txHash: tx.hash });
    console.log(`  ✔ Minted ${ethers.formatUnits(governanceMint, 18)} GOV to ${to}`);
  }

  const deploymentData: DeploymentManifest = {
    network: networkName,
    chainId: Number(net.chainId),
    deployer: deployerAddress,
    deployedAt: new Date().toISOString(),
    deploymentBlock: deployBlocks.length ? Math.min(...deployBlocks) : 0,
    timing: {
      timelockDelay,
      maxDelay,
      votingPeriod,
      challengeWindow,
      challengeExtension,
      quorum: quorum.toString(),
    },
    setup: {
      setGovernorTx: setGovernorReceipt?.hash ?? setGovernorTx.hash,
      governanceMints,
      usdcSeeds: {
        executor: (500_000n * 1_000_000n).toString(),
        treasury: (1_000_000n * 1_000_000n).toString(),
      },
    },
    contracts,
  };

  const outDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outPath = path.join(outDir, `${networkName}.json`);
  fs.writeFileSync(outPath, JSON.stringify(deploymentData, null, 2), "utf8");
  console.log(`\n💾 Saved deployment manifest to: ${outPath}`);

  if (isSepolia) {
    console.log("\nEtherscan:");
    for (const [name, entry] of Object.entries(contracts)) {
      console.log(`  ${name.padEnd(20)} https://sepolia.etherscan.io/address/${entry.address}`);
    }
  }

  return deploymentData;
}

interface GasEstimate {
  name: string;
  gas: bigint | null;
}

async function estimateDeployGas(deployer: string): Promise<{
  rows: GasEstimate[];
  totalGas: bigint;
  gasPrice: bigint | null;
} | null> {
  const factories: { name: string; factory: ContractFactory; args: unknown[] }[] = [
    { name: "MockUSDC", factory: await ethers.getContractFactory("MockUSDC"), args: [] },
    { name: "GovernanceToken", factory: await ethers.getContractFactory("MockUSDC"), args: [] },
    { name: "ProposalRegistry", factory: await ethers.getContractFactory("ProposalRegistry"), args: [] },
    {
      name: "DisclosureRegistry",
      factory: await ethers.getContractFactory("DisclosureRegistry"),
      args: [ethers.ZeroAddress, 300, 600],
    },
    {
      name: "IntentLockExecutor",
      factory: await ethers.getContractFactory("IntentLockExecutor"),
      args: [ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress, 120, 1209600],
    },
    {
      name: "IntentGovernor",
      factory: await ethers.getContractFactory("IntentGovernor"),
      args: [
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        300,
        ethers.parseUnits("1000", 18),
        120,
      ],
    },
    { name: "FeeModule", factory: await ethers.getContractFactory("FeeModule"), args: [30, ethers.ZeroAddress] },
    { name: "TreasuryProxy", factory: await ethers.getContractFactory("TreasuryProxy"), args: [ethers.ZeroAddress, ethers.ZeroAddress] },
    { name: "MaliciousImpl", factory: await ethers.getContractFactory("MaliciousImpl"), args: [ethers.ZeroAddress] },
    { name: "ReentrantRecipient", factory: await ethers.getContractFactory("ReentrantRecipient"), args: [ethers.ZeroAddress] },
    { name: "VulnerableProxy", factory: await ethers.getContractFactory("VulnerableProxy"), args: [ethers.ZeroAddress, ethers.ZeroAddress] },
  ];

  const rows: GasEstimate[] = [];
  let totalGas = 0n;
  let gasPrice: bigint | null = null;

  try {
    const feeData = await ethers.provider.getFeeData();
    gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? null;
  } catch {
    // Gas price is only needed for the cost column.
  }

  for (const item of factories) {
    try {
      const request = await item.factory.getDeployTransaction(...item.args);
      const gas = await ethers.provider.estimateGas({
        ...request,
        from: deployer,
      });
      rows.push({ name: item.name, gas });
      totalGas += gas;
    } catch (error) {
      rows.push({ name: item.name, gas: null });
      console.log(
        `  ⚠ gas estimate unavailable for ${item.name}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return { rows, totalGas, gasPrice };
}

function printGasTable(estimate: {
  rows: GasEstimate[];
  totalGas: bigint;
  gasPrice: bigint | null;
}): void {
  console.log("\n⛽ Dry-run gas estimate (before sending):");
  console.log(`  ${"Contract".padEnd(20)} ${"Gas".padStart(12)}  Est. cost`);
  for (const row of estimate.rows) {
    const gas = row.gas === null ? "-" : row.gas.toString();
    const cost =
      row.gas !== null && estimate.gasPrice !== null
        ? `${ethers.formatEther(row.gas * estimate.gasPrice)} ETH`
        : "-";
    console.log(`  ${row.name.padEnd(20)} ${gas.padStart(12)}  ${cost}`);
  }
  const totalCost =
    estimate.gasPrice !== null
      ? ` (~${ethers.formatEther(estimate.totalGas * estimate.gasPrice)} ETH at ${ethers.formatUnits(estimate.gasPrice, "gwei")} gwei)`
      : "";
  console.log(`  ${"TOTAL".padEnd(20)} ${estimate.totalGas.toString().padStart(12)}${totalCost}`);
}

if (require.main === module) {
  const argName = process.argv.slice(2).find((arg) => !arg.startsWith("-"));
  const dryRun = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";
  deployAll(argName ?? defaultNetworkName(), { dryRun })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
