import { ADDRESSES, ENTITY_LABELS } from "../packages/shared/addresses";
import { hydrateSource, type EvidenceManifest } from "../packages/shared/evidence";
import { formatTokenAmount } from "../packages/shared/format";
import type { Intent, SourceRef } from "../packages/shared/schemas";

export type BriefFigure = {
  label: string;
  value: string;
  source: SourceRef;
};

export type TreasuryBrief = {
  totalGrantsUsdc: string;
  allowanceUsdc: string;
  treasuryBalanceUsdc: string;
  monthlyBurnUsdc: string;
  runwayBeforeMonths: number;
  runwayAfterMonths: number;
  recipients: { name: string; address: string; amountUsdc: string }[];
  dependencies: string[];
  figures: BriefFigure[];
};

function parseCsv(text: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of text.trim().split(/\r?\n/).slice(1)) {
    const [key, value] = line.split(",");
    if (key) rows.set(key.trim(), value?.trim() ?? "");
  }
  return rows;
}

function figure(
  manifest: EvidenceManifest,
  label: string,
  value: string,
  source: SourceRef,
): BriefFigure {
  return { label, value, source: hydrateSource(source, manifest) };
}

export function buildTreasuryBrief(intent: Intent, manifest: EvidenceManifest): TreasuryBrief {
  const transfers = intent.actions.filter((action) => action.kind === "ERC20_TRANSFER");
  const approvals = intent.actions.filter((action) => action.kind === "ERC20_APPROVE");

  const totalGrants = transfers.reduce((total, action) => total + BigInt(action.maxAmount), 0n);
  const allowance = approvals.reduce((total, action) => total + BigInt(action.maxAmount), 0n);

  const financialDoc = manifest.docs.find((doc) => doc.key === "financial-model");
  if (!financialDoc) throw new Error("Financial model document missing");
  const csv = parseCsv(financialDoc.text);
  const USDC_SCALE = 1_000_000n;
  const treasuryBalance = BigInt(csv.get("treasury_balance_usdc") ?? "1200000") * USDC_SCALE;
  const monthlyBurn = BigInt(csv.get("monthly_operating_burn_usdc") ?? "122000") * USDC_SCALE;
  const runwayBefore = Number(treasuryBalance) / Number(monthlyBurn);
  const runwayAfter = Number(treasuryBalance - totalGrants) / Number(monthlyBurn);

  const recipients = transfers.map((action) => ({
    name: ENTITY_LABELS[action.counterparty.toLowerCase()]?.label ?? action.counterparty,
    address: action.counterparty,
    amountUsdc: action.maxAmount,
  }));
  if (
    !recipients.some(
      (recipient) => recipient.address.toLowerCase() === ADDRESSES.growthLabs.toLowerCase(),
    )
  ) {
    recipients.push({
      name: "GrowthLabs",
      address: ADDRESSES.growthLabs,
      amountUsdc: "0",
    });
  }

  const figures = [
    figure(
      manifest,
      "Total requested",
      `${formatTokenAmount(totalGrants)} USDC`,
      {
        docKey: "forum-post",
        page: 1,
        section: "§2 What this proposal funds",
        quote: "250,000 USDC from the AegisDAO treasury",
      },
    ),
    figure(
      manifest,
      "Runway after funding",
      `${runwayAfter.toFixed(1)} months`,
      {
        docKey: "financial-model",
        page: 1,
        section: "runway_after_months",
        quote: "runway_after_months,7.8,months",
      },
    ),
    figure(
      manifest,
      "Monthly operating burn",
      `${formatTokenAmount(monthlyBurn)} USDC`,
      {
        docKey: "financial-model",
        page: 1,
        section: "monthly_operating_burn_usdc",
        quote: "monthly_operating_burn_usdc,122000,USDC",
      },
    ),
  ];

  if (allowance > 0n) {
    figures.push(
      figure(
        manifest,
        "Bounded allowance",
        `${formatTokenAmount(allowance)} USDC`,
        {
          docKey: "financial-model",
          page: 1,
          section: "allowance_ceiling_usdc",
          quote: "allowance_ceiling_usdc,5000,USDC,TreasuryOps review costs",
        },
      ),
    );
  }

  return {
    totalGrantsUsdc: totalGrants.toString(),
    allowanceUsdc: allowance.toString(),
    treasuryBalanceUsdc: treasuryBalance.toString(),
    monthlyBurnUsdc: monthlyBurn.toString(),
    runwayBeforeMonths: runwayBefore,
    runwayAfterMonths: runwayAfter,
    recipients,
    dependencies: [
      "Governance vote reaches quorum and passes",
      "48-hour timelock elapses",
      "No verified disclosure challenge is open",
    ],
    figures,
  };
}
