import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { connection } from "next/server";

import { I18nProvider } from "@/i18n/client";
import { pickMessages } from "@/i18n/messages";
import { getI18n } from "@/i18n/server";
import { HTML_LANG } from "@/lib/locale";
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

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t.app.name,
    description: t.app.description,
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the bottom menu pad itself by env(safe-area-inset-bottom) on phones with a home bar.
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page renders per request: Next.js puts the CSP nonce from the proxy on its scripts only
  // during a request, so a prerendered page would ship scripts the browser refuses to run.
  await connection();
  const { t, locale } = await getI18n();
  return (
    // The head script adds the theme class and data-theme before the first paint.
    <html
      lang={HTML_LANG[locale]}
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        {/* Texts every screen's client parts use; pages add their own sections. */}
        <I18nProvider
          locale={locale}
          messages={pickMessages(t, ["common", "errors"])}
        >
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
