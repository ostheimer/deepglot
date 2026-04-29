import bcrypt from "bcryptjs";

import { db } from "@/lib/db";
import { computeTranslationHash } from "@/lib/translation-hash";
import {
  getTestLoginConfig,
  isTestLoginEnabled,
  type TestLoginConfig,
} from "@/lib/test-login-config";

async function ensureTestProjectSeed(
  projectId: string,
  organizationId: string
): Promise<void> {
  await db.projectLanguage.createMany({
    data: [
      { projectId, langCode: "en", isActive: true },
      { projectId, langCode: "fr", isActive: true },
    ],
    skipDuplicates: true,
  });

  await db.projectSettings.upsert({
    where: { projectId },
    create: {
      projectId,
      automaticTranslation: true,
      displayAiNotice: true,
      pageViewsEnabled: true,
      translationMemory: true,
    },
    update: {
      pageViewsEnabled: true,
    },
  });

  await db.projectMember.upsert({
    where: {
      projectId_email: {
        projectId,
        email: "translator@deepglot.local",
      },
    },
    create: {
      projectId,
      email: "translator@deepglot.local",
      role: "TRANSLATOR",
      langCode: "en",
    },
    update: {
      role: "TRANSLATOR",
      langCode: "en",
    },
  });

  await db.glossaryRule.upsert({
    where: {
      projectId_originalTerm_langFrom_langTo: {
        projectId,
        originalTerm: "Deepglot",
        langFrom: "de",
        langTo: "en",
      },
    },
    create: {
      projectId,
      originalTerm: "Deepglot",
      translatedTerm: "Deepglot",
      langFrom: "de",
      langTo: "en",
      caseSensitive: true,
    },
    update: {
      translatedTerm: "Deepglot",
      caseSensitive: true,
    },
  });

  await db.translationExclusion.upsert({
    where: {
      projectId_type_value: {
        projectId,
        type: "URL",
        value: "/wp-admin",
      },
    },
    create: { projectId, type: "URL", value: "/wp-admin" },
    update: {},
  });

  await db.urlSlug.upsert({
    where: {
      projectId_originalSlug_langTo: {
        projectId,
        originalSlug: "preise",
        langTo: "en",
      },
    },
    create: {
      projectId,
      originalSlug: "preise",
      translatedSlug: "pricing",
      langTo: "en",
      urlCount: 1,
    },
    update: {
      translatedSlug: "pricing",
      urlCount: 1,
    },
  });

  const now = new Date();

  for (const item of [
    {
      urlPath: "/preise",
      langTo: "en",
      wordCount: 280,
      requestCount: 18,
    },
    {
      urlPath: "/kontakt",
      langTo: "en",
      wordCount: 160,
      requestCount: 11,
    },
    {
      urlPath: "/leistungen",
      langTo: "fr",
      wordCount: 220,
      requestCount: 7,
    },
  ]) {
    await db.translatedUrl.upsert({
      where: {
        projectId_urlPath_langTo: {
          projectId,
          urlPath: item.urlPath,
          langTo: item.langTo,
        },
      },
      create: {
        projectId,
        urlPath: item.urlPath,
        langTo: item.langTo,
        wordCount: item.wordCount,
        requestCount: item.requestCount,
        lastSeenAt: now,
      },
      update: {
        wordCount: item.wordCount,
        requestCount: item.requestCount,
        lastSeenAt: now,
      },
    });
  }

  for (const item of [
    {
      originalText: "Willkommen bei Deepglot",
      translatedText: "Welcome to Deepglot",
      langFrom: "de",
      langTo: "en",
      wordCount: 3,
      isManual: false,
    },
    {
      originalText: "Preise und Plaene",
      translatedText: "Pricing and plans",
      langFrom: "de",
      langTo: "en",
      wordCount: 3,
      isManual: false,
    },
    {
      originalText: "Kontakt aufnehmen",
      translatedText: "Get in touch",
      langFrom: "de",
      langTo: "en",
      wordCount: 2,
      isManual: true,
    },
  ]) {
    await db.translation.upsert({
      where: {
        projectId_originalHash: {
          projectId,
          originalHash: computeTranslationHash(
            item.originalText,
            item.langFrom,
            item.langTo
          ),
        },
      },
      create: {
        projectId,
        originalHash: computeTranslationHash(
          item.originalText,
          item.langFrom,
          item.langTo
        ),
        originalText: item.originalText,
        translatedText: item.translatedText,
        langFrom: item.langFrom,
        langTo: item.langTo,
        wordCount: item.wordCount,
        isManual: item.isManual,
        source: "OPENAI",
      },
      update: {
        translatedText: item.translatedText,
        wordCount: item.wordCount,
        isManual: item.isManual,
        source: "OPENAI",
      },
    });
  }

  await db.translationBatchLog.deleteMany({
    where: {
      projectId,
      requestUrl: {
        startsWith: "https://e2e.deepglot.local/",
      },
    },
  });

  await db.translationBatchLog.createMany({
    data: [
      {
        organizationId,
        projectId,
        langFrom: "de",
        langTo: "en",
        requestUrl: "https://e2e.deepglot.local/preise",
        provider: "openai",
        totalWords: 120,
        cachedWords: 10,
        manualWords: 0,
        glossaryWords: 20,
        translatedWords: 90,
        createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
      },
      {
        organizationId,
        projectId,
        langFrom: "de",
        langTo: "en",
        requestUrl: "https://e2e.deepglot.local/kontakt",
        provider: "manual",
        totalWords: 8,
        cachedWords: 0,
        manualWords: 8,
        glossaryWords: 0,
        translatedWords: 0,
        createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      },
      {
        organizationId,
        projectId,
        langFrom: "de",
        langTo: "fr",
        requestUrl: "https://e2e.deepglot.local/import",
        provider: "import",
        totalWords: 12,
        cachedWords: 0,
        manualWords: 12,
        glossaryWords: 0,
        translatedWords: 0,
        createdAt: now,
      },
    ],
  });

  const currentMonth = parseInt(
    new Date().toISOString().slice(0, 7).replace("-", "")
  );
  await db.usageRecord.upsert({
    where: {
      organizationId_projectId_month: {
        organizationId,
        projectId,
        month: currentMonth,
      },
    },
    create: { organizationId, projectId, month: currentMonth, words: 420 },
    update: {},
  });
}

