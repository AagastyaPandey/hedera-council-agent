import { describe, expect, it } from "vitest";
import { Wallet, verifyTypedData } from "ethers";
import {
  buildIntentHaltTypedData,
  buildIntentVoteTypedData,
  intentTypedDataDigest,
  renderIntentStatement,
} from "../lib/signing";

describe("EIP-712 signing builders", () => {
  it("builds vote typed data with the contract's primary type and verifies", async () => {
    const wallet = Wallet.createRandom();
    const typed = buildIntentVoteTypedData({
      chainId: 31337,
      verifyingContract: "0x1000000000000000000000000000000000000001",
      govId: 7n,
      commitment: "0x" + "11".repeat(32),
      support: 1,
      briefHash: "0x" + "22".repeat(32),
      statement: "Transfer 5,000 USDC to GrowthLabs.",
      nonce: 0n,
      deadline: 1_800_000_000n,
    });

    expect(typed.primaryType).toBe("IntentVote");
    expect(typed.types.IntentVote.map((field) => field.name)).toEqual([
      "govId",
      "commitment",
      "support",
      "briefHash",
      "statement",
      "nonce",
      "deadline",
    ]);

    const signature = await wallet.signTypedData(
      typed.domain,
      typed.types,
      typed.message
    );
    expect(
      verifyTypedData(typed.domain, typed.types, typed.message, signature)
    ).toBe(wallet.address);
    expect(intentTypedDataDigest(typed)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("builds halt typed data with the executor domain", async () => {
    const wallet = Wallet.createRandom();
    const typed = buildIntentHaltTypedData({
      chainId: 31337,
      verifyingContract: "0x2000000000000000000000000000000000000002",
      commitment: "0x" + "33".repeat(32),
      reportHash: "0x" + "44".repeat(32),
      reason: "Uncommitted upgrade in the queued call.",
      nonce: 3n,
      deadline: 1_800_000_000n,
    });

    expect(typed.primaryType).toBe("IntentHalt");
    const signature = await wallet.signTypedData(
      typed.domain,
      typed.types,
      typed.message
    );
    expect(
      verifyTypedData(typed.domain, typed.types, typed.message, signature)
    ).toBe(wallet.address);
  });

  it("renders a deterministic statement from title, amount and recipient", () => {
    const statement = renderIntentStatement("AIP-042 Growth Grant", [
      {
        kind: "ERC20_TRANSFER",
        amount: "200,000",
        token: "USDC",
        recipient: "GrowthLabs",
      },
      {
        kind: "ERC20_APPROVE",
        amount: "5,000",
        token: "USDC",
        recipient: "TreasuryOps",
      },
    ]);

    expect(statement).toBe(
      "AIP-042 Growth Grant: transfer 200,000 USDC to GrowthLabs; approve 5,000 USDC for TreasuryOps."
    );
    expect(
      renderIntentStatement("AIP-042 Growth Grant", [
        {
          kind: "ERC20_TRANSFER",
          amount: "200,000",
          token: "USDC",
          recipient: "GrowthLabs",
        },
        {
          kind: "ERC20_APPROVE",
          amount: "5,000",
          token: "USDC",
          recipient: "TreasuryOps",
        },
      ])
    ).toBe(statement);
  });

  it("changes the digest when a signed field changes", () => {
    const base = buildIntentVoteTypedData({
      chainId: 31337,
      verifyingContract: "0x1000000000000000000000000000000000000001",
      govId: 7n,
      commitment: "0x" + "11".repeat(32),
      support: 1,
      briefHash: "0x" + "22".repeat(32),
      statement: "Transfer 5,000 USDC to GrowthLabs.",
      nonce: 0n,
      deadline: 1_800_000_000n,
    });
    const tampered = buildIntentVoteTypedData({
      chainId: 31337,
      verifyingContract: "0x1000000000000000000000000000000000000001",
      govId: 7n,
      commitment: "0x" + "11".repeat(32),
      support: 0,
      briefHash: "0x" + "22".repeat(32),
      statement: "Transfer 5,000 USDC to GrowthLabs.",
      nonce: 0n,
      deadline: 1_800_000_000n,
    });

    expect(intentTypedDataDigest(base)).not.toBe(intentTypedDataDigest(tampered));
  });
});
