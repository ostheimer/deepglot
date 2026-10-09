import { notFound } from "next/navigation";

import { ProjectWebhooksManager } from "@/components/projekte/project-webhooks-manager";
import { db } from "@/lib/db";
import { canManageProjectForWrite, getAuthenticatedUserId } from "@/lib/project-access";
import { requireProjectManagement } from "@/lib/project-page-access";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function WebhooksPage({ params }: PageProps) {
  const { projektId } = await params;
  await requireProjectManagement(projektId);
  const userId = await getAuthenticatedUserId();

  // Webhook signing secrets are displayed here. Fetch them while the same
  // current-workspace lock protects the authorization decision from transfer.
  const project = await db.$transaction(async (tx) => {
    if (!userId || !(await canManageProjectForWrite(tx, userId, projektId))) return null;
    return tx.project.findUnique({
        where: { id: projektId },
        include: {
          webhookEndpoints: {
            include: {
              deliveries: {
                orderBy: { createdAt: "desc" },
                take: 10,
              },
            },
            orderBy: { createdAt: "desc" },
          },
        },
      });
  });
  if (!project) notFound();

  const [latestProcessorRun, statusCounts, pendingDueCount] =
    await Promise.all([
      db.webhookProcessorRun.findFirst({
        orderBy: { createdAt: "desc" },
      }),
      db.webhookDelivery.groupBy({
        by: ["status"],
        where: { projectId: projektId },
        _count: { _all: true },
      }),
      db.webhookDelivery.count({
        where: {
          projectId: projektId,
          status: "PENDING",
          nextAttemptAt: { lte: new Date() },
        },
      }),
    ]);

  const deliveryCounts = { PENDING: 0, SUCCESS: 0, FAILED: 0 };
  for (const item of statusCounts) {
    deliveryCounts[item.status] = item._count._all;
  }

  return (
    <ProjectWebhooksManager
      projectId={project.id}
      endpoints={project.webhookEndpoints}
      health={{
        latestProcessorRun,
        deliveryCounts,
        pendingDueCount,
      }}
    />
  );
}
