"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MonitorPlay } from "lucide-react";
import { InstallApp } from "@/components/InstallApp";
import { InstallBanner } from "@/components/InstallBanner";
import { JudgeMode } from "@/components/JudgeMode";
import { SignerTag } from "@/components/SignerTag";

const NAV = [
  { href: "/trail", label: "Trail" },
  { href: "/intent", label: "Intent" },
  { href: "/graph", label: "Graph" },
  { href: "/timeline", label: "Timeline" },
  { href: "/vote", label: "Vote" },
  { href: "/arena", label: "Arena" },
  { href: "/scorecard", label: "Scorecard" },
  { href: "/live", label: "Live" },
  { href: "/docs", label: "Docs" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/trail") return pathname === "/trail";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/present") {
    return <>{children}</>;
  }

  return (
    <div className="app-shell">
      <aside className="app-rail" aria-hidden="true">
        <Link href="/" className="app-rail-mark">
          AEGIS
        </Link>
        <span className="app-rail-rule" />
        <span className="app-rail-meta">IntentLock, Vol. 2</span>
      </aside>

      <div className="app-rail-r" aria-hidden="true">
        <span className="app-dot" />
        <span className="app-rail-meta">Local, 31337</span>
      </div>

      <header className="app-header">
        <div className="app-header-inner">
          <Link href="/" className="app-wordmark">
            <span className="app-wordmark-mark" aria-hidden="true" />
            <span className="app-wordmark-text">
              Aegis <em>IntentLock</em>
            </span>
          </Link>

          <span className="app-header-note">Working papers</span>

          <nav className="app-nav" aria-label="Primary">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="app-header-actions">
            <SignerTag />
            <JudgeMode />
            <Link
              href="/present"
              aria-label="Presentation mode"
              title="Full-screen presentation"
              className="app-header-link"
            >
              <MonitorPlay size={11} strokeWidth={1.8} />
              <span className="hidden xl:inline">Present</span>
            </Link>
            <span className="app-chain">
              <span className="status-dot text-safe" />
              Local, 31337
            </span>
          </div>
        </div>

        <nav className="app-mobile-nav" aria-label="Primary mobile">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <InstallBanner />

      <main className="app-main">{children}</main>

      <footer className="app-footer">
        <div className="app-footer-inner">
          <p>AegisDAO IntentLock, AIP-042, editorial edition</p>
          <div className="flex flex-wrap items-center gap-4">
            <p>Reference model, wallet data simulated, live chain at /live</p>
            <InstallApp />
          </div>
        </div>
      </footer>
    </div>
  );
}
