import { ADDRESSES } from "../packages/shared/addresses";
import type { Assumption, Intent, SourceRef } from "../packages/shared/schemas";

export type Resolutions = Record<string, string>;

const SOURCES = {
  upgradeRejected: {
    docKey: "technical-assessment",
    page: 1,
    section: "Treasury implementation",
    quote: "No implementation upgrade is authorized by this proposal.",
  } satisfies SourceRef,
  upgradeAuthorized: {
    docKey: "forum-post",
    page: 1,
    section: "§5 Implementation note",
    quote: "align the treasury implementation with the program's delivery roadmap",
  } satisfies SourceRef,
  cadenceOneTime: {
    docKey: "growthlabs-letter",
    page: 1,
    section: "Disbursement",
    quote: "This is a single disbursement, not a recurring grant.",
  } satisfies SourceRef,
  cadenceRecurring: {
    docKey: "forum-post",
    page: 1,
    section: "§2 What this proposal funds",
    quote: "The grant is a one-time payment. It is not a recurring commitment",
  } satisfies SourceRef,
  allowance: {
    docKey: "financial-model",
    page: 1,
    section: "allowance_ceiling_usdc",
    quote: "allowance_ceiling_usdc,5000,USDC,TreasuryOps review costs",
  } satisfies SourceRef,
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function applyResolutions(source: Intent, resolutions: Resolutions): Intent {
  const next = clone(source);
  const upgradeDecision = resolutions["upgrade-scope"];
  const cadenceDecision = resolutions["cadence"];

  if (upgradeDecision === "reject") {
    next.actions = next.actions.filter(
      (action) => !(action.kind === "UPGRADE" && action.label?.includes("TENTATIVE")),
    );
  }
  if (upgradeDecision === "authorize") {
    next.actions = next.actions.map((action) =>
      action.kind === "UPGRADE" && action.label?.includes("TENTATIVE")
        ? { ...action, label: "Reviewer-authorized implementation upgrade" }
        : action,
    );
  }

  if (cadenceDecision === "recurring_quarterly") {
    next.actions = next.actions.map((action) => {
      if (
        action.kind === "ERC20_TRANSFER" &&
        action.counterparty.toLowerCase() === ADDRESSES.growthLabs.toLowerCase()
      ) {
        return {
          ...action,
          maxAmount: "800000000000",
          label: "Recurring quarterly grants (4 × 200,000 USDC)",
        };
      }
      return action;
    });
  }

  const assumptions: Assumption[] = [];
  if (upgradeDecision === "reject" || upgradeDecision === "authorize") {
    assumptions.push({
      name: "upgrade_authorized",
      value: upgradeDecision === "authorize" ? "true" : "false",
      source:
        upgradeDecision === "authorize" ? SOURCES.upgradeAuthorized : SOURCES.upgradeRejected,
    });
  }
  if (cadenceDecision === "one_time" || cadenceDecision === "recurring_quarterly") {
    assumptions.push({
      name: "grant_cadence",
      value: cadenceDecision,
      source:
        cadenceDecision === "one_time" ? SOURCES.cadenceOneTime : SOURCES.cadenceRecurring,
    });
  }
  assumptions.push({
    name: "allowance_ceiling_usdc",
    value: "5000",
    source: SOURCES.allowance,
  });

  next.assumptions = assumptions;
  next.unresolved = next.unresolved.filter((item) => !(item.id in resolutions));
  return next;
}

export function isFullyResolved(intent: Intent): boolean {
  return intent.unresolved.length === 0 && intent.assumptions.length >= 3;
}
