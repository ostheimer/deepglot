import { notFound } from "next/navigation";

import { ProjectWebhooksManager } from "@/components/projekte/project-webhooks-manager";
import { db } from "@/lib/db";
import { requireProjectManagement } from "@/lib/project-page-access";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function WebhooksPage({ params }: PageProps) {
  const { projektId } = await params;
  await requireProjectManagement(projektId);

  const [project, latestProcessorRun, statusCounts, pendingDueCount] =
    await Promise.all([
      db.project.findUnique({
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
      }),
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

  if (!project) {
    notFound();
  }

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
