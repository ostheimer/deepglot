import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { LocaleProvider } from "@/components/providers/locale-provider";
import { CANONICAL_APP_HOST } from "@/lib/canonical-host";
import { getRequestLocale } from "@/lib/request-locale";

const inter = Inter({ subsets: ["latin"] });
const canonicalAppOrigin = `https://${CANONICAL_APP_HOST}`;

export const metadata: Metadata = {
  metadataBase: new URL(canonicalAppOrigin),
  title: {
    default: "Deepglot",
    template: "%s | Deepglot",
  },
  description:
    "AI-powered WordPress translation with full control over your content and no cloud lock-in.",
  keywords: [
    "WordPress translation",
    "multilingual website",
    "AI WordPress translation",
    "open source translation",
    "WordPress translation plugin",
  ],
  openGraph: {
    type: "website",
    locale: "en_US",
    url: canonicalAppOrigin,
    siteName: "Deepglot",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getRequestLocale();

  return (
    <html lang={locale}>
      <body className={inter.className}>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
