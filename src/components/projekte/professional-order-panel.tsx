"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SiteLocale } from "@/lib/site-locale";

type Segment = { id: string; originalText: string; updatedAt: string };
type OrderItem = { id: string; translationId: string; originalText: string; sourceUpdatedAt: string; proposedText: string | null; adoptedAt: string | null };
type Order = { id: string; status: string; targetLanguage: string; wordCount: number; scopeDigest: string; quoteAmountMinor: number | null; quoteCurrency: string | null; quoteTurnaroundDays: number | null; quoteExpiresAt: string | null; quoteReference: string | null; items: OrderItem[] };

export function ProfessionalOrderPanel({ projectId, languages, locale }: { projectId: string; languages: string[]; locale: SiteLocale }) {
  const de = locale === "de";
  const [language, setLanguage] = useState(languages[0] ?? "");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [token, setToken] = useState("");

  const load = useCallback(async () => {
    const base = `/api/projects/${projectId}`;
    const [segmentResponse, orderResponse] = await Promise.all([
      fetch(`${base}/translations?langTo=${encodeURIComponent(language)}&pageSize=100`, { cache: "no-store" }),
      fetch(`${base}/professional-orders`, { cache: "no-store" }),
    ]);
    if (!segmentResponse.ok || !orderResponse.ok) throw new Error(de ? "Bestellungen konnten nicht geladen werden." : "Could not load orders.");
    const segmentData = await segmentResponse.json();
    const orderData = await orderResponse.json();
    setSegments(segmentData.items ?? []);
    setOrders(orderData.orders ?? []);
  }, [projectId, language, de]);

  useEffect(() => { void load().catch((cause) => setError(cause.message)); }, [load]);

  async function action(url: string, body: object) {
    setBusy(true); setError(""); setToken("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? (de ? "Aktion fehlgeschlagen." : "Action failed."));
      if (data.token) setToken(data.token);
      await load();
      return data;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Error"); return null; }
    finally { setBusy(false); }
  }

  async function checkout(orderId: string) {
    const result = await action(`${base}/${orderId}/checkout`, {});
    if (result?.url && typeof result.url === "string" && result.url.startsWith("https://checkout.stripe.com/")) {
      window.location.assign(result.url);
    }
  }

  const base = `/api/projects/${projectId}/professional-orders`;
  return <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
    <div>
      <h2 className="text-lg font-semibold">{de ? "Professionelle Übersetzungen bestellen" : "Order professional translations"}</h2>
      <p className="text-sm text-gray-600">{de ? "Wähle Segmente und eine Zielsprache. Prüfe Preis und Lieferzeit vor der Annahme. Gelieferte Texte bleiben bis zur ausdrücklichen Übernahme Entwürfe und durchlaufen danach den normalen Review." : "Select segments and a target language. Review price and turnaround before accepting. Delivered text remains a draft until explicit adoption, then follows normal review."}</p>
    </div>
    <label className="block text-sm font-medium">{de ? "Zielsprache" : "Target language"}
      <select className="ml-2 rounded border p-2" value={language} onChange={(event) => { setLanguage(event.target.value); setSelected([]); }}>
        {languages.map((lang) => <option key={lang} value={lang}>{lang}</option>)}
      </select>
    </label>
    <div className="max-h-64 space-y-2 overflow-auto rounded border p-3">
      {segments.map((segment) => <label key={segment.id} className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={selected.includes(segment.id)} onChange={(event) => setSelected((old) => event.target.checked ? [...old, segment.id] : old.filter((id) => id !== segment.id))} />
        <span className="break-words">{segment.originalText}</span>
      </label>)}
      {segments.length === 0 && <p className="text-sm text-gray-500">{de ? "Keine Segmente für diese Sprache vorhanden." : "No segments for this language."}</p>}
    </div>
    <Button disabled={busy || selected.length === 0} onClick={() => void action(base, { targetLanguage: language, translationIds: selected }).then((result) => { if (result) setSelected([]); })}>
      {de ? `Angebot für ${selected.length} Segmente anfragen` : `Request quote for ${selected.length} segments`}
    </Button>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {token && <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
      <p>{de ? "Dieser auf eine Bestellung begrenzte Zugang wird nur einmal angezeigt. Gib ihn ausschließlich dem freigegebenen Dienstleister über einen vereinbarten sicheren Kanal." : "This order-scoped access token is shown once. Share it only with the approved vendor through an agreed secure channel."}</p>
      <code className="block break-all py-2">{token}</code>
    </div>}
    <div className="space-y-4">
      {orders.map((order) => <article key={order.id} className="space-y-2 rounded border p-4 text-sm">
        <div className="flex flex-wrap items-center gap-2"><strong>{order.targetLanguage} · {order.wordCount} {de ? "Wörter" : "words"}</strong><span className="rounded bg-gray-100 px-2 py-1">{order.status}</span></div>
        {order.quoteAmountMinor !== null && order.quoteCurrency && <p>{new Intl.NumberFormat(de ? "de-AT" : "en-US", { style: "currency", currency: order.quoteCurrency }).format(order.quoteAmountMinor / 100)} · {order.quoteTurnaroundDays} {de ? "Tage Lieferzeit" : "days turnaround"} · {de ? "gültig bis" : "valid until"} {order.quoteExpiresAt ? new Date(order.quoteExpiresAt).toLocaleString(de ? "de-AT" : "en-US") : "–"}</p>}
        <div className="flex flex-wrap gap-2">
          {order.status === "QUOTE_REQUESTED" && <Button variant="outline" size="sm" disabled={busy} onClick={() => void action(`${base}/${order.id}`, { action: "vendor_grant" })}>{de ? "Dienstleisterzugang erzeugen" : "Create vendor access"}</Button>}
          {order.status === "QUOTED" && order.quoteReference && <Button size="sm" disabled={busy || !order.quoteExpiresAt || new Date(order.quoteExpiresAt) <= new Date()} onClick={() => void action(`${base}/${order.id}`, { action: "accept_quote", expectedScopeDigest: order.scopeDigest, expectedQuoteReference: order.quoteReference })}>{de ? "Angebot annehmen" : "Accept quote"}</Button>}
          {order.status === "PAYMENT_PENDING" && <Button size="sm" disabled={busy} onClick={() => void checkout(order.id)}>{de ? "Einmalig sicher bezahlen" : "Secure one-time payment"}</Button>}
          {["QUOTE_REQUESTED", "QUOTED", "PAYMENT_PENDING", "PAID", "IN_PROGRESS", "DELIVERED"].includes(order.status) && <Button variant="outline" size="sm" disabled={busy} onClick={() => void action(`${base}/${order.id}`, { action: "cancel" })}>{order.status === "PAID" || order.status === "IN_PROGRESS" || order.status === "DELIVERED" ? (de ? "Erstattung anfragen" : "Request refund") : (de ? "Stornieren" : "Cancel")}</Button>}
        </div>
        {order.status === "PAYMENT_PENDING" && <p className="text-amber-700">{de ? "Zahlung ausstehend. Die Bestellung startet erst nach bestätigtem Zahlungseingang." : "Payment pending. Work starts only after confirmed payment."}</p>}
        {order.items.some((item) => item.proposedText !== null) && <div className="space-y-2 border-t pt-3">
          <h3 className="font-semibold">{de ? "Gelieferte Entwürfe prüfen" : "Review delivered drafts"}</h3>
          {order.items.filter((item) => item.proposedText !== null).map((item) => <div key={item.id} className="rounded bg-gray-50 p-3">
            <p><strong>{de ? "Quelle:" : "Source:"}</strong> {item.originalText}</p>
            <p><strong>{de ? "Lieferung:" : "Delivery:"}</strong> {item.proposedText}</p>
            {item.adoptedAt ? <span>{de ? "In den Review-Workflow übernommen" : "Adopted into the review workflow"}</span> : <Button className="mt-2" size="sm" disabled={busy} onClick={() => void action(`${base}/${order.id}`, { action: "adopt_delivery", itemId: item.id, expectedUpdatedAt: item.sourceUpdatedAt })}>{de ? "Entwurf ausdrücklich übernehmen" : "Explicitly adopt draft"}</Button>}
          </div>)}
        </div>}
      </article>)}
    </div>
  </section>;
}
