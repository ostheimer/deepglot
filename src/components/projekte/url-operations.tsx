"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";

type Action = "retranslate" | "delete";
type Preview = {
  id: string; urlPath: string; langTo: string; action: Action; afterId?: string; confirmation: string;
  affectedSegments: number; sharedSegments: number; protectedSegments: number;
  totalEligibleSegments: number; remainingSegments: number; nextAfterId: string | null;
  billableWords: number; wordsUsed: number; wordsLimit: number; canRetranslate: boolean; canDelete: boolean; reason: string | null;
};

type UrlRecord = { id: string; urlPath: string; sourceUrl: string; langTo: string; wordCount: number; requestCount: number; lastSeenAt: string; operationState: string | null; lastResult: string | null; lastHttpStatus: number | null; origin: string | null; lastOperationAt: string | null; lastError: string | null };

export function UrlOperations({ projectId, records, wordpressSyncUrl, locale, canManage }: { projectId: string; records: UrlRecord[]; wordpressSyncUrl: string | null; locale: string; canManage: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Array<{ id: string; urlPath: string; ok: boolean; detail: string; action?: Action; nextAfterId?: string | null }>>([]);
  const de = locale === "de";
  const reasonText = (reason: string | null) => {
    const labels: Record<string, [string, string]> = {
      provider_outcome_unknown: ["Provider-Ausgang ungeklärt: Erst Buchung und Datenstand prüfen lassen.", "Provider outcome unresolved: Have billing and data checked first."],
      target_language_inactive: ["Zielsprache ist inaktiv.", "Target language is inactive."],
      automatic_translation_disabled: ["Automatische Übersetzung ist deaktiviert.", "Automatic translation is disabled."],
      no_exclusive_machine_segments: ["Keine ausschließlich zugeordneten automatischen Segmente.", "No exclusive automatic segments."],
      quota_exceeded: ["Monatskontingent reicht für diesen Schritt nicht aus.", "Monthly quota is insufficient for this step."],
    };
    return reason ? (labels[reason]?.[de ? 0 : 1] ?? reason) : "";
  };
  const ids = records.map((record) => record.id);
  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/url-operations`;
  const resultText = (result: string, remaining?: number) => {
    const labels: Record<string, [string, string]> = {
      completed: ["Neuübersetzung abgeschlossen", "Retranslation completed"],
      deleted: ["URL-Daten gelöscht", "URL data deleted"],
      partial: ["Schritt abgeschlossen", "Step completed"],
      failed: ["Aktion fehlgeschlagen", "Action failed"],
      unknown: ["Provider-Ausgang ungeklärt; vor weiteren Aktionen abgleichen", "Provider outcome unresolved; reconcile before further actions"],
    };
    const label = labels[result]?.[de ? 0 : 1] ?? result;
    return remaining && remaining > 0 ? `${label}; ${remaining} ${de ? "geeignete Segmente verbleiben" : "eligible segments remain"}` : label;
  };

  async function open(action: Action, targetIds: string[], afterId?: string) {
    setBusy(true); if (!afterId) setResults([]);
    const output: Preview[] = [];
    const failures: Array<{ id: string; urlPath: string; ok: boolean; detail: string }> = [];
    for (const id of targetIds) {
      const urlPath = records.find((record) => record.id === id)?.urlPath ?? id;
      try {
        const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id, afterId }) });
        const payload = await response.json();
        if (response.ok) output.push({ ...payload, afterId } as Preview);
        else failures.push({ id, urlPath, ok: false, detail: String(payload.error ?? response.status) });
      } catch { failures.push({ id, urlPath, ok: false, detail: de ? "Netzwerkfehler" : "Network error" }); }
    }
    setPreviews(output); setResults(failures); setBusy(false);
  }

  async function confirm() {
    setBusy(true);
    const output = [...results];
    for (const preview of previews) {
      if ((preview.action === "retranslate" && !preview.canRetranslate) || (preview.action === "delete" && !preview.canDelete)) {
        output.push({ id: preview.id, urlPath: preview.urlPath, ok: false, detail: reasonText(preview.reason) || (de ? "Nicht verfügbar" : "Unavailable") });
        continue;
      }
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": preview.confirmation },
          body: JSON.stringify({ action: preview.action, id: preview.id, afterId: preview.afterId, confirmation: preview.confirmation }),
        });
        const payload = await response.json();
        const unresolved = payload.result === "unknown" || payload.error === "provider_outcome_unknown" || payload.code === "provider_outcome_unknown";
        output.push({ id: preview.id, urlPath: preview.urlPath, ok: response.ok && !unresolved && payload.result !== "failed", detail: unresolved ? resultText("unknown") : response.ok ? resultText(payload.result ?? (preview.action === "delete" ? "deleted" : "completed"), payload.remainingSegments) : String(payload.error ?? response.status), action: preview.action, nextAfterId: payload.nextAfterId ?? null });
      } catch { output.push({ id: preview.id, urlPath: preview.urlPath, ok: false, detail: de ? "Netzwerkfehler; Ergebnis vor erneutem Versuch prüfen" : "Network error; check result before retrying" }); }
      setResults([...output]);
    }
    setPreviews([]); setSelected([]); setBusy(false); router.refresh();
  }

  return <div className="space-y-3">
    {canManage && <div className="flex flex-wrap items-center gap-2">
      <label className="text-sm"><input type="checkbox" checked={ids.length > 0 && selected.length === Math.min(ids.length, 10)} onChange={(event) => setSelected(event.target.checked ? ids.slice(0, 10) : [])} /> {de ? "Bis zu 10 sichtbare auswählen" : "Select up to 10 visible"}</label>
      <Button size="sm" variant="outline" disabled={busy || selected.length === 0} onClick={() => open("retranslate", selected)}>{de ? "Auswahl neu übersetzen" : "Retranslate selected"}</Button>
      <Button size="sm" variant="outline" disabled={busy || selected.length === 0} onClick={() => open("delete", selected)}>{de ? "Auswahl löschen" : "Delete selected"}</Button>
      <span className="text-xs text-gray-500">{selected.length}/10 {de ? "ausgewählt (max. 10)" : "selected (max 10)"}</span>
    </div>}
    <div className="space-y-3">
      {records.map((record) => <article key={record.id} className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
        <div className="flex items-start gap-3">
          {canManage && <input type="checkbox" className="mt-1" aria-label={`${de ? "URL auswählen" : "Select URL"} ${record.urlPath}`} checked={selected.includes(record.id)} onChange={(event) => setSelected((old) => event.target.checked ? [...old, record.id].slice(0, 10) : old.filter((value) => value !== record.id))} />}
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2 font-semibold text-gray-900"><span className="min-w-0 break-all">{record.urlPath}</span><a href={record.sourceUrl} target="_blank" rel="noreferrer" aria-label={de ? `${record.urlPath} öffnen` : `Open ${record.urlPath}`} className="shrink-0 text-gray-500"><ExternalLink className="h-4 w-4" /></a></div>
            <div className="mt-3 grid gap-3 text-xs text-gray-600 sm:grid-cols-3">
              <div><span className="block font-semibold uppercase tracking-wide text-gray-400">{de ? "Wörter / Aufrufe" : "Words / requests"}</span>{record.wordCount} / {record.requestCount}</div>
              <div><span className="block font-semibold uppercase tracking-wide text-gray-400">{de ? "Letztes Ergebnis" : "Last result"}</span><span className={record.operationState?.includes("failed") || record.operationState === "provider_pending" ? "text-red-700" : ""}>{record.operationState === "sync_failed" ? (de ? "Sync fehlgeschlagen" : "Sync failed") : record.operationState === "sync_completed" ? (de ? "Sync abgeschlossen" : "Sync completed") : record.operationState === "sync_retry" ? (de ? "Sync wiederholt" : "Sync retry") : record.operationState === "provider_pending" ? (de ? "Provider-Ausgang ungeklärt" : "Provider outcome unresolved") : record.operationState === "completed" ? (de ? "Neu übersetzt" : "Retranslated") : record.operationState === "failed" ? (de ? "Aktion fehlgeschlagen" : "Action failed") : (de ? "Nicht erfasst" : "Not recorded")}</span>{record.lastHttpStatus && <span> · HTTP {record.lastHttpStatus}</span>}{record.lastError && <div className="text-red-700">{record.lastError}</div>}{record.origin && <div className="break-all">{record.origin}</div>}</div>
              <div><span className="block font-semibold uppercase tracking-wide text-gray-400">{de ? "Zuletzt gesehen" : "Last seen"}</span>{new Date(record.lastSeenAt).toLocaleString(de ? "de-AT" : "en-US")}{record.lastOperationAt && <div>{de ? "Aktion:" : "Action:"} {new Date(record.lastOperationAt).toLocaleString(de ? "de-AT" : "en-US")}</div>}</div>
            </div>
          </div>
        </div>
        {canManage && <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-3"><Button size="sm" variant="outline" disabled={busy} onClick={() => open("retranslate", [record.id])}>{de ? "Neu übersetzen" : "Retranslate"}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => open("delete", [record.id])}>{de ? "Löschen" : "Delete"}</Button>{record.operationState === "sync_failed" && wordpressSyncUrl && <a className="self-center text-sm underline" href={`${wordpressSyncUrl}#deepglot-url-sync`} target="_blank" rel="noreferrer">{de ? "WordPress öffnen und Wiederholung bestätigen" : "Open WordPress to confirm retry"}</a>}</div>}
      </article>)}
      {records.length === 0 && <p className="rounded-xl border bg-white p-8 text-center text-gray-500">{de ? "Keine URL-Einträge gefunden." : "No URL records found."}</p>}
    </div>
    {canManage && previews.length > 0 && <div role="dialog" aria-modal="true" aria-label={de ? "URL-Aktion bestätigen" : "Confirm URL action"} className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm space-y-3">
      <p className="font-semibold">{de ? "Aktuelle Vorschau bestätigen" : "Confirm current preview"}</p>
      {previews.some((preview) => preview.action === "retranslate") && <p>{de ? "Diese Auswahl umfasst" : "This selection includes"} <strong>{previews.filter((preview) => preview.action === "retranslate" && preview.canRetranslate).reduce((sum, preview) => sum + preview.billableWords, 0)}</strong> {de ? "abrechenbare Wörter in diesem Schritt. Jede URL erhält ein eigenes Ergebnis; bei ausgeschöpftem Kontingent wird die betroffene URL nicht neu übersetzt." : "billable words in this step. Each URL gets its own result; a URL is skipped if quota runs out."}</p>}
      {previews.map((preview) => <div key={preview.id} className="border-t border-amber-200 pt-2">
        <strong>{preview.urlPath} ({preview.langTo.toUpperCase()})</strong>: {preview.affectedSegments} {de ? "ausschließlich zugeordnete automatische Segmente in diesem Schritt" : "exclusive automatic segments in this step"} ({preview.totalEligibleSegments} {de ? "insgesamt geeignet" : "eligible in total"}); {preview.sharedSegments} {de ? "geteilte" : "shared"}, {preview.protectedSegments} {de ? "manuelle, geprüfte oder Glossar-geschützte bleiben erhalten" : "manual, reviewed or glossary-protected remain"}. {preview.remainingSegments > 0 && <strong>{preview.remainingSegments} {de ? "geeignete Segmente benötigen einen weiteren bestätigten Schritt." : "eligible segments need another confirmed step."}</strong>}
        {preview.action === "retranslate" ? <p>{de ? "Bei Erfolg werden genau" : "On success exactly"} <strong>{preview.billableWords}</strong> {de ? "Wörter neu berechnet; Monatsstand" : "words will be billed; monthly usage"} {preview.wordsUsed}/{preview.wordsLimit}. {de ? "Providerkosten können auch bei einem Fehler entstehen. Die Website muss danach ihren Seiten-Cache neu aufbauen." : "Provider cost may occur even on failure. The site must rebuild its page cache afterward."} {!preview.canRetranslate && <strong> {reasonText(preview.reason)}</strong>}</p> : <p className="font-medium">{de ? "Endgültig: URL-Eintrag und exklusive automatische Cache-Segmente werden gelöscht; URL-Verknüpfungen entfernt. Historische Nutzung bleibt." : "Permanent: URL record and exclusive automatic cache segments are deleted; URL links removed. Historical usage remains."} {!preview.canDelete && <strong> {reasonText(preview.reason)}</strong>}</p>}
      </div>)}
      <div className="flex gap-2"><Button size="sm" disabled={busy || previews.every((preview) => preview.action === "retranslate" ? !preview.canRetranslate : !preview.canDelete)} onClick={confirm}>{de ? "Endgültig bestätigen" : "Confirm permanently"}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setPreviews([])}>{de ? "Abbrechen" : "Cancel"}</Button></div>
    </div>}
    {canManage && results.length > 0 && <div role="status" className="rounded border p-3 text-sm"><strong>{de ? "Einzelergebnisse" : "Individual results"}</strong><ul>{results.map((result, index) => <li key={`${result.id}-${index}`}>{result.urlPath}: {result.ok ? "✓" : "✗"} {result.detail} {result.nextAfterId && result.action && <Button size="sm" variant="outline" disabled={busy} onClick={() => open(result.action!, [result.id], result.nextAfterId!)}>{de ? "Nächste 250 prüfen" : "Review next 250"}</Button>}</li>)}</ul></div>}
  </div>;
}
