import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import {
  buildViolationReport,
  hashViolationReport,
} from "./report";
import type { ReportMeta, ViolationReport } from "./report";
import type { SimulationResult } from "./simulate";

export type { DecodedAction } from "./decode";
export type { ReportMeta, ViolationReport } from "./report";
export { buildViolationReport, hashViolationReport, stableStringify } from "./report";

export interface HaltReceipt {
  commitment: string;
  reportHash: string;
  txHash: string;
  blockNumber: number;
  report: ViolationReport;
}

/**
 * Guardian intervention: halt a queued proposal after the Sentinel detected
 * a violation. The guardian can only halt — never execute or substitute.
 */
export async function haltProposal(
  executor: any,
  guardianSigner: any,
  commitment: string,
  reportOrSimulation: ViolationReport | SimulationResult,
  meta: ReportMeta = {}
): Promise<HaltReceipt> {
  const simulation = isSimulation(reportOrSimulation)
    ? reportOrSimulation
    : undefined;
  const report = simulation
    ? buildViolationReport(simulation, meta)
    : (reportOrSimulation as ViolationReport);

  if (!report.evidence.commitment) {
    report.evidence.commitment = commitment;
  }

  const reportHash = hashViolationReport(report);

  if (meta.persist) {
    persistEvidence(report, simulation);
  }

  console.log(`SENTINEL GUARDIAN HALT (halt-only authority — no execution)`);
  console.log(`  Commitment:  ${commitment}`);
  console.log(`  Report hash: ${reportHash}`);
  console.log(`  Constraint:  ${report.violatedConstraint.code}`);

  const tx = await executor.connect(guardianSigner).halt(commitment, reportHash);
  const receipt = await tx.wait();
  if (!receipt) {
    throw new Error("Halt transaction was not mined");
  }

  console.log(
    `  Proposal halted in block ${receipt.blockNumber} (tx: ${receipt.hash})`
  );

  return {
    commitment,
    reportHash,
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    report,
  };
}

function isSimulation(
  value: ViolationReport | SimulationResult
): value is SimulationResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "diffReport" in value &&
    "shouldHalt" in value
  );
}

function persistEvidence(
  report: ViolationReport,
  simulation: SimulationResult | undefined
): void {
  const traceRef = report.evidence.traceRef;
  if (!traceRef) return;

  try {
    const absolute = path.resolve(process.cwd(), traceRef);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    const payload = {
      report,
      simulation: simulation
        ? {
            proposalId: simulation.proposalId,
            commitment: simulation.commitment,
            commitmentMismatch: simulation.commitmentMismatch,
            success: simulation.success,
            reverted: simulation.reverted,
            revertReason: simulation.revertReason,
            revertData: simulation.revertData,
            txHash: simulation.txHash,
            shouldHalt: simulation.shouldHalt,
            haltReason: simulation.haltReason,
            staticScans: simulation.staticScans,
            diffReport: simulation.diffReport,
            trace: simulation.trace,
          }
        : undefined,
    };
    fs.writeFileSync(
      absolute,
      JSON.stringify(
        payload,
        (_key, value) => (typeof value === "bigint" ? value.toString() : value),
        2
      ),
      "utf8"
    );
  } catch {
    // Evidence persistence is best-effort; the on-chain hash is authoritative.
  }
}
