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
    <div className="-m-6 min-h-screen sm:-m-8 lg:flex lg:gap-6">
      <h1 className="sr-only">{project.name}</h1>
      <ProjectSidebar project={project} access={access} />
      <div className="min-w-0 flex-1 p-6 sm:p-8">{children}</div>
    </div>
  );
}
