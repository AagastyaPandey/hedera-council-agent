import { describe, expect, it } from "vitest";
import {
  buildReportHtml,
  buildReportJson,
  escapeHtml,
  reportFilename,
} from "../lib/report-export";
import { getDemo } from "../lib/demo";

const demo = getDemo();
const generatedAt = "2026-10-25T12:00:00.000Z";

describe("downloadable report", () => {
  it("builds a self-contained HTML report with the quote, decoded call, constraint and evidence", () => {
    const html = buildReportHtml(demo.mainRun, demo.proposal.id, generatedAt);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("SelectorNotAuthorized");
    expect(html).toContain("0x1420732b");
    expect(html).toContain("We will align the treasury implementation");
    expect(html).toContain("TreasuryProxy");
    expect(html).toContain(demo.mainRun.approvedCommitment);
    expect(html).toContain("reference model");
    expect(html).toContain("TEST_REQUIRED");
  });

  it("escapes report text instead of injecting markup", () => {
    const run = structuredClone(demo.mainRun);
    run.report.proposalSaid = '<script>alert("x")</script>';
    const html = buildReportHtml(run, demo.proposal.id, generatedAt);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(escapeHtml("<b>&</b>")).toBe("&lt;b&gt;&amp;&lt;/b&gt;");
  });

  it("exports a machine-readable JSON bundle", () => {
    const json = JSON.parse(buildReportJson(demo.mainRun, demo.proposal.id, generatedAt));
    expect(json.scenario.id).toBe("03-jargon-upgrade");
    expect(json.report.violatedConstraint.code).toBe("SelectorNotAuthorized");
    expect(json.evidence.commitment).toBe(demo.mainRun.approvedCommitment);
    expect(json.exportedAt).toBe(generatedAt);
    expect(json.disclaimer).toContain("No chain");
  });

  it("produces a safe deterministic filename", () => {
    expect(reportFilename(demo.proposal.id, demo.mainRun, "html")).toBe(
      "aegis-aip-042-03-jargon-upgrade.html",
    );
    expect(reportFilename(demo.proposal.id, demo.mainRun, "json")).toBe(
      "aegis-aip-042-03-jargon-upgrade.json",
    );
  });

  it("labels a sentinel report as a layer flag rather than an executor revert", () => {
    const html = buildReportHtml(
      demo.runs["06-delegatecall-payload"],
      demo.proposal.id,
      generatedAt,
    );
    expect(html).toContain("Layer flag");
    expect(html).toContain("DelegatecallDetected");
    expect(html).not.toContain("Error selector");
  });
});
