import { PricingGrid } from "@/components/marketing/pricing-grid";
import Link from "next/link";
import { Globe } from "lucide-react";

export const metadata = {
  title: "Preise – Deepglot",
  description: "Kostenlos starten, keine Kreditkarte erforderlich. Alle Pläne im Überblick.",
};

export default function PreisePage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b border-gray-100 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center gap-2">
              <Globe className="h-6 w-6 text-indigo-600" />
              <span className="text-xl font-bold text-gray-900">Deepglot</span>
            </Link>
            <div className="hidden md:flex items-center gap-8">
              <Link href="/#features" className="text-sm text-gray-600 hover:text-gray-900">Features</Link>
              <Link href="/preise" className="text-sm font-medium text-indigo-600">Preise</Link>
              <Link href="/docs" className="text-sm text-gray-600 hover:text-gray-900">Dokumentation</Link>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/anmelden" className="text-sm text-gray-600 hover:text-gray-900 font-medium px-3 py-1.5">
                Anmelden
              </Link>
              <Link href="/registrieren">
                <button className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                  Kostenlos testen
                </button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Header */}
      <div className="text-center pt-16 pb-10 px-4">
        <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 mb-4">
          Einfache, faire Preise
        </h1>
        <p className="text-lg text-gray-500">Kostenlos starten, keine Kreditkarte erforderlich</p>
      </div>

      {/* Pricing Grid (client component for toggle) */}
      <PricingGrid />

      {/* Footer */}
      <footer className="border-t border-gray-100 py-10 mt-20">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-indigo-600" />
            <span className="font-semibold text-gray-900">Deepglot</span>
            <span className="text-gray-400 text-sm ml-2">© {new Date().getFullYear()}</span>
          </div>
          <div className="flex gap-6 text-sm text-gray-400">
            <Link href="/datenschutz" className="hover:text-gray-700">Datenschutz</Link>
            <Link href="/impressum" className="hover:text-gray-700">Impressum</Link>
            <Link href="/agb" className="hover:text-gray-700">AGB</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
