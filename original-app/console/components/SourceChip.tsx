"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, FileText, ShieldCheck, X } from "lucide-react";
import manifestJson from "@/packages/shared/fixtures/evidence-manifest.json";
import { verifyDocument, type EvidenceManifest } from "@/packages/shared/evidence";
import type { SourceRef } from "@/packages/shared/schemas";

const manifest = manifestJson as unknown as EvidenceManifest;

type Verification = {
  hashMatches: boolean;
  proofValid: boolean;
  computedHash: string;
  root: string;
};

export function SourceChip({ source, compact = false }: { source: SourceRef; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [verification, setVerification] = useState<Verification | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const doc = manifest.docs.find((candidate) => candidate.key === source.docKey);

  function openSource() {
    setVerification(null);
    setOpen(true);
  }

  function verify() {
    if (!doc) return;
    setVerification(verifyDocument(doc, manifest));
  }

  const start = doc ? doc.text.indexOf(source.quote) : -1;

  return (
    <>
      <button
        type="button"
        onClick={openSource}
        className="inline-flex max-w-full items-center gap-1.5 rounded border border-edge bg-white/2 px-1.5 py-1 font-mono text-[9px] uppercase tracking-[0.06em] text-dim transition-colors hover:border-signal/40 hover:text-signal"
        title={`Open source: ${source.docKey} · ${source.section}`}
      >
        <FileText size={10} strokeWidth={1.8} className="shrink-0" />
        <span className="truncate">
          {compact ? doc?.title ?? source.docKey : `source · ${doc?.title ?? source.docKey}`}
        </span>
        {!compact ? <span className="shrink-0 text-faint">{source.section}</span> : null}
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/75 p-3 backdrop-blur-sm sm:p-6"
              onClick={() => setOpen(false)}
              role="presentation"
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label={`Source document: ${doc?.title ?? source.docKey}`}
                onClick={(event) => event.stopPropagation()}
                className="panel my-6 w-full max-w-3xl overflow-hidden shadow-2xl fade-up"
              >
                <div className="flex items-start justify-between gap-4 border-b border-edge px-5 py-4">
                  <div>
                    <div className="mono-label mb-1.5">Anchored source document</div>
                    <h2 className="text-[16px] font-medium text-body">{doc?.title ?? source.docKey}</h2>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span className="chip">{doc?.filename ?? source.docKey}</span>
                      <span className="chip">page {source.page}</span>
                      <span className="chip">{source.section}</span>
                      <span className="chip">{doc?.mime ?? "text/plain"}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded border border-edge p-1.5 text-dim hover:border-edge2 hover:text-body"
                    aria-label="Close source"
                  >
                    <X size={14} strokeWidth={1.8} />
                  </button>
                </div>

                <div className="max-h-[46vh] overflow-y-auto border-b border-edge bg-ink/40 px-5 py-4">
                  <pre className="whitespace-pre-wrap font-mono text-[11.5px] leading-[1.75] text-steel">
                    {doc ? (
                      start >= 0 ? (
                        <>
                          {doc.text.slice(0, start)}
                          <mark className="source-mark">{source.quote}</mark>
                          {doc.text.slice(start + source.quote.length)}
                        </>
                      ) : (
                        doc.text
                      )
                    ) : (
                      "Document not found in the local evidence manifest."
                    )}
                  </pre>
                </div>

                <div className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="mono-label">Verify source</div>
                      <p className="mt-1 max-w-lg text-[11.5px] leading-relaxed text-dim">
                        Re-hash the exact document text in this browser and check its Merkle proof
                        against the anchored evidence root.
                      </p>
                    </div>
                    <button type="button" onClick={verify} className="btn btn-primary btn-sm">
                      <ShieldCheck size={12} strokeWidth={1.9} />
                      Re-hash & verify
                    </button>
                  </div>

                  {verification ? (
                    <div
                      className={`mt-4 rounded-lg border px-4 py-3 ${
                        verification.hashMatches && verification.proofValid
                          ? "border-safe/35 bg-safe/6"
                          : "border-danger/35 bg-danger/6"
                      }`}
                    >
                      <div className="flex items-center gap-2 text-[12px] font-medium">
                        {verification.hashMatches && verification.proofValid ? (
                          <>
                            <Check size={14} className="text-safe" />
                            <span className="text-safe">Hash matches anchor · Merkle proof valid</span>
                          </>
                        ) : (
                          <>
                            <X size={14} className="text-danger" />
                            <span className="text-danger">Verification failed</span>
                          </>
                        )}
                      </div>
                      <div className="mt-3 grid gap-2">
                        <div className="grid gap-1">
                          <span className="mono-label">re-computed locally</span>
                          <code className="hash">{verification.computedHash}</code>
                        </div>
                        <div className="grid gap-1">
                          <span className="mono-label">anchored in manifest</span>
                          <code className="hash">{doc?.docHash}</code>
                        </div>
                        <div className="grid gap-1">
                          <span className="mono-label">evidence root</span>
                          <code className="hash">{verification.root}</code>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[10.5px] text-faint">
                      <span className="chip">not verified this session</span>
                      <span>
                        proof length {doc ? manifest.proofs[doc.key]?.length ?? 0 : 0} · bytes{" "}
                        {doc?.bytes ?? 0}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
