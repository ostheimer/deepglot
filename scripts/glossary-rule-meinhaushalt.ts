#!/usr/bin/env -S node --import tsx
/**
 * One-shot helper that ensures glossary rules exist for the meinhaushalt.at
 * brand name on the production project, so `Mein Haushalt` and the lower-case
 * domain reference stay untranslated when the WordPress plugin sends batches
 * to /api/translate.
 *
 * Writes through Prisma against the production Neon branch using the
 * connection string in `.env.production.local`. The script is idempotent:
 * each rule is keyed by (projectId, originalTerm, langFrom, langTo).
 * Existing rules with matching translatedTerm and caseSensitive are kept,
 * mismatched rows are updated to the desired values so a stale brand
 * mapping (e.g. an earlier manual edit) is reconciled instead of silently
 * leaving the misconfiguration in place.
 *
 * Usage:
 *   node --import tsx scripts/glossary-rule-meinhaushalt.ts
 */

import { existsSync, readFileSync } from "node:fs";
import dotenv from "dotenv";

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

async function main() {
  const { db } = await import("@/lib/db");

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });

  if (!project) {
    throw new Error(`Project ${projectId} not found in production DB`);
  }

  console.log(`[glossary] target project ${project.id} (${project.name})`);

  // Brand-name variants on meinhaushalt.at: the canonical brand uses a space
  // ("Mein Haushalt"), while logo and domain references appear as
  // "Meinhaushalt" / "MeinHaushalt" (and lowercase "meinhaushalt.at").
  // Each rule maps the term to itself so it survives translation untouched.
  const rules = [
    { originalTerm: "Mein Haushalt", translatedTerm: "Mein Haushalt", caseSensitive: true },
    { originalTerm: "Meinhaushalt", translatedTerm: "Meinhaushalt", caseSensitive: true },
    { originalTerm: "MeinHaushalt", translatedTerm: "MeinHaushalt", caseSensitive: true },
    { originalTerm: "meinhaushalt.at", translatedTerm: "meinhaushalt.at", caseSensitive: false },
  ];

  for (const rule of rules) {
    const existing = await db.glossaryRule.findUnique({
      where: {
        projectId_originalTerm_langFrom_langTo: {
          projectId: project.id,
          originalTerm: rule.originalTerm,
          langFrom: "de",
          langTo: "en",
        },
      },
    });

    if (existing) {
      const translatedDiffers = existing.translatedTerm !== rule.translatedTerm;
      const caseSensitivityDiffers =
        existing.caseSensitive !== rule.caseSensitive;

      if (!translatedDiffers && !caseSensitivityDiffers) {
        console.log(
          `[glossary] kept "${rule.originalTerm}" → "${existing.translatedTerm}" (id=${existing.id})`
        );
        continue;
      }

      const updated = await db.glossaryRule.update({
        where: { id: existing.id },
        data: {
          translatedTerm: rule.translatedTerm,
          caseSensitive: rule.caseSensitive,
        },
      });

      console.log(
        `[glossary] updated "${rule.originalTerm}" (id=${existing.id}): "${existing.translatedTerm}" -> "${updated.translatedTerm}", caseSensitive ${String(existing.caseSensitive)} -> ${String(updated.caseSensitive)}`
      );
      continue;
    }

    const created = await db.glossaryRule.create({
      data: {
        projectId: project.id,
        originalTerm: rule.originalTerm,
        translatedTerm: rule.translatedTerm,
        langFrom: "de",
        langTo: "en",
        caseSensitive: rule.caseSensitive,
      },
    });

    console.log(
      `[glossary] created "${rule.originalTerm}" → "${rule.translatedTerm}" (id=${created.id})`
    );
  }

  await db.$disconnect();
  console.log("[glossary] done");
}

main().catch(async (error) => {
  console.error(
    `[glossary] failed: ${error instanceof Error ? error.message : error}`
  );
  process.exit(1);
});
