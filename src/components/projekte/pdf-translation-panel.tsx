"use client";

import { useRef, useState } from "react";
import { Download, FileText, Upload } from "lucide-react";
import { toast } from "sonner";

import { useLocale } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { getLanguageName } from "@/lib/language-names";

type PdfTranslationPanelProps = {
  projectId: string;
  originalLang: string;
  languages: Array<{ id: string; langCode: string }>;
};

function filenameFromDisposition(value: string | null) {
  const match = value?.match(/filename="([^"]+)"/i);
  return match?.[1] ?? "deepglot-translated.pdf";
}

export function PdfTranslationPanel({
  projectId,
  originalLang,
  languages,
}: PdfTranslationPanelProps) {
  const locale = useLocale();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [langTo, setLangTo] = useState(languages[0]?.langCode ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const t = (english: string, german: string) =>
    locale === "de" ? german : english;

  const errors: Record<string, string> = {
    invalid_pdf_type: t(
      "Choose a non-empty PDF file.",
      "Wähle eine nicht leere PDF-Datei aus."
    ),
    invalid_pdf: t(
      "The file could not be parsed as a PDF.",
      "Die Datei konnte nicht als PDF gelesen werden."
    ),
    pdf_too_large: t(
      "The PDF exceeds the 4 MiB limit.",
      "Die PDF-Datei überschreitet das Limit von 4 MiB."
    ),
    pdf_too_many_pages: t(
      "The PDF exceeds the 20-page limit.",
      "Die PDF-Datei überschreitet das Limit von 20 Seiten."
    ),
    pdf_too_many_words: t(
      "The PDF exceeds the 10,000-word processing limit.",
      "Die PDF-Datei überschreitet das Verarbeitungslimit von 10.000 Wörtern."
    ),
    pdf_encrypted: t(
      "Encrypted or password-protected PDFs are not supported.",
      "Verschlüsselte oder passwortgeschützte PDFs werden nicht unterstützt."
    ),
    pdf_scanned_or_empty: t(
      "Every page must contain selectable text. OCR and image-only PDFs are not supported.",
      "Jede Seite muss auswählbaren Text enthalten. OCR und reine Bild-PDFs werden nicht unterstützt."
    ),
    pdf_output_characters_unsupported: t(
      "The translated text contains characters the current PDF font cannot render.",
      "Der übersetzte Text enthält Zeichen, die die aktuelle PDF-Schrift nicht darstellen kann."
    ),
    quota_exhausted: t(
      "This translation would exceed the monthly word quota.",
      "Diese Übersetzung würde das monatliche Wortlimit überschreiten."
    ),
    velocity_limited: t(
      "Too many fresh words are being translated. Try again later.",
      "Aktuell werden zu viele neue Wörter übersetzt. Versuche es später erneut."
    ),
    provider_failed: t(
      "The configured translation provider could not process the PDF.",
      "Der konfigurierte Übersetzungsanbieter konnte die PDF-Datei nicht verarbeiten."
    ),
    language_forbidden: t(
      "You cannot translate into this language.",
      "Du darfst nicht in diese Sprache übersetzen."
    ),
    language_not_active: t(
      "Choose an active project language.",
      "Wähle eine aktive Projektsprache."
    ),
  };

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !langTo || isSubmitting) return;

    const formData = new FormData();
    formData.set("file", file);
    formData.set("langTo", langTo);
    setIsSubmitting(true);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/pdf-translations`,
        { method: "POST", body: formData }
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          code?: string;
          error?: string;
        };
        toast.error(
          (body.code && errors[body.code]) ||
            body.error ||
            t("PDF translation failed.", "PDF-Übersetzung fehlgeschlagen.")
        );
        return;
      }

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filenameFromDisposition(
        response.headers.get("content-disposition")
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);

      toast.success(
        t(
          "Translated PDF downloaded.",
          "Übersetzte PDF-Datei wurde heruntergeladen."
        )
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900">
          {t("PDF translation", "PDF-Übersetzung")}
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          {t(
            "Translate a text-based PDF into one active project language and download a newly typeset PDF.",
            "Übersetze eine textbasierte PDF-Datei in eine aktive Projektsprache und lade eine neu gesetzte PDF-Datei herunter."
          )}
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-gray-200 bg-white p-6"
      >
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-50">
            <FileText className="h-5 w-5 text-indigo-600" />
          </div>
          <div className="min-w-0 flex-1 space-y-5">
            <div>
              <label
                htmlFor="pdf-target-language"
                className="text-sm font-medium text-gray-900"
              >
                {t("Target language", "Zielsprache")}
              </label>
              <select
                id="pdf-target-language"
                value={langTo}
                onChange={(event) => setLangTo(event.target.value)}
                disabled={languages.length === 0 || isSubmitting}
                className="mt-2 flex h-10 w-full max-w-sm rounded-md border border-input bg-white px-3 py-2 text-sm"
              >
                {languages.map((language) => (
                  <option key={language.id} value={language.langCode}>
                    {getLanguageName(language.langCode, locale)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-400">
                {t("Source language", "Ausgangssprache")}: {getLanguageName(originalLang, locale)}
              </p>
            </div>

            <div>
              <label
                htmlFor="pdf-source-file"
                className="mb-2 block text-sm font-medium text-gray-900"
              >
                {t("PDF file", "PDF-Datei")}
              </label>
              <input
                id="pdf-source-file"
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                disabled={isSubmitting}
                className="block w-full max-w-xl text-sm text-gray-600 file:mr-4 file:rounded-md file:border-0 file:bg-gray-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
              />
              {file && (
                <p className="mt-2 text-xs text-gray-500">
                  {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MiB
                </p>
              )}
            </div>

            <Button
              type="submit"
              disabled={!file || !langTo || isSubmitting}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {isSubmitting ? (
                t("Translating…", "Wird übersetzt…")
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  {t("Translate and download", "Übersetzen und herunterladen")}
                  <Download className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>

            {languages.length === 0 && (
              <p className="text-sm text-amber-700">
                {t(
                  "No active target language is available for your project access.",
                  "Für deinen Projektzugriff ist keine aktive Zielsprache verfügbar."
                )}
              </p>
            )}
          </div>
        </div>
      </form>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
        <h3 className="text-sm font-semibold text-amber-950">
          {t("Current PDF limits", "Aktuelle PDF-Einschränkungen")}
        </h3>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-amber-900">
          <li>
            {t(
              "Up to 4 MiB, 20 pages, and 10,000 source words per text-based PDF.",
              "Bis zu 4 MiB, 20 Seiten und 10.000 Ausgangswörter pro textbasierter PDF-Datei."
            )}
          </li>
          <li>
            {t(
              "Every page must contain selectable text; scanned/image-only, blank-page, encrypted, and password-protected PDFs are rejected. OCR is not included.",
              "Jede Seite muss auswählbaren Text enthalten; gescannte, reine Bild-, Leerseiten-, verschlüsselte und passwortgeschützte PDFs werden abgelehnt. OCR ist nicht enthalten."
            )}
          </li>
          <li>
            {t(
              "The output reflows translated text and does not preserve the original layout, fonts, images, columns, forms, signatures, links, or accessibility tags.",
              "Die Ausgabe setzt den übersetzten Text neu und bewahrt das ursprüngliche Layout, Schriften, Bilder, Spalten, Formulare, Signaturen, Links oder Barrierefreiheits-Tags nicht."
            )}
          </li>
          <li>
            {t(
              "The built-in output font currently supports mainly Western European characters; unsupported translated characters are rejected instead of replaced silently. Source words already processed by the provider still count toward quota and velocity limits.",
              "Die integrierte Ausgabeschrift unterstützt derzeit hauptsächlich westeuropäische Zeichen; nicht unterstützte Übersetzungszeichen werden abgelehnt statt still ersetzt. Bereits vom Provider verarbeitete Ausgangswörter zählen weiterhin zum Wort- und Geschwindigkeitslimit."
            )}
          </li>
          <li>
            {t(
              "All extracted source words are fresh provider usage and count toward the organization's monthly word quota. Uploaded and generated PDF files are not stored by this flow.",
              "Alle extrahierten Ausgangswörter gelten als neue Provider-Nutzung und zählen zum monatlichen Wortlimit der Organisation. Hochgeladene und erzeugte PDF-Dateien werden in diesem Ablauf nicht gespeichert."
            )}
          </li>
        </ul>
      </section>
    </div>
  );
}
