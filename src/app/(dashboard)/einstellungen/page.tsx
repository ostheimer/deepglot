import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { SettingsToggle } from "@/components/projekte/settings-toggle";
import { ExternalLink, Eye, Pencil, Plus } from "lucide-react";
import { PasswordChangeForm } from "@/components/einstellungen/password-change-form";
import { AccountDeleteButton } from "@/components/einstellungen/account-delete-button";

export const metadata = { title: "Konto-Einstellungen" };

const PLAN_LABELS: Record<string, string> = {
  FREE: "Free",
  STARTER: "Starter",
  PROFESSIONAL: "Professional",
  ENTERPRISE: "Enterprise",
};

export default async function EinstellungenPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/anmelden");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
  });

  const memberships = await db.organizationMember.findMany({
    where: { userId: session.user.id },
    include: {
      organization: {
        include: {
          subscription: true,
          _count: { select: { projects: true, members: true } },
        },
      },
    },
  });

  const nameParts = (user?.name ?? "").split(" ");
  const firstName = nameParts[0] ?? "";
  const lastName = nameParts.slice(1).join(" ");

  return (
    <div className="max-w-3xl space-y-8">

      {/* ── My Account ──────────────────────────────────── */}
      <section>
        <h2 className="text-xl font-bold text-gray-900 mb-4">Mein Konto</h2>
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
          {/* Avatar */}
          <div className="flex items-start gap-4">
            <Avatar className="h-16 w-16 border border-gray-200">
              <AvatarImage src={user?.image ?? undefined} />
              <AvatarFallback className="bg-indigo-100 text-indigo-700 text-xl font-bold">
                {(user?.name ?? user?.email ?? "?").charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <a
                href="https://gravatar.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline"
              >
                Zu Gravatar
                <ExternalLink className="h-3 w-3" />
              </a>
              <p className="text-xs text-gray-500 mt-1 max-w-xs">
                Du kannst deinen Avatar über Gravatar ändern oder direkt ein Bild hochladen.
              </p>
            </div>
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              E-Mail-Adresse
            </Label>
            <Input defaultValue={user?.email ?? ""} type="email" className="max-w-md" />
          </div>

          {/* Name */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Vorname
              </Label>
              <Input defaultValue={firstName} placeholder="Vorname eingeben" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Nachname
              </Label>
              <Input defaultValue={lastName} placeholder="Nachname eingeben" />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <AccountDeleteButton />
            <Button className="bg-indigo-600 hover:bg-indigo-700 h-8 px-4 text-sm">
              Speichern
            </Button>
          </div>
        </div>
      </section>

      {/* ── Account Security ────────────────────────────── */}
      <section>
        <h2 className="text-xl font-bold text-gray-900 mb-4">Kontosicherheit</h2>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <PasswordChangeForm hasPassword={!!user?.password} />

          <div className="border-t border-gray-100">
            <SettingsToggle
              label="Zwei-Faktor-Authentifizierung"
              description="Fügt eine zusätzliche Sicherheitsebene für die Anmeldung hinzu."
              defaultChecked={false}
            />
          </div>
        </div>
      </section>

      {/* ── Notifications ───────────────────────────────── */}
      <section>
        <h2 className="text-xl font-bold text-gray-900 mb-4">Benachrichtigungen</h2>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <SettingsToggle
            label="Neuigkeiten & Feature-Updates"
            description="Bleib über Produkt-Updates, Deepglot-Ankündigungen und gelegentliche News auf dem Laufenden."
            defaultChecked={false}
          />
          <div className="border-t border-gray-100">
            <SettingsToggle
              label="Onboarding"
              description="Erhalte Tipps für deine ersten Tage mit Deepglot."
              defaultChecked={true}
            />
          </div>
          <div className="border-t border-gray-100">
            <SettingsToggle
              label="Workspaces & Projekte"
              description="Werde über Aktivitäten in deinen Workspaces und Projekten benachrichtigt."
              defaultChecked={true}
            />
          </div>

          {/* Workspace sub-settings */}
          <div className="border-t border-gray-100 bg-gray-50">
            {memberships.map((m) => (
              <div key={m.id} className="px-5 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-5 w-5 rounded-full bg-indigo-600 flex items-center justify-center">
                    <span className="text-white text-xs font-bold">
                      {m.organization.name.charAt(0)}
                    </span>
                  </div>
                  <span className="text-sm font-semibold text-gray-700">
                    {m.organization.name}
                  </span>
                </div>

                <div className="space-y-3 pl-7">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Workspace-Nutzung</p>
                      <p className="text-xs text-gray-500 mt-0.5 max-w-sm">
                        Benachrichtigungen zu Workspace-Auslastung, Plan-Limits, Einladungen etc.
                      </p>
                    </div>
                    <button
                      className="relative flex-shrink-0 h-5 w-9 rounded-full bg-indigo-600 transition-colors"
                      role="switch"
                      aria-checked="true"
                    >
                      <span className="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-white shadow" />
                    </button>
                  </div>

                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Aktivitäts-Digest</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Regelmäßige Updates über Workspace-Aktivitäten
                      </p>
                    </div>
                    <select className="h-7 text-xs border border-gray-200 rounded px-2 bg-white text-gray-700">
                      <option value="weekly">Wöchentlich</option>
                      <option value="daily">Täglich</option>
                      <option value="never">Nie</option>
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end p-4 border-t border-gray-100">
            <Button className="bg-indigo-600 hover:bg-indigo-700 h-8 px-4 text-sm">
              Speichern
            </Button>
          </div>
        </div>
      </section>

      {/* ── Workspaces ──────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            Workspaces
            <button className="text-gray-400 hover:text-gray-600">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          </h2>
          <Button className="bg-indigo-600 hover:bg-indigo-700 gap-1.5 h-8 px-4 text-sm">
            <Plus className="h-3.5 w-3.5" />
            Erstellen
          </Button>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_auto] gap-3 px-5 py-3 bg-gray-50 border-b border-gray-200">
            {["NAME", "TYP", "PLAN", "ROLLE", "PROJEKTE", "USER", "AKTIONEN"].map((h) => (
              <span key={h} className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {h}
              </span>
            ))}
          </div>

          {memberships.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm text-gray-400">Noch kein Workspace vorhanden.</p>
            </div>
          ) : (
            memberships.map((m) => (
              <div
                key={m.id}
                className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_auto] gap-3 px-5 py-4 border-b border-gray-100 last:border-0 items-center hover:bg-gray-50"
              >
                {/* Name */}
                <div className="flex items-center gap-2.5">
                  <div className="h-7 w-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-xs font-bold">
                      {m.organization.name.charAt(0)}
                    </span>
                  </div>
                  <span className="text-sm font-medium text-gray-900 truncate">
                    {m.organization.name}
                  </span>
                </div>

                {/* Type */}
                <span className="text-sm text-gray-600 flex items-center gap-1">
                  <svg className="h-3 w-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  Persönlich
                </span>

                {/* Plan */}
                <Badge
                  variant="outline"
                  className="text-xs w-fit"
                >
                  {PLAN_LABELS[m.organization.plan] ?? m.organization.plan}
                </Badge>

                {/* Role */}
                <span className="text-sm text-gray-700 capitalize">
                  {m.role === "OWNER" ? "Admin" : m.role === "ADMIN" ? "Admin" : "Mitglied"}
                </span>

                {/* Projects count */}
                <span className="text-sm text-gray-700">
                  {m.organization._count.projects}
                </span>

                {/* Users */}
                <div className="flex items-center">
                  <div className="h-6 w-6 rounded-full bg-indigo-100 border-2 border-white flex items-center justify-center">
                    <span className="text-xs font-bold text-indigo-700">
                      {(session.user.name ?? session.user.email ?? "?").charAt(0).toUpperCase()}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                    <Eye className="h-3.5 w-3.5 text-gray-400" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                    <Pencil className="h-3.5 w-3.5 text-gray-400" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
