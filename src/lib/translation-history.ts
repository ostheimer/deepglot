import { z } from "zod";
import {
  resolveTranslationWorkflowLanguage,
  TranslationWorkflowError,
  type TranslationWorkflowActor,
} from "./translation-workflow";

export const translationHistoryQuerySchema = z.object({
  cursor: z.string().min(1).max(128).optional(),
  pageSize: z.coerce.number().int().min(1).max(20).default(10),
}).strict();

// Stay below serverless response limits even for long multilingual revisions.
export function boundHistoryPage<T extends { id: string }>(rows: T[], pageSize: number) {
  const items: T[] = [];
  let bytes = 0;
  for (const row of rows.slice(0, pageSize)) {
    const size = Buffer.byteLength(JSON.stringify(row), "utf8");
    if (items.length && bytes + size > 3_000_000) break;
    items.push(row);
    bytes += size;
  }
  return { items, nextCursor: rows.length > items.length ? items.at(-1)!.id : null };
}

export async function listTranslationHistory({
  projectId, translationId, actor, cursor, pageSize = 10,
}: {
  projectId: string;
  translationId: string;
  actor: TranslationWorkflowActor;
  cursor?: string;
  pageSize?: number;
}) {
  const query = translationHistoryQuerySchema.parse({ cursor, pageSize });
  const { db } = await import("@/lib/db");
  return db.$transaction(async (tx) => {
    const translation = await tx.translation.findFirst({
      where: { id: translationId, projectId }, select: { langTo: true },
    });
    if (!translation) throw new TranslationWorkflowError("NOT_FOUND", "Translation segment not found.");
    resolveTranslationWorkflowLanguage(actor, translation.langTo);
    const boundary = query.cursor ? await tx.translationContentRevision.findFirst({
      where: { id: query.cursor, translationId }, select: { createdAt: true, id: true },
    }) : null;
    if (query.cursor && !boundary) throw new TranslationWorkflowError("INVALID_PAYLOAD", "Invalid history cursor.");
    const rows = await tx.translationContentRevision.findMany({
      where: {
        translationId,
        ...(boundary ? { OR: [
          { createdAt: { lt: boundary.createdAt } },
          { createdAt: boundary.createdAt, id: { lt: boundary.id } },
        ] } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.pageSize + 1,
      select: { id: true, beforeText: true, afterText: true, createdAt: true, actor: { select: { name: true } } },
    });
    return boundHistoryPage(rows, query.pageSize);
  }, { isolationLevel: "RepeatableRead" });
}
