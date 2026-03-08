import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getRequestLocale } from "@/lib/request-locale";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function SeitenaufrufeStatistikPage({ params }: PageProps) {
  const { projektId } = await params;
  const locale = await getRequestLocale();

  const project = await db.project.findUnique({ where: { id: projektId } });
  if (!project) notFound();

  // Page views tracking is opt-in (requires JS snippet activation)
  const isActivated = false; // TODO: store activation state in Project model

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-6">
        {locale === "de" ? "Seitenaufrufe" : "Page views"}
      </h2>

      {!isActivated ? (
        <div className="bg-white border border-gray-200 rounded-xl py-24 flex flex-col items-center justify-center text-center px-8">
          {/* Reference-style icon */}
          <div className="relative mb-6">
            <div className="h-20 w-20 rounded-2xl bg-gray-100 flex items-center justify-center">
              <svg
                className="h-10 w-10 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
            </div>
            <div className="absolute -top-1 -right-1 h-6 w-6 rounded-full bg-gray-100 border-2 border-white flex items-center justify-center">
              <svg className="h-3 w-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
          </div>

          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            {locale === "de" ? "Seitenaufrufe noch nicht aktiviert." : "Page views are not enabled yet."}
          </h3>
          <p className="text-gray-500 text-sm mb-8 max-w-sm">
            {locale === "de"
              ? "Aktiviere die Seitenaufruf-Statistiken um erweiterte Daten darüber zu erhalten, welche übersetzten Seiten am häufigsten besucht werden."
              : "Enable page-view analytics to see which translated pages are visited most often."}
          </p>

          <form action={`/api/projects/${projektId}/page-views/activate`} method="POST">
            <Button
              type="submit"
              className="bg-indigo-600 hover:bg-indigo-700 px-8"
            >
              {locale === "de" ? "Aktivieren" : "Enable"}
            </Button>
          </form>

          <div className="mt-8 border border-gray-100 rounded-xl p-5 text-left max-w-sm w-full">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              {locale === "de" ? "Was du mit Seitenaufrufen erhältst:" : "What you get with page views:"}
            </p>
            <ul className="space-y-2 text-sm text-gray-600">
              {[
                locale === "de" ? "Anzahl der Aufrufe pro übersetzter Seite" : "View count per translated page",
                locale === "de" ? "Vergleich Original vs. übersetzte Versionen" : "Compare original vs translated versions",
                locale === "de" ? "Zeitlicher Verlauf nach Tag/Woche/Monat" : "Trend over day/week/month",
                locale === "de" ? "Meistbesuchte übersetzte URLs" : "Most visited translated URLs",
              ].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        // Activated state – placeholder for actual chart
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <p className="text-gray-500 text-sm text-center py-16">
            {locale === "de" ? "Seitenaufruf-Daten werden geladen..." : "Loading page-view data..."}
          </p>
        </div>
      )}
    </div>
  );
}
