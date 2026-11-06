import { concat, keccak256, toBytes, type Hex } from "viem";
import { buildConcreteCalls, type ConcreteCall } from "../packages/shared/calls";
import { formatTokenAmount, shortAddress } from "../packages/shared/format";
import {
  compileRules,
  computeActionsHash,
  computeCalldataHash,
  computeCommitment,
  computeIntentHash,
  computeSimulatedTxHash,
  type ActionRule,
} from "../packages/shared/hash";
import type { DecodedAction } from "../packages/shared/schemas";
import { decodeBundle, entityLabel, extractMulticallChildren } from "../sentinel/decode";
import { buildReport } from "../sentinel/report";
import { encodeViolationError, type ViolationInput } from "./errors";
import type {
  ChallengeSummary,
  ExecutionContext,
  RunResult,
  RunStep,
  Scenario,
} from "./types";
import sentinelTrace06Json from "../packages/shared/fixtures/sentinel-trace-06.json";

/**
 * `extcodehash` of an account that exists but holds no bytecode (EIP-1052), i.e.
 * `keccak256("")`. The reference model deploys nothing, so no address has code;
 * this is the honest value to report as the observed implementation hash rather
 * than a zero placeholder that reads like a measurement.
 */
const EMPTY_CODE_HASH = keccak256("0x");

/**
 * Simulated Sentinel traces, keyed by the filename a scenario cites.
 * A trace is only evidence if it is actually read — the verdict below is
 * derived from the call tree, never from `scenario.layer`.
 */
export type TraceNode = {
  type: string;
  from: string;
  to: string;
  selector: string;
  function: string;
  flag?: string;
  children: TraceNode[];
};

export type TraceFixture = {
  source: string;
  network: string;
  root: TraceNode;
  storageChanges: { contract: string; slot: string; label: string; before: string; after: string }[];
  flags: { code: string; message: string; evidence: string }[];
};

export const TRACE_REGISTRY: Record<string, TraceFixture> = {
  "sentinel-trace-06.json": sentinelTrace06Json as unknown as TraceFixture,
};

/** Walk a trace's call tree for a DELEGATECALL, falling back to its explicit flags. */
export function traceFlagsDelegatecall(trace: TraceFixture): boolean {
  const walk = (node: TraceNode): boolean =>
    node.type === "DELEGATECALL" || node.flag === "DELEGATECALL" || node.children.some(walk);
  if (walk(trace.root)) return true;
  return (trace.flags ?? []).some((flag) => flag.code === "DELEGATECALL");
}


const CODE_LABELS: Record<string, string> = {
  OK: "Executed as committed",
  CommitmentMismatch: "Commitment mismatch",
  UnauthorizedRecipient: "Recipient not in commitment",
  UnauthorizedSpender: "Spender not in commitment",
  ExceedsSpendLimit: "Above committed spend limit",
  ExceedsAllowance: "Above allowance ceiling",
  SelectorNotAuthorized: "Function never committed",
  CodeHashMismatch: "Implementation not approved",
  NestedCallNotAuthorized: "Hidden child call",
  StaleVersion: "Superseded version",
  AlreadyExecuted: "Already executed",
  TimelockNotElapsed: "Timelock not elapsed",
  WrongChain: "Wrong chain",
  ReentrancyDetected: "Re-entrant call blocked",
  PostConditionViolated: "Post-condition failed",
  GuardianHalted: "Guardian halted",
  UnknownSelector: "Unknown function",
  ValueNotAllowed: "Native value not allowed",
  DelegatecallDetected: "Simulation detected",
  UndisclosedLink: "Disclosure challenge filed",
};

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function fnName(decoded: DecodedAction): string {
  return decoded.function.replace("()", "");
}

function selectorOf(call: ConcreteCall): Hex {
  return call.data.slice(0, 10) as Hex;
}

