"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Gavel, MonitorPlay, X } from "lucide-react";

const STEPS = [
  {
    path: "/trail",
    label: "Verdict",
    title: "The transaction does not match the vote",
    instruction: "Point at the blocked banner and the four stages. This is the whole story in one screen.",
  },
  {
    path: "/intent",
    label: "Intent",
    title: "Resolve the ambiguity",
    instruction: "Click “Prefill sourced”, then “Confirm intent”. Watch the intent, content and commitment hashes match v3.",
  },
  {
    path: "/graph",
    label: "Conflict",
    title: "The disclosure is incomplete",
    instruction: "Select the Nova Ops → GrowthLabs Deployer edge, then open the challenge payload.",
  },
  {
    path: "/vote",
    label: "Vote",
    title: "Read the brief, then bind the vote",
    instruction: "Acknowledge the brief, choose For, and cast the vote. The receipt records the brief hash.",
  },
  {
    path: "/arena",
    label: "Arena",
    title: "Run the attack",
    instruction: "Run 00-benign-grant, then 03-jargon-upgrade. Point at the layer badge on each verdict.",
  },
  {
    path: "/arena/03-jargon-upgrade",
    label: "Report",
    title: "Jargon beside calldata",
    instruction: "Walk the evidence, then download the standalone report from the Takeaway panel.",
  },
  {
    path: "/scorecard",
    label: "Honesty",
    title: "Show the nine amber gaps",
    instruction: "Filter TEST_REQUIRED. Close on what we are not claiming.",
  },
] as const;

const LAST = STEPS.length - 1;

export function JudgeMode() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    document.body.classList.toggle("judge-open", open);
    return () => document.body.classList.remove("judge-open");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        if (step === LAST) {
          setOpen(false);
          router.push("/present");
          return;
        }
        const next = Math.min(LAST, step + 1);
        setStep(next);
        router.push(STEPS[next].path);
      }
      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        const previous = Math.max(0, step - 1);
        setStep(previous);
        router.push(STEPS[previous].path);
      }
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step, router]);

  if (pathname === "/present") return null;

  function goTo(index: number) {
    const clamped = Math.max(0, Math.min(LAST, index));
    setStep(clamped);
    router.push(STEPS[clamped].path);
  }

  function start() {
    setStep(0);
    setOpen(true);
    router.push(STEPS[0].path);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function next() {
    if (step === LAST) {
      setOpen(false);
      router.push("/present");
      return;
    }
    goTo(step + 1);
  }

  const current = STEPS[step];

  return (
    <>
      <button
        type="button"
        onClick={open ? () => setOpen(false) : start}
        aria-pressed={open}
        title={open ? "Exit judge mode" : "Start the guided judge walkthrough"}
        className={`inline-flex items-center gap-1.5 font-sans text-[11px] transition-colors ${
          open ? "text-danger" : "text-dim hover:text-body"
        }`}
      >
        <Gavel size={11} strokeWidth={1.9} />
        <span className="hidden sm:inline">
          {open ? `Judge ${String(step + 1).padStart(2, "0")}/${String(STEPS.length).padStart(2, "0")}` : "Judge mode"}
        </span>
        <span className="sm:hidden">Judge</span>
      </button>

      {open
        ? createPortal(
            <div className="fixed inset-x-0 bottom-0 z-[85] border-t border-edge bg-ink/95 backdrop-blur-md">
              <div className="relative mx-auto w-full max-w-[1480px] px-3 pb-2.5 pt-2 sm:px-5">
                <div className="absolute inset-x-0 top-0 h-[2px] bg-edge">
                  <div
                    data-testid="judge-progress"
                    className="h-full bg-danger transition-all duration-300"
                    style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
                  />
                </div>

                <div
                  className="flex flex-col gap-2 pt-2 lg:flex-row lg:items-center lg:justify-between"
                  aria-live="polite"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex shrink-0 flex-col items-center border border-danger/60 px-2 py-1 text-danger">
                      <span className="font-sans text-[9px]">judge</span>
                      <span className="font-sans text-[12px] leading-none">
                        {String(step + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="mono-label text-danger">{current.label}</span>
                        <span className="chip">{step + 1} / {STEPS.length}</span>
                      </div>
                      <div className="truncate text-[14px] font-medium text-body">{current.title}</div>
                      <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-dim">
                        {current.instruction}
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2 lg:pl-4">
                    <button
                      type="button"
                      onClick={() => goTo(step - 1)}
                      disabled={step === 0}
                      className="btn btn-sm"
                    >
                      <ArrowLeft size={11} />
                      Back
                    </button>
                    <Link
                      href="/present"
                      onClick={() => setOpen(false)}
                      className="btn btn-sm"
                      title="Open the full-screen presentation"
                    >
                      <MonitorPlay size={11} />
                      Present
                    </Link>
                    <button type="button" onClick={next} className="btn btn-primary btn-sm">
                      {step === LAST ? "Finish" : "Next"}
                      <ArrowRight size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="btn btn-sm"
                      aria-label="Exit judge mode"
                      title="Exit judge mode (Esc)"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between gap-3 border-t border-edge/60 pt-1.5">
                  <span className="hidden font-mono text-[8px] uppercase tracking-[0.08em] text-faint sm:block">
                    Alt + ← / → to move · Esc to exit
                  </span>
                  <div className="flex items-center gap-1" role="group" aria-label="Judge mode steps">
                    {STEPS.map((item, index) => (
                      <button
                        key={item.path}
                        type="button"
                        onClick={() => goTo(index)}
                        aria-label={`Open step ${index + 1}: ${item.label}`}
                        aria-current={index === step ? "step" : undefined}
                        className={`h-1 transition-all ${
                          index === step ? "w-6 bg-danger" : "w-1.5 bg-edge2 hover:bg-steel"
                        }`}
                      />
                    ))}
                  </div>
                  <span className="font-mono text-[8px] uppercase tracking-[0.08em] text-faint">
                    judge path, 7 stops
                  </span>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
