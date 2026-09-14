/**
 * PWA web-app manifest (T6.13) — makes AyuSphere installable on phones.
 * Colors mirror the design tokens in globals.css (--color-primary /
 * --color-bg). iOS ignores these icons and reads the apple-icon route
 * (180px), already served via the root layout metadata.
 */
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AyuSphere — Clinical Trials for Ayurveda",
    short_name: "AyuSphere",
    description:
      "AI-assisted Clinical Research Intelligence Platform for Ayurveda — SIH26046",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f6f3",
    theme_color: "#1b7a43",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // Android masks installed icons into a circle/squircle — the maskable
      // entry tells it this artwork survives that crop
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
