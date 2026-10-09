"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useLocale } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getLanguageName } from "@/lib/language-names";
import { uiText } from "@/lib/static-copy";

type Language = { langCode: string; isActive: boolean; isVisible: boolean; automaticTranslation: boolean };
type RemovalPreview = {
  langCode: string; translations: number; translationWords: number; urls: number; urlPaths: string[]; slugs: number; slugMappings: string[];
  mediaReplacements: number; glossaryRules: number; domainMappings: string[]; retainedPageViews: number;
  retainedBatches: number; retainedBilledWords: number; retainedProjectUsageWords: number;
  retainedMemberAssignments: number; retainedPendingInvitations: number;
  confirmationToken: string;
};

export function LanguageLifecycleManager({ projectId, languages }: { projectId: string; languages: Language[] }) {
  const locale = useLocale();
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [previews, setPreviews] = useState<RemovalPreview[]>([]);
  const path = `/api/projects/${projectId}/languages`;
  const say = (en: string, de: string) => uiText(locale, en, de);
  const statusText = (status: string) => ({
    updated: say("updated", "aktualisiert"),
    removed: say("removed", "entfernt"),
    not_found: say("not found", "nicht gefunden"),
    stale_preview: say("preview expired; review again", "Vorschau veraltet; bitte erneut prüfen"),
    preview_required: say("preview required", "Vorschau erforderlich"),
    duplicate: say("selected twice", "doppelt ausgewählt"),
    failed: say("failed", "fehlgeschlagen"),
  } as Record<string, string>)[status] ?? status;

  async function change(langCode: string, key: "isActive" | "isVisible" | "automaticTranslation", value: boolean) {
    setBusy(true);
    try {
      const response = await fetch(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ langCode, [key]: value }) });
      if (!response.ok) throw new Error((await response.json()).error);
      router.refresh();
      toast.success(say("Language updated", "Sprache aktualisiert"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : say("Update failed", "Aktualisierung fehlgeschlagen"));
    } finally { setBusy(false); }
  }

  async function bulk(action: "enable" | "disable") {
    if (!selected.length) return;
    setBusy(true);
    try {
      const response = await fetch(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, languages: selected.map((langCode) => ({ langCode })) }) });
      if (!response.ok) throw new Error(say("Bulk action failed", "Sammelaktion fehlgeschlagen"));
      const body = await response.json() as { results: { langCode: string; status: string }[] };
      toast.info(body.results.map((result) => `${result.langCode}: ${statusText(result.status)}`).join(" · "));
      router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function inspectRemoval(codes: string[]) {
    setBusy(true);
    try {
      const loaded: RemovalPreview[] = [];
      for (const langCode of codes) {
        const response = await fetch(`${path}?langCode=${encodeURIComponent(langCode)}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`${langCode}: ${say("Could not load removal preview", "Löschvorschau konnte nicht geladen werden")}`);
        loaded.push((await response.json()).preview);
      }
      setPreviews(loaded);
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function confirmRemoval() {
    setBusy(true);
    try {
      const response = await fetch(path, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", languages: previews.map((preview) => ({ langCode: preview.langCode, confirmationToken: preview.confirmationToken })) }),
      });
      if (!response.ok) throw new Error(say("Removal failed", "Entfernen fehlgeschlagen"));
      const body = await response.json() as { results: { langCode: string; status: string }[] };
      toast.info(body.results.map((result) => `${result.langCode}: ${statusText(result.status)}`).join(" · "));
      setPreviews([]);
      setSelected([]);
      router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  return <section className="mb-5 rounded-xl border border-gray-200 bg-white p-4" aria-label={say("Manage target languages", "Zielsprachen verwalten")}>
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <strong className="mr-auto text-sm">{say("Manage target languages", "Zielsprachen verwalten")}</strong>
      <Button size="sm" variant="outline" disabled={busy || !selected.length} onClick={() => bulk("enable")}>{say("Enable selected", "Ausgewählte aktivieren")}</Button>
      <Button size="sm" variant="outline" disabled={busy || !selected.length} onClick={() => bulk("disable")}>{say("Pause selected", "Ausgewählte pausieren")}</Button>
      <Button size="sm" variant="destructive" disabled={busy || !selected.length} onClick={() => inspectRemoval(selected)}>{say("Review removal", "Entfernen prüfen")}</Button>
    </div>
    <div className="space-y-2">
      {languages.map((language) => <div key={language.langCode} className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-100 px-3 py-2 text-sm">
        <label className="flex min-w-40 items-center gap-2">
          <input type="checkbox" checked={selected.includes(language.langCode)} onChange={(event) => setSelected((before) => event.target.checked ? [...before, language.langCode] : before.filter((code) => code !== language.langCode))} />
          {getLanguageName(language.langCode, locale)} <code>{language.langCode}</code>
        </label>
        {(["isActive", "isVisible", "automaticTranslation"] as const).map((key) => <label key={key} className="flex items-center gap-1.5">
          <input type="checkbox" disabled={busy} checked={language[key]} onChange={(event) => change(language.langCode, key, event.target.checked)} />
          {key === "isActive" ? say("Active", "Aktiv") : key === "isVisible" ? say("Visible", "Sichtbar") : say("Automatic translation", "Automatische Übersetzung")}
        </label>)}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => inspectRemoval([language.langCode])}>{say("Remove", "Entfernen")}</Button>
      </div>)}
    </div>
    <p className="mt-3 text-xs text-gray-500">{say("Pausing stops translated delivery. Hiding removes discovery links and marks direct pages noindex, but their URLs stay public; hiding is not access control. Turning off automatic translation keeps existing cached and manual content available.", "Pausieren stoppt die übersetzte Auslieferung. Ausblenden entfernt Sprachlinks und markiert direkte Seiten mit noindex; ihre URLs bleiben öffentlich. Ausblenden ist keine Zugriffssperre. Ohne automatische Übersetzung bleiben vorhandene und manuelle Inhalte verfügbar.")}</p>
    <Dialog open={previews.length > 0} onOpenChange={(open) => { if (!open) setPreviews([]); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{say("Review language removal", "Entfernen der Sprache prüfen")}</DialogTitle></DialogHeader>
        <p className="text-sm">{say("Removal permanently deletes the following target-language data. Historical billing and usage remain recorded.", "Beim Entfernen werden die folgenden Daten der Zielsprache dauerhaft gelöscht. Historische Abrechnung und Nutzung bleiben gespeichert.")}</p>
        {previews.map((preview) => <div key={preview.langCode} className="rounded-lg border p-3 text-sm">
          <strong>{preview.langCode}</strong>
          <p>{say("Deleted", "Gelöscht")}: {preview.translations} {say("translations", "Übersetzungen")} ({preview.translationWords} {say("words", "Wörter")}), {preview.urls} URLs, {preview.slugs} Slugs, {preview.glossaryRules} {say("glossary rules", "Glossarregeln")}, {preview.mediaReplacements} {say("media replacements", "Bildersetzungen")}, {preview.domainMappings.length} {say("domain mappings", "Domain-Zuordnungen")}.</p>
          <p>{say("Affected domains", "Betroffene Domains")}: {preview.domainMappings.join(", ") || "–"}</p>
          <p>{say("Affected URLs", "Betroffene URLs")}: {preview.urlPaths.join(", ") || "–"}{preview.urls > preview.urlPaths.length ? " …" : ""}</p>
          <p>{say("Affected slugs", "Betroffene Slugs")}: {preview.slugMappings.join(", ") || "–"}{preview.slugs > preview.slugMappings.length ? " …" : ""}</p>
          <p>{say("Retained", "Erhalten")}: {preview.retainedPageViews} {say("page views", "Seitenaufrufe")}, {preview.retainedBatches} {say("translation batches", "Übersetzungsläufe")}, {preview.retainedBilledWords} {say("billed language words", "abgerechnete Sprachwörter")}, {preview.retainedProjectUsageWords} {say("project usage words", "Projekt-Nutzungswörter")}, {preview.retainedMemberAssignments} {say("member assignments", "Mitgliedszuweisungen")}, {preview.retainedPendingInvitations} {say("pending invitations", "offene Einladungen")}.</p>
        </div>)}
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setPreviews([])}>{say("Cancel", "Abbrechen")}</Button><Button variant="destructive" disabled={busy} onClick={confirmRemoval}>{say("Permanently remove", "Dauerhaft entfernen")}</Button></div>
      </DialogContent>
    </Dialog>
  </section>;
}