function step(id: string, label: string, status: RunStep["status"], detail: string): RunStep {
  return { id, label, status, detail };
}

function describeRecipients(rules: ActionRule[], target: string, selector: Hex): string {
  const recipients = rules
    .filter(
      (rule) =>
        rule.kind === "ERC20_TRANSFER" &&
        sameAddress(rule.target, target) &&
        rule.selector.toLowerCase() === selector.toLowerCase(),
    )
    .map((rule) => `${entityLabel(rule.counterparty)} (${shortAddress(rule.counterparty)})`);
  return recipients.length > 0 ? recipients.join(", ") : "none";
}

function checkSingle(
  call: ConcreteCall,
  decoded: DecodedAction,
  rules: ActionRule[],
): ViolationInput | null {
  if (decoded.unknown) {
    return {
      code: "UnknownSelector",
      message: `Selector ${decoded.selector} on ${entityLabel(call.target)} is not in the decoder registry.`,
      args: [decoded.selector],
    };
  }

  const selector = selectorOf(call);
  const functionName = fnName(decoded);

  switch (functionName) {
    case "transfer": {
      const recipient = decoded.args.arg0;
      const amount = BigInt(decoded.args.arg1);
      const match = rules.find(
        (rule) =>
          rule.kind === "ERC20_TRANSFER" &&
          sameAddress(rule.target, call.target) &&
          rule.selector.toLowerCase() === selector.toLowerCase() &&
          sameAddress(rule.counterparty, recipient),
      );
      if (!match) {
        const sameShape = rules.some(
          (rule) =>
            rule.kind === "ERC20_TRANSFER" &&
            sameAddress(rule.target, call.target) &&
            rule.selector.toLowerCase() === selector.toLowerCase(),
        );
        if (sameShape) {
          return {
            code: "UnauthorizedRecipient",
            message: `Transfers ${formatTokenAmount(amount)} USDC to ${entityLabel(
              recipient,
            )} (${shortAddress(recipient)}), which is not a committed recipient. Committed: ${describeRecipients(
              rules,
              call.target,
              selector,
            )}.`,
            args: [recipient],
          };
        }
        return {
          code: "SelectorNotAuthorized",
          message: `transfer(address,uint256) on ${entityLabel(call.target)} was never committed.`,
          args: [call.target, selector],
        };
      }
      if (amount > match.maxAmount) {
        return {
          code: "ExceedsSpendLimit",
          message: `Requests ${formatTokenAmount(amount)} USDC; the committed ceiling for ${entityLabel(
            match.counterparty,
          )} is ${formatTokenAmount(match.maxAmount)} USDC.`,
          args: [amount, match.maxAmount],
        };
      }
      return null;
    }

    case "approve": {
      const spender = decoded.args.arg0;
      const amount = BigInt(decoded.args.arg1);
      const match = rules.find(
        (rule) =>
          rule.kind === "ERC20_APPROVE" &&
          sameAddress(rule.target, call.target) &&
          rule.selector.toLowerCase() === selector.toLowerCase() &&
          sameAddress(rule.counterparty, spender),
      );
      if (!match) {
        const sameShape = rules.some(
          (rule) =>
            rule.kind === "ERC20_APPROVE" &&
            sameAddress(rule.target, call.target) &&
            rule.selector.toLowerCase() === selector.toLowerCase(),
        );
        if (sameShape) {
          return {
            code: "UnauthorizedSpender",
            message: `Allowance is requested for ${entityLabel(
              spender,
            )} (${shortAddress(spender)}), which is not a committed spender.`,
            args: [spender],
          };
        }
        return {
          code: "SelectorNotAuthorized",
          message: `approve(address,uint256) on ${entityLabel(call.target)} was never committed.`,
          args: [call.target, selector],
        };
      }
      if (amount > match.maxAmount) {
        return {
          code: "ExceedsAllowance",
          message: `Requests ${formatTokenAmount(amount)} allowance; the committed ceiling is ${formatTokenAmount(
            match.maxAmount,
          )} USDC.`,
          args: [amount, match.maxAmount],
        };
      }
      return null;
    }

    case "upgradeTo":
    case "upgradeToAndCall": {
      const newImplementation = decoded.args.arg0;
      const match = rules.find(
        (rule) =>
          rule.kind === "UPGRADE" &&
          sameAddress(rule.target, call.target) &&
          rule.selector.toLowerCase() === selector.toLowerCase(),
      );
      if (!match) {
        return {
          code: "SelectorNotAuthorized",
          message: `${functionName}(address) on ${entityLabel(
            call.target,
          )} was never committed. The commitment authorizes transfers and a bounded allowance only.`,
          args: [call.target, selector],
        };
      }
      if (!sameAddress(match.counterparty, newImplementation)) {
        return {
          code: "CodeHashMismatch",
          message: `Implementation ${shortAddress(
            newImplementation,
          )} is not the approved implementation ${shortAddress(match.counterparty)}.`,
          // args[2] is the code hash the model can actually observe at the
          // submitted address. Nothing is deployed in this model, so that is
          // the empty-code hash — not a zero stand-in for a measurement.
          args: [call.target, match.codeHash, EMPTY_CODE_HASH],
        };
      }
      return null;
    }

    case "transferOwnership": {
      const match = rules.find(
        (rule) =>
          rule.kind === "OWNERSHIP_TRANSFER" &&
          sameAddress(rule.target, call.target) &&
          rule.selector.toLowerCase() === selector.toLowerCase(),
      );
      if (!match) {
        return {
          code: "SelectorNotAuthorized",
          message: `transferOwnership(address) on ${entityLabel(
            call.target,
          )} was never committed. Ownership changes require a new proposal.`,
          args: [call.target, selector],
        };
      }
      return null;
    }

    case "multicall":
      return null;

    default:
      return {
        code: "SelectorNotAuthorized",
        message: `${functionName}() on ${entityLabel(call.target)} was never committed.`,
        args: [call.target, selector],
      };
  }
}

