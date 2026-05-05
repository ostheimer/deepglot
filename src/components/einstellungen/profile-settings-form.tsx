"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { AccountDeleteButton } from "@/components/einstellungen/account-delete-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SiteLocale } from "@/lib/site-locale";

const COPY = {
  en: {
    email: "Email address",
    firstName: "First name",
    lastName: "Last name",
    firstNamePlaceholder: "Enter first name",
    lastNamePlaceholder: "Enter last name",
    save: "Save",
    saving: "Saving...",
    saved: "Profile saved.",
    failed: "Could not save your profile.",
  },
  de: {
    email: "E-Mail-Adresse",
    firstName: "Vorname",
    lastName: "Nachname",
    firstNamePlaceholder: "Vorname eingeben",
    lastNamePlaceholder: "Nachname eingeben",
    save: "Speichern",
    saving: "Speichern...",
    saved: "Profil gespeichert.",
    failed: "Dein Profil konnte nicht gespeichert werden.",
  },
} as const;

type ProfileSettingsFormProps = {
  locale: SiteLocale;
  email: string;
  firstName: string;
  lastName: string;
};

export function ProfileSettingsForm({
  locale,
  email,
  firstName,
  lastName,
}: ProfileSettingsFormProps) {
  const copy = COPY[locale];
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setMessage(null);

    const formData = new FormData(event.currentTarget);
    const payload = {
      email: String(formData.get("email") ?? "").trim(),
      firstName: String(formData.get("firstName") ?? "").trim(),
      lastName: String(formData.get("lastName") ?? "").trim(),
    };

    try {
      const response = await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setMessage({ type: "error", text: data?.error ?? copy.failed });
        return;
      }

      setMessage({ type: "success", text: copy.saved });
      router.refresh();
    } catch {
      setMessage({ type: "error", text: copy.failed });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <Label
          htmlFor="profile-email"
          className="text-xs font-semibold text-gray-500 uppercase tracking-wider"
        >
          {copy.email}
        </Label>
        <Input
          id="profile-email"
          name="email"
          defaultValue={email}
          type="email"
          required
          className="max-w-md"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label
            htmlFor="profile-first-name"
            className="text-xs font-semibold text-gray-500 uppercase tracking-wider"
          >
            {copy.firstName}
          </Label>
          <Input
            id="profile-first-name"
            name="firstName"
            defaultValue={firstName}
            placeholder={copy.firstNamePlaceholder}
          />
        </div>
        <div className="space-y-1.5">
          <Label
            htmlFor="profile-last-name"
            className="text-xs font-semibold text-gray-500 uppercase tracking-wider"
          >
            {copy.lastName}
          </Label>
          <Input
            id="profile-last-name"
            name="lastName"
            defaultValue={lastName}
            placeholder={copy.lastNamePlaceholder}
          />
        </div>
      </div>

      {message && (
        <p
          role="status"
          className={message.type === "success" ? "text-sm text-green-600" : "text-sm text-red-600"}
        >
          {message.text}
        </p>
      )}

      <div className="flex items-center justify-between pt-1">
        <AccountDeleteButton />
        <Button
          type="submit"
          disabled={isSaving}
          className="bg-indigo-600 hover:bg-indigo-700 h-8 px-4 text-sm"
        >
          {isSaving ? copy.saving : copy.save}
        </Button>
      </div>
    </form>
  );
}
