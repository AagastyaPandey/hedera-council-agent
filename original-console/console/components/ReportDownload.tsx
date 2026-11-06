"use client";

import { Download, FileJson } from "lucide-react";
import {
  buildReportHtml,
  buildReportJson,
  downloadText,
  reportFilename,
} from "@/lib/report-export";
import type { RunResult } from "@/reference/types";

export function ReportDownload({
  run,
  proposalId,
  className = "",
}: {
  run: RunResult;
  proposalId: string;
  className?: string;
}) {
  function exportHtml() {
    const generatedAt = new Date().toISOString();
    downloadText(
      reportFilename(proposalId, run, "html"),
      buildReportHtml(run, proposalId, generatedAt),
      "text/html;charset=utf-8",
    );
  }

  function exportJson() {
    const generatedAt = new Date().toISOString();
    downloadText(
      reportFilename(proposalId, run, "json"),
      buildReportJson(run, proposalId, generatedAt),
      "application/json;charset=utf-8",
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={exportHtml}
        className="btn btn-primary btn-sm"
        title="Download a self-contained HTML report"
      >
        <Download size={12} strokeWidth={1.9} />
        Download report
      </button>
      <button
        type="button"
        onClick={exportJson}
        className="btn btn-sm"
        title="Download the machine-readable report JSON"
      >
        <FileJson size={12} strokeWidth={1.9} />
        JSON
      </button>
    </div>
  );
}
