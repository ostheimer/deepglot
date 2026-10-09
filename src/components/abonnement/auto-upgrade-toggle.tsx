"use client";

import { useEffect, useState } from "react";
import { BILLING_PLAN_KEYS, BILLING_PLANS, type BillingInterval, type BillingPlanKey } from "@/lib/billing-plans";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

type Preference = { enabled: boolean; maxPlan: BillingPlanKey; maxPriceCents: number; interval: BillingInterval };
type Attempt = { id: string; fromPlan: string; toPlan: string; status: string; createdAt: string; usedWords: number };
type Notice = { id: string; attemptId: string; kind: string; createdAt: string };

export function AutoUpgradeToggle({ organizationId, currentPlan, initialInterval, locale }: { organizationId: string; currentPlan: BillingPlanKey; initialInterval: BillingInterval; locale: SiteLocale }) {
  const [saved, setSaved] = useState<Preference | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [maxPlan, setMaxPlan] = useState<BillingPlanKey>("BUSINESS");
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [busy, setBusy] = useState(false);
  const [acknowledgeProration, setAcknowledgeProration] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const de = locale === "de";
  const currentIndex = BILLING_PLAN_KEYS.indexOf(currentPlan);
  const nextPlan = BILLING_PLAN_KEYS[currentIndex + 1];
  const choices = BILLING_PLAN_KEYS.slice(currentIndex + 1, -1).filter((key) => key !== "FREE");

  async function refresh() {
    const response = await fetch(`/api/billing/auto-upgrade?workspaceId=${encodeURIComponent(organizationId)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(de ? "Einstellung konnte nicht geladen werden." : "Could not load preference.");
    const data = await response.json();
    const preference = data.preference as Preference;
    setSaved(preference);
    setEnabled(preference.enabled);
    setMaxPlan(preference.enabled && BILLING_PLAN_KEYS.indexOf(preference.maxPlan) > currentIndex ? preference.maxPlan : (nextPlan ?? "EXTENDED"));
    setAttempts(data.attempts ?? []);
    setNotices(data.notices ?? []);
    setAcknowledgeProration(false);
    setReady(true);
  }

  useEffect(() => { void refresh().catch((cause) => { setError(String(cause)); setReady(true); }); }, [organizationId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (currentIndex < 1 || currentIndex >= BILLING_PLAN_KEYS.length - 2) return null;
  const interval: BillingInterval = saved?.enabled ? saved.interval : initialInterval;
  const price = interval === "monthly" ? BILLING_PLANS[maxPlan].monthlyPriceCents : BILLING_PLANS[maxPlan].yearlyPriceCents;
  const nextPrice = interval === "monthly" ? BILLING_PLANS[nextPlan].monthlyPriceCents : BILLING_PLANS[nextPlan].yearlyPriceCents;
  const euro = (cents: number | null) => cents === null ? "—" : new Intl.NumberFormat(de ? "de-AT" : "en-IE", { style: "currency", currency: "EUR" }).format(cents / 100);

  async function save() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/billing/auto-upgrade", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: organizationId, enabled, maxPlan, interval, maxPriceCents: price, acknowledgeProration }) });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error ?? "Save failed"); }
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  return <section className="rounded-xl border border-gray-200 bg-white p-6 space-y-4" aria-label={de ? "Automatische Planerhöhung" : "Automatic plan upgrade"}>
    <div>
      <h2 className="text-lg font-semibold text-gray-900">{de ? "Automatische Planerhöhung" : "Automatic plan upgrade"}</h2>
      <p className="text-sm text-gray-600 mt-1">{de
        ? "Standardmäßig aus. Ab 90 % des monatlichen Wortlimits kann Deepglot genau eine Stufe höher buchen. Es gibt keine automatische Herabstufung."
        : "Off by default. At 90% of the monthly word allowance, Deepglot may move one plan higher. Plans never downgrade automatically."}</p>
    </div>
    {ready && <>
      <label className="flex items-center gap-3 text-sm font-medium text-gray-900">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="h-4 w-4" />
        {de ? "Automatische Planerhöhung erlauben" : "Allow automatic plan upgrades"}
      </label>
      {enabled && <>
        <label className="block text-sm font-medium text-gray-900" htmlFor="auto-upgrade-ceiling">{de ? "Höchster erlaubter Plan" : "Highest allowed plan"}</label>
        <select id="auto-upgrade-ceiling" value={maxPlan} onChange={(event) => setMaxPlan(event.target.value as BillingPlanKey)} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
          {choices.map((key) => <option key={key} value={key}>{BILLING_PLANS[key].name} · {euro(interval === "monthly" ? BILLING_PLANS[key].monthlyPriceCents : BILLING_PLANS[key].yearlyPriceCents)} / {interval === "monthly" ? (de ? "Monat" : "month") : (de ? "Jahr" : "year")}</option>)}
        </select>
        <p className="text-sm text-gray-700">{de
          ? `Nächste Stufe: ${BILLING_PLANS[nextPlan].name} für ${euro(nextPrice)} pro ${interval === "monthly" ? "Monat" : "Jahr"}. Du erlaubst schrittweise Erhöhungen bis ${BILLING_PLANS[maxPlan].name} für höchstens ${euro(price)} pro ${interval === "monthly" ? "Monat" : "Jahr"}. Sofortige anteilige Rechnungen können anfallen; Steuern und bestehende Rabatte folgen Stripe. Bei fehlgeschlagener Zahlung bleibt das bisherige Kontingent.`
          : `Next step: ${BILLING_PLANS[nextPlan].name} at ${euro(nextPrice)} per ${interval === "monthly" ? "month" : "year"}. You allow stepwise increases up to ${BILLING_PLANS[maxPlan].name} at no more than ${euro(price)} per ${interval === "monthly" ? "month" : "year"}. Immediate prorated invoices may apply; taxes and existing discounts follow Stripe. If payment fails, the old allowance remains.`}</p>
        <label className="flex items-start gap-2 text-sm text-gray-800">
          <input type="checkbox" checked={acknowledgeProration} onChange={(event) => setAcknowledgeProration(event.target.checked)} className="mt-1 h-4 w-4" />
          <span>{de
            ? `Ich erlaube wiederkehrende Kosten bis ${euro(price)} pro ${interval === "monthly" ? "Monat" : "Jahr"} (${interval === "monthly" ? `${euro((price ?? 0) * 12)} für 12 volle Monate` : "jährlicher Gesamtbetrag"}) sowie eine sofortige anteilige Stripe-Rechnung. Deren tatsächlicher Betrag kann durch Steuern, Guthaben und Rabatte abweichen.`
            : `I authorize recurring charges up to ${euro(price)} per ${interval === "monthly" ? "month" : "year"} (${interval === "monthly" ? `${euro((price ?? 0) * 12)} for 12 full months` : "annual total"}) and an immediate prorated Stripe invoice. Its actual amount may differ due to tax, credits and discounts.`}</span>
        </label>
      </>}
      <button type="button" disabled={busy || (enabled && (!price || !acknowledgeProration || BILLING_PLAN_KEYS.indexOf(maxPlan) <= currentIndex))} onClick={save} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? (de ? "Speichert …" : "Saving…") : uiText(locale, "Save", "Speichern")}</button>
      <p aria-live="polite" className="text-sm text-gray-600">{saved && (saved.enabled ? (de ? "Gespeichert: aktiviert" : "Saved: enabled") : (de ? "Gespeichert: deaktiviert" : "Saved: disabled"))}</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {attempts.length > 0 && <div className="border-t border-gray-100 pt-4">
        <h3 className="font-medium text-gray-900">{de ? "Bisherige Erhöhungsversuche" : "Upgrade history"}</h3>
        <ul className="mt-2 space-y-1 text-sm text-gray-700">{attempts.map((attempt) => <li key={attempt.id}>{new Date(attempt.createdAt).toLocaleString(de ? "de-AT" : "en-IE")}: {attempt.fromPlan} → {attempt.toPlan} · {attempt.status} · {attempt.usedWords.toLocaleString(de ? "de-AT" : "en-IE")} {de ? "Wörter" : "words"}</li>)}</ul>
      </div>}
      {notices.length > 0 && <div className="border-t border-gray-100 pt-4">
        <h3 className="font-medium text-gray-900">{de ? "Benachrichtigungen" : "Notifications"}</h3>
        <ul className="mt-2 space-y-1 text-sm text-gray-700">{notices.map((notice) => <li key={notice.id}>{new Date(notice.createdAt).toLocaleString(de ? "de-AT" : "en-IE")}: {{ ATTEMPTED: de ? "Planerhöhung angefragt" : "Upgrade attempted", APPLIED: de ? "Planerhöhung bezahlt und aktiviert" : "Upgrade paid and applied", PAYMENT_ACTION_REQUIRED: de ? "Zahlung benötigt Bestätigung" : "Payment needs action", FAILED: de ? "Planerhöhung nicht ausgeführt" : "Upgrade not completed", RECONCILE_REQUIRED: de ? "Abrechnungsstatus muss geprüft werden" : "Billing status needs review" }[notice.kind] ?? notice.kind}</li>)}</ul>
      </div>}
    </>}
  </section>;
}