async function ensureTestProject(
  organizationId: string,
  config: TestLoginConfig
): Promise<void> {
  let project = await db.project.findFirst({
    where: {
      organizationId,
      domain: config.projectDomain,
    },
  });

  if (!project) {
    project = await db.project.create({
      data: {
        organizationId,
        name: config.projectName,
        domain: config.projectDomain,
        originalLang: "de",
      },
    });
  }

  await ensureTestProjectSeed(project.id, organizationId);
}

export async function ensureTestLoginUser() {
  if (!isTestLoginEnabled()) {
    throw new Error("Test login is disabled.");
  }

  const config = getTestLoginConfig();
  const hashedPassword = await bcrypt.hash(config.password, 12);
  const existingUser = await db.user.findUnique({
    where: { email: config.email },
  });

  const user = existingUser
    ? await db.user.update({
        where: { id: existingUser.id },
        data: {
          name: config.name,
          password: hashedPassword,
        },
      })
    : await db.user.create({
        data: {
          email: config.email,
          name: config.name,
          password: hashedPassword,
        },
      });

  const organization = await db.organization.upsert({
    where: { slug: config.organizationSlug },
    create: {
      name: config.organizationName,
      slug: config.organizationSlug,
      plan: "FREE",
    },
    update: {
      name: config.organizationName,
    },
  });

  await db.organizationMember.upsert({
    where: {
      userId_organizationId: {
        userId: user.id,
        organizationId: organization.id,
      },
    },
    create: {
      userId: user.id,
      organizationId: organization.id,
      role: "OWNER",
    },
    update: {
      role: "OWNER",
    },
  });

  await db.subscription.upsert({
    where: { organizationId: organization.id },
    create: {
      organizationId: organization.id,
      stripeCustomerId: `free_${organization.id}`,
      status: "ACTIVE",
      plan: "FREE",
      wordsLimit: 10_000,
    },
    update: {
      status: "ACTIVE",
      plan: "FREE",
      wordsLimit: 10_000,
    },
  });

  await ensureTestProject(organization.id, config);

  return user;
}
