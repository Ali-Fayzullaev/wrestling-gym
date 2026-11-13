import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import { ru } from "@/i18n/ru";
import { themeInitScript } from "@/lib/theme";

import "./globals.css";

// Inter covers Kazakh letters (ә ғ қ ң ө ұ ү һ і) in cyrillic-ext. Only the cyrillic file is
// preloaded: preloading all three (93 KB) delayed LCP by ~0.5 s on mobile; latin (digits) and
// cyrillic-ext still load by unicode-range. The fallback is metric-adjusted, so the swap does not
// shift the layout.
const inter = Inter({
  subsets: ["cyrillic"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: ru.app.name,
  description: ru.app.description,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the bottom menu pad itself by env(safe-area-inset-bottom) on phones with a home bar.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The head script adds the theme class and data-theme before the first paint.
    <html
      lang="ru"
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
