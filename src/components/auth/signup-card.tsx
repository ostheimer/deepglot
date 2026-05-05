"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Github } from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
import { getMarketingPath, withLocalePrefix } from "@/lib/site-locale";

const COPY = {
  en: {
    title: "Create your account",
    description: "Start for free with 10,000 words per month",
    github: "Continue with GitHub",
    google: "Continue with Google",
    separator: "or",
    name: "Name",
    namePlaceholder: "Jane Doe",
    email: "Email",
    emailPlaceholder: "you@example.com",
    password: "Password",
    passwordPlaceholder: "At least 8 characters",
    submit: "Create account",
    submitting: "Creating account...",
    termsPrefix: "By signing up, you agree to our",
    terms: "Terms",
    privacy: "Privacy Policy",
    haveAccount: "Already have an account?",
    login: "Sign in",
    registerFailed: "Registration failed",
    networkError: "Network error. Please try again.",
  },
  de: {
    title: "Konto erstellen",
    description: "Starte kostenlos mit 10.000 Wörtern pro Monat",
    github: "Mit GitHub registrieren",
    google: "Mit Google registrieren",
    separator: "oder",
    name: "Name",
    namePlaceholder: "Max Mustermann",
    email: "E-Mail",
    emailPlaceholder: "du@beispiel.de",
    password: "Passwort",
    passwordPlaceholder: "Mindestens 8 Zeichen",
    submit: "Konto erstellen",
    submitting: "Konto wird erstellt...",
    termsPrefix: "Mit der Registrierung stimmst du unseren",
    terms: "AGB",
    privacy: "Datenschutzerklärung",
    haveAccount: "Bereits ein Konto?",
    login: "Anmelden",
    registerFailed: "Registrierung fehlgeschlagen",
    networkError: "Netzwerkfehler. Bitte versuche es erneut.",
  },
} as const;

type SignupCardProps = {
  canUseGitHubLogin: boolean;
  canUseGoogleLogin: boolean;
};

export function SignupCard({
  canUseGitHubLogin,
  canUseGoogleLogin,
}: SignupCardProps) {
  const locale = useLocale();
  const copy = COPY[locale];
  const dashboardPath = withLocalePrefix("/dashboard", locale);
  const [isLoading, setIsLoading] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/registrieren", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? copy.registerFailed);
        return;
      }

      await signIn("credentials", {
        email,
        password,
        callbackUrl: dashboardPath,
        redirect: true,
      });
    } catch {
      toast.error(copy.networkError);
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
        {(canUseGitHubLogin || canUseGoogleLogin) && (
          <>
            {canUseGitHubLogin && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => signIn("github", { callbackUrl: dashboardPath })}
              >
                <Github className="mr-2 h-4 w-4" />
                {copy.github}
              </Button>
            )}
            {canUseGoogleLogin && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => signIn("google", { callbackUrl: dashboardPath })}
              >
                <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                {copy.google}
              </Button>
            )}

            <div className="flex items-center gap-4">
              <Separator className="flex-1" />
              <span className="text-xs text-gray-400">{copy.separator}</span>
              <Separator className="flex-1" />
            </div>
          </>
        )}

        <form onSubmit={handleRegister} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">{copy.name}</Label>
            <Input
              id="name"
              placeholder={copy.namePlaceholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{copy.email}</Label>
            <Input
              id="email"
              type="email"
              placeholder={copy.emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{copy.password}</Label>
            <Input
              id="password"
              type="password"
              placeholder={copy.passwordPlaceholder}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
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

        <p className="text-center text-xs text-gray-500">
          {copy.termsPrefix}{" "}
          <Link
            href={withLocalePrefix("/agb", locale)}
            className="underline hover:text-gray-700"
          >
            {copy.terms}
          </Link>{" "}
          {locale === "de" ? "und der" : "and"}{" "}
          <Link
            href={withLocalePrefix("/datenschutz", locale)}
            className="underline hover:text-gray-700"
          >
            {copy.privacy}
          </Link>
          .
        </p>

        <p className="text-center text-sm text-gray-600">
          {copy.haveAccount}{" "}
          <Link
            href={getMarketingPath(locale, "login")}
            className="font-medium text-indigo-600 hover:underline"
          >
            {copy.login}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
