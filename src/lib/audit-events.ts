import type { Prisma, PrismaClient } from "@prisma/client";

export const AUDIT_CATEGORIES = [
  "project", "member", "translation", "glossary", "exclusion",
  "api_key", "webhook", "billing", "workspace",
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

// No arbitrary request payload is accepted here. IDs, counts and fixed enum
// labels are sufficient for the activity view and cannot expose translated
// content, webhook URLs, API keys, token hashes, or billing addresses.
export type AuditMetadata = Record<string, string | number | boolean | null>;
type AuditClient = Pick<PrismaClient, "auditEvent" | "project"> | Prisma.TransactionClient;

export async function appendProjectAuditEvent(
  client: AuditClient,
  input: {
    projectId: string;
    actorUserId: string | null;
    action: string;
    category: AuditCategory;
    metadata?: AuditMetadata;
  },
) {
  const project = await client.project.findUnique({
    where: { id: input.projectId },
    select: { organizationId: true },
  });
  if (!project) throw new Error("Audit project does not exist");
  return client.auditEvent.create({
    data: {
      organizationId: project.organizationId,
      projectId: input.projectId,
      projectIdSnapshot: input.projectId,
      actorUserId: input.actorUserId,
      action: input.action,
      category: input.category,
      metadata: sanitizeAuditMetadata(input.metadata),
    },
  });
}

export function sanitizeAuditMetadata(metadata: AuditMetadata = {}): Prisma.InputJsonObject {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!/^(count|language|role|status|kind|source|targetId|affectedId)$/.test(key)) {
      throw new Error("Unsupported audit metadata key");
    }
    if (typeof value === "string" && (value.length > 80 || !/^[a-zA-Z0-9_:-]*$/.test(value))) {
      throw new Error("Unsupported audit metadata value");
    }
    if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000)) {
      throw new Error("Unsupported audit metadata count");
    }
    result[key] = value;
  }
  if (JSON.stringify(result).length > 512) throw new Error("Audit metadata exceeds limit");
  return result;
}

export async function appendWorkspaceAuditEvent(
  client: Pick<PrismaClient, "auditEvent"> | Prisma.TransactionClient,
  input: {
    organizationId: string;
    actorUserId: string | null;
    action: string;
    category: AuditCategory;
    metadata?: AuditMetadata;
  },
) {
  return client.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: input.action,
      category: input.category,
      metadata: sanitizeAuditMetadata(input.metadata),
    },
  });
}
