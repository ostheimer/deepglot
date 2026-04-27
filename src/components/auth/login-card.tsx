"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Github, Sparkles } from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
import { getMarketingPath, withLocalePrefix } from "@/lib/site-locale";

const COPY = {
  en: {
    title: "Welcome back",
    description: "Sign in to your Deepglot account",
    github: "Continue with GitHub",
    google: "Continue with Google",
    separator: "or",
    email: "Email",
    emailPlaceholder: "you@example.com",
    password: "Password",
    forgotPassword: "Forgot password?",
    submit: "Sign in",
    submitting: "Signing in...",
    noAccount: "No account yet?",
    signup: "Start for free",
    invalidCredentials: "Wrong email address or password",
    testLoginTitle: "Instant test login",
    testLoginDescription:
      "For local and preview testing you can sign in directly as the shared test user.",
    testLoginButton: "Sign in as test user",
    testLoginPending: "Signing in as test user...",
    testLoginFailed: "Test login failed.",
    testLoginHintPrefix: "Shared test user:",
  },
  de: {
    title: "Willkommen zurück",
    description: "Melde dich bei deinem Deepglot-Konto an",
    github: "Mit GitHub anmelden",
    google: "Mit Google anmelden",
    separator: "oder",
    email: "E-Mail",
    emailPlaceholder: "du@beispiel.de",
    password: "Passwort",
    forgotPassword: "Passwort vergessen?",
    submit: "Anmelden",
    submitting: "Anmelden...",
    noAccount: "Noch kein Konto?",
    signup: "Kostenlos starten",
    invalidCredentials: "Falsche E-Mail-Adresse oder falsches Passwort",
    testLoginTitle: "Sofortiger Test-Login",
    testLoginDescription:
      "Für lokale Entwicklung und Preview kannst du dich direkt als gemeinsamer Testnutzer anmelden.",
    testLoginButton: "Als Testnutzer anmelden",
    testLoginPending: "Testnutzer wird angemeldet...",
    testLoginFailed: "Test-Login fehlgeschlagen.",
    testLoginHintPrefix: "Gemeinsamer Testnutzer:",
  },
} as const;

type LoginCardProps = {
  canUseGitHubLogin: boolean;
  canUseGoogleLogin: boolean;
  canUseTestLogin: boolean;
  testLoginEmail: string;
};

export function LoginCard({
  canUseGitHubLogin,
  canUseGoogleLogin,
  canUseTestLogin,
  testLoginEmail,
}: LoginCardProps) {
  const locale = useLocale();
  const copy = COPY[locale];
  const dashboardPath = withLocalePrefix("/dashboard", locale);
  const [isLoading, setIsLoading] = useState(false);
  const [isTestLoginLoading, setIsTestLoginLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleCredentialsSignIn(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl: dashboardPath,
      });

      if (result?.error) {
        toast.error(copy.invalidCredentials);
      } else {
        window.location.assign(result?.url ?? dashboardPath);
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleTestLogin() {
    setIsTestLoginLoading(true);

    try {
      const result = await signIn("test-login", {
        redirect: false,
        callbackUrl: dashboardPath,
      });

      if (result?.error) {
        toast.error(copy.testLoginFailed);
        return;
      }

      window.location.assign(result?.url ?? dashboardPath);
    } finally {
      setIsTestLoginLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canUseTestLogin && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-full bg-indigo-100 p-2">
                <Sparkles className="h-4 w-4 text-indigo-700" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900">
                  {copy.testLoginTitle}
                </p>
                <p className="mt-1 text-sm text-gray-600">
                  {copy.testLoginDescription}
                </p>
                <p className="mt-2 text-xs text-indigo-700">
                  {copy.testLoginHintPrefix}{" "}
                  <code className="rounded bg-white px-1.5 py-0.5">
                    {testLoginEmail}
                  </code>
                </p>
                <Button
                  className="mt-3 w-full bg-indigo-600 hover:bg-indigo-700"
                  onClick={handleTestLogin}
                  disabled={isTestLoginLoading || isLoading}
                >
                  {isTestLoginLoading
                    ? copy.testLoginPending
                    : copy.testLoginButton}
                </Button>
              </div>
            </div>
          </div>
        )}

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

        <form onSubmit={handleCredentialsSignIn} className="space-y-4">
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
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="password">{copy.password}</Label>
              <Link
                href={getMarketingPath(locale, "forgotPassword")}
                className="text-sm font-medium text-indigo-600 hover:underline"
              >
                {copy.forgotPassword}
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button
            type="submit"
            className="w-full bg-indigo-600 hover:bg-indigo-700"
            disabled={isLoading || isTestLoginLoading}
          >
            {isLoading ? copy.submitting : copy.submit}
          </Button>
        </form>

        <p className="text-center text-sm text-gray-600">
          {copy.noAccount}{" "}
          <Link
            href={getMarketingPath(locale, "signup")}
            className="font-medium text-indigo-600 hover:underline"
          >
            {copy.signup}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
