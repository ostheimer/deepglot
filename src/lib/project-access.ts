import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function getAuthenticatedUserId() {
  const session = await auth();

  return session?.user?.id ?? null;
}

export async function userHasProjectAccess(userId: string, projectId: string) {
  const membership = await db.project.findFirst({
    where: {
      id: projectId,
      organization: {
        members: {
          some: { userId },
        },
      },
    },
    select: { id: true },
  });

  return Boolean(membership);
}
