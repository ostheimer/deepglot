import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { addProjectTargetLanguages } from "@/lib/project-language-mutations";

test("retrying duplicate target languages records only real additions", async () => {
  const languages = new Map<string, boolean>();
  const events: Array<{ action: string; metadata: { count: number } }> = [];
  let updatedAt = new Date("2026-10-09T00:00:00.000Z");
  const tx = {
    $queryRaw: async () => [{ organizationId: "workspace-a" }],
    organizationMember: { findUnique: async () => ({ role: "OWNER" }) },
    projectMember: { findFirst: async () => null },
    project: {
      findUnique: async () => ({ organizationId: "workspace-a", originalLang: "en", updatedAt }),
      updateMany: async ({ data }: { data: { updatedAt: Date } }) => { updatedAt = data.updatedAt; return { count: 1 }; },
    },
    projectLanguage: {
      findMany: async ({ where }: { where: { langCode?: { in: string[] }; isActive?: boolean } }) =>
        [...languages].filter(([langCode, isActive]) =>
          (!where.langCode || where.langCode.in.includes(langCode)) &&
          (where.isActive === undefined || where.isActive === isActive))
          .map(([langCode, isActive]) => ({ langCode, isActive })),
      updateMany: async ({ where, data }: { where: { langCode: { in: string[] } }; data: { isActive: boolean } }) => {
        let count = 0;
        for (const langCode of where.langCode.in) if (languages.has(langCode)) {
          languages.set(langCode, data.isActive); count++;
        }
        return { count };
      },
      createMany: async ({ data }: { data: Array<{ langCode: string; isActive: boolean }> }) => {
        let count = 0;
        for (const row of data) if (!languages.has(row.langCode)) {
          languages.set(row.langCode, row.isActive); count++;
        }
        return { count };
      },
    },
    projectMediaReplacement: { findMany: async () => [] },
    auditEvent: { create: async ({ data }: { data: { action: string; metadata: { count: number } } }) => {
      events.push(data); return data;
    } },
  };
  const database = { $transaction: async (mutation: (client: typeof tx) => Promise<unknown>) => mutation(tx) } as unknown as PrismaClient;

  assert.deepEqual(await addProjectTargetLanguages(database, {
    projectId: "project-a", languages: ["fr", "fr"], actorUserId: "owner",
  }), { kind: "updated" });
  assert.deepEqual(await addProjectTargetLanguages(database, {
    projectId: "project-a", languages: ["fr"], actorUserId: "owner",
  }), { kind: "updated" });
  assert.equal(languages.size, 1);
  assert.deepEqual(events.map(({ action, metadata }) => ({ action, count: metadata.count })), [
    { action: "project.languages_added", count: 1 },
  ]);
});
