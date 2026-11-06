import { cn } from "@/lib/format";
import type { ReactNode } from "react";

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  contentClassName,
  danger = false,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  danger?: boolean;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border bg-slate-900/60 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)] backdrop-blur-sm",
        danger
          ? "border-red-900/70 shadow-[0_0_40px_-16px_rgba(239,68,68,0.55)]"
          : "border-slate-800",
        className
      )}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
          <div className="min-w-0">
            {title ? (
              <h2 className="text-sm font-semibold tracking-tight text-slate-100">
                {title}
              </h2>
            ) : null}
            {subtitle ? (
              <p className="mt-0.5 text-xs text-muted">{subtitle}</p>
            ) : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      )}
      <div className={cn("p-5", contentClassName)}>{children}</div>
    </section>
  );
}