function checkRules(
  calls: ConcreteCall[],
  decodedActions: DecodedAction[],
  rules: ActionRule[],
): ViolationInput | null {
  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index];
    const decoded = decodedActions[index];

    if (fnName(decoded) === "multicall") {
      const children = extractMulticallChildren(call);
      const multicallRule = rules.find(
        (rule) =>
          rule.kind === "MULTICALL" &&
          sameAddress(rule.target, call.target) &&
          rule.selector.toLowerCase() === selectorOf(call).toLowerCase(),
      );

      if (multicallRule) {
        for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
          const childDecoded = decoded.nested[childIndex];
          const childViolation = checkSingle(
            { target: children[childIndex].target, value: 0n, data: children[childIndex].data },
            childDecoded,
            multicallRule.children,
          );
          if (childViolation) {
            return {
              code: "NestedCallNotAuthorized",
              message: `Multicall child #${childIndex + 1} failed its child rule: ${childViolation.message}`,
              args: [BigInt(childIndex), children[childIndex].data],
            };
          }
        }
        continue;
      }

      let firstUnauthorized = -1;
      for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
        const childDecoded = decoded.nested[childIndex];
        const childViolation = checkSingle(
          { target: children[childIndex].target, value: 0n, data: children[childIndex].data },
          childDecoded,
          rules,
        );
        if (childViolation) {
          firstUnauthorized = childIndex;
          break;
        }
      }

      const errorIndex = firstUnauthorized >= 0 ? firstUnauthorized : 0;
      const childData = children[errorIndex]?.data ?? call.data;
      const childDescription =
        decoded.nested[errorIndex]?.humanText ?? "the multicall wrapper itself";
      return {
        code: "NestedCallNotAuthorized",
        message:
          firstUnauthorized >= 0
            ? `Multicall child #${errorIndex + 1} is not in the commitment: ${childDescription}`
            : "The multicall wrapper is not in the commitment.",
        args: [BigInt(errorIndex), childData],
      };
    }

    const violation = checkSingle(call, decoded, rules);
    if (violation) return violation;
  }
  return null;
}

