import { Prisma } from "@prisma/client";
import { collectReportedTypes } from "./translation-reported-types";

/** Record only existing translations in the locked project's current language pair. */
export async function recordTranslationTypes(
  tx: Prisma.TransactionClient,
  input: {
    projectId: string;
    langFrom: string;
    langTo: string;
    hashes: string[];
    words: readonly { t?: unknown }[];
  },
) {
  const observations = collectReportedTypes(input.words, input.hashes);
  if (!observations.length) return;
  // Two array parameters keep large requests below PostgreSQL's bind limit.
  // A single upsert preserves concurrent observations without changing edit tokens.
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "TranslationTypeObservation" ("translationId", "wordType", "firstSeenAt", "lastSeenAt")
    SELECT t.id, o.kind, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM unnest(${observations.map((o) => o.hash)}::text[], ${observations.map((o) => o.wordType)}::integer[]) AS o(hash, kind)
    JOIN "Translation" t ON t."originalHash" = o.hash
    WHERE t."projectId" = ${input.projectId} AND t."langFrom" = ${input.langFrom} AND t."langTo" = ${input.langTo}
    ORDER BY t.id, o.kind
    ON CONFLICT ("translationId", "wordType") DO UPDATE
      SET "lastSeenAt" = GREATEST("TranslationTypeObservation"."lastSeenAt", EXCLUDED."lastSeenAt")
  `);
}
