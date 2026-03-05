import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Globe, Zap, Lock, Code, ArrowRight } from "lucide-react";
import { PLANS } from "@/lib/stripe";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="border-b border-gray-100 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <Globe className="h-6 w-6 text-indigo-600" />
              <span className="text-xl font-bold text-gray-900">Deepglot</span>
            </div>
            <div className="hidden md:flex items-center gap-8">
              <Link href="#features" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
                Features
              </Link>
              <Link href="/preise" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
                Preise
              </Link>
              <Link href="#plugin" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
                WordPress Plugin
              </Link>
              <Link href="/docs" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
                Dokumentation
              </Link>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/anmelden">
                <Button variant="ghost" size="sm">Anmelden</Button>
              </Link>
              <Link href="/registrieren">
                <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700">
                  Kostenlos starten
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-20">
        <div className="text-center max-w-4xl mx-auto">
          <Badge variant="secondary" className="mb-6 text-indigo-700 bg-indigo-50 border-indigo-200">
            Weglot-Alternative · Open Source · Kein Lock-in
          </Badge>
          <h1 className="text-5xl sm:text-6xl font-bold text-gray-900 tracking-tight mb-6">
            Übersetze deine WordPress-Site{" "}
            <span className="text-indigo-600">ohne Abo-Falle</span>
          </h1>
          <p className="text-xl text-gray-600 mb-10 max-w-2xl mx-auto leading-relaxed">
            Deepglot übersetzt deinen WordPress-Content automatisch per DeepL-KI –
            zu einem Bruchteil der Weglot-Kosten. Übersetzungen gehören dir, nicht uns.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/registrieren">
              <Button size="lg" className="bg-indigo-600 hover:bg-indigo-700 text-base px-8">
                Kostenlos loslegen
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link href="https://github.com/deepglot/deepglot" target="_blank">
              <Button size="lg" variant="outline" className="text-base px-8">
                <Code className="mr-2 h-4 w-4" />
                GitHub ansehen
              </Button>
            </Link>
          </div>
          <p className="mt-4 text-sm text-gray-500">
            10.000 Wörter/Monat kostenlos · Keine Kreditkarte erforderlich
          </p>
        </div>
      </section>

      {/* Comparison Banner */}
      <section className="bg-gray-50 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { label: "Weglot Professional", price: "€99/Monat", words: "200k Wörter", highlight: false },
              { label: "Deepglot Professional", price: "€49/Monat", words: "1 Mio. Wörter", highlight: true },
            ].map((item) => (
              <div
                key={item.label}
                className={`col-span-2 rounded-xl p-6 ${
                  item.highlight
                    ? "bg-indigo-600 text-white"
                    : "bg-white border border-gray-200 text-gray-900"
                }`}
              >
                <p className={`text-sm font-medium mb-2 ${item.highlight ? "text-indigo-200" : "text-gray-500"}`}>
                  {item.label}
                </p>
                <p className="text-3xl font-bold mb-1">{item.price}</p>
                <p className={`text-sm ${item.highlight ? "text-indigo-200" : "text-gray-500"}`}>
                  {item.words}
                </p>
                {item.highlight && (
                  <Badge className="mt-3 bg-white text-indigo-600">5× mehr für die Hälfte</Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            Alles was du brauchst. Nichts was dich fesselt.
          </h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Deepglot gibt dir die Kontrolle über deine Übersetzungen zurück –
            mit professionellen Features zu fairen Preisen.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature) => (
            <Card key={feature.title} className="border-gray-100 hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="h-10 w-10 rounded-lg bg-indigo-50 flex items-center justify-center mb-3">
                  <feature.icon className="h-5 w-5 text-indigo-600" />
                </div>
                <CardTitle className="text-lg">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 text-sm">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="preise" className="bg-gray-50 py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">
              Transparente Preise. Keine Überraschungen.
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {Object.entries(PLANS).map(([key, plan]) => (
              <Card
                key={key}
                className={`relative ${key === "PROFESSIONAL" ? "border-indigo-600 border-2 shadow-lg" : "border-gray-200"}`}
              >
                {key === "PROFESSIONAL" && (
                  <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                    <Badge className="bg-indigo-600 text-white">Empfohlen</Badge>
                  </div>
                )}
                <CardHeader>
                  <CardTitle className="text-lg">{plan.name}</CardTitle>
                  <div className="mt-2">
                    <span className="text-3xl font-bold">
                      {plan.priceMonthly === 0 ? "Kostenlos" : `€${(plan.priceMonthly / 100).toFixed(0)}`}
                    </span>
                    {plan.priceMonthly > 0 && (
                      <span className="text-gray-500 text-sm">/Monat</span>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 mb-6">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2 text-sm text-gray-600">
                        <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Link href="/registrieren">
                    <Button
                      className={`w-full ${key === "PROFESSIONAL" ? "bg-indigo-600 hover:bg-indigo-700" : ""}`}
                      variant={key === "PROFESSIONAL" ? "default" : "outline"}
                    >
                      {plan.priceMonthly === 0 ? "Kostenlos starten" : "Plan wählen"}
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-indigo-600" />
              <span className="font-semibold text-gray-900">Deepglot</span>
              <span className="text-gray-500 text-sm ml-2">© {new Date().getFullYear()}</span>
            </div>
            <div className="flex gap-6 text-sm text-gray-500">
              <Link href="/datenschutz" className="hover:text-gray-900 transition-colors">Datenschutz</Link>
              <Link href="/impressum" className="hover:text-gray-900 transition-colors">Impressum</Link>
              <Link href="/agb" className="hover:text-gray-900 transition-colors">AGB</Link>
              <Link href="https://github.com/deepglot" target="_blank" className="hover:text-gray-900 transition-colors">
                GitHub
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

const features = [
  {
    icon: Zap,
    title: "Blitzschnelle Übersetzung",
    description:
      "Alle Strings einer Seite in einem API-Call – minimale Latenz durch intelligentes Batching und lokalen Cache.",
  },
  {
    icon: Lock,
    title: "Deine Daten, deine Kontrolle",
    description:
      "Übersetzungen werden in deiner eigenen Datenbank gespeichert. Kein Lock-in, jederzeit exportierbar.",
  },
  {
    icon: Globe,
    title: "DeepL-Qualität",
    description:
      "Die beste verfügbare Übersetzungsqualität powered by DeepL – optional mit OpenAI für kontextsensitive Inhalte.",
  },
  {
    icon: Code,
    title: "WordPress Plugin",
    description:
      "Bewährter ob_start-Ansatz wie Weglot – kompatibel mit Elementor, WooCommerce, Yoast SEO und mehr.",
  },
  {
    icon: Check,
    title: "SEO-optimiert",
    description:
      "Automatische hreflang-Tags, Subdirectory-URLs (/de/, /fr/) und Sitemap-Übersetzung für maximale Sichtbarkeit.",
  },
  {
    icon: Globe,
    title: "Self-hosted Option",
    description:
      "Für maximale Datenkontrolle: Das gesamte Backend per Docker selbst hosten. Keine monatlichen Kosten.",
  },
];
