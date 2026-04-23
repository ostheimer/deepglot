import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

export type TranslationBatchRecordInput = {
  organizationId: string;
  projectId: string;
  langFrom: string;
  langTo: string;
  requestUrl?: string | null;
  provider: string;
  totalWords: number;
  cachedWords: number;
  manualWords: number;
  glossaryWords: number;
  translatedWords: number;
};

export function getUsageMonthKey(date = new Date()) {
  return Number.parseInt(date.toISOString().slice(0, 7).replace("-", ""), 10);
}

export async function incrementUsageRecord({
  organizationId,
  projectId,
  words,
  month = getUsageMonthKey(),
  tx,
}: {
  organizationId: string;
  projectId: string;
  words: number;
  month?: number;
  tx?: Prisma.TransactionClient;
}) {
  if (words <= 0) {
    return null;
  }

  const client = tx ?? db;

  return client.usageRecord.upsert({
    where: {
      organizationId_projectId_month: {
        organizationId,
        projectId,
        month,
      },
    },
    create: {
      organizationId,
      projectId,
      month,
      words,
    },
    update: {
      words: {
        increment: words,
      },
    },
  });
}

export async function upsertTranslatedUrlHit({
  projectId,
  langTo,
  requestUrl,
  wordCount,
  tx,
}: {
  projectId: string;
  langTo: string;
  requestUrl?: string | null;
  wordCount: number;
  tx?: Prisma.TransactionClient;
}) {
  if (!requestUrl) {
    return null;
  }

  let path: string;
  try {
    path = new URL(requestUrl).pathname || "/";
  } catch {
    return null;
  }

  const client = tx ?? db;

  return client.translatedUrl.upsert({
    where: {
      projectId_urlPath_langTo: {
        projectId,
        urlPath: path,
        langTo,
      },
    },
    create: {
      projectId,
      urlPath: path,
      langTo,
      wordCount,
      requestCount: 1,
      lastSeenAt: new Date(),
    },
    update: {
      wordCount,
      requestCount: {
        increment: 1,
      },
      lastSeenAt: new Date(),
    },
  });
}

export async function recordTranslationBatch(
  input: TranslationBatchRecordInput,
  tx?: Prisma.TransactionClient
) {
  const client = tx ?? db;

  return client.translationBatchLog.create({
    data: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      langFrom: input.langFrom,
      langTo: input.langTo,
      requestUrl: input.requestUrl ?? null,
      provider: input.provider,
      totalWords: input.totalWords,
      cachedWords: input.cachedWords,
      manualWords: input.manualWords,
      glossaryWords: input.glossaryWords,
      translatedWords: input.translatedWords,
    },
  });
}
