"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/providers/locale-provider";
import { uiText } from "@/lib/static-copy";

type Preview = {
  projectName: string; sourceName: string; destinationName: string;
  destinationPlan: string; destinationProjectCount: number; destinationProjectsLimit: number;
  destinationWordsUsed: number; destinationWordsLimit: number; sourceProjectWordsThisMonth: number;
  languages: number; translations: number; manualTranslations: number;
  translatedUrls: number; urlSlugs: number; keptProjectMembers: number; removedProjectMembers: number;
  revokedInvitations: number; revokedApiKeys: number; disabledWebhookEndpoints: number;
  retainedWebhookDeliveries: number; retainedHistoricalBatches: number; clearedProviderKey: boolean;
  providerReconnectRequiredAfterTransfer: boolean;
  fingerprint: string; issuedAt: string; confirmationToken: string;
};

export function ProjectTransferDialog({ projectId, projectName, organizationId }: {
  projectId: string; projectName: string; organizationId: string;
}) {
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [destinations, setDestinations] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [destinationId, setDestinationId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);

  async function show() {
    setOpen(true); setPreview(null); setAcknowledged(false);
    const response = await fetch("/api/workspaces");
    if (!response.ok) return;
    const data = await response.json();
    setDestinations(data.workspaces.filter((row: { id: string; role: string }) =>
      row.id !== organizationId && (row.role === "OWNER" || row.role === "ADMIN")));
  }

  async function requestPreview() {
    setBusy(true); setPreview(null); setAcknowledged(false);
    try {
      const response = await fetch(`/api/projects/${projectId}/transfer`, { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destinationId }) });
      if (!response.ok) { toast.error(uiText(locale, "Transfer preview unavailable. Check destination access and plan limits.", "Transfer-Vorschau nicht verfügbar. Prüfe Zielzugriff und Planlimits.")); return; }
      setPreview(await response.json());
    } finally { setBusy(false); }
  }

  async function transfer() {
    if (!preview || !acknowledged) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/transfer`, { method: "PUT",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destinationId,
          fingerprint: preview.fingerprint, issuedAt: preview.issuedAt,
          confirmationToken: preview.confirmationToken }) });
      if (!response.ok) { setPreview(null); setAcknowledged(false);
        toast.error(uiText(locale, "Transfer changed or failed. Request a fresh preview.", "Transfer geändert oder fehlgeschlagen. Fordere eine neue Vorschau an.")); return; }
      setOpen(false); router.refresh();
      toast.success(uiText(locale, "Project transferred. Reconnect the plugin and webhook credentials.", "Projekt übertragen. Verbinde Plugin und Webhook-Zugänge neu."));
    } finally { setBusy(false); }
  }

  return <>
    <Button type="button" variant="ghost" size="sm" onClick={show}>
      {uiText(locale, "Transfer", "Übertragen")}
    </Button>
    {open && <div role="presentation" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-label={uiText(locale, "Transfer project", "Projekt übertragen")}
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl space-y-4">
        <h2 className="text-lg font-bold">{uiText(locale, "Transfer project", "Projekt übertragen")}: {projectName}</h2>
        <p className="text-sm text-gray-600">{uiText(locale,
          "Only a workspace owner or admin can transfer to a workspace they also manage.",
          "Nur Workspace-Owner oder -Admins können in einen Workspace übertragen, den sie ebenfalls verwalten.")}</p>
        <select className="w-full rounded-md border p-2" value={destinationId} onChange={(event) => {
          setDestinationId(event.target.value); setPreview(null); setAcknowledged(false);
        }} aria-label={uiText(locale, "Destination workspace", "Ziel-Workspace")}>
          <option value="">{uiText(locale, "Choose destination", "Ziel wählen")}</option>
          {destinations.map((destination) => <option key={destination.id} value={destination.id}>{destination.name}</option>)}
        </select>
        {!destinations.length && <p className="text-sm">{uiText(locale,
          "No other workspace under your management is available.",
          "Kein weiterer Workspace unter deiner Verwaltung verfügbar.")}</p>}
        <Button type="button" onClick={requestPreview} disabled={!destinationId || busy}>
          {uiText(locale, "Show transfer preview", "Transfer-Vorschau anzeigen")}
        </Button>
        {preview && <div className="space-y-3 text-sm">
          <p className="font-semibold">{preview.sourceName} → {preview.destinationName}</p>
          <dl className="grid grid-cols-2 gap-2 rounded-lg border p-3">
            <dt>{uiText(locale, "Destination plan", "Ziel-Plan")}</dt><dd>{preview.destinationPlan}</dd>
            <dt>{uiText(locale, "Destination projects", "Ziel-Projekte")}</dt><dd>{preview.destinationProjectCount + 1}/{preview.destinationProjectsLimit}</dd>
            <dt>{uiText(locale, "Destination words used this month", "Ziel-Wörter diesen Monat")}</dt><dd>{preview.destinationWordsUsed}/{preview.destinationWordsLimit}</dd>
            <dt>{uiText(locale, "Source billed words this month", "Bereits beim Ursprung abgerechnete Wörter")}</dt><dd>{preview.sourceProjectWordsThisMonth}</dd>
            <dt>{uiText(locale, "Languages / translations / manual", "Sprachen / Übersetzungen / manuell")}</dt><dd>{preview.languages} / {preview.translations} / {preview.manualTranslations}</dd>
            <dt>{uiText(locale, "URLs / slugs", "URLs / Slugs")}</dt><dd>{preview.translatedUrls} / {preview.urlSlugs}</dd>
            <dt>{uiText(locale, "Project members kept / removed", "Projektmitglieder behalten / entfernt")}</dt><dd>{preview.keptProjectMembers} / {preview.removedProjectMembers}</dd>
            <dt>{uiText(locale, "Pending invitations revoked", "Offene Einladungen widerrufen")}</dt><dd>{preview.revokedInvitations}</dd>
            <dt>{uiText(locale, "API keys revoked", "API-Keys widerrufen")}</dt><dd>{preview.revokedApiKeys}</dd>
            <dt>{uiText(locale, "Webhooks disabled", "Webhooks deaktiviert")}</dt><dd>{preview.disabledWebhookEndpoints}</dd>
            <dt>{uiText(locale, "Previous deliveries / batches retained", "Frühere Zustellungen / Batches bleiben")}</dt><dd>{preview.retainedWebhookDeliveries} / {preview.retainedHistoricalBatches}</dd>
            <dt>{uiText(locale, "Provider key cleared", "Provider-Key entfernt")}</dt><dd>{preview.clearedProviderKey ? uiText(locale, "Yes", "Ja") : uiText(locale, "No", "Nein")}</dd>
            <dt>{uiText(locale, "Provider reconnect required after transfer", "Provider-Verbindung nach Transfer erforderlich")}</dt><dd>{preview.providerReconnectRequiredAfterTransfer ? uiText(locale, "Yes", "Ja") : uiText(locale, "No", "Nein")}</dd>
          </dl>
          <ul className="list-disc space-y-1 pl-5">
            <li>{uiText(locale, "Workspace members and roles stay in their workspaces. Only project members already in the destination remain; source-only assignments are cleared. Pending invitations are revoked.", "Workspace-Mitglieder und Rollen bleiben in ihren Workspaces. Nur Projektmitglieder, die bereits zum Ziel gehören, bleiben; Zuweisungen entfernter Mitglieder werden aufgehoben. Offene Einladungen werden widerrufen.")}</li>
            <li>{uiText(locale, "Subscriptions and billing ownership stay separate. Past billed usage and batches remain with the source, including this month; future usage counts for the destination.", "Abos und Abrechnungsverantwortung bleiben getrennt. Bereits abgerechnete Nutzung und Batches bleiben beim Ursprung, auch in diesem Monat; künftige Nutzung zählt beim Ziel.")}</li>
            <li>{uiText(locale, "Translations, manual edits, history, glossary, URLs, slugs and media remain with the project. No content is retransmitted to a provider during transfer.", "Übersetzungen, manuelle Änderungen, Verlauf, Glossar, URLs, Slugs und Medien bleiben beim Projekt. Beim Transfer wird kein Inhalt erneut an einen Provider gesendet.")}</li>
            <li>{uiText(locale, "All plugin API keys are deactivated and cannot be recovered. Reconnect WordPress with a newly created key after transfer.", "Alle Plugin-API-Keys werden deaktiviert und können nicht wiederhergestellt werden. Verbinde WordPress nach dem Transfer mit einem neu erstellten Key.")}</li>
            <li>{preview.clearedProviderKey
              ? uiText(locale, "The source provider key is removed and fresh provider work is paused until a destination-owned key is saved.", "Der Provider-Key des Ursprungs wird entfernt. Neue Provider-Aufträge bleiben pausiert, bis ein Key des Ziel-Workspace gespeichert ist.")
              : preview.providerReconnectRequiredAfterTransfer
                ? uiText(locale, "The provider connection is already paused from an earlier transfer and remains paused until a destination-owned key is saved.", "Die Provider-Verbindung ist seit einem früheren Transfer pausiert und bleibt es, bis ein Key des Ziel-Workspace gespeichert ist.")
                : uiText(locale, "No project provider key is moved. Existing platform provider settings remain subject to the destination plan and quota.", "Es wird kein Projekt-Provider-Key mitgenommen. Bestehende Plattform-Provider-Einstellungen unterliegen dem Plan und Kontingent des Ziel-Workspace.")}</li>
            <li>{uiText(locale, "Webhook endpoints are disabled, signing secrets removed and pending deliveries failed. Reconnect the endpoint and secret explicitly; past delivery records remain.", "Webhook-Endpunkte werden deaktiviert, Signatur-Secrets entfernt und offene Zustellungen als fehlgeschlagen markiert. Verbinde Endpunkt und Secret ausdrücklich neu; frühere Zustellungen bleiben erhalten.")}</li>
            <li>{uiText(locale, "WordPress runtime sync state is reset; workspace notification preferences remain with their original memberships.", "Der WordPress-Runtime-Sync-Status wird zurückgesetzt; Workspace-Benachrichtigungseinstellungen bleiben bei ihren bisherigen Mitgliedschaften.")}</li>
          </ul>
          <p>{uiText(locale,
            "Billing and past usage remain with the source. Future usage belongs to the destination. Translations, manual edits, URLs, slugs, domain mapping and non-secret runtime settings stay with the project. The plugin and webhooks need reconnecting.",
            "Abrechnung und bisherige Nutzung bleiben beim Ursprung. Künftige Nutzung gehört zum Ziel. Übersetzungen, manuelle Änderungen, URLs, Slugs, Domain-Zuordnung und Runtime-Einstellungen ohne Geheimnisse bleiben beim Projekt. Plugin und Webhooks müssen neu verbunden werden.")}</p>
          <label className="flex gap-2"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            {uiText(locale, "I understand these changes and confirm the transfer.", "Ich verstehe diese Folgen und bestätige die Übertragung.")}</label>
          <Button type="button" disabled={!acknowledged || busy} onClick={transfer}>{uiText(locale, "Transfer now", "Jetzt übertragen")}</Button>
        </div>}
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>{uiText(locale, "Cancel", "Abbrechen")}</Button>
      </div>
    </div>}
  </>;
}
