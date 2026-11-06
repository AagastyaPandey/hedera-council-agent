import { readFileSync } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

export function GET() {
  const html = readFileSync(
    path.join(process.cwd(), "public", "report.html"),
    "utf8"
  );
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
