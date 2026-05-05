"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { useLocale } from "@/components/providers/locale-provider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getMarketingPath } from "@/lib/site-locale";

const COPY = {
  en: {
    title: "Choose a new password",
    description: "Enter a new password for your Deepglot account.",
    password: "New password",
    passwordPlaceholder: "At least 8 characters",
    confirmPassword: "Confirm password",
    submit: "Update password",
    submitting: "Updating...",
    missingToken: "This reset link is missing a token.",
    mismatch: "Passwords do not match.",
    failed: "Could not reset password.",
    success: "Password updated. You can sign in now.",
    backToLogin: "Back to sign in",
  },
  de: {
    title: "Neues Passwort wählen",
    description: "Gib ein neues Passwort für dein Deepglot-Konto ein.",
    password: "Neues Passwort",
    passwordPlaceholder: "Mindestens 8 Zeichen",
    confirmPassword: "Passwort bestätigen",
    submit: "Passwort aktualisieren",
    submitting: "Wird aktualisiert...",
    missingToken: "Dieser Reset-Link enthält keinen Token.",
    mismatch: "Die Passwörter stimmen nicht überein.",
    failed: "Passwort konnte nicht zurückgesetzt werden.",
    success: "Passwort geändert. Du kannst dich jetzt anmelden.",
    backToLogin: "Zur Anmeldung",
  },
} as const;

export function ResetPasswordCard({ token }: { token: string }) {
  const locale = useLocale();
  const copy = COPY[locale];
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!token) {
      toast.error(copy.missingToken);
      return;
    }

    if (password !== confirmPassword) {
      toast.error(copy.mismatch);
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        toast.error(data.error ?? copy.failed);
        return;
      }

      toast.success(data.message ?? copy.success);
      router.push(getMarketingPath(locale, "login"));
    } catch {
      toast.error(copy.failed);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <h1
          data-slot="card-title"
          className="text-2xl leading-none font-semibold"
        >
          {copy.title}
        </h1>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!token && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
            {copy.missingToken}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">{copy.password}</Label>
            <Input
              id="password"
              type="password"
              placeholder={copy.passwordPlaceholder}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">{copy.confirmPassword}</Label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder={copy.passwordPlaceholder}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={8}
              required
            />
          </div>
          <Button
            type="submit"
            className="w-full bg-indigo-600 hover:bg-indigo-700"
            disabled={isLoading || !token}
          >
            {isLoading ? copy.submitting : copy.submit}
          </Button>
        </form>

        <p className="text-center text-sm text-gray-600">
          <Link
            href={getMarketingPath(locale, "login")}
            className="font-medium text-indigo-600 hover:underline"
          >
            {copy.backToLogin}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
