"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const COUNTRIES = [
  { code: "AT", label: "Österreich" },
  { code: "DE", label: "Deutschland" },
  { code: "CH", label: "Schweiz" },
  { code: "US", label: "USA" },
  { code: "GB", label: "Großbritannien" },
];

interface Props {
  stripeCustomerId: string | null;
}

export function BillingAddressForm({ stripeCustomerId }: Props) {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

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
          Firmenname / Name
        </Label>
        <Input name="billingName" placeholder="z.B. Mustermann GmbH" className="max-w-xl" />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Adresse
        </Label>
        <Input name="address" placeholder="Straße und Hausnummer" className="max-w-xl" />
      </div>

      <div className="grid grid-cols-3 gap-4 max-w-xl">
        <div className="col-span-1 space-y-1.5">
          <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Stadt
          </Label>
          <Input name="city" placeholder="Wien" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            PLZ
          </Label>
          <Input name="zip" placeholder="1010" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Land
          </Label>
          <select
            name="country"
            defaultValue="AT"
            className="h-9 w-full border border-gray-200 rounded-md px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          USt-IdNr. (nur für Unternehmen)
        </Label>
        <Input name="vatNumber" placeholder="ATU12345678" className="max-w-xs" />
      </div>

      {success && (
        <p className="text-sm text-green-600">Rechnungsinformationen gespeichert.</p>
      )}

      <div className="flex justify-end max-w-xl pt-2">
        <Button
          type="submit"
          disabled={loading}
          className="bg-indigo-600 hover:bg-indigo-700 h-9 px-5 text-sm"
        >
          {loading ? "Speichern…" : "Speichern"}
        </Button>
      </div>
    </form>
  );
}
