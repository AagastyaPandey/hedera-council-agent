import { ethers } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";

function loadEnv(): Record<string, string> {
  const envPath = path.resolve(__dirname, "../.env");
  const content = fs.readFileSync(envPath, "utf8");
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx !== -1) {
      env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
  }
  return env;
}

function normalizeKey(key: string): string {
  return key.startsWith("0x") ? key : `0x${key}`;
}

async function main() {
  const env = loadEnv();
  const rpcUrl = env.SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new Error("Missing SEPOLIA_RPC_URL in .env");

  const deployerKey = env.DEPLOYER_KEY;
  if (!deployerKey) throw new Error("Missing DEPLOYER_KEY in .env");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployer = new ethers.Wallet(normalizeKey(deployerKey), provider);

  const initialBalance = await provider.getBalance(deployer.address);
  console.log(`\nDeployer address: ${deployer.address}`);
  console.log(`Deployer initial balance: ${ethers.formatEther(initialBalance)} ETH\n`);

  const recipients = [
    { role: "Voter 3", key: env.VOTER3_KEY, amount: "0.025" },
    { role: "Guardian", key: env.GUARDIAN_KEY, amount: "0.025" },
    { role: "Verifier", key: env.VERIFIER_KEY, amount: "0.025" },
    { role: "Challenger", key: env.CHALLENGER_KEY, amount: "0.025" },
  ];

  for (const item of recipients) {
    if (!item.key) {
      console.warn(`⚠ Missing key for ${item.role}, skipping.`);
      continue;
    }
    const targetWallet = new ethers.Wallet(normalizeKey(item.key));
    const targetAddress = targetWallet.address;
    const currentBalance = await provider.getBalance(targetAddress);
    console.log(`\n➡️ Funding ${item.role} (${targetAddress})...`);
    console.log(`   Current balance: ${ethers.formatEther(currentBalance)} ETH`);

    const tx = await deployer.sendTransaction({
      to: targetAddress,
      value: ethers.parseEther(item.amount),
    });
    console.log(`   Sent tx: ${tx.hash}`);
    console.log(`   Waiting for confirmation...`);
    const receipt = await tx.wait(1);
    console.log(`   ✔ Confirmed in block ${receipt?.blockNumber}!`);

    const newBalance = await provider.getBalance(targetAddress);
    console.log(`   New balance: ${ethers.formatEther(newBalance)} ETH`);
  }

  const finalBalance = await provider.getBalance(deployer.address);
  console.log(`\n🎉 Distribution complete!`);
  console.log(`Deployer remaining balance: ${ethers.formatEther(finalBalance)} ETH\n`);
}

main().catch((err) => {
  console.error("Error distributing funds:", err);
  process.exit(1);
});
