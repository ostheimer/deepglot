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
    "Deepglot übersetzt deinen WordPress-Content automatisch per KI – zu einem Bruchteil der üblichen Kosten. Übersetzungen gehören dir, nicht uns.",
  keywords: [
    "WordPress Übersetzung",
    "mehrsprachige Website",
    "DeepL WordPress",
    "Open Source Übersetzung",
    "WordPress Übersetzungs Plugin",
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
