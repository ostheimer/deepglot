import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { AUDIT_CATEGORIES } from "@/lib/audit-events";
import { auditActionLabel, auditCategoryLabel } from "@/lib/audit-labels";
import { listAuditEvents, parseAuditFilters } from "@/lib/audit-query";
import { getRequestLocale } from "@/lib/request-locale";
import { withLocalePrefix } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function csvCell(value: string) {
  const safe = /^[=+@\-\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export default async function ActivityPage({ searchParams }: Props) {
  const locale = await getRequestLocale();
  const user = (await auth())?.user;
  if (!user?.id) redirect(withLocalePrefix("/login", locale));
  const raw = await searchParams;
  const one = (key: string) => typeof raw[key] === "string" ? raw[key] as string : "";
  const memberships = await db.organizationMember.findMany({
    where: { userId: user.id, role: { in: ["OWNER", "ADMIN"] } },
    select: { organizationId: true, organization: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const organizationId = one("workspace") || memberships[0]?.organizationId;
  const authorized = memberships.some((item) => item.organizationId === organizationId);
  if (!organizationId || !authorized) {
    return <div className="rounded-xl border bg-white p-6">{uiText(locale, "Activity is available to workspace owners and admins.", "Aktivitäten sind für Inhaber und Administratoren des Arbeitsbereichs verfügbar.")}</div>;
  }
  const params = new URLSearchParams();
  for (const key of ["from", "to", "actor", "project", "category"]) {
    if (one(key)) params.set(key, one(key));
  }
  let events: Awaited<ReturnType<typeof listAuditEvents>> = [];
  let invalid = false;
  try {
    events = await listAuditEvents(db, {
      organizationId, readerUserId: user.id, filters: parseAuditFilters(params), limit: 100,
    });
  } catch { invalid = true; }
  const [actors, projects] = await Promise.all([
    db.organizationMember.findMany({
      where: { organizationId }, select: { user: { select: { id: true, name: true, email: true } } },
    }),
    db.project.findMany({ where: { organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const path = withLocalePrefix("/dashboard/aktivitaet", locale);
  const csvRows = ["timestamp,actor,project,category,action", ...(events ?? []).map((event) => [
    event.createdAt.toISOString(), event.actor?.name || event.actor?.email || "System",
    event.project?.name || event.projectIdSnapshot || "", event.category, event.action,
  ].map(csvCell).join(","))];
  const csvHref = `data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${csvRows.join("\r\n")}\r\n`)}`;
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold text-gray-900">{uiText(locale, "Activity", "Aktivität")}</h1>
      <p className="mt-1 text-sm text-gray-600">{uiText(locale, "Saved changes from this workspace. Earlier actions are not backfilled.", "Gespeicherte Änderungen dieses Arbeitsbereichs. Frühere Aktionen werden nicht nachgetragen.")}</p></div>
    <form method="get" action={path} className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-sm">{uiText(locale, "Workspace", "Arbeitsbereich")}
        <select name="workspace" defaultValue={organizationId} className="mt-1 w-full rounded border p-2">
          {memberships.map((item) => <option key={item.organizationId} value={item.organizationId}>{item.organization.name}</option>)}
        </select></label>
      <label className="text-sm">{uiText(locale, "From", "Von")}<input type="date" name="from" defaultValue={one("from")} className="mt-1 w-full rounded border p-2" /></label>
      <label className="text-sm">{uiText(locale, "To", "Bis")}<input type="date" name="to" defaultValue={one("to")} className="mt-1 w-full rounded border p-2" /></label>
      <label className="text-sm">{uiText(locale, "Actor", "Person")}
        <select name="actor" defaultValue={one("actor")} className="mt-1 w-full rounded border p-2"><option value="">{uiText(locale, "All", "Alle")}</option>
          {actors.map(({ user: actor }) => <option key={actor.id} value={actor.id}>{actor.name || actor.email}</option>)}
        </select></label>
      <label className="text-sm">{uiText(locale, "Project", "Projekt")}
        <select name="project" defaultValue={one("project")} className="mt-1 w-full rounded border p-2"><option value="">{uiText(locale, "All", "Alle")}</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select></label>
      <label className="text-sm">{uiText(locale, "Category", "Kategorie")}
        <select name="category" defaultValue={one("category")} className="mt-1 w-full rounded border p-2"><option value="">{uiText(locale, "All", "Alle")}</option>
          {AUDIT_CATEGORIES.map((category) => <option key={category} value={category}>{auditCategoryLabel(category, locale)}</option>)}
        </select></label>
      <button className="rounded bg-brand-600 px-4 py-2 text-sm font-semibold text-white">{uiText(locale, "Filter", "Filtern")}</button>
    </form>
    {invalid ? <p role="alert" className="text-sm text-red-700">{uiText(locale, "Invalid filter.", "Ungültiger Filter.")}</p> : null}
    <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead className="border-b bg-gray-50 text-gray-600"><tr>
      <th className="p-3">{uiText(locale, "Date", "Datum")}</th><th className="p-3">{uiText(locale, "Actor", "Person")}</th>
      <th className="p-3">{uiText(locale, "Project", "Projekt")}</th><th className="p-3">{uiText(locale, "Action", "Aktion")}</th></tr></thead>
      <tbody>{(events ?? []).map((event) => <tr key={event.id} className="border-b last:border-0">
        <td className="whitespace-nowrap p-3">{new Intl.DateTimeFormat(locale === "de" ? "de-AT" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Vienna" }).format(event.createdAt)}</td>
        <td className="p-3">{event.actor?.name || event.actor?.email || uiText(locale, "System", "System")}</td>
        <td className="p-3">{event.project?.name || event.projectIdSnapshot || "—"}</td>
        <td className="p-3"><span className="text-gray-500">{auditCategoryLabel(event.category, locale)}</span><br />{auditActionLabel(event.action, locale)}</td>
      </tr>)}</tbody></table>
      {!events?.length && !invalid ? <p className="p-6 text-sm text-gray-500">{uiText(locale, "No saved activity matches these filters.", "Keine gespeicherte Aktivität passt zu diesen Filtern.")}</p> : null}
    </div>
    {events && events.length >= 100 ? <p className="text-sm text-gray-600">{uiText(locale, "Showing the latest 100 events. Narrow the date range to see older events.", "Die letzten 100 Ereignisse werden angezeigt. Schränke den Zeitraum für ältere Ereignisse ein.")}</p> : null}
    <a className="text-sm text-brand-700 underline" download="deepglot-activity.csv" href={csvHref}>{uiText(locale, "Export displayed events as CSV", "Angezeigte Ereignisse als CSV exportieren")}</a>
    <Link className="text-sm text-brand-700 underline" href={withLocalePrefix("/dashboard", locale)}>{uiText(locale, "Back to overview", "Zur Übersicht")}</Link>
  </div>;
}
