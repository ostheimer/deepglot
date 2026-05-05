"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/components/providers/locale-provider";
import { getMarketingPath } from "@/lib/site-locale";

type InviteStatusResponse = {
  status: "valid" | "expired" | "accepted" | "not_found";
  error?: string;
  existingUser?: boolean;
  authenticatedEmail?: string | null;
  invitation?: {
    email: string;
    role: "ADMIN" | "TRANSLATOR";
    langCode: string | null;
    expiresAt: string;
    project: {
      id: string;
      name: string;
      domain: string;
    };
    inviter: {
      name: string | null;
      email: string;
    };
  };
};

type AcceptResponse = {
  ok?: boolean;
  error?: string;
  signInRequired?: boolean;
  redirectTo?: string;
};

const COPY = {
  en: {
    title: "Accept project invitation",
    description: "Join this Deepglot project to work on translations.",
    loading: "Checking invitation...",
    missingToken: "This invite link is missing a token.",
    expired: "This invitation has expired. Ask a project admin to send a new invite.",
    accepted: "This invitation was already accepted.",
    invalid: "Invitation not found.",
    invitedBy: "Invited by",
    role: "Role",
    language: "Language",
    allLanguages: "All languages",
    existingUserTitle: "Sign in required",
    existingUserDescription:
      "This email already has a Deepglot account. Sign in with that account, then open this invite link again to accept it.",
    signIn: "Sign in",
    name: "Name",
    namePlaceholder: "Jane Doe",
    password: "Password",
    passwordPlaceholder: "At least 8 characters",
    confirmPassword: "Confirm password",
    accept: "Accept invitation",
    accepting: "Accepting...",
    mismatch: "Passwords do not match.",
    failed: "Could not accept invitation.",
    success: "Invitation accepted.",
  },
  de: {
    title: "Projekteinladung annehmen",
    description: "Tritt diesem Deepglot-Projekt bei, um an Übersetzungen zu arbeiten.",
    loading: "Einladung wird geprüft...",
    missingToken: "Dieser Einladungslink enthält keinen Token.",
    expired: "Diese Einladung ist abgelaufen. Bitte einen Projekt-Admin um eine neue Einladung.",
    accepted: "Diese Einladung wurde bereits angenommen.",
    invalid: "Einladung nicht gefunden.",
    invitedBy: "Eingeladen von",
    role: "Rolle",
    language: "Sprache",
    allLanguages: "Alle Sprachen",
    existingUserTitle: "Anmeldung erforderlich",
    existingUserDescription:
      "Für diese E-Mail-Adresse gibt es bereits ein Deepglot-Konto. Melde dich mit diesem Konto an und öffne danach diesen Einladungslink erneut.",
    signIn: "Anmelden",
    name: "Name",
    namePlaceholder: "Max Mustermann",
    password: "Passwort",
    passwordPlaceholder: "Mindestens 8 Zeichen",
    confirmPassword: "Passwort bestätigen",
    accept: "Einladung annehmen",
    accepting: "Wird angenommen...",
    mismatch: "Die Passwörter stimmen nicht überein.",
    failed: "Einladung konnte nicht angenommen werden.",
    success: "Einladung angenommen.",
  },
} as const;

function roleLabel(role: "ADMIN" | "TRANSLATOR", locale: "en" | "de") {
  if (role === "ADMIN") return "Admin";
  return locale === "de" ? "Übersetzer" : "Translator";
}

