import { Button } from "@/components/ui/button";
import { Star, Sparkles } from "lucide-react";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function SprachmodellPage({ params }: PageProps) {
  return (
    <div className="max-w-2xl">
      <h2 className="text-xl font-bold text-gray-900 mb-6">Sprachmodell</h2>

      <div className="bg-white border border-gray-200 rounded-xl">
        {/* Hero */}
        <div className="p-12 text-center border-b border-gray-100">
          <div className="h-14 w-14 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto mb-4">
            <Sparkles className="h-7 w-7 text-indigo-600" />
          </div>
          <h3 className="text-2xl font-bold text-gray-900 mb-2">
            Sprachmodell anpassen
          </h3>
          <p className="text-gray-500 text-sm mb-6 max-w-md mx-auto">
            Verbessere die Qualität deiner Übersetzungen, indem du ein auf deine
            spezifischen Bedürfnisse zugeschnittenes Sprachmodell konfigurierst.
          </p>
          <Button className="bg-indigo-600 hover:bg-indigo-700 px-8">
            Konfigurieren
          </Button>
        </div>

        {/* Testimonial */}
        <div className="p-6">
          <div className="border border-gray-200 rounded-xl p-5">
            <div className="flex gap-0.5 mb-3">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="h-4 w-4 fill-indigo-600 text-indigo-600" />
              ))}
            </div>
            <p className="text-sm text-gray-600 italic leading-relaxed mb-4">
              &ldquo;Ich bevorzuge diese Übersetzungen deutlich. Deepglot KI liefert
              merklich bessere Ergebnisse als Standard-Übersetzungen und DeepL.
              Die Anpassungsmöglichkeiten durch das Sprachmodell machen einen
              großen Unterschied in Bezug auf Genauigkeit und Ton.&rdquo;
            </p>
            <p className="text-sm font-semibold text-gray-900">– Caroline G.</p>
          </div>
        </div>

        {/* What you can configure */}
        <div className="px-6 pb-6">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Was du konfigurieren kannst:
          </p>
          <ul className="space-y-2.5">
            {[
              { label: "Tonalität", desc: "Formell, informell, technisch oder locker" },
              { label: "Branchenspezifischer Wortschatz", desc: "Medizin, Recht, E-Commerce u.v.m." },
              { label: "Markensprache", desc: "Spezifische Begriffe und Formulierungen beibehalten" },
              { label: "KI-Modell", desc: "GPT-4o oder DeepL je nach Bedarf" },
            ].map((item) => (
              <li key={item.label} className="flex items-start gap-3">
                <span className="h-5 w-5 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-600" />
                </span>
                <div>
                  <span className="text-sm font-medium text-gray-900">{item.label}</span>
                  <span className="text-sm text-gray-500"> – {item.desc}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
