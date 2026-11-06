"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { ProvenanceTag } from "@/components/ui/ProvenanceTag";
import { DATA_MODE } from "@/lib/config";
import { cn } from "@/lib/format";
import { proposalRef } from "@/lib/proposal-naming";
import type { Proposal } from "@/lib/types";

export function ProposalListbox({
  proposals,
  selectedId,
  onSelect,
}: {
  proposals: Proposal[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);
  const listId = useId();
  const ordered = useMemo(() => {
    const live = proposals.filter((proposal) => proposal.provenance === "LIVE");
    const other = proposals.filter((proposal) => proposal.provenance !== "LIVE");
    return live.length > 0 && other.length > 0 ? [...live, ...other] : proposals;
  }, [proposals]);
  const grouped =
    DATA_MODE === "live" ||
    (ordered.some((proposal) => proposal.provenance === "LIVE") &&
      ordered.some((proposal) => proposal.provenance !== "LIVE"));
  const selected = ordered.find((proposal) => proposal.id === selectedId) ?? ordered[0];
  const selectedIndex = Math.max(
    0,
    ordered.findIndex((proposal) => proposal.id === selectedId)
  );

  useEffect(() => {
    setActiveIndex(selectedIndex);
  }, [selectedIndex]);

  useEffect(() => {
    setOpen(false);
  }, [selectedId]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  if (!selected) return null;

  const choose = (index: number) => {
    const proposal = ordered[index];
    if (!proposal) return;
    onSelect(proposal.id);
    setActiveIndex(index);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
        onClick={() => {
          setActiveIndex(selectedIndex);
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((index) => {
              if (!open) return selectedIndex;
              const direction = event.key === "ArrowDown" ? 1 : -1;
              return Math.min(
                ordered.length - 1,
                Math.max(0, index + direction)
              );
            });
          } else if (event.key === "Escape") {
            setOpen(false);
          } else if (open && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            choose(activeIndex);
          }
        }}
        className={cn(
          "flex min-w-[260px] max-w-[440px] items-center gap-3 rounded-lg border bg-slate-900/75 px-3 py-1.5 text-left transition-colors duration-150 sm:min-w-[340px]",
          open
            ? "border-cyan-800/80 bg-slate-900"
            : "border-slate-800 hover:border-slate-700"
        )}
        title={`${proposalRef(selected.id)} · ${selected.title}`}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-cyan-300">
              {proposalRef(selected.id)}
            </span>
            {selected.provenance ? (
              <ProvenanceTag kind={selected.provenance} />
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-xs text-slate-200">
            {selected.title}
          </span>
        </span>
        <ChevronDown
          size={15}
          className={cn(
            "shrink-0 text-slate-500 transition-transform duration-150",
            open && "rotate-180 text-cyan-300"
          )}
        />
      </button>

      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Proposal options"
          className="absolute left-0 top-full z-[60] mt-2 max-h-[min(70vh,520px)] w-[min(92vw,460px)] overflow-y-auto rounded-xl border border-slate-700 bg-slate-950 p-1.5 shadow-[0_24px_80px_-20px_rgba(0,0,0,0.95)]"
        >
          {ordered.map((proposal, index) => {
            const isSelected = proposal.id === selectedId;
            const isActive = index === activeIndex;
            const previous = ordered[index - 1];
            const group = proposal.provenance === "LIVE" ? "live" : "recorded";
            const previousGroup =
              previous?.provenance === "LIVE" ? "live" : "recorded";
            const showHeading =
              grouped && (index === 0 || group !== previousGroup);
            return (
              <Fragment key={proposal.id}>
                {showHeading ? (
                  <li
                    role="presentation"
                    className="px-3 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500 first:pt-0"
                  >
                    {group === "live" ? "Live proposals" : "Recorded / Mock"}
                  </li>
                ) : null}
                <li
                  id={`${listId}-${index}`}
                  ref={isActive ? activeRef : undefined}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(index)}
                  className={cn(
                    "cursor-pointer rounded-lg border px-3 py-2.5 transition-colors duration-150",
                    isActive
                      ? "border-cyan-900/70 bg-cyan-950/20"
                      : "border-transparent hover:bg-slate-900/70"
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-cyan-300">
                      {proposalRef(proposal.id)}
                    </span>
                    {proposal.provenance ? (
                      <ProvenanceTag kind={proposal.provenance} />
                    ) : null}
                    {isSelected ? (
                      <Check size={13} className="ml-auto text-[#22ff88]" />
                    ) : null}
                  </div>
                  <p className="mt-1 break-words text-sm leading-snug text-slate-200">
                    {proposal.title}
                  </p>
                </li>
              </Fragment>
            );
          })}
          <li className="sr-only" aria-live="polite">
            {proposalRef(ordered[activeIndex]?.id ?? selected.id)}
          </li>
        </ul>
      ) : null}
    </div>
  );
}
