"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/format";

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

export function Tabs({
  items,
  defaultId,
  className,
}: {
  items: TabItem[];
  defaultId?: string;
  className?: string;
}) {
  const [active, setActive] = useState(defaultId ?? items[0]?.id);
  const current = items.find((item) => item.id === active) ?? items[0];

  return (
    <div className={className}>
      <div
        role="tablist"
        className="inline-flex flex-wrap gap-1 rounded-xl border border-slate-800 bg-slate-900/60 p-1"
      >
        {items.map((item) => (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={item.id === current?.id}
            onClick={() => setActive(item.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-150",
              item.id === current?.id
                ? "bg-slate-800 text-slate-100 shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="mt-4">
        {current?.content}
      </div>
    </div>
  );
}
