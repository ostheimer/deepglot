import { Prisma } from "@prisma/client";
import type { TranslationWorkflowFilters } from "./translation-workflow";
import { normalizeTranslationLabel } from "./translation-metadata";
import { TRANSLATION_TOKEN_PATTERN } from "./translation-quality";

/** One parameterized predicate for both count and page selection. Alias: t. */
export function workspaceSqlWhere(
  projectId: string,
  langTo: string | undefined,
  filters: TranslationWorkflowFilters,
  cutoff: Date,
) {
  const clauses: Prisma.Sql[] = [Prisma.sql`t."projectId" = ${projectId}`];
  if (langTo) clauses.push(Prisma.sql`t."langTo" = ${langTo}`);
  if (filters.source)
    clauses.push(Prisma.sql`t.source::text = ${filters.source}`);
  if (filters.mode)
    clauses.push(Prisma.sql`t."isManual" = ${filters.mode === "manual"}`);
  if (filters.status)
    clauses.push(Prisma.sql`t."workflowStatus"::text = ${filters.status}`);
  if (filters.assignedToId !== undefined)
    clauses.push(
      filters.assignedToId === null
        ? Prisma.sql`t."assignedToId" IS NULL`
        : Prisma.sql`t."assignedToId" = ${filters.assignedToId}`,
    );
  if (filters.query?.trim()) {
    // Match literal text, including SQL LIKE metacharacters.
    const query = `%${filters.query.trim().replace(/[\\%_]/g, "\\$&")}%`;
    clauses.push(
      Prisma.sql`(t."originalText" ILIKE ${query} OR t."translatedText" ILIKE ${query})`,
    );
  }
  if (filters.label)
    clauses.push(Prisma.sql`EXISTS (
    SELECT 1 FROM "TranslationMetadata" m WHERE m."translationId" = t.id
    AND m.labels @> ARRAY[${normalizeTranslationLabel(filters.label)}]::text[]
  )`);
  const hasVariables = Prisma.sql`EXISTS (
    SELECT 1 FROM "TranslationMetadata" m WHERE m."translationId" = t.id
    AND cardinality(m.variables) > 0
  )`;
  if (filters.variables)
    clauses.push(
      filters.variables === "saved"
        ? hasVariables
        : Prisma.sql`NOT (${hasVariables})`,
    );
  if (filters.context) {
    const known = Prisma.sql`EXISTS (SELECT 1 FROM "TranslationContext" c WHERE c."translationId" = t.id)`;
    clauses.push(
      filters.context === "known" ? known : Prisma.sql`NOT (${known})`,
    );
  }
  if (filters.urlPath)
    clauses.push(Prisma.sql`EXISTS (
    SELECT 1 FROM "TranslationContext" c WHERE c."translationId" = t.id AND c."urlPath" = ${filters.urlPath}
  )`);
  if (filters.activity) {
    const known = Prisma.sql`EXISTS (SELECT 1 FROM "TranslationContext" c WHERE c."translationId" = t.id)`;
    const recent = Prisma.sql`EXISTS (SELECT 1 FROM "TranslationContext" c
      WHERE c."translationId" = t.id AND c."lastSeenAt" >= ${cutoff})`;
    clauses.push(
      filters.activity === "recent"
        ? recent
        : filters.activity === "older"
          ? Prisma.sql`(${known} AND NOT (${recent}))`
          : Prisma.sql`NOT (${known})`,
    );
  }
  if (filters.quality === "unchecked")
    clauses.push(Prisma.sql`NOT (${hasVariables})`);
  else if (filters.quality) {
    // Tokenize in PostgreSQL before pagination; do not load the project into JS.
    // The same expression is tested against translationTokenCounts with real PG.
    const mismatch = Prisma.sql`EXISTS (
      SELECT 1 FROM "TranslationMetadata" m, unnest(m.variables) AS v(token)
      WHERE m."translationId" = t.id AND (
        NOT EXISTS (SELECT 1 FROM regexp_matches(t."originalText", ${TRANSLATION_TOKEN_PATTERN}, 'g') AS s(parts) WHERE s.parts[1] = v.token AND v.token <> '%%')
        OR (SELECT count(*) FROM regexp_matches(t."originalText", ${TRANSLATION_TOKEN_PATTERN}, 'g') AS s(parts) WHERE s.parts[1] = v.token)
        <> (SELECT count(*) FROM regexp_matches(t."translatedText", ${TRANSLATION_TOKEN_PATTERN}, 'g') AS s(parts) WHERE s.parts[1] = v.token)
      )
    )`;
    clauses.push(
      hasVariables,
      filters.quality === "mismatch" ? mismatch : Prisma.sql`NOT (${mismatch})`,
    );
  }
  return Prisma.join(clauses, " AND ");
}

export function workspaceSqlOrder(sort: TranslationWorkflowFilters["sort"]) {
  switch (sort) {
    case "created_asc":
      return Prisma.sql`t."createdAt" ASC, t.id ASC`;
    case "created_desc":
      return Prisma.sql`t."createdAt" DESC, t.id ASC`;
    case "original_asc":
      return Prisma.sql`t."originalText" ASC, t.id ASC`;
    default:
      return Prisma.sql`t."updatedAt" DESC, t.id ASC`;
  }
}
