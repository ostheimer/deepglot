import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { ProjectsTable, type ProjectRow } from "@/components/projekte/projects-table";

export const metadata = { title: "Projekte – Deepglot" };

export default async function ProjektePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/anmelden");

  const membership = await db.organizationMember.findFirst({
    where: { userId: session.user.id },
    include: {
      organization: {
        include: {
          projects: {
            include: {
              languages: true,
              members: true,
              _count: { select: { translations: true } },
            },
            orderBy: { updatedAt: "desc" },
          },
          members: {
            include: {
              user: { select: { name: true, email: true, image: true } },
            },
          },
        },
      },
    },
  });

  const org = membership?.organization;
  const rawProjects = org?.projects ?? [];

  if (rawProjects.length === 0) {
    const rows: ProjectRow[] = [];
    return <ProjectsTable projects={rows} />;
  }

  const projectIds = rawProjects.map((p) => p.id);

  // Sum of wordCount per project (one query)
  const wordsByProject = await db.translation.groupBy({
    by: ["projectId"],
    where: { projectId: { in: projectIds } },
    _sum: { wordCount: true },
  });

  // Count of manual translations per project
  const manualByProject = await db.translation.groupBy({
    by: ["projectId"],
    where: { projectId: { in: projectIds }, isManual: true },
    _count: { _all: true },
  });

  const wordMap = new Map(wordsByProject.map((r) => [r.projectId, r._sum.wordCount ?? 0]));
  const manualMap = new Map(manualByProject.map((r) => [r.projectId, r._count._all]));

  // Org members used as fallback for member avatars
  const orgMembers = (org?.members ?? []).map((m) => ({
    name: m.user?.name,
    email: m.user?.email,
    image: m.user?.image,
  }));

  const rows: ProjectRow[] = rawProjects.map((p) => ({
    id: p.id,
    name: p.name,
    domain: p.domain,
    originalLang: p.originalLang,
    updatedAt: p.updatedAt,
    totalWords: wordMap.get(p.id) ?? 0,
    languagesCount: p.languages.length,
    manualTranslations: manualMap.get(p.id) ?? 0,
    totalTranslations: p._count.translations,
    // Project-specific members + org members as fallback
    members:
      p.members.length > 0
        ? p.members.map((m) => ({ name: null, email: m.email, image: null }))
        : orgMembers,
  }));

  return <ProjectsTable projects={rows} />;
}
