"use client";

import { AlertTriangle, ArrowRight, CornerDownRight } from "lucide-react";
import { explorerAddressUrl } from "@/lib/explorer";
import { cn, shortAddress } from "@/lib/format";
import type { DecodedAction } from "@/lib/types";

export function ActionTree({
  actions,
  constraintCode,
  outcome,
  depth = 0,
}: {
  actions: DecodedAction[];
  constraintCode: string;
  outcome: string;
  depth?: number;
}) {
  if (actions.length === 0) {
    return <p className="text-xs text-slate-500">No submitted actions.</p>;
  }

  return (
    <ul className={cn("space-y-2", depth > 0 && "border-l border-slate-800 pl-4")}>
      {actions.map((action, index) => {
        const danger = isDangerous(action, constraintCode, outcome);
        return (
          <li key={`${action.target}-${action.function}-${index}`}>
            <div
              className={cn(
                "rounded-lg border px-3 py-2 transition-colors duration-150",
                danger
                  ? "border-red-900/70 bg-red-950/25"
                  : "border-slate-800 bg-slate-950/40"
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                {depth > 0 ? (
                  <CornerDownRight
                    size={13}
                    className={danger ? "text-red-400" : "text-slate-500"}
                  />
                ) : danger ? (
                  <AlertTriangle size={13} className="text-red-400" />
                ) : (
                  <ArrowRight size={13} className="text-cyan-300/80" />
                )}
                <span
                  className={cn(
                    "text-xs font-medium",
                    danger ? "text-red-200" : "text-slate-200"
                  )}
                >
                  {action.targetLabel}
                </span>
                {action.targetLabel !== action.target ? (
                  explorerAddressUrl(action.target) ? (
                    <a
                      href={explorerAddressUrl(action.target)!}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[10px] text-slate-500 underline decoration-slate-800 underline-offset-2 hover:text-cyan-300"
                      title={action.target}
                    >
                      {shortAddress(action.target)}
                    </a>
                  ) : (
                    <span className="font-mono text-[10px] text-slate-500">
                      {shortAddress(action.target)}
                    </span>
                  )
                ) : null}
              </div>

              <p
                className={cn(
                  "mt-1 break-words font-mono text-[11px] leading-relaxed",
                  danger ? "text-red-300" : "text-cyan-300"
                )}
              >
                {action.humanText}
              </p>

              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded border px-1.5 py-0.5 font-mono text-[10px]",
                    danger
                      ? "border-red-900 text-red-400"
                      : "border-slate-800 text-slate-400"
                  )}
                >
                  {action.function}
                </span>
                {Object.entries(action.argumentLabels ?? {})
                  .filter(([name, label]) => label !== action.args[name])
                  .map(([name, label]) => (
                    <span
                      key={name}
                      className="font-mono text-[10px] text-slate-500"
                    >
                      {name} → <span className="text-slate-300">{label}</span>
                    </span>
                  ))}
                {danger ? (
                  <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-red-400">
                    outside committed intent
                  </span>
                ) : null}
              </div>
            </div>

            {action.nested.length > 0 ? (
              <div className="mt-2">
                <ActionTree
                  actions={action.nested}
                  constraintCode={constraintCode}
                  outcome={outcome}
                  depth={depth + 1}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function isDangerous(
  action: DecodedAction,
  constraintCode: string,
  outcome: string
): boolean {
  if (outcome === "Success") return false;
  const fn = action.function.toLowerCase();

  if (
    ["UnauthorizedRecipient", "ExceedsSpendLimit", "UnlimitedApprovalNotCommitted"].includes(
      constraintCode
    )
  ) {
    return fn.startsWith("transfer") || fn.startsWith("approve");
  }

  if (constraintCode === "ActionExecutionFailed") return true;

  if (
    [
      "DangerousBytecode",
      "SelectorNotAllowed",
      "UnauthorizedTarget",
      "ProposalNotInState",
      "CommitmentMismatch",
    ].includes(constraintCode)
  ) {
    if (
      /^(upgradeto|executearbitrary|backdoordrain|transferownership)/.test(fn)
    ) {
      return true;
    }
    if (
      fn.startsWith("multicall") &&
      action.nested.some((child) => isDangerous(child, constraintCode, outcome))
    ) {
      return true;
    }
  }

  return false;
}
