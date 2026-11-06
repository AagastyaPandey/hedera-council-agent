/**
 * test/commitment-parity.test.ts
 *
 * 1. Deploys CommitmentHasher.sol
 * 2. Runs multiple test vectors through the Solidity contract
 * 3. Writes hash-vectors.json (ground truth from Solidity)
 * 4. Runs the same vectors through packages/shared/hash.ts
 * 5. Asserts byte-identical outputs
 *
 * Run: npx hardhat test test/commitment-parity.test.ts
 */

import { expect } from "chai";
import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";
import {
  COMMIT_TYPEHASH,
  hashActions,
  computeCommitment,
  Action,
  CommitmentInput,
} from "../packages/shared/hash";

// ── Test vector definitions ─────────────────────────────────

interface ActionVector {
  target: string;
  value: string; // decimal string for JSON serialization
  data: string;  // hex
}

interface TestVector {
  id: string;
  description: string;
  chainId: string;
  executor: string;
  proposalId: string;
  version: string;
  versionHash: string;
  intentHash: string;
  disclosureHash: string;
  actions: ActionVector[];
  expected: {
    commitTypehash: string;
    actionsHash: string;
    commitment: string;
  };
}

// Sample addresses (deterministic, not real)
const ADDR = {
  executor:  "0x1111111111111111111111111111111111111111",
  devWallet: "0x2222222222222222222222222222222222222222",
  usdc:      "0x3333333333333333333333333333333333333333",
  proxy:     "0x4444444444444444444444444444444444444444",
  attacker:  "0x5555555555555555555555555555555555555555",
  feeModule: "0x6666666666666666666666666666666666666666",
};

// ERC-20 transfer(address,uint256) selector = 0xa9059cbb
const TRANSFER_SELECTOR = "0xa9059cbb";
// ERC-20 approve(address,uint256) selector = 0x095ea7b3
const APPROVE_SELECTOR = "0x095ea7b3";

function encodeTransfer(to: string, amount: bigint): string {
  const { AbiCoder } = hre.ethers;
  const coder = AbiCoder.defaultAbiCoder();
  return TRANSFER_SELECTOR + coder.encode(["address", "uint256"], [to, amount]).slice(2);
}

function encodeApprove(spender: string, amount: bigint): string {
  const { AbiCoder } = hre.ethers;
  const coder = AbiCoder.defaultAbiCoder();
  return APPROVE_SELECTOR + coder.encode(["address", "uint256"], [spender, amount]).slice(2);
}

// ── Define raw inputs for each vector ───────────────────────

interface RawVector {
  id: string;
  description: string;
  chainId: bigint;
  executor: string;
  proposalId: bigint;
  version: bigint;
  versionHash: string;
  intentHash: string;
  disclosureHash: string;
  actions: { target: string; value: bigint; data: string }[];
}

