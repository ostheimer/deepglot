"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { useLocale } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  filterMediaMappings,
  mediaDisplayKind,
  mediaMappingPayload,
  type MediaMapping,
} from "@/lib/media-dashboard";
import { getLanguageName } from "@/lib/language-names";
import { withLocalePrefix } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

export function MediaManager({
  projectId,
  domain,
  languages,
}: {
  projectId: string;
  domain: string;
  languages: { langCode: string; isActive: boolean }[];
}) {
  const locale = useLocale();
  const t = (en: string, de: string) => uiText(locale, en, de);
  const [rows, setRows] = useState<MediaMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [limitExceeded, setLimitExceeded] = useState(false);
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("");
  const [kind, setKind] = useState("");
  const [form, setForm] = useState<MediaMapping | null>(null);
  const [editBaseline, setEditBaseline] = useState<MediaMapping | null>(null);
  const [deleting, setDeleting] = useState<MediaMapping | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endpoint = `/api/projects/${projectId}/media`;
  const active = languages.filter((item) => item.isActive);
  const selectClass =
    "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
  const labels = {
    image: t("Image", "Bild"),
    document: t("Document", "Dokument"),
    video: t("Video file", "Videodatei"),
    embed: t("Video embed", "Video-Einbettung"),
  };
  const languageLabel = (code: string) =>
    `${getLanguageName(code, locale)} (${code.toUpperCase()})`;
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error("load failed");
      const data = await response.json();
      setRows(data.mediaReplacements);
      setLimitExceeded(data.limitExceeded === true);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [endpoint]);
  useEffect(() => {
    void load();
  }, [load]);

  function apiError(code?: string) {
    switch (code) {
      case "media_replacement_already_exists":
        return t(
          "A mapping already exists for this original URL and language.",
          "Für diese Original-URL und Sprache existiert bereits eine Zuordnung.",
        );
      case "inactive_target_language":
        return t(
          "Activate this target language in the project first.",
          "Aktiviere diese Zielsprache zuerst im Projekt.",
        );
      case "invalid_media_image_url":
        return t(
          "Use supported same-site file URLs or exact supported video embed URLs. Check the format and origin of both URLs.",
          "Verwende unterstützte Datei-URLs derselben Website oder exakt unterstützte Video-Einbettungs-URLs. Prüfe Format und Herkunft beider URLs.",
        );
      case "media_replacements_limit_exceeded":
        return t(
          "The project limit of 500 mappings has been reached.",
          "Das Projektlimit von 500 Zuordnungen ist erreicht.",
        );
      case "media_replacements_payload_too_large":
        return t(
          "These URLs exceed the runtime size limit. Shorten URLs or remove unused mappings.",
          "Diese URLs überschreiten die zulässige Laufzeitgröße. Kürze URLs oder entferne ungenutzte Zuordnungen.",
        );
      case "media_replacement_not_found":
        return t(
          "This mapping no longer exists. Close the dialog and reload the list.",
          "Diese Zuordnung existiert nicht mehr. Schließe den Dialog und lade die Liste neu.",
        );
      default:
        return t(
          "Could not save the change. Check your connection and project permissions, then try again.",
          "Die Änderung konnte nicht gespeichert werden. Prüfe Verbindung und Projektberechtigungen und versuche es erneut.",
        );
    }
  }

  async function mutate(remove = false) {
    const item = remove ? deleting : form;
    if (!item || busy) return;
    const payload = remove
      ? null
      : mediaMappingPayload(item, item.id ? editBaseline : null);
    if (!remove && item.id && payload && !Object.keys(payload).length) {
      setForm(null);
      setError("");
      await load();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `${endpoint}${item.id ? `/${item.id}` : ""}`,
        {
          method: remove ? "DELETE" : item.id ? "PATCH" : "POST",
          ...(!remove
            ? {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              }
            : {}),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(apiError(data.code));
        return;
      }
      if (!remove && !data.mediaReplacement) {
        setError(apiError());
        return;
      }
      setRows((current) =>
        remove
          ? current.filter((row) => row.id !== item.id)
          : [
              ...current.filter((row) => row.id !== item.id),
              data.mediaReplacement,
            ].sort(
              (a, b) =>
                a.langTo.localeCompare(b.langTo) ||
                a.originalUrl.localeCompare(b.originalUrl),
            ),
      );
      setForm(null);
      setDeleting(null);
      toast.success(
        remove
          ? t("Mapping deleted", "Zuordnung gelöscht")
          : t("Mapping saved", "Zuordnung gespeichert"),
      );
    } catch {
      setError(apiError());
    } finally {
      setBusy(false);
    }
  }

  const visible = filterMediaMappings(rows, query, language, kind);
  const filterLanguages = [
    ...new Set([
      ...languages.map((item) => item.langCode),
      ...rows.map((item) => item.langTo),
    ]),
  ].sort();
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">{t("Media", "Medien")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            {t(
              "Replace media URLs for individual target languages. Without a mapping, the original asset stays in place.",
              "Ersetze Medien-URLs für einzelne Zielsprachen. Ohne Zuordnung bleibt das Original erhalten.",
            )}
          </p>
        </div>
        <Button
          disabled={
            loading ||
            loadError ||
            !active.length ||
            limitExceeded ||
            rows.length >= 500
          }
          onClick={() => {
            setError("");
            setForm({
              id: "",
              originalUrl: "",
              localizedUrl: "",
              langTo:
                active.find((item) => item.langCode === language)?.langCode ??
                active[0].langCode,
            });
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          {t("Add mapping", "Zuordnung hinzufügen")}
        </Button>
      </div>
      <div className="rounded-lg border bg-gray-50 p-4 text-sm text-gray-600 space-y-2">
        <p>
          {t("Same-site files on", "Dateien derselben Website auf")}{" "}
          <strong className="break-all">{domain}</strong>: PNG, JPG, WebP, AVIF,
          GIF; PDF, DOCX, XLSX, PPTX; MP4, WebM.{" "}
          {t(
            "Use root-relative paths or same-origin HTTPS URLs. Documents and videos must keep their file format.",
            "Verwende Pfade ab / oder HTTPS-URLs derselben Herkunft. Dokumente und Videos müssen ihr Dateiformat behalten.",
          )}
        </p>
        <p>
          {t(
            "Embeds: exact YouTube, YouTube-nocookie or Vimeo embed URLs, using the same provider. No uploads or AI generation. Only use assets you are authorized to publish. WordPress must sync the mapping; upstream CDN caches may need clearing.",
            "Einbettungen: exakte YouTube-, YouTube-nocookie- oder Vimeo-Einbettungs-URLs desselben Anbieters. Keine Uploads oder KI-Generierung. Verwende nur Medien, die du veröffentlichen darfst. WordPress muss die Zuordnung synchronisieren; vorgeschaltete CDN-Caches müssen gegebenenfalls geleert werden.",
          )}
        </p>
        <Link
          className="underline"
          href={withLocalePrefix("/docs", locale) + "#media-replacements"}
        >
          {t(
            "Supported URLs and fallback rules",
            "Unterstützte URLs und Fallback-Regeln",
          )}
        </Link>
      </div>
      {!active.length && (
        <p className="text-sm">
          {t(
            "Activate a target language before adding a mapping.",
            "Aktiviere eine Zielsprache, um eine Zuordnung hinzuzufügen.",
          )}{" "}
          <Link
            className="underline"
            href={withLocalePrefix(
              `/projects/${projectId}/translations/languages`,
              locale,
            )}
          >
            {t("Manage languages", "Sprachen verwalten")}
          </Link>
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="media-search">
            {t("Search URLs", "URLs durchsuchen")}
          </Label>
          <Input
            id="media-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t(
              "Original or replacement URL",
              "Original- oder Ersatz-URL",
            )}
          />
        </div>
        <div>
          <Label htmlFor="media-language">
            {t("Target language", "Zielsprache")}
          </Label>
          <select
            id="media-language"
            className={selectClass}
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            <option value="">{t("All languages", "Alle Sprachen")}</option>
            {filterLanguages.map((code) => (
              <option key={code} value={code}>
                {languageLabel(code)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="media-kind">{t("Media type", "Medientyp")}</Label>
          <select
            id="media-kind"
            className={selectClass}
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="">{t("All types", "Alle Typen")}</option>
            {Object.entries(labels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {loading ? (
        <p role="status">
          {t("Loading mappings…", "Zuordnungen werden geladen…")}
        </p>
      ) : loadError ? (
        <div role="alert">
          <p>
            {t(
              "Could not load mappings. Check your connection and permissions.",
              "Zuordnungen konnten nicht geladen werden. Prüfe Verbindung und Berechtigungen.",
            )}
          </p>
          <Button variant="outline" onClick={() => void load()}>
            {t("Retry", "Erneut versuchen")}
          </Button>
        </div>
      ) : (
        <>
          {limitExceeded && (
            <p role="alert">
              {t(
                "The list exceeds the supported limit and is incomplete. Remove unused mappings and reload.",
                "Die Liste überschreitet das unterstützte Limit und ist unvollständig. Entferne ungenutzte Zuordnungen und lade sie neu.",
              )}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-sm text-gray-500">
              {visible.length} / {rows.length} {t("mappings", "Zuordnungen")}
            </p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              {t("Reload", "Neu laden")}
            </Button>
          </div>
          {!visible.length ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-gray-600">
              {rows.length
                ? t(
                    "No mappings match these filters.",
                    "Keine Zuordnungen passen zu diesen Filtern.",
                  )
                : t(
                    "No media mappings yet. Add a URL replacement for an active target language.",
                    "Noch keine Medienzuordnungen vorhanden. Füge eine URL-Ersetzung für eine aktive Zielsprache hinzu.",
                  )}
            </div>
          ) : (
            <ul className="space-y-3">
              {visible.map((row) => (
                <li
                  key={row.id}
                  className="min-w-0 rounded-lg border bg-white p-4"
                  data-testid="media-mapping"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {languageLabel(row.langTo)} ·{" "}
                      {labels[mediaDisplayKind(row.originalUrl)]}
                      {!active.some((item) => item.langCode === row.langTo) && (
                        <span className="ml-2 text-amber-700">
                          {t("Inactive language", "Inaktive Sprache")}
                        </span>
                      )}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setError("");
                          setEditBaseline({ ...row });
                          setForm({ ...row });
                        }}
                      >
                        {t("Edit", "Bearbeiten")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setError("");
                          setDeleting(row);
                        }}
                      >
                        {t("Delete", "Löschen")}
                      </Button>
                    </div>
                  </div>
                  <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                    <div className="min-w-0">
                      <dt className="text-gray-500">
                        {t("Original URL", "Original-URL")}
                      </dt>
                      <dd className="mt-1 break-all">{row.originalUrl}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-gray-500">
                        {t("Replacement URL", "Ersatz-URL")}
                      </dt>
                      <dd className="mt-1 break-all">{row.localizedUrl}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <Dialog
        open={!!form}
        onOpenChange={(open) => {
          if (!open && !busy) setForm(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {form?.id
                ? t("Edit mapping", "Zuordnung bearbeiten")
                : t("Add mapping", "Zuordnung hinzufügen")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "The replacement applies only to the selected target language. Both URLs must use a supported format.",
                "Die Ersetzung gilt nur für die gewählte Zielsprache. Beide URLs müssen ein unterstütztes Format verwenden.",
              )}
            </DialogDescription>
          </DialogHeader>
          {form && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void mutate();
              }}
              className="space-y-4"
            >
              <div>
                <Label htmlFor="mapping-language">
                  {t("Target language", "Zielsprache")}
                </Label>
                <select
                  id="mapping-language"
                  required
                  disabled={busy}
                  className={selectClass}
                  value={form.langTo}
                  onChange={(event) =>
                    setForm({ ...form, langTo: event.target.value })
                  }
                >
                  {!active.some((item) => item.langCode === form.langTo) && (
                    <option value={form.langTo} disabled>
                      {languageLabel(form.langTo)} — {t("inactive", "inaktiv")}
                    </option>
                  )}
                  {active.map((item) => (
                    <option key={item.langCode} value={item.langCode}>
                      {languageLabel(item.langCode)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="mapping-original">
                  {t("Original URL", "Original-URL")}
                </Label>
                <Input
                  id="mapping-original"
                  required
                  maxLength={2048}
                  disabled={busy}
                  value={form.originalUrl}
                  onChange={(event) =>
                    setForm({ ...form, originalUrl: event.target.value })
                  }
                  placeholder="/wp-content/uploads/brochure.pdf"
                />
              </div>
              <div>
                <Label htmlFor="mapping-localized">
                  {t("Replacement URL", "Ersatz-URL")}
                </Label>
                <Input
                  id="mapping-localized"
                  required
                  maxLength={2048}
                  disabled={busy}
                  value={form.localizedUrl}
                  onChange={(event) =>
                    setForm({ ...form, localizedUrl: event.target.value })
                  }
                  placeholder="/wp-content/uploads/brochure-en.pdf"
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-red-700">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setForm(null)}
                >
                  {t("Cancel", "Abbrechen")}
                </Button>
                <Button
                  type="submit"
                  disabled={
                    busy ||
                    !active.some((item) => item.langCode === form.langTo)
                  }
                >
                  {busy
                    ? t("Saving…", "Wird gespeichert…")
                    : t("Save", "Speichern")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t("Delete mapping?", "Zuordnung löschen?")}
            </DialogTitle>
            <DialogDescription className="break-all">
              {deleting?.originalUrl} · {deleting?.langTo.toUpperCase()}.{" "}
              {t(
                "The original media will be used again after WordPress sync. The media files themselves are retained.",
                "Nach der WordPress-Synchronisierung wird wieder das Original verwendet. Die Mediendateien selbst bleiben erhalten.",
              )}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              {t("Cancel", "Abbrechen")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void mutate(true)}
            >
              {busy ? t("Deleting…", "Wird gelöscht…") : t("Delete", "Löschen")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
