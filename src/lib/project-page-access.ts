import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import {
  canAccessProjectArea,
  canManageProject,
  getProjectAccess,
  type ProjectArea,
} from "@/lib/project-access";
import { getRequestLocale } from "@/lib/request-locale";
import { withLocalePrefix } from "@/lib/site-locale";

export async function requireProjectAreaAccess(
  projectId: string,
  area: ProjectArea,
  langCode?: string | null
) {
  const locale = await getRequestLocale();
  const session = await auth();

  if (!session?.user?.id) {
    redirect(withLocalePrefix("/login", locale));
  }

  const access = await getProjectAccess(session.user.id, projectId);
  if (!canAccessProjectArea(access, area, langCode)) {
    notFound();
  }

  return access;
}

export async function requireProjectManagement(projectId: string) {
  const locale = await getRequestLocale();
  const session = await auth();

  if (!session?.user?.id) {
    redirect(withLocalePrefix("/login", locale));
  }

  const access = await getProjectAccess(session.user.id, projectId);
  if (!canManageProject(access)) {
    notFound();
  }

  return access;
}