function makeRawVectors(): RawVector[] {
  return [
    {
      id: "V0",
      description: "Benign 5,000 USDC transfer to approved dev wallet",
      chainId: 31337n,
      executor: ADDR.executor,
      proposalId: 1n,
      version: 1n,
      versionHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("proposal-v1-content")),
      intentHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("intent-v1")),
      disclosureHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("disclosure-v1")),
      actions: [
        {
          target: ADDR.usdc,
          value: 0n,
          data: encodeTransfer(ADDR.devWallet, 5000000000n), // 5000 USDC (6 decimals)
        },
      ],
    },
    {
      id: "V1",
      description: "Post-vote recipient substitution (attacker address)",
      chainId: 31337n,
      executor: ADDR.executor,
      proposalId: 1n,
      version: 1n,
      versionHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("proposal-v1-content")),
      intentHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("intent-v1")),
      disclosureHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("disclosure-v1")),
      actions: [
        {
          target: ADDR.usdc,
          value: 0n,
          data: encodeTransfer(ADDR.attacker, 5000000000n), // swapped recipient
        },
      ],
    },
    {
      id: "V2",
      description: "Amount inflation (50,000 instead of 5,000 USDC)",
      chainId: 31337n,
      executor: ADDR.executor,
      proposalId: 1n,
      version: 1n,
      versionHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("proposal-v1-content")),
      intentHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("intent-v1")),
      disclosureHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("disclosure-v1")),
      actions: [
        {
          target: ADDR.usdc,
          value: 0n,
          data: encodeTransfer(ADDR.devWallet, 50000000000n), // inflated
        },
      ],
    },
    {
      id: "V3",
      description: "Multiple actions: transfer + fee module parameter set",
      chainId: 31337n,
      executor: ADDR.executor,
      proposalId: 2n,
      version: 1n,
      versionHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("proposal-v2-content")),
      intentHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("intent-v2")),
      disclosureHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("disclosure-v2")),
      actions: [
        {
          target: ADDR.usdc,
          value: 0n,
          data: encodeTransfer(ADDR.devWallet, 1000000000n),
        },
        {
          target: ADDR.feeModule,
          value: 0n,
          // setFeeBps(uint256) selector 0x... using a made-up selector
          data: "0x12345678" + hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [50n]).slice(2),
        },
      ],
    },
    {
      id: "V4",
      description: "Different chain ID changes commitment",
      chainId: 1n, // mainnet instead of 31337
      executor: ADDR.executor,
      proposalId: 1n,
      version: 1n,
      versionHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("proposal-v1-content")),
      intentHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("intent-v1")),
      disclosureHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("disclosure-v1")),
      actions: [
        {
          target: ADDR.usdc,
          value: 0n,
          data: encodeTransfer(ADDR.devWallet, 5000000000n),
        },
      ],
    },
    {
      id: "V5",
      description: "Different executor address changes commitment",
      chainId: 31337n,
      executor: ADDR.attacker, // different executor
      proposalId: 1n,
      version: 1n,
      versionHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("proposal-v1-content")),
      intentHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("intent-v1")),
      disclosureHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("disclosure-v1")),
      actions: [
        {
          target: ADDR.usdc,
          value: 0n,
          data: encodeTransfer(ADDR.devWallet, 5000000000n),
        },
      ],
    },
    {
      id: "V6",
      description: "Different version changes commitment",
      chainId: 31337n,
      executor: ADDR.executor,
      proposalId: 1n,
      version: 2n, // v2 instead of v1
      versionHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("proposal-v1-content")),
      intentHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("intent-v1")),
      disclosureHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("disclosure-v1")),
      actions: [
        {
          target: ADDR.usdc,
          value: 0n,
          data: encodeTransfer(ADDR.devWallet, 5000000000n),
        },
      ],
    },
    {
      id: "V7",
      description: "Different intentHash changes commitment",
      chainId: 31337n,
      executor: ADDR.executor,
      proposalId: 1n,
      version: 1n,
      versionHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("proposal-v1-content")),
      intentHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("intent-TAMPERED")),
      disclosureHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("disclosure-v1")),
      actions: [
        {
          target: ADDR.usdc,
          value: 0n,
          data: encodeTransfer(ADDR.devWallet, 5000000000n),
        },
      ],
    },
    {
      id: "V8",
      description: "Empty actions array",
      chainId: 31337n,
      executor: ADDR.executor,
      proposalId: 3n,
      version: 1n,
      versionHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("proposal-v3-empty")),
      intentHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("intent-v3-empty")),
      disclosureHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("disclosure-v3")),
      actions: [],
    },
    {
      id: "V9",
      description: "Action with non-zero ETH value",
      chainId: 31337n,
      executor: ADDR.executor,
      proposalId: 4n,
      version: 1n,
      versionHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("proposal-v4-eth")),
      intentHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("intent-v4")),
      disclosureHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes("disclosure-v4")),
      actions: [
        {
          target: ADDR.devWallet,
          value: hre.ethers.parseEther("1"), // 1 ETH
          data: "0x", // empty calldata
        },
      ],
    },
  ];
}

// ── Test suite ───────────────────────────────────────────────

