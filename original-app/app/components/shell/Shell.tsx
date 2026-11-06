"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardCheck,
  FileText,
  Link2,
  Network,
  ShieldCheck,
  Swords,
  Vote,
  Workflow,
} from "lucide-react";
import { CHAIN_ID, CHAIN_NAME } from "@/lib/config";
import { explorerBaseUrl } from "@/lib/explorer";
import { cn } from "@/lib/format";
import { useProposal } from "@/lib/proposal-context";
import { ProposalListbox } from "./ProposalListbox";

const NAV = [
  { href: "/", label: "Decision Trail", icon: Workflow },
  { href: "/proposals", label: "Proposals", icon: FileText },
  { href: "/arena", label: "Arena", icon: Swords },
  { href: "/disclosure", label: "Disclosure & Graph", icon: Network },
  { href: "/voting", label: "Voting", icon: Vote },
  { href: "/scorecard", label: "Scorecard", icon: ClipboardCheck },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function ChainTag() {
  const explorer = explorerBaseUrl();
  const className =
    "inline-flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1 font-mono text-[11px] tabular-nums text-slate-400 transition-colors duration-150";
  const label = (
    <>
      <Link2 size={12} className="text-slate-500" />
      {CHAIN_NAME}
      <span className="text-slate-600">{CHAIN_ID}</span>
    </>
  );

  if (!explorer) {
    return <span className={className}>{label}</span>;
  }
  return (
    <a
      href={explorer}
      target="_blank"
      rel="noreferrer"
      className={cn(className, "hover:border-cyan-900/70 hover:text-cyan-200")}
      title={`Open ${CHAIN_NAME} explorer`}
    >
      {label}
    </a>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { proposals, proposal, setProposalId } = useProposal();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="hidden min-h-screen flex-col border-r border-slate-800 bg-slate-950/80 px-4 py-6 backdrop-blur-sm lg:flex">
        <Link href="/" className="flex items-center gap-3 px-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-emerald-900/70 bg-emerald-950/40 text-[#22ff88] shadow-[0_0_22px_rgba(34,255,136,0.16)]">
            <ShieldCheck size={18} />
          </span>
          <span>
            <span className="block text-sm font-semibold tracking-[0.2em] text-slate-100">
              AEGIS
            </span>
            <span className="block text-[10px] uppercase tracking-[0.16em] text-slate-500">
              IntentLock Console
            </span>
          </span>
        </Link>

        <nav className="mt-8 space-y-1">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors duration-150",
                  active
                    ? "border-emerald-900/60 bg-emerald-950/20 text-slate-100"
                    : "border-transparent text-slate-400 hover:border-slate-800 hover:bg-slate-900/60 hover:text-slate-200"
                )}
              >
                <Icon
                  size={16}
                  className={
                    active
                      ? "text-[#22ff88]"
                      : "text-slate-500 group-hover:text-slate-300"
                  }
                />
                <span>{item.label}</span>
                {active ? (
                  <span className="ml-auto status-dot text-[#22ff88]" />
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto rounded-xl border border-slate-800 bg-slate-900/40 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Enforcement
          </p>
          <p className="mt-2 flex items-center gap-2 text-xs text-slate-300">
            <span className="status-dot text-[#22ff88]" />
            On-chain hard gate
          </p>
          <p className="mt-1.5 flex items-center gap-2 text-xs text-slate-400">
            <span className="status-dot text-amber-400" />
            Sentinel early warning
          </p>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-col">
        <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/75 backdrop-blur-md">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <Link
              href="/"
              className="grid h-8 w-8 place-items-center rounded-lg border border-emerald-900/70 bg-emerald-950/40 text-[#22ff88] lg:hidden"
              aria-label="AegisDAO home"
            >
              <ShieldCheck size={16} />
            </Link>

            <ProposalListbox
              proposals={proposals}
              selectedId={proposal.id}
              onSelect={setProposalId}
            />

            <div className="ml-auto flex items-center gap-2">
              <ChainTag />
            </div>
          </div>

          <nav className="flex gap-1 overflow-x-auto border-t border-slate-800/70 px-3 py-2 lg:hidden">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs transition-colors duration-150",
                    active
                      ? "bg-slate-800 text-slate-100"
                      : "text-slate-400 hover:text-slate-200"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
