import { notFound } from "next/navigation";

import { ProjectWebhooksManager } from "@/components/projekte/project-webhooks-manager";
import { db } from "@/lib/db";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function WebhooksPage({ params }: PageProps) {
  const { projektId } = await params;

  const project = await db.project.findUnique({
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

  if (!project) {
    notFound();
  }

  return (
    <ProjectWebhooksManager
      projectId={project.id}
      endpoints={project.webhookEndpoints}
    />
  );
}
