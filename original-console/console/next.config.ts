import type { NextConfig } from "next";
import fs from "node:fs";
import path from "node:path";

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
  devIndicators: false,
  turbopack: {
    root: path.resolve(process.cwd(), ".."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
