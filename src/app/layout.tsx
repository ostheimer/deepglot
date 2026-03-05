import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "Deepglot – WordPress Übersetzung ohne Cloud-Lock-in",
    template: "%s | Deepglot",
  },
  description:
    "Übersetze deine WordPress-Website mit KI – ohne monatliche Abo-Fallen. Deepglot ist die Open-Source-Alternative zu Weglot.",
  keywords: [
    "WordPress Übersetzung",
    "Weglot Alternative",
    "mehrsprachige Website",
    "DeepL WordPress",
    "Open Source Übersetzung",
  ],
  openGraph: {
    type: "website",
    locale: "de_DE",
    url: "https://deepglot.com",
    siteName: "Deepglot",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body className={inter.className}>
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
