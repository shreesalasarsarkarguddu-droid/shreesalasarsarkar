import type { MetadataRoute } from "next";

// Makes the site installable as an app (Chrome: "Install app" / "Add to Home screen").
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Shree Salasar Sarkar",
    short_name: "SS Finance",
    description: "Finance accounts, collections and reports",
    start_url: "/accounts",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f1f5f9",
    theme_color: "#1d4ed8",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Collect payment", url: "/payments", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "New loan", url: "/loans/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
