"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useLocale } from "@/components/providers/locale-provider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getMarketingPath } from "@/lib/site-locale";

const COPY = {
  en: {
    title: "Reset your password",
    description: "Enter your email address and we will send you a reset link.",
    email: "Email",
    emailPlaceholder: "you@example.com",
    submit: "Send reset link",
    submitting: "Sending...",
    success:
      "If an account exists for this email address, we will send a reset link.",
    failed: "Could not request a reset link.",
    backToLogin: "Back to sign in",
  },
  de: {
    title: "Passwort zurücksetzen",
    description:
      "Gib deine E-Mail-Adresse ein und wir senden dir einen Link zum Zurücksetzen.",
    email: "E-Mail",
    emailPlaceholder: "du@beispiel.de",
    submit: "Reset-Link senden",
    submitting: "Wird gesendet...",
    success:
      "Wenn ein Konto mit dieser E-Mail-Adresse existiert, senden wir dir einen Link zum Zurücksetzen.",
    failed: "Reset-Link konnte nicht angefordert werden.",
    backToLogin: "Zurück zur Anmeldung",
  },
} as const;

export function ForgotPasswordCard() {
  const locale = useLocale();
  const copy = COPY[locale];
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        toast.error(data.error ?? copy.failed);
        return;
      }

      setHasSubmitted(true);
      toast.success(data.message ?? copy.success);
    } catch {
      toast.error(copy.failed);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasSubmitted ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            {copy.success}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{copy.email}</Label>
              <Input
                id="email"
                type="email"
                placeholder={copy.emailPlaceholder}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <Button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-700"
              disabled={isLoading}
            >
              {isLoading ? copy.submitting : copy.submit}
            </Button>
          </form>
        )}

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
