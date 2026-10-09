import type { SiteLocale } from "@/lib/site-locale";

const germanActions: Record<string, string> = {
  "api_key.created": "API-Schlüssel erstellt",
  "api_key.revoked": "API-Schlüssel widerrufen",
  "billing.address_updated": "Rechnungsadresse geändert",
  "billing.cancellation_requested": "Kündigung angefordert",
  "exclusion.created": "Ausnahme erstellt",
  "exclusion.deleted": "Ausnahme gelöscht",
  "exclusion.imported": "Ausnahmen importiert",
  "exclusion.updated": "Ausnahme geändert",
  "glossary.created": "Glossareintrag erstellt",
  "glossary.deleted": "Glossareintrag gelöscht",
  "glossary.import_chunk": "Glossareinträge importiert",
  "glossary.updated": "Glossareintrag geändert",
  "member.invitation_canceled": "Einladung zurückgezogen",
  "member.invitation_renewed": "Einladung erneuert",
  "member.invited": "Mitglied eingeladen",
  "member.joined": "Mitglied beigetreten",
  "member.removed": "Mitglied entfernt",
  "member.updated": "Mitglied geändert",
  "project.created": "Projekt erstellt",
  "project.deleted": "Projekt gelöscht",
  "project.language_model_updated": "Sprachmodell geändert",
  "project.language_removed": "Zielsprache entfernt",
  "project.language_updated": "Zielsprache geändert",
  "project.languages_added": "Zielsprachen hinzugefügt",
  "project.page_views_disabled": "Seitenaufrufe deaktiviert",
  "project.page_views_enabled": "Seitenaufrufe aktiviert",
  "project.runtime_sync_origin_cleared": "Synchronisierungsquelle entfernt",
  "project.settings_updated": "Projekteinstellungen geändert",
  "project.slugs_imported": "URL-Pfade importiert",
  "project.switcher_returned_to_wordpress": "Sprachauswahl zurückgesetzt",
  "project.switcher_updated": "Sprachauswahl geändert",
  "project.transferred_in": "Projekt in Arbeitsbereich verschoben",
  "project.transferred_out": "Projekt aus Arbeitsbereich verschoben",
  "project.translation_memory_updated": "Übersetzungsspeicher geändert",
  "translation.content_updated": "Übersetzung geändert",
  "translation.deleted": "Übersetzung gelöscht",
  "translation.import_chunk": "Übersetzungen importiert",
  "translation.machine_saved": "Maschinelle Übersetzungen gespeichert",
  "translation.manual_created": "Manuelle Übersetzung erstellt",
  "translation.manual_updated": "Manuelle Übersetzung geändert",
  "translation.metadata_updated": "Übersetzungsmetadaten geändert",
  "translation.search_replaced": "Übersetzungen gesucht und ersetzt",
  "translation.url_retranslated": "URL erneut übersetzt",
  "translation.workflow_bulk_updated": "Übersetzungsstatus gesammelt geändert",
  "translation.workflow_updated": "Übersetzungsstatus geändert",
  "webhook.created": "Webhook erstellt",
  "webhook.deleted": "Webhook gelöscht",
  "webhook.updated": "Webhook geändert",
  "workspace.activity_digest_updated": "Aktivitätsbericht geändert",
  "workspace.created": "Arbeitsbereich erstellt",
  "workspace.member_add": "Mitglied zum Arbeitsbereich hinzugefügt",
  "workspace.member_remove": "Mitglied aus Arbeitsbereich entfernt",
  "workspace.member_role": "Rolle im Arbeitsbereich geändert",
  "workspace.renamed": "Arbeitsbereich umbenannt",
};

export function auditActionLabel(action: string, locale: SiteLocale) {
  if (locale === "de") return germanActions[action] ?? action.replaceAll(/[._]/g, " ");
  return action.replaceAll(/[._]/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function auditCategoryLabel(category: string, locale: SiteLocale) {
  if (locale !== "de") return category.replaceAll("_", " ");
  return ({ project: "Projekt", member: "Mitglied", translation: "Übersetzung",
    glossary: "Glossar", exclusion: "Ausnahme", api_key: "API-Schlüssel",
    webhook: "Webhook", billing: "Abrechnung", workspace: "Arbeitsbereich" } as Record<string, string>)[category] ?? category;
}

const metadataLabels: Record<string, [string, string]> = {
  count: ["Count", "Anzahl"], language: ["Language", "Sprache"],
  role: ["Role", "Rolle"], status: ["Status", "Status"],
  kind: ["Kind", "Typ"], source: ["Source", "Quelle"],
  targetId: ["Target ID", "Ziel-ID"], affectedId: ["Affected ID", "Betroffene ID"],
};

export function auditMetadataLabel(metadata: unknown, locale: SiteLocale) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  return Object.entries(metadata).filter(([key, value]) =>
    Object.hasOwn(metadataLabels, key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
  ).map(([key, value]) => `${metadataLabels[key][locale === "de" ? 1 : 0]}: ${value}`).join(" · ");
}
