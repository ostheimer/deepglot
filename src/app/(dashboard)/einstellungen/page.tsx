import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Eye, Pencil, Plus } from "lucide-react";
import { PasswordChangeForm } from "@/components/einstellungen/password-change-form";
import { ProfileSettingsForm } from "@/components/einstellungen/profile-settings-form";
import { getPageLocale, type LocaleSearchParams } from "@/lib/request-locale";
import { withLocalePrefix } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

export const metadata = { title: "Konto-Einstellungen" };

const PLAN_LABELS: Record<string, string> = {
  FREE: "Free",
  STARTER: "Starter",
  PROFESSIONAL: "Professional",
  ENTERPRISE: "Enterprise",
};

type EinstellungenPageProps = {
  searchParams: LocaleSearchParams;
};

export default async function EinstellungenPage({
  searchParams,
}: EinstellungenPageProps) {
  const locale = await getPageLocale(searchParams);
  const session = await auth();
  if (!session?.user?.id) redirect(withLocalePrefix("/login", locale));

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
      <h1 className="sr-only">
        {uiText(locale, "Account settings", "Konto-Einstellungen")}
      </h1>

      {/* ── My Account ──────────────────────────────────── */}
      <section>
        <h2 className="text-xl font-bold text-gray-900 mb-4">
          {uiText(locale, "My account", "Mein Konto")}
        </h2>
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
                {uiText(locale, "Open Gravatar", "Zu Gravatar")}
                <ExternalLink className="h-3 w-3" />
              </a>
              <p className="text-xs text-gray-500 mt-1 max-w-xs">
                {uiText(locale, "Deepglot currently uses your Gravatar. Direct uploads are not available yet.", "Deepglot verwendet aktuell deinen Gravatar. Direkte Uploads sind noch nicht verfügbar.")}
              </p>
            </div>
          </div>

          <ProfileSettingsForm
            locale={locale}
            email={user?.email ?? ""}
            firstName={firstName}
            lastName={lastName}
          />
        </div>
      </section>

      {/* ── Account Security ────────────────────────────── */}
      <section>
        <h2 className="text-xl font-bold text-gray-900 mb-4">
          {uiText(locale, "Account security", "Kontosicherheit")}
        </h2>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <PasswordChangeForm hasPassword={!!user?.password} />

          <div className="border-t border-gray-100">
            <div className="bg-white p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">
                    {uiText(locale, "Two-factor authentication", "Zwei-Faktor-Authentifizierung")}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
                    {uiText(locale, "2FA needs a dedicated enrollment and recovery flow. This setting cannot be changed until that work is implemented.", "2FA benötigt ein eigenes Enrollment und Recovery-Konzept. Bis das umgesetzt ist, kann diese Einstellung nicht geändert werden.")}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0 text-xs">
                  {uiText(locale, "Planned", "Geplant")}
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Notifications ───────────────────────────────── */}
      <section>
        <h2 className="text-xl font-bold text-gray-900 mb-4">
          {uiText(locale, "Notifications", "Benachrichtigungen")}
        </h2>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="p-5">
            <p className="text-sm font-medium text-gray-900">
              {uiText(locale, "Preferences are not configurable yet", "Einstellungen sind noch nicht konfigurierbar")}
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-gray-500">
              {uiText(locale, "Deepglot will continue to send important account, security, and project emails. Optional notification controls will appear once they can be persisted.", "Deepglot sendet weiterhin wichtige Konto-, Sicherheits- und Projekt-E-Mails. Optionale Benachrichtigungen werden erst angezeigt, wenn sie dauerhaft gespeichert werden können.")}
            </p>
          </div>

          <div className="border-t border-gray-100 divide-y divide-gray-100">
            {[
              {
                label: uiText(locale, "Account and security notices", "Konto- und Sicherheitshinweise"),
                status: uiText(locale, "Always on", "Immer aktiv"),
              },
              {
                label: uiText(locale, "Project and workspace activity", "Projekt- und Workspace-Aktivität"),
                status: uiText(locale, "Planned", "Geplant"),
              },
              {
                label: uiText(locale, "Product updates", "Produkt-Updates"),
                status: uiText(locale, "Planned", "Geplant"),
              },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-4 px-5 py-4">
                <span className="text-sm font-medium text-gray-900">{item.label}</span>
                <Badge variant="outline" className="shrink-0 text-xs">
                  {item.status}
                </Badge>
              </div>
            ))}
          </div>

          {memberships.length > 0 && (
            <div className="border-t border-gray-100 bg-gray-50 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                {uiText(locale, "Workspace note", "Workspace-Hinweis")}
              </p>
              <div className="mt-3 space-y-3">
                {memberships.map((m) => (
                  <div key={m.id} className="flex items-start gap-2">
                    <div className="mt-0.5 h-5 w-5 rounded-full bg-indigo-600 flex items-center justify-center">
                      <span className="text-white text-xs font-bold">
                        {m.organization.name.charAt(0)}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-gray-500">
                      <span className="font-semibold text-gray-700">{m.organization.name}</span>
                      {" - "}
                      {uiText(locale, "workspace-specific notification controls will be enabled once a persisted preference model exists.", "eigene Workspace-Benachrichtigungen werden erst aktiviert, wenn es ein dauerhaftes Präferenzmodell gibt.")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Workspaces ──────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
            Workspaces
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              {uiText(locale, "Workspace creation and management will appear here once persistence for those actions is implemented.", "Workspace-Erstellung und Verwaltung werden hier angezeigt, sobald die Persistenz dafür umgesetzt ist.")}
            </p>
          </div>
          <Button
            disabled
            className="bg-indigo-600 hover:bg-indigo-600 gap-1.5 h-8 px-4 text-sm opacity-50"
            title={uiText(locale, "Not available yet", "Noch nicht verfügbar")}
          >
            <Plus className="h-3.5 w-3.5" />
            {uiText(locale, "Create", "Erstellen")}
          </Button>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_auto] gap-3 px-5 py-3 bg-gray-50 border-b border-gray-200">
            {[
              "NAME",
              locale === "de" ? "TYP" : "TYPE",
              "PLAN",
              locale === "de" ? "ROLLE" : "ROLE",
              locale === "de" ? "PROJEKTE" : "PROJECTS",
              locale === "de" ? "USER" : "USERS",
              locale === "de" ? "AKTIONEN" : "ACTIONS",
            ].map((h) => (
              <span key={h} className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {h}
              </span>
            ))}
          </div>

          {memberships.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm text-gray-400">
                {uiText(locale, "No workspace yet.", "Noch kein Workspace vorhanden.")}
              </p>
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
                  {uiText(locale, "Personal", "Persönlich")}
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
                  {m.role === "OWNER"
                    ? "Admin"
                    : m.role === "ADMIN"
                      ? "Admin"
                      : uiText(locale, "Member", "Mitglied")}
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
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled
                    aria-label={
                      locale === "de"
                        ? `${m.organization.name} ansehen - noch nicht verfügbar`
                        : `View ${m.organization.name} - not available yet`
                    }
                    title={uiText(locale, "Not available yet", "Noch nicht verfügbar")}
                    className="h-7 w-7 p-0 opacity-40"
                  >
                    <Eye className="h-3.5 w-3.5 text-gray-400" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled
                    aria-label={
                      locale === "de"
                        ? `${m.organization.name} bearbeiten - noch nicht verfügbar`
                        : `Edit ${m.organization.name} - not available yet`
                    }
                    title={uiText(locale, "Not available yet", "Noch nicht verfügbar")}
                    className="h-7 w-7 p-0 opacity-40"
                  >
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
