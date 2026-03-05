import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { UsageCharts } from "@/components/abonnement/usage-charts";

export const metadata = { title: "Nutzung – Deepglot" };

const PLAN_LIMITS: Record<string, { words: number; requests: number; languages: number; projects: number; users: number }> = {
  FREE:         { words: 10_000,    requests: 1_000,      languages: 1,  projects: 1,  users: 1 },
  STARTER:      { words: 100_000,   requests: 50_000,     languages: 3,  projects: 3,  users: 5 },
  PROFESSIONAL: { words: 1_000_000, requests: 1_000_000,  languages: 10, projects: 10, users: 25 },
  ENTERPRISE:   { words: 10_000_000, requests: 10_000_000, languages: 50, projects: 50, users: 100 },
};

export default async function NutzungPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/anmelden");

  const membership = await db.organizationMember.findFirst({
    where: { userId: session.user.id },
    include: {
      organization: {
        include: {
          subscription: true,
          projects: {
            include: { languages: true },
            orderBy: { updatedAt: "desc" },
          },
          members: true,
          _count: { select: { projects: true, members: true } },
        },
      },
    },
  });

  const org = membership?.organization;
  const plan = org?.plan ?? "FREE";
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.FREE;
  const currentMonth = parseInt(new Date().toISOString().slice(0, 7).replace("-", ""));

  const projectIds = (org?.projects ?? []).map((p) => p.id);

  // Word usage per project this month
  const wordsByProject = projectIds.length
    ? await db.usageRecord.groupBy({
        by: ["projectId"],
        where: { organizationId: org!.id, month: currentMonth },
        _sum: { words: true },
      })
    : [];

  // Request count per project this month
  const requestsByProject = projectIds.length
    ? await db.usageRecord.groupBy({
        by: ["projectId"],
        where: { organizationId: org!.id, month: currentMonth },
        _count: { _all: true },
      })
    : [];

  // Language count per project
  const langsByProject = projectIds.length
    ? await db.projectLanguage.groupBy({
        by: ["projectId"],
        where: { projectId: { in: projectIds } },
        _count: { _all: true },
      })
    : [];

  const wordMap = new Map(wordsByProject.map((r) => [r.projectId, r._sum.words ?? 0]));
  const reqMap = new Map(requestsByProject.map((r) => [r.projectId, r._count._all]));
  const langMap = new Map(langsByProject.map((r) => [r.projectId, r._count._all]));

  const totalWords = Array.from(wordMap.values()).reduce((s, v) => s + v, 0);
  const totalRequests = Array.from(reqMap.values()).reduce((s, v) => s + v, 0);

  const projectRows = (org?.projects ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    domain: p.domain,
    words: wordMap.get(p.id) ?? 0,
    requests: reqMap.get(p.id) ?? 0,
    languages: langMap.get(p.id) ?? 0,
    members: 1, // org members used for all projects
  }));

  const pieWordData = projectRows
    .filter((p) => p.words > 0)
    .map((p) => ({ name: p.domain, value: p.words }));

  const pieRequestData = projectRows
    .filter((p) => p.requests > 0)
    .map((p) => ({ name: p.domain, value: p.requests }));

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Nutzung</h1>

      <UsageCharts
        totalWords={totalWords}
        wordsLimit={limits.words}
        totalRequests={totalRequests}
        requestsLimit={limits.requests}
        pieWordData={pieWordData}
        pieRequestData={pieRequestData}
        projectRows={projectRows}
        projectCount={org?._count.projects ?? 0}
        projectsLimit={limits.projects}
        membersCount={org?._count.members ?? 0}
        membersLimit={limits.users}
        langLimitPerProject={limits.languages}
      />
    </div>
  );
}
