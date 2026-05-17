"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/providers/locale-provider";
import { uiText } from "@/lib/static-copy";

export function BillingAddressForm() {
  const locale = useLocale();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const countries = [
    { code: "AT", label: uiText(locale, "Austria", "Österreich") },
    { code: "DE", label: uiText(locale, "Germany", "Deutschland") },
    { code: "CH", label: uiText(locale, "Switzerland", "Schweiz") },
    { code: "US", label: "USA" },
    { code: "GB", label: uiText(locale, "United Kingdom", "Großbritannien") },
  ];

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setSuccess(false);
    const form = e.currentTarget;
    const data = {
      billingName: (form.elements.namedItem("billingName") as HTMLInputElement).value,
      address: (form.elements.namedItem("address") as HTMLInputElement).value,
      city: (form.elements.namedItem("city") as HTMLInputElement).value,
      zip: (form.elements.namedItem("zip") as HTMLInputElement).value,
      country: (form.elements.namedItem("country") as HTMLSelectElement).value,
      vatNumber: (form.elements.namedItem("vatNumber") as HTMLInputElement).value,
    };
    await fetch("/api/billing/address", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setSuccess(true);
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {uiText(locale, "Company / Name", "Firmenname / Name")}
        </Label>
        <Input
          name="billingName"
          placeholder={uiText(locale, "e.g. Example Inc.", "z.B. Mustermann GmbH")}
          className="max-w-xl"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {uiText(locale, "Address", "Adresse")}
        </Label>
        <Input
          name="address"
          placeholder={uiText(locale, "Street and number", "Straße und Hausnummer")}
          className="max-w-xl"
        />
      </div>

      <div className="grid grid-cols-3 gap-4 max-w-xl">
        <div className="col-span-1 space-y-1.5">
          <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {uiText(locale, "City", "Stadt")}
          </Label>
          <Input name="city" placeholder={uiText(locale, "Vienna", "Wien")} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {locale === "de" ? "PLZ" : "ZIP"}
          </Label>
          <Input name="zip" placeholder="1010" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {uiText(locale, "Country", "Land")}
          </Label>
          <select
            name="country"
            defaultValue="AT"
            className="h-9 w-full border border-gray-200 rounded-md px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {uiText(locale, "VAT number (companies only)", "USt-IdNr. (nur für Unternehmen)")}
        </Label>
        <Input name="vatNumber" placeholder="ATU12345678" className="max-w-xs" />
      </div>

      {success && (
        <p className="text-sm text-green-600">
          {uiText(locale, "Billing details saved.", "Rechnungsinformationen gespeichert.")}
        </p>
      )}

      <div className="flex justify-end max-w-xl pt-2">
        <Button
          type="submit"
          disabled={loading}
          className="bg-indigo-600 hover:bg-indigo-700 h-9 px-5 text-sm"
        >
          {loading ? (uiText(locale, "Saving...", "Speichern…")) : uiText(locale, "Save", "Speichern")}
        </Button>
      </div>
    </form>
  );
}