function transferSpend(calls: ConcreteCall[], decodedActions: DecodedAction[]): bigint {
  return calls.reduce((total, call, index) => {
    const decoded = decodedActions[index];
    if (fnName(decoded) === "transfer") return total + BigInt(decoded.args.arg1);
    return total;
  }, 0n);
}

/**
 * Cumulative transfer budget, summed over the committed ERC20_TRANSFER rules.
 *
 * Allowances are deliberately excluded. An `approve` ceiling is a permission,
 * not a spend: it is already bounded by its own rule (ExceedsAllowance), and
 * counting it here would double-count the same USDC against the grant total.
 * The post-condition therefore answers "how much can leave the treasury", not
 * "how much has been authorised".
 */
function transferBudget(rules: ActionRule[]): bigint {
  return rules
    .filter((rule) => rule.kind === "ERC20_TRANSFER")
    .reduce((total, rule) => total + rule.maxAmount, 0n);
}

export function runScenario(
  scenario: Scenario,
  context: ExecutionContext,
  challenge?: ChallengeSummary,
): RunResult {
  const approved = decodeBundle(context.approvedCalls);
  const submittedCalls =
    scenario.mode === "approved"
      ? context.approvedCalls
      : scenario.mode === "attack"
        ? buildConcreteCalls(scenario.calls)
        : [];
  const submitted = decodeBundle(submittedCalls);

  const intentHash = computeIntentHash(context.intent);
  const approvedActionsHash = computeActionsHash(context.approvedCalls);
  const submittedActionsHash = computeActionsHash(submittedCalls);
  const approvedCommitment = computeCommitment({
    chainId: context.chainId,
    executor: context.executor,
    proposalId: context.proposalId,
    version: context.intent.version,
    actionsHash: approvedActionsHash,
    intentHash,
    evidenceRoot: context.evidenceRoot,
    disclosureHash: context.disclosureHash,
  });
  const submittedCommitment = computeCommitment({
    chainId: scenario.context.chainId,
    executor: context.executor,
    proposalId: context.proposalId,
    version: scenario.context.submittedVersion,
    actionsHash: submittedActionsHash,
    intentHash,
    evidenceRoot: context.evidenceRoot,
    disclosureHash: context.disclosureHash,
  });
  const commitmentMatched =
    approvedCommitment.toLowerCase() === submittedCommitment.toLowerCase();

  const submittedCalldata: Hex =
    submittedCalls.length === 0
      ? "0x"
      : submittedCalls.length === 1
        ? submittedCalls[0].data
        : concat(submittedCalls.map((call) => call.data));
  const calldataHash = computeCalldataHash(submittedCalldata);

  const txHash =
    scenario.layer === "executor"
      ? computeSimulatedTxHash({
          scenarioId: scenario.id,
          calldata: submittedCalldata,
          commitBlock: scenario.context.blockNumber,
        })
      : null;
  const traceRef =
    scenario.layer === "sentinel" ? (scenario.context.sentinel?.traceFile ?? null) : null;

  const steps: RunStep[] = [];
  const unknownCount = submitted.filter((action) => action.unknown).length;
  steps.push(
    step(
      "decode",
      "Decode calldata",
      "PASS",
      `${submittedCalls.length} call${submittedCalls.length === 1 ? "" : "s"} decoded · ${unknownCount} unknown selector${
        unknownCount === 1 ? "" : "s"
      }`,
    ),
  );

  const finalize = (input: {
    violation: ViolationInput | null;
    status: "PASSED" | "REJECTED" | "FLAGGED";
    steps: RunStep[];
    challenge?: ChallengeSummary;
    messageOverride?: string;
  }): RunResult => {
    const code = input.violation?.code ?? "OK";
    const message =
      input.messageOverride ??
      input.violation?.message ??
      "The submitted bundle matches the commitment and all post-conditions hold.";
    const revertData = input.violation ? encodeViolationError(input.violation) : ("0x" as Hex);
    const report = buildReport({
      proposalId: context.proposalId,
      scenarioId: scenario.id,
      layer: scenario.layer,
      status: input.status,
      proposalSaid: scenario.proposalSaid,
      approved,
      submitted,
      constraint: input.violation ? { code, message } : null,
      evidence: {
        commitment: approvedCommitment,
        submittedCommitment,
        calldataHash,
        calldata: submittedCalldata,
        revertData,
        txHash,
        traceRef,
      },
    });

    const notes = scenario.modelNote ? [scenario.modelNote] : [];
    if (code === "CodeHashMismatch") {
      notes.push(
        'The reference model deploys no bytecode, so the observed implementation hash is keccak256("") — the EIP-1052 extcodehash of an account with no code. A deployed executor must compare real extcodehash values.',
      );
    }
    if (scenario.layer === "disclosure") {
      notes.push("Challenge verification is simulated; the DisclosureRegistry is Person A's contract.");
    }

    return {
      scenario,
      layer: scenario.layer,
      status: input.status,
      code,
      label: CODE_LABELS[code] ?? code,
      message,
      steps: input.steps,
      approved,
      submitted,
      approvedCalls: context.approvedCalls,
      submittedCalls,
      approvedCalldata: concat(context.approvedCalls.map((call) => call.data)),
      submittedCalldata,
      approvedCommitment,
      submittedCommitment,
      commitmentMatched,
      intentHash,
      approvedActionsHash,
      submittedActionsHash,
      calldataHash,
      revertData,
      txHash,
      traceRef,
      violatedConstraint: report.violatedConstraint,
      report,
      notes,
      challenge: input.challenge,
    };
  };

  if (scenario.layer === "disclosure") {
    const score = challenge?.score ?? 0;
    const threshold = challenge?.threshold ?? 0.65;
    const linkCount = challenge?.linkCount ?? 0;
    // A challenge only becomes a flag when the graph actually reaches the red
    // threshold. Otherwise the layer raises no objection and we fall through.
    const substantiated = Boolean(challenge) && score >= threshold;

    if (substantiated) {
      steps.push(
        step(
          "graph",
          "Wallet graph",
          "FLAG",
          `${linkCount} discovered link${linkCount === 1 ? "" : "s"} · noisy-OR risk ${score.toFixed(2)} ≥ ${threshold.toFixed(2)}`,
        ),
        step("challenge", "Disclosure challenge", "FLAG", "Filed by Aegis Watch · evidence attached"),
        step("flag", "Proposal status", "FLAG", "FLAGGED — execution should not proceed"),
      );
      return finalize({
        violation: {
          code: "UndisclosedLink",
          message: `An undisclosed funding path connects the proposer to the GrowthLabs deployer. Noisy-OR risk ${score.toFixed(
            2,
          )} across ${linkCount} links; the proposal is flagged.`,
        },
        status: "FLAGGED",
        steps,
        challenge,
      });
    }

    steps.push(
      step(
        "graph",
        "Wallet graph",
        "PASS",
        `${linkCount} discovered link${linkCount === 1 ? "" : "s"} · noisy-OR risk ${score.toFixed(2)} < ${threshold.toFixed(2)}`,
      ),
      step(
        "challenge",
        "Disclosure challenge",
        "INFO",
        "Not substantiated — the graph does not reach the red threshold",
      ),
    );
    return finalize({
      violation: null,
      status: "PASSED",
      steps,
      challenge,
      messageOverride: `The disclosure challenge is not substantiated: noisy-OR risk ${score.toFixed(
        2,
      )} is below the ${threshold.toFixed(2)} red threshold across ${linkCount} link${
        linkCount === 1 ? "" : "s"
      }. This layer raises no flag.`,
    });
  }

  if (scenario.layer === "sentinel") {
    const traceFile = scenario.context.sentinel?.traceFile ?? null;
    const trace = traceFile ? TRACE_REGISTRY[traceFile] : undefined;
    const detected = trace ? traceFlagsDelegatecall(trace) : false;

    if (detected) {
      steps.push(
        step(
          "simulation",
          "Sentinel static scan",
          "FLAG",
          "DELEGATECALL detected in the simulated call tree",
        ),
        step("executor", "Executor", "INFO", "Not invoked — the simulation flags before execution"),
        step("verdict", "Verdict", "FLAG", "FLAGGED — early warning, not the on-chain guarantee"),
      );
      return finalize({
        violation: {
          code: "DelegatecallDetected",
          message:
            "Sentinel detected a DELEGATECALL inside the proposed upgrade's initialization payload. The executor has no delegatecall path, so this transaction cannot execute.",
        },
        status: "FLAGGED",
        steps,
      });
    }

    steps.push(
      step(
        "simulation",
        "Sentinel static scan",
        trace ? "PASS" : "INFO",
        trace
          ? "No DELEGATECALL found in the simulated call tree"
          : `No trace available for ${traceFile ?? "this scenario"} — simulation cannot substantiate a flag`,
      ),
      step("executor", "Executor", "INFO", "Falling through to the executor checks"),
    );
  }

  if (scenario.context.chainId !== scenario.context.expectedChainId) {
    steps.push(
      step(
        "chain",
        "Chain check",
        "FAIL",
        `Commitment chain ${scenario.context.expectedChainId}; submitted on ${scenario.context.chainId}`,
      ),
    );
    return finalize({
      violation: {
        code: "WrongChain",
        message: `The commitment was issued for chain ${scenario.context.expectedChainId}, but the transaction was submitted on chain ${scenario.context.chainId}.`,
        args: [BigInt(scenario.context.chainId), BigInt(scenario.context.expectedChainId)],
      },
      status: "REJECTED",
      steps,
    });
  }
  steps.push(step("chain", "Chain check", "PASS", `chain ${scenario.context.chainId}`));

  if (scenario.context.submittedVersion !== scenario.context.latestVersion) {
    steps.push(
      step(
        "version",
        "Version check",
        "FAIL",
        `Submitted v${scenario.context.submittedVersion}; latest v${scenario.context.latestVersion}`,
      ),
    );
    return finalize({
      violation: {
        code: "StaleVersion",
        message: `Version ${scenario.context.submittedVersion} was superseded by version ${scenario.context.latestVersion}.`,
        args: [BigInt(scenario.context.submittedVersion), BigInt(scenario.context.latestVersion)],
      },
      status: "REJECTED",
      steps,
    });
  }
  steps.push(
    step("version", "Version check", "PASS", `v${scenario.context.submittedVersion} is current`),
  );

  if (scenario.context.executed) {
    steps.push(step("executed", "Executed flag", "FAIL", "This version already executed"));
    return finalize({
      violation: {
        code: "AlreadyExecuted",
        message: `Version ${scenario.context.submittedVersion} already executed.`,
        args: [BigInt(scenario.context.submittedVersion)],
      },
      status: "REJECTED",
      steps,
    });
  }
  steps.push(step("executed", "Executed flag", "PASS", "Not yet executed"));

  if (scenario.context.now < scenario.context.eta) {
    steps.push(
      step(
        "timelock",
        "Timelock",
        "FAIL",
        `Submitted ${scenario.context.eta - scenario.context.now}s before the timelock elapsed`,
      ),
    );
    return finalize({
      violation: {
        code: "TimelockNotElapsed",
        message: `The timelock has not elapsed. ${scenario.context.eta - scenario.context.now} seconds remain.`,
        args: [BigInt(scenario.context.now), BigInt(scenario.context.eta)],
      },
      status: "REJECTED",
      steps,
    });
  }
  steps.push(step("timelock", "Timelock", "PASS", "48h timelock elapsed"));

  const nativeValue = submittedCalls.find((call) => call.value > 0n);
  if (nativeValue) {
    steps.push(step("value", "Native value", "FAIL", "Transaction carries native value"));
    return finalize({
      violation: {
        code: "ValueNotAllowed",
        message: `The transaction carries ${nativeValue.value.toString()} wei of native value, which this proposal does not authorize.`,
        args: [nativeValue.value],
      },
      status: "REJECTED",
      steps,
    });
  }
  steps.push(step("value", "Native value", "PASS", "No native value"));

  const rules = compileRules(context.intent);
  const ruleViolation = checkRules(submittedCalls, submitted, rules);

  steps.push(
    ruleViolation
      ? step("rules", "Committed rules", "FAIL", ruleViolation.message)
      : step(
          "rules",
          "Committed rules",
          "PASS",
          `${submittedCalls.length} call(s) matched the committed rules`,
        ),
  );

  let violation = ruleViolation;

  if (violation) {
    steps.push(step("reentrancy", "Re-entrancy probe", "INFO", "Not reached — rule check failed"));
  } else if (scenario.context.recipientBehavior === "REENTRANT") {
    steps.push(
      step(
        "reentrancy",
        "Re-entrancy probe",
        "FAIL",
        "Recipient contract attempted a re-entrant call",
      ),
    );
    violation = {
      code: "ReentrancyDetected",
      message:
        "The recipient contract attempted a re-entrant call during the transfer. The on-chain guard would revert the whole transaction.",
    };
  } else {
    steps.push(step("reentrancy", "Re-entrancy probe", "PASS", "No re-entrant behaviour observed"));
  }

  const spent = transferSpend(submittedCalls, submitted);
  const budget = transferBudget(rules);
  if (!violation && spent > budget) {
    steps.push(
      step(
        "budget",
        "Post-condition: spend budget",
        "FAIL",
        `Submitted ${formatTokenAmount(spent)} USDC; committed transfer budget is ${formatTokenAmount(budget)} USDC`,
      ),
    );
    violation = {
      code: "PostConditionViolated",
      message: `Cumulative transfer amount ${formatTokenAmount(
        spent,
      )} USDC exceeds the committed transfer budget ${formatTokenAmount(budget)} USDC.`,
      args: [keccak256(toBytes("cumulative-transfer-spend"))],
    };
  } else {
    steps.push(
      step(
        "budget",
        "Post-condition: spend budget",
        "PASS",
        `${formatTokenAmount(spent)} of ${formatTokenAmount(
          budget,
        )} USDC committed transfer budget (allowances excluded)`,
      ),
    );
  }

  steps.push(
    commitmentMatched
      ? step("commitment", "Commitment match", "PASS", "Submitted commitment equals the approved commitment")
      : step(
          "commitment",
          "Commitment match",
          "FAIL",
          "Submitted commitment differs from the approved commitment",
        ),
  );

  if (!violation && !commitmentMatched) {
    violation = {
      code: "CommitmentMismatch",
      message: "The submitted bundle hashes to a different commitment than the approved intent.",
      args: [approvedCommitment, submittedCommitment],
    };
  }

  if (violation) {
    steps.push(
      step(
        "verdict",
        "Verdict",
        "FAIL",
        `REJECTED — ${CODE_LABELS[violation.code] ?? violation.code}`,
      ),
    );
    return finalize({ violation, status: "REJECTED", steps });
  }

  steps.push(step("verdict", "Verdict", "PASS", "PASSED — executed as committed"));
  return finalize({ violation: null, status: "PASSED", steps });
}