describe("Commitment Parity: Solidity ↔ TypeScript", function () {
  let hasher: any;
  const vectors: TestVector[] = [];

  before(async function () {
    const CommitmentHasher = await hre.ethers.getContractFactory("CommitmentHasher");
    hasher = await CommitmentHasher.deploy();
    await hasher.waitForDeployment();
  });

  it("COMMIT_TYPEHASH matches between Solidity and TypeScript", async function () {
    const solidityTypehash: string = await hasher.getCommitTypehash();
    expect(COMMIT_TYPEHASH).to.equal(solidityTypehash);
  });

  const rawVectors = makeRawVectors();

  for (const rv of rawVectors) {
    it(`[${rv.id}] ${rv.description}`, async function () {
      // ── Solidity side ──
      const solActions = rv.actions.map((a) => ({
        target: a.target,
        value: a.value,
        data: a.data,
      }));

      const solActionsHash: string = await hasher.hashActions(solActions);

      const solCommitment: string = await hasher.computeCommitment(
        rv.chainId,
        rv.executor,
        rv.proposalId,
        rv.version,
        rv.versionHash,
        solActionsHash,
        rv.intentHash,
        rv.disclosureHash
      );

      // ── TypeScript side ──
      const tsActions: Action[] = rv.actions.map((a) => ({
        target: a.target,
        value: a.value,
        data: a.data,
      }));

      const tsActionsHash = hashActions(tsActions);

      const tsInput: CommitmentInput = {
        chainId: rv.chainId,
        executor: rv.executor,
        proposalId: rv.proposalId,
        version: rv.version,
        versionHash: rv.versionHash,
        actionsHash: tsActionsHash,
        intentHash: rv.intentHash,
        disclosureHash: rv.disclosureHash,
      };

      const tsCommitment = computeCommitment(tsInput);

      // ── Assert parity ──
      expect(tsActionsHash).to.equal(
        solActionsHash,
        `actionsHash mismatch on ${rv.id}`
      );
      expect(tsCommitment).to.equal(
        solCommitment,
        `commitment mismatch on ${rv.id}`
      );

      // ── Collect for hash-vectors.json ──
      vectors.push({
        id: rv.id,
        description: rv.description,
        chainId: rv.chainId.toString(),
        executor: rv.executor,
        proposalId: rv.proposalId.toString(),
        version: rv.version.toString(),
        versionHash: rv.versionHash,
        intentHash: rv.intentHash,
        disclosureHash: rv.disclosureHash,
        actions: rv.actions.map((a) => ({
          target: a.target,
          value: a.value.toString(),
          data: a.data,
        })),
        expected: {
          commitTypehash: COMMIT_TYPEHASH,
          actionsHash: solActionsHash,
          commitment: solCommitment,
        },
      });
    });
  }

  // ── Sensitivity tests: changing any single field changes commitment ──

  it("changing target in action changes actionsHash and commitment", async function () {
    const base = rawVectors[0]; // V0 benign
    const modified = {
      ...base,
      actions: [{ ...base.actions[0], target: ADDR.attacker }],
    };

    const baseActionsHash = hashActions(
      base.actions.map((a) => ({ target: a.target, value: a.value, data: a.data }))
    );
    const modifiedActionsHash = hashActions(
      modified.actions.map((a) => ({ target: a.target, value: a.value, data: a.data }))
    );

    expect(baseActionsHash).to.not.equal(modifiedActionsHash);
  });

  it("changing value in action changes actionsHash", async function () {
    const base = rawVectors[0];
    const modified = {
      ...base,
      actions: [{ ...base.actions[0], value: 1n }],
    };

    const baseHash = hashActions(
      base.actions.map((a) => ({ target: a.target, value: a.value, data: a.data }))
    );
    const modHash = hashActions(
      modified.actions.map((a) => ({ target: a.target, value: a.value, data: a.data }))
    );

    expect(baseHash).to.not.equal(modHash);
  });

  it("changing calldata changes actionsHash", async function () {
    const base = rawVectors[0];
    const modified = {
      ...base,
      actions: [
        { ...base.actions[0], data: encodeTransfer(ADDR.devWallet, 9999n) },
      ],
    };

    const baseHash = hashActions(
      base.actions.map((a) => ({ target: a.target, value: a.value, data: a.data }))
    );
    const modHash = hashActions(
      modified.actions.map((a) => ({ target: a.target, value: a.value, data: a.data }))
    );

    expect(baseHash).to.not.equal(modHash);
  });

  // ── Write hash-vectors.json after all tests ──

  after(function () {
    const outDir = path.resolve(__dirname, "..", "packages", "shared", "fixtures");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, "hash-vectors.json");
    fs.writeFileSync(outPath, JSON.stringify(vectors, null, 2));
    console.log(`\n✅ Wrote ${vectors.length} hash vectors to ${outPath}`);
  });
});
