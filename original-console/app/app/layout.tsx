import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { DATA_MODE } from "@/lib/config";
import { getProposals } from "@/lib/data";
import { liveGetProposals } from "@/lib/live";
import { ProposalProvider } from "@/lib/proposal-context";
import { Shell } from "@/components/shell/Shell";

// Live mode reads chain state on every request; static prerendering would
// require an RPC at build time and a reachable server for relative fetches.
export const dynamic = "force-dynamic";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AegisDAO IntentLock Console",
  description:
    "Security-ops console for verifiable governance execution: decision trail, red-team arena, COI graph, voting and scorecard.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server components cannot fetch a relative URL; call the live data layer
  // directly instead of routing through /api/live/proposals.
  const proposals =
    DATA_MODE === "live" ? await liveGetProposals() : await getProposals();

  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="font-sans">
        <ProposalProvider proposals={proposals}>
          <Shell>{children}</Shell>
        </ProposalProvider>
      </body>
    </html>
  );
}
