import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { LocaleProvider } from "@/components/providers/locale-provider";
import { CANONICAL_APP_HOST } from "@/lib/canonical-host";
import { getRequestLocale } from "@/lib/request-locale";

const manrope = Manrope({
  subsets: ["latin", "latin-ext", "cyrillic", "cyrillic-ext", "greek"],
  display: "swap",
  variable: "--font-manrope",
});
const canonicalAppOrigin = `https://${CANONICAL_APP_HOST}`;

export const metadata: Metadata = {
  metadataBase: new URL(canonicalAppOrigin),
  title: {
    default: "Deepglot",
    template: "%s | Deepglot",
  },
  description:
    "AI-powered WordPress translation with full control over your content and no cloud lock-in.",
  applicationName: "Deepglot",
  creator: "Ostheimer OG",
  publisher: "Ostheimer OG",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-icon.png", type: "image/png", sizes: "180x180" }],
  },
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
    title: "Deepglot — WordPress translation without lock-in",
    description:
      "Open-source WordPress translation, built in Austria and designed to keep your content under your control.",
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "Deepglot — WordPress translation built in Austria",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Deepglot — WordPress translation without lock-in",
    description:
      "Open-source WordPress translation, built in Austria and designed to keep your content under your control.",
    images: ["/opengraph-image.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#f03b22",
  colorScheme: "light",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getRequestLocale();

  return (
    <html lang={locale}>
      <body className={`${manrope.variable} font-sans antialiased`}>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
