// Fresh code, written 2026-11-06 for ETHGlobal Mumbai.
// Hedera client, env-gated. Real mode only when HEDERA_ACCOUNT_ID and
// HEDERA_PRIVATE_KEY are set. Otherwise SIMULATED mode: the full logic
// runs, but every chain id is prefixed SIM- and output is labelled
// SIMULATED. Never invent a fake real transaction id or HashScan link.
//
// Council model: proposals move funds out of the treasury account
// (HEDERA_TREASURY_ACCOUNT_ID, default: the agent's own account). The
// agent's "seat" is its key. Signing a proposal means creating the
// Scheduled Transaction for the exact transfer (the creator's signature
// counts toward the schedule) or, if another council member already
// created the identical schedule, adding the agent's signature with
// ScheduleSign. If the treasury has a threshold key, the transfer runs
// only once enough council members have signed.

import type { Transfer } from "./proposal.js";

export type HederaMode = "real" | "simulated";

export interface HederaConfig {
  network: string;
  accountId: string;
  privateKey: string;
  topicId: string;
  treasuryAccountId: string;
}

export function loadHederaConfig(env: NodeJS.ProcessEnv): { config: HederaConfig; mode: HederaMode } {
  const accountId = (env.HEDERA_ACCOUNT_ID ?? "").trim();
  const privateKey = (env.HEDERA_PRIVATE_KEY ?? "").trim();
  const config: HederaConfig = {
    network: (env.HEDERA_NETWORK ?? "testnet").trim() || "testnet",
    accountId,
    privateKey,
    topicId: (env.HEDERA_TOPIC_ID ?? "").trim(),
    treasuryAccountId: (env.HEDERA_TREASURY_ACCOUNT_ID ?? "").trim() || accountId,
  };
  const mode: HederaMode = accountId && privateKey ? "real" : "simulated";
  return { config, mode };
}

export function hashscanUrl(network: string, txId: string): string {
  const host = network === "mainnet" ? "hashscan.io/mainnet" : "hashscan.io/testnet";
  return `https://${host}/transaction/${encodeURIComponent(txId)}`;
}

export interface AuditEntry {
  proposalId: string;
  event: string;
  detail: string;
  at: string;
}

export interface ScheduleResult {
  scheduleId: string;
  // "created": the agent created the schedule (its signature included).
  // "signed": the identical schedule existed, the agent added its signature.
  // "already-signed": the agent's signature was already on it.
  action: "created" | "signed" | "already-signed";
}

type Sdk = typeof import("@hiero-ledger/sdk");

export class HederaClient {
  readonly mode: HederaMode;
  private simCounter = 0;
  // Real-mode SDK client, created lazily so simulated mode needs no keys.
  private sdkClient: import("@hiero-ledger/sdk").Client | null = null;
  private sdk: Sdk | null = null;
  private topicCreation: Promise<string> | null = null;

  constructor(
    readonly config: HederaConfig,
    mode: HederaMode,
  ) {
    this.mode = mode;
  }

  isReal(): boolean {
    return this.mode === "real";
  }

  simId(prefix: string): string {
    this.simCounter += 1;
    return `SIM-${prefix}-${String(this.simCounter).padStart(4, "0")}`;
  }

  private async getSdk(): Promise<Sdk> {
    if (!this.sdk) this.sdk = await import("@hiero-ledger/sdk");
    return this.sdk;
  }

  private async getClient() {
    if (this.sdkClient) return this.sdkClient;
    const sdk = await this.getSdk();
    const client = this.config.network === "mainnet" ? sdk.Client.forMainnet() : sdk.Client.forTestnet();
    client.setOperator(
      sdk.AccountId.fromString(this.config.accountId),
      sdk.PrivateKey.fromString(this.config.privateKey),
    );
    this.sdkClient = client;
    return client;
  }

  // Verify a payment tx id exists and settled. Real mode checks the
  // receipt via the SDK; simulated mode only accepts SIM- ids it made.
  async verifyPayment(txId: string): Promise<boolean> {
    if (this.mode === "simulated") return txId.startsWith("SIM-PAY-");
    try {
      const sdk = await this.getSdk();
      const client = await this.getClient();
      const receipt = await new sdk.TransactionReceiptQuery()
        .setTransactionId(sdk.TransactionId.fromString(txId))
        .execute(client);
      return receipt.status.toString() === "SUCCESS";
    } catch {
      return false;
    }
  }

  // Topic id for the audit log. Creates one on first use when
  // HEDERA_TOPIC_ID is unset, and logs it so it can be pinned in .env.
  async ensureTopic(): Promise<string> {
    if (this.config.topicId) return this.config.topicId;
    this.topicCreation ??= this.createTopic().then((id) => {
      this.config.topicId = id;
      console.log(`Created HCS audit topic ${id}. Set HEDERA_TOPIC_ID=${id} in .env to reuse it.`);
      return id;
    });
    return this.topicCreation;
  }

