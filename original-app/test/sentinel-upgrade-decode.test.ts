import { expect } from "chai";
import { ethers } from "ethers";
import { buildViolationReport } from "../sentinel/report";
import { decodeAction } from "../sentinel/decode";
import type { SimulationResult } from "../sentinel/simulate";
import type { Action } from "../packages/shared/hash";
import reports from "../packages/shared/fixtures/sentinel-reports.json";
import appReports from "../app/lib/mocks/sentinel-reports.json";
import sentinelFindings from "../packages/shared/sentinel-findings.json";

describe("Sentinel · upgradeTo rendering", () => {
  it("decodes the scenario 3 calldata to its new implementation argument", () => {
    const scenario = reports.find((item) => item.scenarioId === 3);
    expect(scenario, "scenario 3 report").to.exist;

    const submitted = scenario!.violationReport.submitted[0];
    const submittedArgs = submitted.args as Record<string, string>;
    const newImplementation = submittedArgs.newImplementation;
    const action: Action = {
      target: submitted.target,
      value: 0n,
      data: scenario!.violationReport.evidence.calldata,
    };
    const labels = {
      [submitted.target.toLowerCase()]: submitted.targetLabel,
      [newImplementation.toLowerCase()]: "MaliciousImpl",
    };

    const decoded = decodeAction(action, undefined, labels);
    expect(decoded.humanText).to.include(
      "upgradeTo(0x2279B7A0…eBe6) on TreasuryProxy"
    );
    expect(decoded.args.newImplementation).to.equal(newImplementation);
    expect(decoded.args.newImplementation).to.not.equal(action.target);
    expect(decoded.argumentLabels?.newImplementation).to.equal("MaliciousImpl");
    expect(decoded.humanText).to.not.include("upgradeTo(0x8A791620");

    const simulation = {
      proposalId: 8n,
      commitment: ethers.ZeroHash,
      commitmentMismatch: false,
      success: false,
      reverted: true,
      staticScan: undefined,
      staticScans: [],
      diffReport: {
        timestamp: new Date(0).toISOString(),
        hasViolations: false,
        violations: [],
        summary: "No state diff",
      },
      shouldHalt: true,
      haltReason: "Upgrade hidden behind parameter-tuning language",
      actions: [action],
      rules: [],
    } as unknown as SimulationResult;

    const report = buildViolationReport(simulation, {
      proposalId: "8",
      scenarioId: "3",
      proposalSaid: "Routine parameter tuning of the fee module.",
      targetLabels: labels,
      layer: "sentinel",
      status: "FLAGGED",
    });

    expect(report.submitted[0].humanText).to.include(
      "upgradeTo(0x2279B7A0…eBe6) on TreasuryProxy"
    );
    expect(report.submitted[0].args.newImplementation).to.equal(newImplementation);
  });

  it("explains the scenario 3 halt with its Sentinel finding, not an executor error", () => {
    const scenario = reports.find((item) => item.scenarioId === 3);
    expect(scenario, "scenario 3 report").to.exist;

    const message = scenario!.violationReport.violatedConstraint.message;
    expect(scenario!.violationReport.layer).to.equal("sentinel");
    expect(scenario!.violationReport.violatedConstraint.code).to.equal(
      "DangerousBytecode"
    );
    expect(message.toLowerCase()).to.match(/bytecode|opcode/);
    expect(message).to.not.include("Unauthorized Target");
    expect(
      (sentinelFindings as Record<string, { explanation?: string }>)
        .DangerousBytecode?.explanation
    ).to.match(/DELEGATECALL/);

    const appScenario = appReports.find((item) => item.scenarioId === 3);
    expect(appScenario?.violationReport.violatedConstraint.message).to.equal(
      message
    );
  });
});
