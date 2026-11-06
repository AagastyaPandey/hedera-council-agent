import type { NextConfig } from "next";
import fs from "node:fs";
import path from "node:path";

// The console lives in app/, but the deployment keys and RPC URLs live in the
// repo-root .env next to hardhat.config.ts. Load it before Next inlines
// NEXT_PUBLIC_* values. app/.env.local still takes precedence via Next itself.
const rootEnv = path.resolve(process.cwd(), "..", ".env");
try {
  if (fs.existsSync(rootEnv)) {
    const loadEnvFile = (process as NodeJS.Process & { loadEnvFile?: (p: string) => void })
      .loadEnvFile;
    if (typeof loadEnvFile === "function") {
      loadEnvFile.call(process, rootEnv);
    }
  }
} catch {
  // Missing or unreadable .env: use the process environment.
}

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(process.cwd(), ".."),
  },
};

export default nextConfig;
