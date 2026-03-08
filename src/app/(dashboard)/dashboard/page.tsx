import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Globe,
  HelpCircle,
  MessageCircle,
  Plus,
  Zap,
  AlertTriangle,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { formatNumber, getIntlLocale } from "@/lib/locale-formatting";
import { getPageLocale, type LocaleSearchParams } from "@/lib/request-locale";
import { withLocalePrefix } from "@/lib/site-locale";

export const metadata = { title: "Übersicht – Deepglot" };

// Users limit per plan
const PLAN_USERS_LIMIT: Record<string, number> = {
  FREE: 1,
  STARTER: 5,
  PROFESSIONAL: 25,
  ENTERPRISE: 100,
};
const PLAN_REQUESTS_LIMIT: Record<string, number> = {
  FREE: 1_000,
  STARTER: 50_000,
  PROFESSIONAL: 1_000_000,
  ENTERPRISE: 10_000_000,
};
const PLAN_LABELS: Record<string, string> = {
  FREE: "Free",
  STARTER: "Starter",
  PROFESSIONAL: "Advanced",
  ENTERPRISE: "Enterprise",
};

type DashboardPageProps = {
  searchParams: LocaleSearchParams;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const locale = await getPageLocale(searchParams);
  const session = await auth();
  if (!session?.user?.id) redirect(withLocalePrefix("/login", locale));

  const memberships = await db.organizationMember.findMany({
    where: { userId: session.user.id },
    include: {
      organization: {
        include: {
          projects: {
            include: { languages: true },
            orderBy: { updatedAt: "desc" },
          },
          subscription: true,
          members: { include: { user: { select: { name: true, email: true, image: true } } } },
          _count: { select: { members: true } },
        },
      },
    },
    take: 1,
  });

  const org = memberships[0]?.organization;
  const currentMonth = parseInt(new Date().toISOString().slice(0, 7).replace("-", ""));

  // Word usage this month
  const monthlyUsage = org
    ? await db.usageRecord.aggregate({
        where: { organizationId: org.id, month: currentMonth },
        _sum: { words: true },
      })
    : null;

  // Translation requests this month (count of UsageRecord entries = API batches)
  const requestsCount = org
    ? await db.usageRecord.count({
        where: { organizationId: org.id, month: currentMonth },
      })
    : 0;

  // Activity: recent exclusions, glossary rules, projects
  const recentExclusions = org
    ? await db.translationExclusion.findMany({
        where: { project: { organizationId: org.id } },
        include: { project: { select: { name: true, domain: true } } },
        orderBy: { createdAt: "desc" },
        take: 6,
      })
    : [];

  const recentGlossary = org
    ? await db.glossaryRule.findMany({
        where: { project: { organizationId: org.id } },
        include: { project: { select: { name: true, domain: true } } },
        orderBy: { createdAt: "desc" },
        take: 3,
      })
    : [];

  const wordsUsed = monthlyUsage?._sum.words ?? 0;
  const wordsLimit = org?.subscription?.wordsLimit ?? 10_000;
  const plan = org?.plan ?? "FREE";
  const usersLimit = PLAN_USERS_LIMIT[plan] ?? 1;
  const requestsLimit = PLAN_REQUESTS_LIMIT[plan] ?? 1_000;
  const usersCount = org?._count.members ?? 1;

  const wordsPercent = Math.min(Math.round((wordsUsed / wordsLimit) * 100), 100);
  const requestsPercent = Math.min(Math.round((requestsCount / requestsLimit) * 100), 100);

  // Build activity feed
  type ActivityItem = {
    id: string;
    project: string;
    message: string;
    date: Date;
    type: "exclusion" | "glossary" | "warning" | "project";
  };

  const activityItems: ActivityItem[] = [
    ...recentExclusions.map((e) => ({
      id: `excl-${e.id}`,
      project: e.project.domain,
      message:
        locale === "de"
          ? `${session.user?.email ?? "Du"} hat eine Ausnahme-Regel hinzugefügt „${e.type === "URL" ? "URL enthält" : e.type} ${e.value.slice(0, 30)}".`
          : `${session.user?.email ?? "You"} added an exclusion rule "${e.type === "URL" ? "URL contains" : e.type} ${e.value.slice(0, 30)}".`,
      date: e.createdAt,
      type: "exclusion" as const,
    })),
    ...recentGlossary.map((g) => ({
      id: `gloss-${g.id}`,
      project: g.project.domain,
      message:
        locale === "de"
          ? `${session.user?.email ?? "Du"} hat Glossar-Regel „${g.originalTerm}" hinzugefügt.`
          : `${session.user?.email ?? "You"} added glossary rule "${g.originalTerm}".`,
      date: g.createdAt,
      type: "glossary" as const,
    })),
    ...(org?.projects ?? []).map((p) => ({
      id: `proj-${p.id}`,
      project: p.domain,
      message:
        locale === "de"
          ? `Projekt „${p.name}" wurde erstellt.`
          : `Project "${p.name}" was created.`,
      date: p.createdAt,
      type: "project" as const,
    })),
  ]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 8);

  return (
    <div className="min-h-full">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        {locale === "de" ? "Übersicht" : "Overview"}
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_280px] gap-6">

        {/* ── LEFT: Plan Usage ──────────────────────────────── */}
        <aside className="space-y-5">
          {/* Plan Usage Card */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">
                {locale === "de" ? "Plan-Nutzung" : "Plan usage"}
              </h2>
            </div>
            <div className="px-5 py-4 space-y-4">
              {/* Current Plan */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">
                    {locale === "de" ? "Aktueller Plan" : "Current plan"}
                  </p>
                  <p className="text-sm font-semibold text-indigo-700 mt-0.5">
                    {PLAN_LABELS[plan] ?? plan}{" "}
                    {plan !== "FREE" && (
                      <span className="text-gray-400 font-normal text-xs">
                        {locale === "de" ? "(Monatlich)" : "(Monthly)"}
                      </span>
                    )}
                  </p>
                </div>
                <Link href={withLocalePrefix("/subscription", locale)}>
                  <button className="text-xs text-gray-600 border border-gray-300 rounded px-2.5 py-1.5 hover:bg-gray-50 transition-colors">
                    {locale === "de" ? "Plan verwalten" : "Manage plan"}
                  </button>
                </Link>
              </div>

              {/* Auto-upgrade */}
              <div className="flex items-start gap-2">
                <div className="flex-shrink-0 w-3 h-3 rounded-full border-2 border-gray-300 bg-gray-100 mt-0.5" />
                <div>
                  <p className="text-xs text-gray-600 flex items-center gap-1">
                    Auto-Upgrade
                    <HelpCircle className="h-3 w-3 text-gray-400" />
                  </p>
                  <p className="text-xs text-gray-500">
                    {locale === "de" ? "AUS (Nicht empfohlen)" : "OFF (Not recommended)"}
                  </p>
                </div>
              </div>

              {/* Word Usage */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">
                    {locale === "de" ? "Wörter-Nutzung" : "Word usage"}
                  </p>
                </div>
                <p className="text-sm font-semibold text-indigo-700 mb-1.5">
                  {formatNumber(wordsUsed, locale)} / {formatNumber(wordsLimit, locale)}
                </p>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      wordsPercent > 90 ? "bg-red-500" : wordsPercent > 70 ? "bg-yellow-400" : "bg-indigo-600"
                    }`}
                    style={{ width: `${wordsPercent}%` }}
                  />
                </div>
              </div>

              {/* Translation Requests */}
              <div>
                <div className="flex items-center gap-1 mb-1.5">
                  <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">
                    {locale === "de" ? "Übersetzungs-Anfragen" : "Translation requests"}
                  </p>
                  <HelpCircle className="h-3 w-3 text-gray-400" />
                </div>
                <p className="text-sm font-semibold text-indigo-700 mb-1.5">
                  {formatNumber(requestsCount, locale)} / {formatNumber(requestsLimit, locale)}
                </p>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      requestsPercent > 90 ? "bg-red-500" : "bg-indigo-600"
                    }`}
                    style={{ width: `${requestsPercent}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1.5 leading-tight">
                  {locale === "de"
                    ? "Anfragen-Zähler wird am 1. jedes Monats zurückgesetzt."
                    : "The request counter resets on the first day of each month."}
                </p>
              </div>
            </div>

            {/* Users */}
            <div className="px-5 py-4 border-t border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {locale === "de" ? "Benutzer" : "Users"}
                </p>
                <span className="text-xs text-gray-500">
                  {usersCount} / {usersLimit}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {org?.members.slice(0, 6).map((m) => (
                  <div key={m.id} className="flex flex-col items-center gap-1">
                    <div className="h-9 w-9 rounded-full bg-indigo-100 flex items-center justify-center border-2 border-white shadow-sm">
                      {m.user?.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={m.user.image}
                          alt={m.user.name ?? ""}
                          className="h-9 w-9 rounded-full object-cover"
                        />
                      ) : (
                        <span className="text-xs font-bold text-indigo-700">
                          {(m.user?.name ?? m.user?.email ?? "?").charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-500">
                      {m.role === "OWNER" ? "Admin" : m.role}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* ── CENTER: Projects ──────────────────────────────── */}
        <main className="space-y-5">
          {/* Promo Banner */}
          <div className="relative bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl overflow-hidden p-5 text-white min-h-[120px]">
            <div className="relative z-10 max-w-[55%]">
              <p className="text-sm font-bold leading-tight">
                {locale === "de"
                  ? "Übersetzt deine Inhalte schnell und datenschutzkonform – ohne Cloud-Lock-in."
                  : "Translate your content quickly and privately without cloud lock-in."}
              </p>
              <p className="text-xs text-gray-300 mt-1.5">
                {locale === "de"
                  ? "Deepglot nutzt DeepL für höchste Übersetzungsqualität – deine Daten bleiben bei dir."
                  : "Deepglot uses DeepL for top translation quality while your data stays under your control."}
              </p>
              <div className="flex gap-2 mt-3">
                <Link href={withLocalePrefix("/projects/new", locale)}>
                  <button className="text-xs bg-white text-gray-900 font-semibold px-3 py-1.5 rounded hover:bg-gray-100 transition-colors">
                    {locale === "de" ? "Projekt erstellen" : "Create project"}
                  </button>
                </Link>
                <Link href={withLocalePrefix("/subscription", locale)}>
                  <button className="text-xs border border-white/30 text-white px-3 py-1.5 rounded hover:bg-white/10 transition-colors">
                    {locale === "de" ? "Mehr erfahren" : "Learn more"}
                  </button>
                </Link>
              </div>
            </div>
            {/* Decorative */}
            <div className="absolute right-0 top-0 h-full w-[42%] flex items-center justify-center opacity-20">
              <Globe className="h-32 w-32 text-indigo-400" />
            </div>
            <div className="absolute top-3 right-3 bg-white/10 rounded-full px-2 py-0.5 flex items-center gap-1">
              <Zap className="h-3 w-3 text-yellow-400" />
              <span className="text-xs text-white font-medium">DeepL powered</span>
            </div>
          </div>

          {/* Project List */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900">
                {org?.projects.length ?? 0}{" "}
                {locale === "de"
                  ? `Projekt${(org?.projects.length ?? 0) !== 1 ? "e" : ""}`
                  : `project${(org?.projects.length ?? 0) !== 1 ? "s" : ""}`}
              </h2>
              <Link href={withLocalePrefix("/projects/new", locale)}>
                <Button className="bg-indigo-600 hover:bg-indigo-700 h-8 px-3 text-xs gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  {locale === "de" ? "Projekt erstellen" : "Create project"}
                </Button>
              </Link>
            </div>

            {org?.projects.length ? (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
                {org.projects.slice(0, 8).map((project) => {
                  const minutesAgo = Math.floor(
                    (Date.now() - project.updatedAt.getTime()) / 60000
                  );
                  const isRecent = minutesAgo < 60;
                  const isActive = minutesAgo < 60 * 24 * 30; // active in last 30 days

                  let timeLabel = "";
                  if (minutesAgo < 1) {
                    timeLabel = locale === "de" ? "Gerade eben" : "Just now";
                  } else if (minutesAgo < 60) {
                    timeLabel =
                      locale === "de"
                        ? `Vor ${minutesAgo} Min.`
                        : `${minutesAgo} min ago`;
                  } else if (minutesAgo < 60 * 24) {
                    const hours = Math.floor(minutesAgo / 60);
                    timeLabel =
                      locale === "de"
                        ? `Vor ${hours} Std.`
                        : `${hours} hr ago`;
                  } else if (minutesAgo < 60 * 24 * 30) {
                    const days = Math.floor(minutesAgo / (60 * 24));
                    timeLabel =
                      locale === "de"
                        ? `Vor ${days} Tagen`
                        : `${days} day${days === 1 ? "" : "s"} ago`;
                  } else {
                    const months = Math.floor(minutesAgo / (60 * 24 * 30));
                    timeLabel =
                      locale === "de"
                        ? `Vor ${months} Monaten`
                        : `${months} month${months === 1 ? "" : "s"} ago`;
                  }

                  return (
                    <Link
                      key={project.id}
                      href={withLocalePrefix(`/projects/${project.id}/translations/languages`, locale)}
                    >
                      <div className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`flex-shrink-0 h-2 w-2 rounded-full ${
                              isRecent
                                ? "bg-green-500"
                                : isActive
                                ? "bg-yellow-400"
                                : "bg-gray-300"
                            }`}
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {project.domain}
                            </p>
                            <p className="text-xs text-gray-400 truncate">
                              https://{project.domain}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-gray-400 flex-shrink-0 ml-4">
                          <Clock className="h-3 w-3" />
                          {timeLabel}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="bg-white border border-dashed border-gray-300 rounded-xl py-14 text-center">
                <Globe className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                <p className="text-sm font-medium text-gray-600">
                  {locale === "de" ? "Noch kein Projekt" : "No project yet"}
                </p>
                <p className="text-xs text-gray-400 mt-1 mb-4 max-w-xs mx-auto">
                  {locale === "de"
                    ? "Erstelle dein erstes Projekt und verbinde dein WordPress-Plugin."
                    : "Create your first project and connect your WordPress plugin."}
                </p>
                <Link href={withLocalePrefix("/projects/new", locale)}>
                  <Button className="bg-indigo-600 hover:bg-indigo-700 gap-1.5">
                    <Plus className="h-4 w-4" />
                    {locale === "de" ? "Erstes Projekt erstellen" : "Create first project"}
                  </Button>
                </Link>
              </div>
            )}

            {(org?.projects.length ?? 0) > 0 && (
              <div className="text-center mt-2">
                <Link
                  href={withLocalePrefix("/projects", locale)}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  {locale === "de" ? "Alle Projekte anzeigen" : "View all projects"}
                </Link>
              </div>
            )}
          </div>
        </main>

        {/* ── RIGHT: Activity + Support ─────────────────────── */}
        <aside className="space-y-5">
          {/* Activity Feed */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">
                {locale === "de" ? "Aktivität" : "Activity"}
              </h2>
            </div>

            {activityItems.length ? (
              <div className="divide-y divide-gray-50 max-h-[420px] overflow-y-auto">
                {activityItems.map((item) => {
                  const icon =
                    item.type === "warning" ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0 mt-0.5" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0 mt-0.5" />
                    );

                  const dateStr = new Intl.DateTimeFormat(getIntlLocale(locale), {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(item.date);

                  return (
                    <div key={item.id} className="px-4 py-3 hover:bg-gray-50">
                      <div className="flex gap-2.5">
                        {icon}
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-indigo-600 truncate">
                            {item.project}
                          </p>
                          <p className="text-xs text-gray-600 mt-0.5 leading-snug">
                            {item.message}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">{dateStr}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-5 py-10 text-center">
                <p className="text-xs text-gray-400">
                  {locale === "de" ? "Noch keine Aktivitäten" : "No activity yet"}
                </p>
              </div>
            )}

            {activityItems.length > 0 && (
              <div className="px-5 py-3 border-t border-gray-100 text-center">
                <button className="text-xs text-indigo-600 hover:underline">
                  {locale === "de" ? "Alle Aktivitäten anzeigen" : "View all activity"}
                </button>
              </div>
            )}
          </div>

          {/* Support Box */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-start gap-3">
              <MessageCircle className="h-5 w-5 text-indigo-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-gray-900">Support</p>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                  {locale === "de"
                    ? "Deepglot Support ist montags bis freitags von 9–17 Uhr erreichbar."
                    : "Deepglot support is available Monday to Friday from 9 a.m. to 5 p.m."}
                </p>
                <a
                  href="mailto:support@deepglot.com"
                  className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline mt-2"
                >
                  {locale === "de" ? "Hilfecenter" : "Help center"}
                  <HelpCircle className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