export function AcceptInviteCard({ token }: { token: string }) {
  const locale = useLocale();
  const copy = COPY[locale];
  const [status, setStatus] = useState<InviteStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(token));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus({ status: "not_found", error: copy.missingToken });
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();

    async function loadInvitation() {
      setIsLoading(true);
      try {
        const response = await fetch(
          `/api/auth/project-invitations/accept?token=${encodeURIComponent(token)}`,
          { signal: controller.signal }
        );
        const data = (await response.json().catch(() => ({}))) as InviteStatusResponse;
        setStatus(data);
      } catch {
        if (!controller.signal.aborted) {
          setStatus({ status: "not_found", error: copy.invalid });
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    loadInvitation();

    return () => controller.abort();
  }, [copy.invalid, copy.missingToken, token]);

  async function acceptInvitation(event?: React.FormEvent) {
    event?.preventDefault();

    if (!token) {
      toast.error(copy.missingToken);
      return;
    }

    if (!status?.existingUser && password !== confirmPassword) {
      toast.error(copy.mismatch);
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/project-invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          name: status?.existingUser ? undefined : name,
          password: status?.existingUser ? undefined : password,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as AcceptResponse;

      if (!response.ok || !data.ok || !data.redirectTo) {
        toast.error(data.error ?? copy.failed);
        return;
      }

      toast.success(copy.success);

      if (!status?.existingUser && status?.invitation?.email) {
        const signInResult = await signIn("credentials", {
          email: status.invitation.email,
          password,
          callbackUrl: data.redirectTo,
          redirect: false,
        });

        window.location.assign(signInResult?.url ?? data.redirectTo);
        return;
      }

      window.location.assign(data.redirectTo);
    } catch {
      toast.error(copy.failed);
    } finally {
      setIsSubmitting(false);
    }
  }

  const invitation = status?.invitation;
  const isExistingUser = Boolean(status?.existingUser);
  const needsSignIn =
    isExistingUser &&
    (!status?.authenticatedEmail ||
      status.authenticatedEmail.toLowerCase() !== invitation?.email.toLowerCase());
  const signInHref = `${getMarketingPath(locale, "login")}?callbackUrl=${encodeURIComponent(
    `${getMarketingPath(locale, "acceptInvite")}?token=${encodeURIComponent(token)}`
  )}`;

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
        {isLoading && (
          <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
            {copy.loading}
          </div>
        )}

        {!isLoading && status?.status !== "valid" && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
            {status?.status === "expired"
              ? copy.expired
              : status?.status === "accepted"
                ? copy.accepted
                : status?.error ?? copy.invalid}
          </div>
        )}

        {!isLoading && status?.status === "valid" && invitation && (
          <>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
              <p className="font-semibold text-gray-900">{invitation.project.name}</p>
              <p className="text-gray-500">{invitation.project.domain}</p>
              <div className="mt-3 space-y-1 text-gray-600">
                <p>
                  {copy.invitedBy}: {invitation.inviter.name ?? invitation.inviter.email}
                </p>
                <p>
                  {copy.role}: {roleLabel(invitation.role, locale)}
                </p>
                <p>
                  {copy.language}:{" "}
                  {invitation.langCode
                    ? invitation.langCode.toUpperCase()
                    : copy.allLanguages}
                </p>
              </div>
            </div>

            {needsSignIn ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
                  <p className="text-sm font-semibold text-gray-900">
                    {copy.existingUserTitle}
                  </p>
                  <p className="mt-1 text-sm text-gray-600">
                    {copy.existingUserDescription}
                  </p>
                </div>
                <Button asChild className="w-full bg-indigo-600 hover:bg-indigo-700">
                  <Link href={signInHref}>{copy.signIn}</Link>
                </Button>
              </div>
            ) : isExistingUser ? (
              <Button
                className="w-full bg-indigo-600 hover:bg-indigo-700"
                disabled={isSubmitting}
                onClick={() => acceptInvitation()}
              >
                {isSubmitting ? copy.accepting : copy.accept}
              </Button>
            ) : (
              <form onSubmit={acceptInvitation} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">{copy.name}</Label>
                  <Input
                    id="name"
                    placeholder={copy.namePlaceholder}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    minLength={2}
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
                  disabled={isSubmitting}
                >
                  {isSubmitting ? copy.accepting : copy.accept}
                </Button>
              </form>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