  // Append an audit entry to the HCS topic. Returns the tx id, or a SIM id.
  async audit(entry: AuditEntry): Promise<string> {
    if (this.mode === "simulated") return this.simId("HCS");
    const topicId = await this.ensureTopic();
    const sdk = await this.getSdk();
    const client = await this.getClient();
    const tx = await new sdk.TopicMessageSubmitTransaction()
      .setTopicId(sdk.TopicId.fromString(topicId))
      .setMessage(JSON.stringify(entry))
      .execute(client);
    await tx.getReceipt(client);
    return tx.transactionId.toString();
  }

  // Create an HCS topic for the audit log. Returns the topic id.
  async createTopic(memo = "hedera-council-agent audit log"): Promise<string> {
    if (this.mode === "simulated") return this.simId("TOPIC");
    const sdk = await this.getSdk();
    const client = await this.getClient();
    const tx = await new sdk.TopicCreateTransaction().setTopicMemo(memo.slice(0, 100)).execute(client);
    const receipt = await tx.getReceipt(client);
    if (!receipt.topicId) throw new Error("TopicCreateTransaction returned no topic id");
    return receipt.topicId.toString();
  }

  // Sign the exact transfer as a Scheduled Transaction from the treasury.
  // The memo must be deterministic (it is part of schedule identity), so
  // every council member signing the same proposal hits the same schedule.
  async signScheduledTransfer(transfer: Transfer, memo: string): Promise<ScheduleResult> {
    if (this.mode === "simulated") return { scheduleId: this.simId("SCHED"), action: "created" };
    const sdk = await this.getSdk();
    const client = await this.getClient();
    const treasury = sdk.AccountId.fromString(this.config.treasuryAccountId);
    const inner = new sdk.TransferTransaction()
      .addHbarTransfer(treasury, sdk.Hbar.fromTinybars(-transfer.amountTinybars))
      .addHbarTransfer(sdk.AccountId.fromString(transfer.payee), sdk.Hbar.fromTinybars(transfer.amountTinybars))
      .setTransactionMemo(memo.slice(0, 100));
    try {
      const created = await new sdk.ScheduleCreateTransaction()
        .setScheduledTransaction(inner)
        .setScheduleMemo(memo.slice(0, 100))
        .execute(client);
      const receipt = await created.getReceipt(client);
      if (!receipt.scheduleId) throw new Error("ScheduleCreateTransaction returned no schedule id");
      return { scheduleId: receipt.scheduleId.toString(), action: "created" };
    } catch (err) {
      const existing =
        err instanceof sdk.ReceiptStatusError && err.status === sdk.Status.IdenticalScheduleAlreadyCreated
          ? err.transactionReceipt.scheduleId
          : null;
      if (!existing) throw err;
      try {
        const signed = await new sdk.ScheduleSignTransaction().setScheduleId(existing).execute(client);
        await signed.getReceipt(client);
        return { scheduleId: existing.toString(), action: "signed" };
      } catch (signErr) {
        if (signErr instanceof sdk.StatusError && signErr.status === sdk.Status.NoNewValidSignatures) {
          return { scheduleId: existing.toString(), action: "already-signed" };
        }
        throw signErr;
      }
    }
  }

  // --- Setup helpers used by `npm run preflight` (real mode only) ---

  async balances(accountId = this.config.accountId): Promise<{ hbar: string; tokens: Record<string, string> }> {
    const sdk = await this.getSdk();
    const client = await this.getClient();
    const b = await new sdk.AccountBalanceQuery().setAccountId(sdk.AccountId.fromString(accountId)).execute(client);
    const json = b.toJSON();
    return { hbar: json.hbars, tokens: Object.fromEntries(json.tokens.map((t) => [t.tokenId, t.balance])) };
  }

  // Associate the agent account with an HTS token. Returns false if it
  // was already associated.
  async associateToken(tokenId: string): Promise<boolean> {
    const sdk = await this.getSdk();
    const client = await this.getClient();
    try {
      const tx = await new sdk.TokenAssociateTransaction()
        .setAccountId(sdk.AccountId.fromString(this.config.accountId))
        .setTokenIds([sdk.TokenId.fromString(tokenId)])
        .execute(client);
      await tx.getReceipt(client);
      return true;
    } catch (err) {
      if (err instanceof sdk.StatusError && err.status === sdk.Status.TokenAlreadyAssociatedToAccount) return false;
      throw err;
    }
  }

  // Create a second account to receive x402 check fees (the check
  // seller). It shares the agent's key and auto-associates tokens, so it
  // can receive testnet USDC without a separate association step.
  async createFeeAccount(initialHbar = 1): Promise<string> {
    const sdk = await this.getSdk();
    const client = await this.getClient();
    const key = sdk.PrivateKey.fromString(this.config.privateKey);
    const tx = await new sdk.AccountCreateTransaction()
      .setKeyWithoutAlias(key.publicKey)
      .setInitialBalance(new sdk.Hbar(initialHbar))
      .setMaxAutomaticTokenAssociations(10)
      .setAccountMemo("hedera-council-agent x402 check fees")
      .execute(client);
    const receipt = await tx.getReceipt(client);
    if (!receipt.accountId) throw new Error("AccountCreateTransaction returned no account id");
    return receipt.accountId.toString();
  }

  close(): void {
    this.sdkClient?.close();
    this.sdkClient = null;
  }
}
