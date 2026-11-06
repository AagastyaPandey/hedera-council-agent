import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { PwaRegistration } from "@/components/PwaRegistration";
import { WalletProvider } from "@/components/WalletProvider";

export const metadata: Metadata = {
  title: {
    default: "Aegis IntentLock — Decision Trail",
    template: "%s · Aegis IntentLock",
  },
  description:
    "Voting transparency isn't informed consent. IntentLock binds the vote to the exact action, and makes the evidence, conflicts and execution verifiable.",
  applicationName: "Aegis IntentLock",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "Aegis",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#f2efe7",
  colorScheme: "light",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-screen">
        <PwaRegistration />
        <WalletProvider>
          <AppShell>{children}</AppShell>
        </WalletProvider>
      </body>
    </html>
  );
}
