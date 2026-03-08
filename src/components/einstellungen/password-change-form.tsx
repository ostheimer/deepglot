"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/components/providers/locale-provider";

interface Props {
  hasPassword: boolean;
}

export function PasswordChangeForm({ hasPassword }: Props) {
  const locale = useLocale();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setLoading(true);

    const form = e.currentTarget;
    const currentPassword = (form.elements.namedItem("currentPassword") as HTMLInputElement).value;
    const newPassword = (form.elements.namedItem("newPassword") as HTMLInputElement).value;
    const confirmPassword = (form.elements.namedItem("confirmPassword") as HTMLInputElement).value;

    if (newPassword !== confirmPassword) {
      setError(
        locale === "de"
          ? "Die neuen Passwörter stimmen nicht überein."
          : "The new passwords do not match."
      );
      setLoading(false);
      return;
    }

    const res = await fetch("/api/user/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? (locale === "de" ? "Ein Fehler ist aufgetreten." : "Something went wrong."));
    } else {
      setSuccess(true);
      form.reset();
    }
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      {hasPassword && (
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {locale === "de" ? "Aktuelles Passwort" : "Current password"}
          </Label>
          <Input
            name="currentPassword"
            type="password"
            placeholder={locale === "de" ? "Aktuelles Passwort eingeben" : "Enter current password"}
            className="max-w-md"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {locale === "de" ? "Neues Passwort" : "New password"}
          </Label>
          <Input
            name="newPassword"
            type="password"
            placeholder={locale === "de" ? "Neues Passwort eingeben" : "Enter new password"}
            required
            minLength={8}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {locale === "de" ? "Passwort bestätigen" : "Confirm password"}
          </Label>
          <Input
            name="confirmPassword"
            type="password"
            placeholder={locale === "de" ? "Neues Passwort bestätigen" : "Confirm new password"}
            required
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && (
        <p className="text-sm text-green-600">
          {locale === "de" ? "Passwort erfolgreich geändert." : "Password updated successfully."}
        </p>
      )}

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={loading}
          className="bg-indigo-600 hover:bg-indigo-700 h-8 px-4 text-sm"
        >
          {loading
            ? locale === "de"
              ? "Speichern…"
              : "Saving..."
            : locale === "de"
              ? "Passwort ändern"
              : "Change password"}
        </Button>
      </div>
    </form>
  );
}
