import type { DecodedAction } from "../packages/shared/schemas";
import type { RunResult } from "../reference/types";

const REPORT_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #f3f0e9;
    color: #171b1f;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    line-height: 1.55;
  }
  .page { max-width: 940px; margin: 0 auto; padding: 44px 36px 64px; }
  .topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
  .brand { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 13px; font-weight: 700; letter-spacing: 0.18em; }
  .brand span { color: #a56a00; }
  .kicker { margin-top: 4px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; color: #777065; }
  .stamp { border: 1px solid #d8a13c; background: #fff6df; color: #7c5300; padding: 5px 8px; font-family: ui-monospace, monospace; font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; }
  .accent { height: 4px; background: #d8a13c; margin: 20px 0 28px; }
  h1 { margin: 0; font-size: 36px; line-height: 1.08; letter-spacing: -0.025em; }
  .subtitle { margin-top: 8px; color: #625c52; font-size: 13px; }
  .status { display: inline-flex; align-items: center; gap: 8px; margin-top: 18px; padding: 8px 12px; border: 1px solid; font-family: ui-monospace, monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
  .status.rejected { color: #8d2020; border-color: #d16a6a; background: #fdeeee; }
  .status.flagged { color: #7c5300; border-color: #d8a13c; background: #fff6df; }
  .status.passed { color: #19633f; border-color: #6db592; background: #ecf8f2; }
  .message { margin-top: 14px; max-width: 760px; font-size: 15px; }
  h2 { margin: 30px 0 10px; font-family: ui-monospace, monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #6f675b; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .card { background: #fffdf8; border: 1px solid #ded7c9; padding: 16px; }
  .card-title { margin: 0 0 8px; font-size: 13px; font-weight: 700; }
  .quote { border-left: 3px solid #d8a13c; padding: 3px 0 3px 16px; font-size: 18px; line-height: 1.45; }
  .quote small { display: block; margin-top: 8px; color: #7a7266; font-size: 10px; font-family: ui-monospace, monospace; }
  .mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10.5px; word-break: break-all; }
  .pre { margin: 8px 0 0; padding: 10px; background: #f8f5ee; border: 1px solid #e5dfd2; white-space: pre-wrap; overflow-wrap: anywhere; }
  .action { border: 1px solid #e5dfd2; background: #fffdf8; padding: 10px 12px; margin: 8px 0; }
  .action-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .fn { font-family: ui-monospace, monospace; font-size: 12px; font-weight: 700; }
  .tag { color: #7a7266; font-family: ui-monospace, monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; white-space: nowrap; }
  .args { margin-top: 5px; color: #5f594f; font-size: 10.5px; }
  .nested { margin-left: 16px; border-left: 1px solid #e5dfd2; padding-left: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; background: #fffdf8; }
  th, td { text-align: left; vertical-align: top; border-bottom: 1px solid #e5dfd2; padding: 8px 7px; }
  th { font-family: ui-monospace, monospace; font-size: 8.5px; letter-spacing: 0.1em; text-transform: uppercase; color: #7a7266; }
  .step-status { font-family: ui-monospace, monospace; font-size: 9px; font-weight: 700; }
  .pass { color: #19633f; } .fail { color: #a22b2b; } .flag { color: #8a5a00; } .info { color: #315e73; }
  .note { background: #fff6df; border: 1px solid #e1c88f; padding: 12px 14px; font-size: 12px; }
  .footer { margin-top: 36px; border-top: 1px solid #d8d0c1; padding-top: 14px; color: #7a7266; font-size: 10px; }
  .signature { margin-top: 24px; padding: 18px; border: 1px solid #ded7c9; background: #fffdf8; font-size: 15px; line-height: 1.5; }
  .muted { color: #7a7266; }
  @media (max-width: 720px) {
    .page { padding: 26px 16px 40px; }
    .grid { grid-template-columns: 1fr; }
    h1 { font-size: 28px; }
    .topbar { flex-direction: column; gap: 10px; }
  }
  @media print {
    body { background: #fff; }
    .page { max-width: none; padding: 18px; }
    .card, .action, tr { break-inside: avoid; }
    .stamp { border-color: #999; color: #333; background: #fff; }
  }
`;

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function escapeJson(value: unknown): string {
  return escapeHtml(JSON.stringify(value, null, 2));
}

function decodedTree(actions: DecodedAction[]): string {
  if (actions.length === 0) return '<p class="muted">No decoded call.</p>';
  return actions
    .map((action) => {
      const argEntries = Object.entries(action.args)
        .map(([key, value]) => `${escapeHtml(key)}=${escapeHtml(value)}`)
        .join(" · ");
      const nested = action.nested.length > 0 ? decodedTree(action.nested) : "";
      return `
        <div class="action">
          <div class="action-head">
            <span class="fn">${escapeHtml(action.function)}</span>
            <span class="tag">${escapeHtml(action.targetLabel)}</span>
          </div>
          <div class="args">${escapeHtml(action.humanText)}</div>
          ${argEntries ? `<div class="args mono">${argEntries}</div>` : ""}
          ${nested ? `<div class="nested">${nested}</div>` : ""}
        </div>`;
    })
    .join("");
}

function stepStatusClass(status: string): string {
  return status === "PASS" ? "pass" : status === "FAIL" ? "fail" : status === "FLAG" ? "flag" : "info";
}

function evidenceRows(run: RunResult): string {
  const rows: [string, string | null][] = [
    ["Approved commitment", run.report.evidence.commitment],
    ...(run.layer === "executor"
      ? ([["Submitted commitment", run.submittedCommitment]] as [string, string][])
      : []),
    ["Calldata hash", run.report.evidence.calldataHash],
    ["Revert data", run.report.evidence.revertData],
    ["Transaction hash", run.report.evidence.txHash ?? "not executed"],
    ["Trace reference", run.report.evidence.traceRef ?? "—"],
  ];

  return rows
    .map(
      ([label, value]) => `
        <tr>
          <th>${escapeHtml(label)}</th>
          <td class="mono">${escapeHtml(value ?? "—")}</td>
        </tr>`,
    )
    .join("");
}

export function buildReportHtml(run: RunResult, proposalId: string, generatedAt: string): string {
  const report = run.report;
  const statusClass = report.status.toLowerCase();
  const reportLabel = report.status === "PASSED" ? "execution record" : "violation report";
  const constraint = report.violatedConstraint;
  const constraintSection = constraint
    ? run.layer === "executor"
      ? `
      <h2>Violated constraint</h2>
      <div class="card">
        <div class="mono" style="font-weight:700;color:#8d2020">${escapeHtml(constraint.code)}</div>
        <p style="margin:6px 0 10px">${escapeHtml(constraint.message)}</p>
        <table>
          <tr><th>Error selector</th><td class="mono">${escapeHtml(constraint.selector ?? "—")}</td></tr>
          <tr><th>Revert data</th><td class="mono">${escapeHtml(run.revertData)}</td></tr>
        </table>
      </div>`
      : `
      <h2>Layer flag</h2>
      <div class="card">
        <div class="mono" style="font-weight:700;color:#8a5a00">${escapeHtml(constraint.code)}</div>
        <p style="margin:6px 0 10px">${escapeHtml(constraint.message)}</p>
        <div class="note">This is a ${escapeHtml(run.layer)} flag, not an executor revert. No transaction was broadcast; there is no custom-error payload for this layer.</div>
      </div>`
    : `
      <h2>Execution record</h2>
      <div class="card">
        <p class="card-title">No constraint violated</p>
        <p>The submitted bundle matches the commitment and all post-conditions hold.</p>
        <p class="mono muted">Transaction hash: ${escapeHtml(run.txHash ?? "not executed")}</p>
      </div>`;

  const challengeSection = run.challenge
    ? `
      <h2>Disclosure challenge payload</h2>
      <pre class="pre mono">${escapeJson(run.challenge.payload)}</pre>`
    : "";

  const notesSection =
    run.notes.length > 0
      ? `<h2>Notes</h2><div class="note">${run.notes.map((note) => `<p style="margin:4px 0">${escapeHtml(note)}</p>`).join("")}</div>`
      : "";

  const steps = run.steps
    .map(
      (step) => `
        <tr>
          <td class="step-status ${stepStatusClass(step.status)}">${escapeHtml(step.status)}</td>
          <td><strong>${escapeHtml(step.label)}</strong></td>
          <td>${escapeHtml(step.detail)}</td>
        </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(proposalId)} · ${escapeHtml(run.scenario.title)} · Aegis IntentLock</title>
  <style>${REPORT_CSS}</style>
</head>
<body>
  <main class="page">
    <div class="topbar">
      <div>
        <div class="brand">AEGIS <span>/ INTENTLOCK</span></div>
        <div class="kicker">Decision integrity console · ${reportLabel}</div>
      </div>
      <div class="stamp">Reference model · no chain</div>
    </div>
    <div class="accent"></div>

    <h1>${escapeHtml(run.scenario.title)}</h1>
    <div class="subtitle">
      ${escapeHtml(proposalId)} · scenario ${escapeHtml(run.scenario.id)} · layer ${escapeHtml(report.layer)} ·
      generated ${escapeHtml(new Date(generatedAt).toUTCString())}
    </div>
    <div class="status ${statusClass}">${escapeHtml(report.status)} · ${escapeHtml(run.code)}</div>
    <p class="message">${escapeHtml(run.message)}</p>

    <div class="grid" style="margin-top:22px">
      <div class="card">
        <div class="kicker">The proposal said</div>
        <div class="quote">${escapeHtml(report.proposalSaid)}
          <small>scenario: ${escapeHtml(run.scenario.id)} · proposal text</small>
        </div>
      </div>
      <div class="card">
        <div class="kicker">The submitted call does</div>
        ${decodedTree(report.submitted)}
      </div>
    </div>

    <h2>Committed actions</h2>
    ${decodedTree(report.approved)}

    <h2>Reference checks · ${run.steps.length} gates</h2>
    <table>
      <thead><tr><th>Status</th><th>Gate</th><th>Observed result</th></tr></thead>
      <tbody>${steps}</tbody>
    </table>

    ${constraintSection}

    <h2>Evidence</h2>
    <table>
      <tbody>${evidenceRows(run)}</tbody>
    </table>
    <h2>Submitted calldata</h2>
    <pre class="pre mono">${escapeHtml(run.submittedCalldata)}</pre>
    <p class="muted" style="font-size:10px">Raw bundle bytes, as decoded above.</p>

    ${challengeSection}
    ${notesSection}

    <h2>What this report is</h2>
    <div class="note">
      Generated deterministically from the Aegis IntentLock TypeScript reference executor. No chain
      was running and no transaction was broadcast. The report demonstrates the commitment, decoding
      and rule checks; Solidity enforcement and byte-parity are still <strong>TEST_REQUIRED</strong>
      (Person A). Wallet graph data elsewhere in the demo is simulated.
    </div>

    <div class="signature">
      <strong>Voting transparency isn&apos;t informed consent.</strong> We made the vote bind to the
      exact action, and we make the evidence, the conflicts, and the execution verifiable.
    </div>

    <div class="footer">
      ${escapeHtml(proposalId)} · ${escapeHtml(run.scenario.id)} · AegisDAO IntentLock ·
      reference model · generated ${escapeHtml(generatedAt)}
    </div>
  </main>
</body>
</html>`;
}

export function buildReportJson(run: RunResult, proposalId: string, generatedAt: string): string {
  return JSON.stringify(
    {
      exportedBy: "AegisDAO IntentLock",
      exportedAt: generatedAt,
      proposalId,
      scenario: run.scenario,
      layer: run.layer,
      status: run.status,
      code: run.code,
      label: run.label,
      message: run.message,
      steps: run.steps,
      approved: run.report.approved,
      submitted: run.report.submitted,
      violatedConstraint: run.report.violatedConstraint,
      evidence: run.report.evidence,
      notes: run.notes,
      challenge: run.challenge ?? null,
      report: run.report,
      disclaimer:
        "TypeScript reference model. No chain was running and no transaction was broadcast. Solidity enforcement and hash parity are TEST_REQUIRED.",
    },
    null,
    2,
  );
}

export function reportFilename(proposalId: string, run: RunResult, extension: "html" | "json"): string {
  const safe = `${proposalId}-${run.scenario.id}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `aegis-${safe}.${extension}`;
}

export function downloadText(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
