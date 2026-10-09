"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SiteLocale } from "@/lib/site-locale";

type Scope = "organization" | "project";
type Model = {
  provider: string; model: string; unit: "TOKEN" | "CHARACTER" | "ZERO_COST";
  inputMicrosPerMillion: string; outputMicrosPerMillion: string;
  maxInputUnits: number; maxOutputUnits: number; priceExpiresAt: string;
  outputCapVerified: boolean;
};
type Policy = {
  scope: Scope; currency: string; capMicros: string; perCallCapMicros: string;
  warningPercent: number; period: "MONTHLY_UTC"; models: Model[];
  revision?: number; approvedAt?: string;
};
type Readback = {
  organization: Policy | null; project: Policy | null; periodKey: number;
  organizationCommittedMicros: string; projectCommittedMicros: string;
  events: Array<{ id: string; kind: string; threshold: number | null; createdAt: string }>;
  recentSpend: Array<{ id: string; action: string; provider: string; model: string;
    state: string; currency: string; reservedMicros: string; reconciledCeilingMicros: string | null;
    dispatchedAt: string }>;
};

function microsToMajor(raw: string): string {
  const value = BigInt(raw || "0");
  return `${value / BigInt(1_000_000)}.${(value % BigInt(1_000_000)).toString().padStart(6, "0")}`;
}

