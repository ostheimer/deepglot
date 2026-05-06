#!/usr/bin/env -S node --import tsx
/**
 * After ensuring the meinhaushalt brand-name glossary rules exist, this
 * helper invalidates any pre-existing cached translations for those terms
 * so the next /api/translate request re-runs them under glossary protection
 * instead of returning the previously cached "My Household" output.
 *
 * Two complementary moves:
 *   1. Bumps `updatedAt` on each brand-name glossary rule, which the
 *      /api/translate route uses to invalidate older cache rows.
 *   2. Deletes Translation cache rows on the project that contain any of
 *      the brand-name variants in the source text. Safer than relying on
 *      timestamp comparison because some legacy rows may share an updatedAt.
 *
 * Idempotent: re-runs only touch matching rows.
 */

import { existsSync, readFileSync } from "node:fs";
import dotenv from "dotenv";
import type { Prisma } from "@prisma/client";

const envFiles = [".env.production.local", ".env.local"];

for (const file of envFiles) {
  if (existsSync(file)) {
    const values = dotenv.parse(readFileSync(file));
    for (const [key, value] of Object.entries(values)) {
      if (process.env[key] === undefined && value.trim() !== "") {
        process.env[key] = value;
      }
    }
  }
}

if (process.env.DEEPGLOT_DATABASE_URL && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DEEPGLOT_DATABASE_URL;
}

const projectId =
  process.env.MEINHAUSHALT_PROD_DEEPGLOT_PROJECT_ID?.trim() ||
  process.env.DEEPGLOT_PHASE6_PROJECT_ID?.trim();

if (!projectId) {
  console.error("MEINHAUSHALT_PROD_DEEPGLOT_PROJECT_ID must be set.");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error(
    "DEEPGLOT_DATABASE_URL or DATABASE_URL must point at the production Neon branch."
  );
  process.exit(1);
}

const TERMS = ["Mein Haushalt", "Meinhaushalt", "MeinHaushalt", "meinhaushalt.at"];

async function main() {
  const { db } = await import("@/lib/db");

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });

  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }

  console.log(`[bust] target project ${project.id} (${project.name})`);

  // 1. Touch glossary rule updatedAt so /api/translate cache lookup invalidates.
  const touched = await db.glossaryRule.updateMany({
    where: {
      projectId: project.id,
      langFrom: "de",
      langTo: "en",
      originalTerm: { in: TERMS },
    },
    data: { updatedAt: new Date() },
  });
  console.log(`[bust] touched ${touched.count} glossary rules`);

  // 2. Delete cached Translation rows that contain any of the brand variants
  // in their source text. Manual translations are preserved.
  const where: Prisma.TranslationWhereInput = {
    projectId: project.id,
    isManual: false,
    OR: TERMS.map((term) => ({
      originalText: { contains: term, mode: "insensitive" as const },
    })),
  };

  const sample = await db.translation.findMany({
    where,
    select: { id: true, originalText: true, translatedText: true },
    take: 10,
  });

  console.log(`[bust] sample of cached entries to delete (max 10):`);
  for (const row of sample) {
    console.log(
      `  - ${row.id}: "${row.originalText.slice(0, 60).replace(/\s+/g, " ")}" -> "${row.translatedText.slice(0, 60).replace(/\s+/g, " ")}"`
    );
  }

  const deleted = await db.translation.deleteMany({ where });
  console.log(`[bust] deleted ${deleted.count} cached translation rows`);

  await db.$disconnect();
  console.log("[bust] done");
}

main().catch(async (error) => {
  console.error(`[bust] failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
