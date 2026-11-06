"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function InstallBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const host = window.location.hostname;
      const local = host === "localhost" || host === "127.0.0.1";
      const standalone = window.matchMedia("(display-mode: standalone)").matches;
      setVisible(
        window.location.protocol === "http:" && !local && !standalone
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div className="border-b border-danger/25 bg-danger/5 px-4 py-2 text-[11.5px] leading-relaxed text-dim">
      <span className="text-danger">Android install needs HTTPS.</span>{" "}
      <Link
        href="/install"
        className="underline decoration-danger/40 underline-offset-2 hover:text-danger"
      >
        Open the install guide
      </Link>{" "}
      to trust the local CA and switch to the secure address.
    </div>
  );
}
