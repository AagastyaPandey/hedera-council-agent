import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Aegis IntentLock",
    short_name: "Aegis",
    description:
      "Working papers for DAO treasury proposals: intent, evidence, disclosure, vote and execution.",
    start_url: "/trail",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f2efe7",
    theme_color: "#f2efe7",
    lang: "en",
    categories: ["finance", "productivity", "security"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
