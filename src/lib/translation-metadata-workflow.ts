import {
  translationMetadataSchema,
  detectTranslationVariables,
  type TranslationMetadataInput,
} from "./translation-metadata";
import {
  assertTranslationContentMutationAllowed,
  TranslationWorkflowError,
  type TranslationWorkflowActor,
} from "./translation-workflow";
import { lockAndValidateProjectLanguageWrite } from "./project-runtime-configuration-lock";

export async function updateProjectTranslationMetadata({
  projectId,
  translationId,
  actor,
  metadata,
  expectedVersion,
}: {
  projectId: string;
  translationId: string;
  actor: TranslationWorkflowActor;
  metadata: TranslationMetadataInput;
  expectedVersion: number;
}) {
  const parsed = translationMetadataSchema.safeParse(metadata);
  if (
    !parsed.success ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0
  ) {
    throw new TranslationWorkflowError(
      "INVALID_PAYLOAD",
      "Invalid translation metadata.",
    );
  }
  const { db } = await import("./db");
  return db.$transaction(async (tx) => {
    const initial = await tx.translation.findFirst({
      where: { id: translationId, projectId },
      select: { langFrom: true, langTo: true },
    });
    if (!initial)
      throw new TranslationWorkflowError(
        "NOT_FOUND",
        "Translation segment not found.",
      );
    if (
      !(await lockAndValidateProjectLanguageWrite(tx, {
        projectId,
        sourceLanguages: [initial.langFrom],
        targetLanguages: [initial.langTo],
      }))
    ) {
      throw new TranslationWorkflowError(
        "INVALID_LANGUAGE",
        "The translation language pair is no longer active.",
      );
    }
    await tx.$queryRaw`SELECT "id" FROM "Translation" WHERE "id"=${translationId} AND "projectId"=${projectId} FOR UPDATE`;
    const current = await tx.translation.findFirst({
      where: { id: translationId, projectId },
      include: { metadata: true },
    });
    if (!current)
      throw new TranslationWorkflowError(
        "NOT_FOUND",
        "Translation segment not found.",
      );
    if (
      current.langFrom !== initial.langFrom ||
      current.langTo !== initial.langTo
    ) {
      throw new TranslationWorkflowError(
        "STALE_UPDATE",
        "The segment language changed. Reload before saving again.",
      );
    }
    assertTranslationContentMutationAllowed({
      actor,
      langTo: current.langTo,
      assignedToId: current.assignedToId,
      operation: "edit",
    });
    if ((current.metadata?.version ?? 0) !== expectedVersion) {
      throw new TranslationWorkflowError(
        "STALE_UPDATE",
        "Metadata changed. Reload before saving again.",
      );
    }
    const detected = new Set(detectTranslationVariables(current.originalText));
    if (parsed.data.variables.some((token) => !detected.has(token))) {
      throw new TranslationWorkflowError(
        "INVALID_PAYLOAD",
        "Variables must be supported placeholders present in the original text.",
      );
    }
    return tx.translationMetadata.upsert({
      where: { translationId },
      create: { translationId, ...parsed.data },
      update: { ...parsed.data, version: { increment: 1 } },
    });
  });
}
