"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/providers/locale-provider";

interface Props {
  stripeCustomerId: string | null;
}

export function BillingAddressForm({ stripeCustomerId }: Props) {
  const locale = useLocale();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const countries = [
    { code: "AT", label: locale === "de" ? "Österreich" : "Austria" },
    { code: "DE", label: locale === "de" ? "Deutschland" : "Germany" },
    { code: "CH", label: locale === "de" ? "Schweiz" : "Switzerland" },
    { code: "US", label: "USA" },
    { code: "GB", label: locale === "de" ? "Großbritannien" : "United Kingdom" },
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
          {locale === "de" ? "Firmenname / Name" : "Company / Name"}
        </Label>
        <Input
          name="billingName"
          placeholder={locale === "de" ? "z.B. Mustermann GmbH" : "e.g. Example Inc."}
          className="max-w-xl"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {locale === "de" ? "Adresse" : "Address"}
        </Label>
        <Input
          name="address"
          placeholder={locale === "de" ? "Straße und Hausnummer" : "Street and number"}
          className="max-w-xl"
        />
      </div>

      <div className="grid grid-cols-3 gap-4 max-w-xl">
        <div className="col-span-1 space-y-1.5">
          <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {locale === "de" ? "Stadt" : "City"}
          </Label>
          <Input name="city" placeholder={locale === "de" ? "Wien" : "Vienna"} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {locale === "de" ? "PLZ" : "ZIP"}
          </Label>
          <Input name="zip" placeholder="1010" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {locale === "de" ? "Land" : "Country"}
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
          {locale === "de" ? "USt-IdNr. (nur für Unternehmen)" : "VAT number (companies only)"}
        </Label>
        <Input name="vatNumber" placeholder="ATU12345678" className="max-w-xs" />
      </div>

      {success && (
        <p className="text-sm text-green-600">
          {locale === "de" ? "Rechnungsinformationen gespeichert." : "Billing details saved."}
        </p>
      )}

      <div className="flex justify-end max-w-xl pt-2">
        <Button
          type="submit"
          disabled={loading}
          className="bg-indigo-600 hover:bg-indigo-700 h-9 px-5 text-sm"
        >
          {loading ? (locale === "de" ? "Speichern…" : "Saving...") : locale === "de" ? "Speichern" : "Save"}
        </Button>
      </div>
    </form>
  );
}
