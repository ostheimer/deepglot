import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import { ProjectSidebar } from "@/components/projekte/project-sidebar";
import { canAccessProject, getProjectAccess } from "@/lib/project-access";
import { getRequestLocale } from "@/lib/request-locale";
import { withLocalePrefix } from "@/lib/site-locale";

interface ProjectLayoutProps {
  children: React.ReactNode;
  params: Promise<{ projektId: string }>;
}

export default async function ProjectLayout({ children, params }: ProjectLayoutProps) {
  const { projektId } = await params;
  const locale = await getRequestLocale();
  const session = await auth();

  if (!session?.user?.id) redirect(withLocalePrefix("/login", locale));

  const project = await db.project.findUnique({
    where: { id: projektId },
    include: {
      languages: { orderBy: { langCode: "asc" } },
      organization: true,
      _count: { select: { translations: true } },
    },
  });

  if (!project) notFound();

  const access = await getProjectAccess(session.user.id, projektId);

  if (!access || !canAccessProject(access)) notFound();

  return (
    <div className="flex gap-6 -m-8 min-h-screen">
      <h1 className="sr-only">{project.name}</h1>
      <ProjectSidebar project={project} access={access} />
      <div className="flex-1 p-8 min-w-0">{children}</div>
    </div>
  );
}