function majorToMicros(raw: string): string | null {
  if (!/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  return (BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0"))).toString();
}

function blankPolicy(scope: Scope): Policy {
  return { scope, currency: "USD", capMicros: "0", perCallCapMicros: "0",
    warningPercent: 80, period: "MONTHLY_UTC", models: [] };
}

function MoneyInput({ label, value, onChange }: { label: string; value: string; onChange: (micros: string) => void }) {
  const [display, setDisplay] = useState(() => microsToMajor(value));
  useEffect(() => setDisplay((current) => majorToMicros(current) === value ? current : microsToMajor(value)), [value]);
  return <label className="text-sm">{label}<Input aria-label={label} inputMode="decimal" value={display} onChange={(event) => {
    setDisplay(event.target.value);
    const parsed = majorToMicros(event.target.value);
    if (parsed !== null) onChange(parsed);
  }} /></label>;
}

const PROVIDERS = ["openai", "gemini", "openrouter", "ollama", "openai-compatible", "deepl", "mock"];

export function AiBudgetSettingsCard({ projectId, locale, isOwner }: {
  projectId: string; locale: SiteLocale; isOwner: boolean;
}) {
  const de = locale === "de";
  const [readback, setReadback] = useState<Readback | null>(null);
  const [scope, setScope] = useState<Scope>("project");
  const [draft, setDraft] = useState<Policy>(blankPolicy("project"));
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function refresh(initializeDraft = false) {
    const response = await fetch(`/api/projects/${projectId}/ai-budget`, { cache: "no-store" });
    if (!response.ok) throw new Error("readback_failed");
    const data = await response.json() as Readback;
    if (initializeDraft) setDraft(data.project ?? blankPolicy("project"));
    setReadback(data);
    return data;
  }

  useEffect(() => { void refresh(true).catch(() => setStatus(de ? "Budgetdaten sind derzeit nicht verfügbar." : "Budget data is currently unavailable.")); }, [projectId, de]);

  function chooseScope(next: Scope) {
    setScope(next);
    setDraft(readback?.[next] ?? blankPolicy(next));
    setStatus("");
  }

  function addModel() {
    setDraft((current) => ({ ...current, models: [...current.models, {
      provider: "openai", model: "", unit: "TOKEN", inputMicrosPerMillion: "0",
      outputMicrosPerMillion: "0", maxInputUnits: 100_000, maxOutputUnits: 2_048,
      outputCapVerified: false,
      priceExpiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    }] }));
  }

  function updateModel(index: number, update: Partial<Model>) {
    setDraft((current) => ({ ...current, models: current.models.map((model, i) => i === index ? { ...model, ...update } : model) }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setStatus("");
    try {
      const response = await fetch(`/api/projects/${projectId}/ai-budget`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { code?: string };
        throw new Error(result.code ?? "approval_failed");
      }
      const data = await refresh();
      setDraft(data[scope] ?? blankPolicy(scope));
      setStatus(de ? "Freigabe gespeichert und unabhängig aus der Datenbank gelesen." : "Approval saved and independently read from the database.");
    } catch (error) {
      setStatus(`${de ? "Freigabe fehlgeschlagen" : "Approval failed"}: ${error instanceof Error ? error.message : "unknown"}`);
    } finally { setLoading(false); }
  }

  const approved = readback?.[scope];
  const committed = scope === "organization" ? readback?.organizationCommittedMicros : readback?.projectCommittedMicros;
  return <section className="rounded-xl border border-gray-200 bg-white p-6" data-testid="ai-budget-panel">
    <h3 className="text-lg font-semibold text-gray-900">{de ? "KI-Budget und Kostenfreigabe" : "AI budget and cost approval"}</h3>
    <p className="mt-2 text-sm text-gray-600">{de
      ? "Wortkontingent, Plattform-Credits, Abonnement und externe Anbieterkosten sind getrennt. Ohne Organisations- und Projektfreigabe wird kein neuer Anbieteraufruf ausgeführt. Preise unten sind Ihre konservativen Obergrenzen, keine Live-Preise."
      : "Word quota, platform credits, subscription and external provider cost are separate. Both organization and project approval are required before a new provider call. Prices below are your conservative ceilings, not live prices."}</p>
    <div className="mt-4 flex gap-2" role="group" aria-label={de ? "Budgetbereich" : "Budget scope"}>
      {(["organization", "project"] as const).map((item) => <Button key={item} type="button" disabled={!readback || loading} variant={scope === item ? "default" : "outline"} onClick={() => chooseScope(item)}>
        {item === "organization" ? (de ? "Organisation" : "Organization") : (de ? "Projekt" : "Project")}
      </Button>)}
    </div>
    <div className="mt-4 rounded-md bg-gray-50 p-3 text-sm" data-testid="ai-budget-readback">
      <p>{approved ? `${de ? "Freigegeben" : "Approved"}: ${approved.currency} ${microsToMajor(approved.capMicros)} · ${de ? "Revision" : "Revision"} ${approved.revision}` : (de ? "Keine Freigabe. Anbieteraufrufe sind gesperrt." : "No approval. Provider calls are blocked.")}</p>
      <p>{de ? "Reservierte oder aus Usage berechnete Kostenobergrenze in UTC-Periode" : "Reserved or usage-based cost ceiling in UTC period"} {readback?.periodKey ?? "—"}: {committed !== undefined ? microsToMajor(committed) : "—"}</p>
      <p>{de ? "Rücksetzung am ersten UTC-Monatstag; kein Übertrag. Unbekannte Usage behält die volle Reservierung." : "Resets on the first UTC day of each month; no rollover. Unknown usage retains the full reservation."}</p>
    </div>
    {isOwner && readback && <form className="mt-5 space-y-4" onSubmit={save}>
      <p className="text-sm font-medium">{de ? "Owner-Freigabe" : "Owner approval"}</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="text-sm">{de ? "Währung (ISO)" : "Currency (ISO)"}<Input aria-label={de ? "Währung" : "Currency"} value={draft.currency} maxLength={3} onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })} /></label>
        <MoneyInput label={de ? "Monatslimit" : "Monthly cap"} value={draft.capMicros} onChange={(capMicros) => setDraft((current) => ({ ...current, capMicros }))} />
        <MoneyInput label={de ? "Limit je Aufruf" : "Per-call cap"} value={draft.perCallCapMicros} onChange={(perCallCapMicros) => setDraft((current) => ({ ...current, perCallCapMicros }))} />
        <label className="text-sm">{de ? "Warnung bei %" : "Warn at %"}<Input type="number" min={1} max={99} value={draft.warningPercent} onChange={(e) => setDraft({ ...draft, warningPercent: Number(e.target.value) })} /></label>
      </div>
      <p className="text-xs text-gray-500">{de ? "Beträge mit höchstens sechs Nachkommastellen; Periode: Kalendermonat in UTC." : "Amounts have up to six decimal places; period: calendar month in UTC."}</p>
      {draft.models.map((model, index) => <div key={index} className="rounded-md border border-gray-200 p-3 space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">{de ? "Anbieter" : "Provider"}<select aria-label={de ? "Anbieter" : "Provider"} className="h-10 w-full rounded-md border px-2" value={model.provider} onChange={(e) => updateModel(index, { provider: e.target.value, unit: e.target.value === "deepl" ? "CHARACTER" : e.target.value === "mock" ? "ZERO_COST" : "TOKEN", maxOutputUnits: e.target.value === "deepl" ? 0 : model.maxOutputUnits })}>{PROVIDERS.map((provider) => <option key={provider} value={provider}>{provider}</option>)}</select></label>
          <label className="text-sm">{de ? "Modell-ID" : "Model ID"}<Input value={model.model} onChange={(e) => updateModel(index, { model: e.target.value })} /></label>
          <label className="text-sm">{de ? "Einheit" : "Unit"}<select className="h-10 w-full rounded-md border px-2" value={model.unit} onChange={(e) => updateModel(index, { unit: e.target.value as Model["unit"] })}><option value="TOKEN">Token</option><option value="CHARACTER">{de ? "Zeichen" : "Characters"}</option><option value="ZERO_COST">{de ? "Keine Anbieterkosten" : "No provider charge"}</option></select></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <MoneyInput label={de ? "Input-Obergrenze je 1 Mio." : "Input ceiling per 1M"} value={model.inputMicrosPerMillion} onChange={(inputMicrosPerMillion) => updateModel(index, { inputMicrosPerMillion })} />
          <MoneyInput label={de ? "Output-Obergrenze je 1 Mio." : "Output ceiling per 1M"} value={model.outputMicrosPerMillion} onChange={(outputMicrosPerMillion) => updateModel(index, { outputMicrosPerMillion })} />
          <label className="text-sm">{de ? "Max. Input-Einheiten" : "Max input units"}<Input type="number" min={1} value={model.maxInputUnits} onChange={(e) => updateModel(index, { maxInputUnits: Number(e.target.value) })} /></label>
          <label className="text-sm">{de ? "Max. Output-Einheiten" : "Max output units"}<Input type="number" min={0} value={model.maxOutputUnits} onChange={(e) => updateModel(index, { maxOutputUnits: Number(e.target.value) })} /></label>
        </div>
        <label className="block text-sm">{de ? "Preisfreigabe gültig bis (UTC)" : "Price approval valid until (UTC)"}<Input type="date" value={model.priceExpiresAt.slice(0, 10)} onChange={(e) => { if (e.target.value) updateModel(index, { priceExpiresAt: new Date(`${e.target.value}T23:59:59.000Z`).toISOString() }); }} /></label>
        {["openrouter", "openai-compatible", "ollama"].includes(model.provider) && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={model.outputCapVerified} onChange={(e) => updateModel(index, { outputCapVerified: e.target.checked })} />{de ? "Ich habe geprüft, dass dieses Modell das angegebene Output-Limit technisch erzwingt." : "I verified that this model enforces the configured output limit."}</label>}
        <Button type="button" variant="outline" onClick={() => setDraft({ ...draft, models: draft.models.filter((_, i) => i !== index) })}>{de ? "Modell entfernen" : "Remove model"}</Button>
      </div>)}
      <div className="flex gap-3"><Button type="button" variant="outline" onClick={addModel}>{de ? "Modell hinzufügen" : "Add model"}</Button><Button type="submit" disabled={loading || draft.models.length === 0}>{loading ? (de ? "Speichere…" : "Saving…") : (de ? "Budget ausdrücklich freigeben" : "Explicitly approve budget")}</Button></div>
    </form>}
    {status && <p role="status" className="mt-3 text-sm">{status}</p>}
    {readback?.events && readback.events.length > 0 && <div className="mt-5 text-sm"><h4 className="font-medium">{de ? "Budgetereignisse" : "Budget events"}</h4><ul className="mt-2 space-y-1">{readback.events.slice(0, 8).map((event) => <li key={event.id}>{event.createdAt.slice(0, 16).replace("T", " ")} UTC · {event.kind === "APPROVED" ? (de ? "Freigabe" : "Approval") : event.kind === "CAP_REACHED" ? (de ? "Limit erreicht" : "Cap reached") : (de ? "Warnschwelle erreicht" : "Warning threshold reached")}{event.threshold ? ` (${event.threshold}%)` : ""}</li>)}</ul></div>}
    {readback?.recentSpend && readback.recentSpend.length > 0 && <div className="mt-5 text-sm"><h4 className="font-medium">{de ? "Letzte Anbieteraufrufe" : "Recent provider attempts"}</h4><ul className="mt-2 space-y-1">{readback.recentSpend.slice(0, 8).map((item) => <li key={item.id}>{item.dispatchedAt.slice(0, 16).replace("T", " ")} UTC · {item.provider}/{item.model} · {item.state === "SETTLED" ? (de ? "Kostenobergrenze aus Usage" : "Usage-based cost ceiling") : (de ? "Volle Reservierung" : "Full hold")} {item.currency} {microsToMajor(item.reconciledCeilingMicros ?? item.reservedMicros)}</li>)}</ul></div>}
  </section>;
}
