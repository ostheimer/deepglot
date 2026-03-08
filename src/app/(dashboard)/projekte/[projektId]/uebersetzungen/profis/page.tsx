import { Button } from "@/components/ui/button";
import { UserCog, ArrowRight } from "lucide-react";
import Link from "next/link";
import { getRequestLocale } from "@/lib/request-locale";
import { withLocalePrefix } from "@/lib/site-locale";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function ProfiUebersetzungenPage({ params }: PageProps) {
  const { projektId } = await params;
  const locale = await getRequestLocale();

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-6">
        {locale === "de" ? "Profi-Übersetzungen" : "Professional translation"}
      </h2>

      <div className="bg-white border border-gray-200 rounded-xl p-8 text-center max-w-lg mx-auto">
        <div className="h-16 w-16 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
          <UserCog className="h-8 w-8 text-amber-600" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          {locale === "de" ? "Professionelle Übersetzer beauftragen" : "Order professional translators"}
        </h3>
        <p className="text-gray-500 text-sm mb-6">
          {locale === "de"
            ? "Dein Warenkorb für Profi-Übersetzungen ist leer. Schicke Seiten oder ganze Sprachen an professionelle Übersetzer."
            : "Your professional translation cart is empty. Send pages or full languages to professional translators."}
        </p>
        <p className="text-xs text-gray-400 mb-6">
          {locale === "de" ? "Ab €0,13/Wort, abhängig vom Sprachpaar" : "From €0.13 per word, depending on the language pair"}
        </p>
        <Link href={withLocalePrefix(`/projects/${projektId}/translations/urls`, locale)}>
          <Button className="bg-indigo-600 hover:bg-indigo-700">
            {locale === "de" ? "Zu den Übersetzungen" : "Go to translations"}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
