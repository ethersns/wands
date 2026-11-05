import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";

import "./globals.css";

import { ThemeProvider } from "@/components/theme-provider";
import { AppShell } from "@/components/shell/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { getEngineStatus, getMarkets } from "@/lib/api/endpoints";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Wands — Trading Command Centre",
    template: "%s · Wands",
  },
  description:
    "Private, professional-grade automated trading platform for crypto and equities. Portfolio, bots, strategy research and risk control in one terminal.",
  applicationName: "Wands",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#07080a" },
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [engine, markets] = await Promise.all([getEngineStatus(), getMarkets()]);

  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} dark`} suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased">
        <ThemeProvider>
          <AppShell engine={engine} markets={markets}>
            {children}
          </AppShell>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
