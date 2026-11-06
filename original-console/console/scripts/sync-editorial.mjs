import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const repoRoot = path.resolve(appRoot, "..");
const outDir = path.join(appRoot, "public");

mkdirSync(outDir, { recursive: true });
copyFileSync(
  path.join(repoRoot, "public", "ecosystem.html"),
  path.join(outDir, "atlas.html")
);
copyFileSync(
  path.join(repoRoot, "public", "report-editorial.html"),
  path.join(outDir, "report.html")
);

console.log("Synced public/ecosystem.html -> console/public/atlas.html");
console.log("Synced public/report-editorial.html -> console/public/report.html");
