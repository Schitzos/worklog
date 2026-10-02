import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { ReminderToast } from "./ReminderToast";
import { ProductNav } from "./ProductNav";

export const metadata: Metadata = {
  title: "Worklog",
  description: "Local worklog reminder — nudges every 2h, boss-ready recaps.",
  manifest: "/manifest.webmanifest",
  applicationName: "Worklog",
  appleWebApp: { capable: true, title: "Worklog", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.png", type: "image/png", sizes: "48x48" },
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  // DESIGN_SYSTEM.md §2 — PWA respects system theme; expose both canvases.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <ProductNav />
        {children}
        <ReminderToast />
      </body>
    </html>
  );
}
