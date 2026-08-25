import assert from "node:assert/strict";
import { after, mock, test } from "node:test";
import { NextRequest } from "next/server";

import { resolveDatabaseUrl } from "@/lib/database-url";
import { generateApiKey } from "@/lib/api-keys";
import {
  getProjectGeneralSettings,
  updateProjectGeneralSettings,
} from "@/lib/project-general-settings";
import {
  addProjectTargetLanguages,
  deleteProjectTargetLanguage,
} from "@/lib/project-language-mutations";
import {
  lockAndValidateProjectLanguageWrite,
  lockProjectRuntimeConfiguration,
} from "@/lib/project-runtime-configuration-lock";
import {
  hashRateLimitSubject,
  TRANSLATE_WORD_VELOCITY_SCOPE,
} from "@/lib/rate-limit";

const databaseUrl = resolveDatabaseUrl();
const skipWithoutDatabase = databaseUrl
  ? false
  : "requires a prepared PostgreSQL database via DATABASE_URL or DEEPGLOT_DATABASE_URL";
const organizationIds: string[] = [];
const userIds: string[] = [];

test(
  "project settings persist atomically and only one concurrent revision wins",
  { skip: skipWithoutDatabase },
  async () => {
    const { db } = await import("@/lib/db");
    const suffix = crypto.randomUUID();
    const organization = await db.organization.create({
      data: { name: `Settings ${suffix}`, slug: `settings-${suffix}` },
    });
    organizationIds.push(organization.id);
    const project = await db.project.create({
      data: {
        organizationId: organization.id,
        name: "Initial",
        domain: `${suffix}.example.test`,
        originalLang: "de",
        languages: { create: [{ langCode: "en" }, { langCode: "fr" }] },
      },
    });

    const expectedVersion = project.updatedAt.toISOString();
    const [first, second] = await Promise.all([
      updateProjectGeneralSettings(db, {
        projectId: project.id,
        expectedVersion,
        patch: {
          name: "First writer",
          autoSwitch: true,
          websiteType: "Blog",
        },
      }),
      updateProjectGeneralSettings(db, {
        projectId: project.id,
        expectedVersion,
        patch: {
          name: "Second writer",
          automaticTranslation: false,
          industryType: "Education",
        },
      }),
    ]);

    assert.deepEqual(
      [first.kind, second.kind].sort(),
      ["conflict", "updated"],
    );
    const stored = await db.project.findUniqueOrThrow({
      where: { id: project.id },
      include: { settings: true },
    });
    const winner =
      first.kind === "updated"
        ? first.project
        : second.kind === "updated"
          ? second.project
          : assert.fail("Expected exactly one successful settings update.");
    assert.equal(stored.name, winner.name);
    assert.equal(stored.settings?.autoSwitch, winner.autoRedirect);
    assert.equal(
      stored.settings?.automaticTranslation,
      winner.automaticTranslation,
    );
    assert.equal(stored.settings?.websiteType, winner.websiteType);
    assert.equal(stored.settings?.industryType, winner.industryType);
  },
);

test(
  "plugin runtime-config reads back the complete updated project settings snapshot",
  { skip: skipWithoutDatabase },
  async () => {
    const { db } = await import("@/lib/db");
    const { GET } = await import("@/app/api/plugin/runtime-config/route");
    const suffix = crypto.randomUUID();
    const organization = await db.organization.create({
      data: { name: `Readback ${suffix}`, slug: `readback-${suffix}` },
    });
    organizationIds.push(organization.id);
    const project = await db.project.create({
      data: {
        organizationId: organization.id,
        name: "Before readback",
        domain: `${suffix}.example.test`,
        originalLang: "de",
        languages: { create: [{ langCode: "en" }] },
        settings: { create: {} },
      },
    });
    const { rawKey } = await generateApiKey({
      projectId: project.id,
      name: "Runtime readback",
    });

    const updated = await updateProjectGeneralSettings(db, {
      projectId: project.id,
      expectedVersion: project.updatedAt.toISOString(),
      patch: {
        name: "After readback",
        domain: `www.${suffix}.example.test:8443`,
        autoSwitch: true,
        displayAiNotice: true,
        automaticTranslation: false,
        websiteType: "Blog",
        industryType: "Software & technology",
      },
    });
    assert.equal(updated.kind, "updated");
    if (updated.kind !== "updated") return;

    const response = await GET(
      new NextRequest("https://deepglot.test/api/plugin/runtime-config", {
        headers: { authorization: `Bearer ${rawKey}` },
      }),
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.project, {
      version: updated.project.version,
      name: "After readback",
      domain: `www.${suffix}.example.test:8443`,
      sourceLanguage: "de",
      targetLanguages: ["en"],
      autoRedirect: true,
      displayAiNotice: true,
      automaticTranslation: false,
      websiteType: "Blog",
      industryType: "Software & technology",
    });
  },
);

test(
  "source-language migration swaps target languages before content and is mutation-free once locked",
  { skip: skipWithoutDatabase },
  async () => {
    const { db } = await import("@/lib/db");
    const suffix = crypto.randomUUID();
    const organization = await db.organization.create({
      data: { name: `Language ${suffix}`, slug: `language-${suffix}` },
    });
    organizationIds.push(organization.id);
    const project = await db.project.create({
      data: {
        organizationId: organization.id,
        name: "Language project",
        domain: `${suffix}.example.test`,
        originalLang: "de",
        languages: { create: [{ langCode: "en" }, { langCode: "fr" }] },
        domainMappings: {
          create: { langCode: "en", host: `en.${suffix}.example.test` },
        },
      },
    });

    const migrated = await updateProjectGeneralSettings(db, {
      projectId: project.id,
      expectedVersion: project.updatedAt.toISOString(),
      patch: { originalLang: "en" },
    });
    assert.equal(migrated.kind, "updated");
    const languages = await db.projectLanguage.findMany({
      where: { projectId: project.id },
      orderBy: { langCode: "asc" },
    });
    assert.deepEqual(
      languages.map(({ langCode, isActive }) => ({ langCode, isActive })),
      [
        { langCode: "de", isActive: true },
        { langCode: "en", isActive: false },
        { langCode: "fr", isActive: true },
      ],
    );
    assert.equal(
      await db.projectDomainMapping.count({ where: { projectId: project.id } }),
      0,
    );

    await db.translation.create({
      data: {
        projectId: project.id,
        originalHash: `hash-${suffix}`,
        originalText: "Existing content",
        translatedText: "Bestehender Inhalt",
        langFrom: "en",
        langTo: "de",
        source: "MANUAL",
      },
    });
    const beforeLockedWrite = await db.project.findUniqueOrThrow({
      where: { id: project.id },
    });
    const locked = await updateProjectGeneralSettings(db, {
      projectId: project.id,
      expectedVersion: beforeLockedWrite.updatedAt.toISOString(),
      patch: { originalLang: "fr", name: "Must not leak" },
    });
    assert.equal(locked.kind, "source_language_locked");
    const afterLockedWrite = await db.project.findUniqueOrThrow({
      where: { id: project.id },
    });
    assert.equal(afterLockedWrite.originalLang, "en");
    assert.equal(afterLockedWrite.name, "Language project");
    assert.equal(
      afterLockedWrite.updatedAt.toISOString(),
      beforeLockedWrite.updatedAt.toISOString(),
    );
  },
);

test(
  "source-language migration rejects a non-target instead of increasing the active target count",
  { skip: skipWithoutDatabase },
  async () => {
    const { db } = await import("@/lib/db");
    const suffix = crypto.randomUUID();
    const organization = await db.organization.create({
      data: {
        name: `Language cap ${suffix}`,
        slug: `language-cap-${suffix}`,
      },
    });
    organizationIds.push(organization.id);
    const project = await db.project.create({
      data: {
        organizationId: organization.id,
        name: "Language cap",
        domain: `${suffix}.example.test`,
        originalLang: "de",
        languages: { create: [{ langCode: "en" }] },
      },
    });

    const result = await updateProjectGeneralSettings(db, {
      projectId: project.id,
      expectedVersion: project.updatedAt.toISOString(),
      patch: { originalLang: "fr" },
    });
    assert.equal(result.kind, "source_language_not_active_target");

    const [readBack, activeTargets] = await Promise.all([
      db.project.findUniqueOrThrow({ where: { id: project.id } }),
      db.projectLanguage.findMany({
        where: { projectId: project.id, isActive: true },
        select: { langCode: true },
      }),
    ]);
    assert.equal(readBack.originalLang, "de");
    assert.deepEqual(activeTargets.map(({ langCode }) => langCode), ["en"]);
    assert.equal(readBack.updatedAt.toISOString(), project.updatedAt.toISOString());
  },
);

test(
  "source-language migration sees a dependent write committed by the Project-lock holder it waited for",
  { skip: skipWithoutDatabase },
  async () => {
    const { db } = await import("@/lib/db");
    const suffix = crypto.randomUUID();
    const organization = await db.organization.create({
      data: { name: `Lock barrier ${suffix}`, slug: `lock-barrier-${suffix}` },
    });
    organizationIds.push(organization.id);
    const project = await db.project.create({
      data: {
        organizationId: organization.id,
        name: "Lock barrier",
        domain: `${suffix}.example.test`,
        originalLang: "de",
        languages: { create: [{ langCode: "en" }, { langCode: "fr" }] },
      },
    });

    let announceWriterLock!: () => void;
    const writerHasLock = new Promise<void>((resolve) => {
      announceWriterLock = resolve;
    });
    let allowWriterCommit!: () => void;
    const writerMayCommit = new Promise<void>((resolve) => {
      allowWriterCommit = resolve;
    });
    const writer = db.$transaction(async (tx) => {
      assert.equal(
        await lockAndValidateProjectLanguageWrite(tx, {
          projectId: project.id,
          sourceLanguages: ["de"],
          targetLanguages: ["fr"],
        }),
        true,
      );
      announceWriterLock();
      await writerMayCommit;
      await tx.translation.create({
        data: {
          projectId: project.id,
          originalHash: `barrier-${suffix}`,
          originalText: "Barrier",
          translatedText: "Barrière",
          langFrom: "de",
          langTo: "fr",
          source: "MANUAL",
        },
      });
    });

    await writerHasLock;
    let migrationSettled = false;
    const migration = updateProjectGeneralSettings(db, {
      projectId: project.id,
      expectedVersion: project.updatedAt.toISOString(),
      patch: { originalLang: "en" },
    }).finally(() => {
      migrationSettled = true;
    });

    // The migration cannot pass the shared Project row lock until the writer
    // commits. This is a real lock barrier, not an ordering-only mock.
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(migrationSettled, false);
    allowWriterCommit();
    await writer;

    const result = await migration;
    assert.equal(result.kind, "source_language_locked");
    const readBack = await db.project.findUniqueOrThrow({
      where: { id: project.id },
    });
    assert.equal(readBack.originalLang, "de");
    assert.equal(
      await db.translation.count({ where: { projectId: project.id } }),
      1,
    );
  },
);

test(
  "source-language migration sees a language-scoped member committed by the Project-lock holder it waited for",
  { skip: skipWithoutDatabase },
  async () => {
    const { db } = await import("@/lib/db");
    const suffix = crypto.randomUUID();
    const organization = await db.organization.create({
      data: {
        name: `Member barrier ${suffix}`,
        slug: `member-barrier-${suffix}`,
      },
    });
    organizationIds.push(organization.id);
    const project = await db.project.create({
      data: {
        organizationId: organization.id,
        name: "Member barrier",
        domain: `${suffix}.example.test`,
        originalLang: "de",
        languages: { create: [{ langCode: "en" }] },
      },
    });

    let announceWriterLock!: () => void;
    const writerHasLock = new Promise<void>((resolve) => {
      announceWriterLock = resolve;
    });
    let allowWriterCommit!: () => void;
    const writerMayCommit = new Promise<void>((resolve) => {
      allowWriterCommit = resolve;
    });
    const writer = db.$transaction(async (tx) => {
      assert.equal(
        await lockAndValidateProjectLanguageWrite(tx, {
          projectId: project.id,
          targetLanguages: ["en"],
        }),
        true,
      );
      announceWriterLock();
      await writerMayCommit;
      await tx.projectMember.create({
        data: {
          projectId: project.id,
          email: `translator-${suffix}@example.test`,
          langCode: "en",
        },
      });
    });

    await writerHasLock;
    let migrationSettled = false;
    const migration = updateProjectGeneralSettings(db, {
      projectId: project.id,
      expectedVersion: project.updatedAt.toISOString(),
      patch: { originalLang: "en" },
    }).finally(() => {
      migrationSettled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(migrationSettled, false);
    allowWriterCommit();
    await writer;

    const result = await migration;
    assert.equal(result.kind, "source_language_locked");
    assert.equal(
      (
        await db.project.findUniqueOrThrow({ where: { id: project.id } })
      ).originalLang,
      "de",
    );
    assert.equal(
      await db.projectMember.count({ where: { projectId: project.id } }),
      1,
    );
  },
);

test(
  "language-scoped members and pending invitations lock source migration without broadening access",
  { skip: skipWithoutDatabase },
  async () => {
    const { db } = await import("@/lib/db");
    const suffix = crypto.randomUUID();
    const organization = await db.organization.create({
      data: { name: `Access lock ${suffix}`, slug: `access-lock-${suffix}` },
    });
    organizationIds.push(organization.id);
    const inviter = await db.user.create({
      data: { email: `inviter-${suffix}@example.test` },
    });
    userIds.push(inviter.id);
    const project = await db.project.create({
      data: {
        organizationId: organization.id,
        name: "Access lock",
        domain: `${suffix}.example.test`,
        originalLang: "de",
        languages: { create: [{ langCode: "en" }, { langCode: "fr" }] },
        members: {
          create: {
            email: `translator-${suffix}@example.test`,
            langCode: "en",
          },
        },
        invitations: {
          create: [
            {
              email: `pending-${suffix}@example.test`,
              langCode: "en",
              tokenHash: `pending-${suffix}`,
              expiresAt: new Date("2030-01-01T00:00:00.000Z"),
              inviterId: inviter.id,
            },
            {
              email: `accepted-${suffix}@example.test`,
              langCode: "en",
              tokenHash: `accepted-${suffix}`,
              expiresAt: new Date("2030-01-01T00:00:00.000Z"),
              acceptedAt: new Date(),
              inviterId: inviter.id,
            },
          ],
        },
      },
    });

    const lockedView = await getProjectGeneralSettings(db, project.id);
    assert.equal(lockedView?.sourceLanguageLocked, true);
    assert.equal(lockedView?.languageDependentContent.languageScopedMembers, 1);
    assert.equal(
      lockedView?.languageDependentContent.pendingLanguageInvitations,
      1,
      "accepted invitations must not be counted as pending",
    );

    const locked = await updateProjectGeneralSettings(db, {
      projectId: project.id,
      expectedVersion: project.updatedAt.toISOString(),
      patch: { originalLang: "en" },
    });
    assert.equal(locked.kind, "source_language_locked");

    await db.projectMember.deleteMany({ where: { projectId: project.id } });
    await db.projectInvitation.deleteMany({
      where: { projectId: project.id, acceptedAt: null },
    });
    const current = await db.project.findUniqueOrThrow({
      where: { id: project.id },
    });
    const migrated = await updateProjectGeneralSettings(db, {
      projectId: project.id,
      expectedVersion: current.updatedAt.toISOString(),
      patch: { originalLang: "en" },
    });
    assert.equal(migrated.kind, "updated");
  },
);

test(
  "deleting a target language independently removes its WordPress domain mapping and advances the project version",
  { skip: skipWithoutDatabase },
  async () => {
    const { db } = await import("@/lib/db");
    const suffix = crypto.randomUUID();
    const organization = await db.organization.create({
      data: { name: `Target ${suffix}`, slug: `target-${suffix}` },
    });
    organizationIds.push(organization.id);
    const project = await db.project.create({
      data: {
        organizationId: organization.id,
        name: "Target deletion",
        domain: `${suffix}.example.test`,
        originalLang: "de",
        languages: { create: [{ langCode: "en" }, { langCode: "fr" }] },
        domainMappings: {
          create: { langCode: "en", host: `en.${suffix}.example.test` },
        },
      },
    });

    assert.equal(
      await deleteProjectTargetLanguage(db, {
        projectId: project.id,
        langCode: "en",
      }),
      true,
    );

    const [readBack, languageCount, mappingCount] = await Promise.all([
      db.project.findUniqueOrThrow({ where: { id: project.id } }),
      db.projectLanguage.count({
        where: { projectId: project.id, langCode: "en" },
      }),
      db.projectDomainMapping.count({
        where: { projectId: project.id, langCode: "en" },
      }),
    ]);
    assert.equal(languageCount, 0);
    assert.equal(mappingCount, 0);
    assert.ok(readBack.updatedAt > project.updatedAt);
  },
);

test(
  "adding an existing inactive language reactivates it as a target",
  { skip: skipWithoutDatabase },
  async () => {
    const { db } = await import("@/lib/db");
    const suffix = crypto.randomUUID();
    const organization = await db.organization.create({
      data: {
        name: `Reactivate target ${suffix}`,
        slug: `reactivate-target-${suffix}`,
      },
    });
    organizationIds.push(organization.id);
    const project = await db.project.create({
      data: {
        organizationId: organization.id,
        name: "Reactivate target",
        domain: `${suffix}.example.test`,
        originalLang: "de",
        languages: { create: [{ langCode: "en", isActive: false }] },
      },
    });

    assert.deepEqual(
      await addProjectTargetLanguages(db, {
        projectId: project.id,
        languages: ["en"],
      }),
      { kind: "updated" },
    );
    const language = await db.projectLanguage.findUniqueOrThrow({
      where: {
        projectId_langCode: { projectId: project.id, langCode: "en" },
      },
    });
    assert.equal(language.isActive, true);
  },
);

test(
  "target deletion sees a domain mapping committed by the Project-lock holder it waited for",
  { skip: skipWithoutDatabase },
  async () => {
    const { db } = await import("@/lib/db");
    const suffix = crypto.randomUUID();
    const organization = await db.organization.create({
      data: {
        name: `Mapping barrier ${suffix}`,
        slug: `mapping-barrier-${suffix}`,
      },
    });
    organizationIds.push(organization.id);
    const project = await db.project.create({
      data: {
        organizationId: organization.id,
        name: "Mapping barrier",
        domain: `${suffix}.example.test`,
        originalLang: "de",
        languages: { create: [{ langCode: "en" }] },
      },
    });

    let announceWriterLock!: () => void;
    const writerHasLock = new Promise<void>((resolve) => {
      announceWriterLock = resolve;
    });
    let allowWriterCommit!: () => void;
    const writerMayCommit = new Promise<void>((resolve) => {
      allowWriterCommit = resolve;
    });
    const writer = db.$transaction(async (tx) => {
      assert.equal(
        await lockProjectRuntimeConfiguration(tx, project.id),
        true,
      );
      announceWriterLock();
      await writerMayCommit;
      await tx.projectDomainMapping.create({
        data: {
          projectId: project.id,
          langCode: "en",
          host: `en.${suffix}.example.test`,
        },
      });
    });

    await writerHasLock;
    let deletionSettled = false;
    const deletion = deleteProjectTargetLanguage(db, {
      projectId: project.id,
      langCode: "en",
    }).finally(() => {
      deletionSettled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(deletionSettled, false);
    allowWriterCommit();
    await writer;

    assert.equal(await deletion, true);
    assert.equal(
      await db.projectDomainMapping.count({
        where: { projectId: project.id, langCode: "en" },
      }),
      0,
    );
  },
);

test(
  "automatic translation disabled serves cache-only while enabled mode creates fresh translations",
  { skip: skipWithoutDatabase },
  async () => {
    const { db } = await import("@/lib/db");
    const { POST } = await import("@/app/api/translate/route");
    const suffix = crypto.randomUUID();
    const organization = await db.organization.create({
      data: { name: `Automatic ${suffix}`, slug: `automatic-${suffix}` },
    });
    organizationIds.push(organization.id);
    const project = await db.project.create({
      data: {
        organizationId: organization.id,
        name: "Automatic translation",
        domain: `${suffix}.example.test`,
        originalLang: "de",
        languages: { create: [{ langCode: "en" }] },
        settings: { create: { automaticTranslation: false } },
      },
    });
    const { rawKey } = await generateApiKey({
      projectId: project.id,
      name: "Integration",
    });
    const previousProvider = process.env.TRANSLATION_PROVIDER;
    process.env.TRANSLATION_PROVIDER = "mock";

    const translate = (text: string, sourceLanguage = "de") =>
      POST(
        new NextRequest("https://deepglot.test/api/translate", {
          method: "POST",
          headers: {
            authorization: `Bearer ${rawKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            l_from: sourceLanguage,
            l_to: "en",
            words: [{ t: 1, w: text }],
          }),
        }),
      );

    try {
      const disabled = await translate("Fresh but disabled");
      assert.equal(disabled.status, 200);
      const disabledBody = await disabled.json();
      assert.deepEqual(disabledBody.to_words, ["Fresh but disabled"]);
      assert.equal(disabledBody.cache_only, true);
      assert.equal(
        await db.translation.count({ where: { projectId: project.id } }),
        0,
      );

      const current = await db.project.findUniqueOrThrow({
        where: { id: project.id },
      });
      const enabled = await updateProjectGeneralSettings(db, {
        projectId: project.id,
        expectedVersion: current.updatedAt.toISOString(),
        patch: { automaticTranslation: true },
      });
      assert.equal(enabled.kind, "updated");

      const translated = await translate("Fresh and enabled");
      assert.equal(translated.status, 200);
      const translatedBody = await translated.json();
      assert.deepEqual(translatedBody.to_words, [
        "[en] Fresh and enabled",
      ]);
      assert.equal(translatedBody.cache_only, false);
      assert.equal(
        await db.translation.count({ where: { projectId: project.id } }),
        1,
      );

      const wrongSource = await translate("Wrong source", "fr");
      assert.equal(wrongSource.status, 400);
      assert.equal((await wrongSource.json()).code, "validation_failed");
    } finally {
      if (previousProvider === undefined) {
        delete process.env.TRANSLATION_PROVIDER;
      } else {
        process.env.TRANSLATION_PROVIDER = previousProvider;
      }
    }
  },
);

test(
  "plugin settings sync validates mappings against the project snapshot inside its write transaction",
  { skip: skipWithoutDatabase },
  async () => {
    const { db } = await import("@/lib/db");
    const { POST } = await import("@/app/api/plugin/settings-sync/route");
    const suffix = crypto.randomUUID();
    const organization = await db.organization.create({
      data: { name: `Plugin race ${suffix}`, slug: `plugin-race-${suffix}` },
    });
    organizationIds.push(organization.id);
    const project = await db.project.create({
      data: {
        organizationId: organization.id,
        name: "Plugin race",
        domain: `${suffix}.example.test`,
        originalLang: "de",
        languages: { create: [{ langCode: "en" }] },
      },
    });
    const { rawKey } = await generateApiKey({
      projectId: project.id,
      name: "Plugin race",
    });

    const database = db as unknown as {
      $transaction: (...args: unknown[]) => Promise<unknown>;
    };
    const originalTransaction = database.$transaction.bind(db);
    let replacedAuthoritativeSnapshot = false;
    database.$transaction = async (...args: unknown[]) => {
      if (!replacedAuthoritativeSnapshot) {
        replacedAuthoritativeSnapshot = true;
        await db.project.update({
          where: { id: project.id },
          data: { originalLang: "en" },
        });
        await db.projectLanguage.update({
          where: {
            projectId_langCode: { projectId: project.id, langCode: "en" },
          },
          data: { isActive: false },
        });
        await db.projectLanguage.create({
          data: { projectId: project.id, langCode: "de", isActive: true },
        });
      }

      return originalTransaction(...args);
    };

    try {
      const response = await POST(
        new NextRequest("https://deepglot.test/api/plugin/settings-sync", {
          method: "POST",
          headers: {
            authorization: `Bearer ${rawKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            routingMode: "SUBDOMAIN",
            siteUrl: `https://${suffix}.example.test`,
            sourceLanguage: "de",
            targetLanguages: ["en"],
            autoRedirect: false,
            translateEmails: false,
            translateSearch: false,
            translateAmp: false,
            domainMappings: [
              { langCode: "en", host: `en.${suffix}.example.test` },
            ],
          }),
        }),
      );

      assert.equal(response.status, 400);
      assert.equal(
        await db.projectDomainMapping.count({
          where: { projectId: project.id },
        }),
        0,
      );
    } finally {
      database.$transaction = originalTransaction;
    }
  },
);

test(
  "automatic translation disabled after API-key validation switches to cache-only before provider spend",
  { skip: skipWithoutDatabase },
  async () => {
    const { db } = await import("@/lib/db");
    const { POST } = await import("@/app/api/translate/route");
    const suffix = crypto.randomUUID();
    const organization = await db.organization.create({
      data: {
        name: `Automatic race ${suffix}`,
        slug: `automatic-race-${suffix}`,
      },
    });
    organizationIds.push(organization.id);
    const project = await db.project.create({
      data: {
        organizationId: organization.id,
        name: "Automatic race",
        domain: `${suffix}.example.test`,
        originalLang: "de",
        languages: { create: [{ langCode: "en" }] },
        settings: { create: { automaticTranslation: true } },
      },
    });
    const { rawKey } = await generateApiKey({
      projectId: project.id,
      name: "Automatic race",
    });

    const previousProvider = process.env.TRANSLATION_PROVIDER;
    const previousApiKey = process.env.OPENAI_API_KEY;
    process.env.TRANSLATION_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "integration-test-key";
    let providerCalls = 0;
    const fetchMock = mock.method(globalThis, "fetch", async () => {
      providerCalls += 1;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  translations: [{ text: "Hello" }],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const translationDelegate = db.translation as unknown as {
      findMany: (...args: unknown[]) => Promise<unknown>;
    };
    const originalFindMany = translationDelegate.findMany.bind(db.translation);
    let disabledBeforeFreshDecision = false;
    translationDelegate.findMany = async (...args: unknown[]) => {
      const result = await originalFindMany(...args);
      if (!disabledBeforeFreshDecision) {
        disabledBeforeFreshDecision = true;
        await db.projectSettings.update({
          where: { projectId: project.id },
          data: { automaticTranslation: false },
        });
      }
      return result;
    };

    try {
      const response = await POST(
        new NextRequest("https://deepglot.test/api/translate", {
          method: "POST",
          headers: {
            authorization: `Bearer ${rawKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            l_from: "de",
            l_to: "en",
            words: [{ t: 1, w: "Noch nicht im Cache" }],
          }),
        }),
      );

      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.cache_only, true);
      assert.deepEqual(body.to_words, ["Noch nicht im Cache"]);
      assert.equal(providerCalls, 0);
      assert.equal(
        await db.translation.count({ where: { projectId: project.id } }),
        0,
      );
      const velocityBucket = await db.rateLimitBucket.findUnique({
        where: {
          scope_subjectHash: {
            scope: TRANSLATE_WORD_VELOCITY_SCOPE,
            subjectHash: hashRateLimitSubject(
              TRANSLATE_WORD_VELOCITY_SCOPE,
              organization.id,
            ),
          },
        },
      });
      assert.equal(
        velocityBucket?.count ?? 0,
        0,
        "cache-only downgrade must happen before the velocity reservation",
      );
    } finally {
      translationDelegate.findMany = originalFindMany;
      fetchMock.mock.restore();
      if (previousProvider === undefined) {
        delete process.env.TRANSLATION_PROVIDER;
      } else {
        process.env.TRANSLATION_PROVIDER = previousProvider;
      }
      if (previousApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousApiKey;
      }
    }
  },
);

test(
  "fresh automatic-translation disablement bypasses a stale invalid provider snapshot",
  { skip: skipWithoutDatabase },
  async () => {
    const { db } = await import("@/lib/db");
    const { POST } = await import("@/app/api/translate/route");
    const suffix = crypto.randomUUID();
    const organization = await db.organization.create({
      data: {
        name: `Stale provider ${suffix}`,
        slug: `stale-provider-${suffix}`,
      },
    });
    organizationIds.push(organization.id);
    const project = await db.project.create({
      data: {
        organizationId: organization.id,
        name: "Stale provider",
        domain: `${suffix}.example.test`,
        originalLang: "de",
        languages: { create: [{ langCode: "en" }] },
        settings: {
          create: {
            automaticTranslation: true,
            translationProvider: "legacy-invalid-provider",
          },
        },
      },
    });
    const { rawKey } = await generateApiKey({
      projectId: project.id,
      name: "Stale provider",
    });

    const apiKeyDelegate = db.apiKey as unknown as {
      findUnique: (...args: unknown[]) => Promise<unknown>;
    };
    const originalFindUnique = apiKeyDelegate.findUnique.bind(db.apiKey);
    let disabledAfterValidation = false;
    apiKeyDelegate.findUnique = async (...args: unknown[]) => {
      const apiKeySnapshot = await originalFindUnique(...args);
      if (!disabledAfterValidation) {
        disabledAfterValidation = true;
        await db.projectSettings.update({
          where: { projectId: project.id },
          data: { automaticTranslation: false },
        });
      }
      return apiKeySnapshot;
    };

    let providerCalls = 0;
    const fetchMock = mock.method(globalThis, "fetch", async () => {
      providerCalls += 1;
      return new Response("provider must not be called", { status: 500 });
    });

    try {
      const response = await POST(
        new NextRequest("https://deepglot.test/api/translate", {
          method: "POST",
          headers: {
            authorization: `Bearer ${rawKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            l_from: "de",
            l_to: "en",
            words: [{ t: 1, w: "Kein Provider" }],
          }),
        }),
      );

      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.cache_only, true);
      assert.deepEqual(body.to_words, ["Kein Provider"]);
      assert.equal(providerCalls, 0);
      assert.equal(
        await db.translation.count({ where: { projectId: project.id } }),
        0,
      );
    } finally {
      apiKeyDelegate.findUnique = originalFindUnique;
      fetchMock.mock.restore();
    }
  },
);

test(
  "automatic translation disabled at the final dispatch gate refunds velocity and records zero fresh spend",
  { skip: skipWithoutDatabase },
  async () => {
    const { db } = await import("@/lib/db");
    const { POST } = await import("@/app/api/translate/route");
    const suffix = crypto.randomUUID();
    const organization = await db.organization.create({
      data: {
        name: `Dispatch race ${suffix}`,
        slug: `dispatch-race-${suffix}`,
      },
    });
    organizationIds.push(organization.id);
    const project = await db.project.create({
      data: {
        organizationId: organization.id,
        name: "Dispatch race",
        domain: `${suffix}.example.test`,
        originalLang: "de",
        languages: { create: [{ langCode: "en" }] },
        settings: { create: { automaticTranslation: true } },
      },
    });
    const { rawKey } = await generateApiKey({
      projectId: project.id,
      name: "Dispatch race",
    });

    const previousProvider = process.env.TRANSLATION_PROVIDER;
    const previousApiKey = process.env.OPENAI_API_KEY;
    process.env.TRANSLATION_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "integration-test-key";
    let providerCalls = 0;
    const fetchMock = mock.method(globalThis, "fetch", async () => {
      providerCalls += 1;
      return new Response("provider must not be called", { status: 500 });
    });

    const database = db as unknown as {
      $transaction: (...args: unknown[]) => Promise<unknown>;
    };
    const originalTransaction = database.$transaction.bind(db);
    let transactionCalls = 0;
    database.$transaction = async (...args: unknown[]) => {
      transactionCalls += 1;
      if (transactionCalls === 1) {
        await db.projectSettings.update({
          where: { projectId: project.id },
          data: { automaticTranslation: false },
        });
      }
      return originalTransaction(...args);
    };

    try {
      const requestUrl = `https://${suffix}.example.test/dispatch-race`;
      const response = await POST(
        new NextRequest("https://deepglot.test/api/translate", {
          method: "POST",
          headers: {
            authorization: `Bearer ${rawKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            l_from: "de",
            l_to: "en",
            request_url: requestUrl,
            words: [{ t: 1, w: "Noch nicht im Cache" }],
          }),
        }),
      );

      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.cache_only, true);
      assert.deepEqual(body.to_words, ["Noch nicht im Cache"]);
      assert.equal(providerCalls, 0);

      const [translationCount, usageCount, batch, translatedUrl, velocity] =
        await Promise.all([
          db.translation.count({ where: { projectId: project.id } }),
          db.usageRecord.count({ where: { projectId: project.id } }),
          db.translationBatchLog.findFirst({
            where: { projectId: project.id },
          }),
          db.translatedUrl.findUnique({
            where: {
              projectId_urlPath_langTo: {
                projectId: project.id,
                urlPath: "/dispatch-race",
                langTo: "en",
              },
            },
          }),
          db.rateLimitBucket.findUnique({
            where: {
              scope_subjectHash: {
                scope: TRANSLATE_WORD_VELOCITY_SCOPE,
                subjectHash: hashRateLimitSubject(
                  TRANSLATE_WORD_VELOCITY_SCOPE,
                  organization.id,
                ),
              },
            },
          }),
        ]);
      assert.equal(translationCount, 0);
      assert.equal(usageCount, 0);
      assert.equal(batch?.provider, "disabled");
      assert.equal(batch?.translatedWords, 0);
      assert.ok((batch?.totalWords ?? 0) > 0);
      assert.equal(translatedUrl?.wordCount, batch?.totalWords);
      assert.equal(translatedUrl?.requestCount, 1);
      assert.equal(velocity?.count ?? 0, 0);
    } finally {
      database.$transaction = originalTransaction;
      fetchMock.mock.restore();
      if (previousProvider === undefined) {
        delete process.env.TRANSLATION_PROVIDER;
      } else {
        process.env.TRANSLATION_PROVIDER = previousProvider;
      }
      if (previousApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousApiKey;
      }
    }
  },
);

for (const failurePoint of ["dispatch transaction", "provider resolution"] as const) {
  test(
    `${failurePoint} failure before provider dispatch refunds the exact velocity reservation`,
    { skip: skipWithoutDatabase },
    async () => {
      const { db } = await import("@/lib/db");
      const { POST } = await import("@/app/api/translate/route");
      const suffix = crypto.randomUUID();
      const organization = await db.organization.create({
        data: {
          name: `Pre-provider failure ${suffix}`,
          slug: `pre-provider-failure-${suffix}`,
        },
      });
      organizationIds.push(organization.id);
      const project = await db.project.create({
        data: {
          organizationId: organization.id,
          name: "Pre-provider failure",
          domain: `${suffix}.example.test`,
          originalLang: "de",
          languages: { create: [{ langCode: "en" }] },
          settings: {
            create: {
              automaticTranslation: true,
              ...(failurePoint === "provider resolution"
                ? { translationProvider: "invalid-provider" }
                : {}),
            },
          },
        },
      });
      const { rawKey } = await generateApiKey({
        projectId: project.id,
        name: "Pre-provider failure",
      });

      const previousProvider = process.env.TRANSLATION_PROVIDER;
      const previousApiKey = process.env.OPENAI_API_KEY;
      process.env.TRANSLATION_PROVIDER = "openai";
      process.env.OPENAI_API_KEY = "integration-test-key";

      let providerCalls = 0;
      const fetchMock = mock.method(globalThis, "fetch", async () => {
        providerCalls += 1;
        return new Response("provider must not be called", { status: 500 });
      });
      const database = db as unknown as {
        $transaction: (...args: unknown[]) => Promise<unknown>;
      };
      const originalTransaction = database.$transaction.bind(db);
      let injectedTransactionFailure = false;
      if (failurePoint === "dispatch transaction") {
        database.$transaction = async (...args: unknown[]) => {
          if (!injectedTransactionFailure) {
            injectedTransactionFailure = true;
            throw new Error("injected final dispatch transaction failure");
          }
          return originalTransaction(...args);
        };
      }

      try {
        const response = await POST(
          new NextRequest("https://deepglot.test/api/translate", {
            method: "POST",
            headers: {
              authorization: `Bearer ${rawKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              l_from: "de",
              l_to: "en",
              words: [{ t: 1, w: "Noch nicht im Cache" }],
            }),
          }),
        );

        assert.equal(response.status, 500);
        assert.equal((await response.json()).code, "internal_error");
        assert.equal(providerCalls, 0);
        if (failurePoint === "dispatch transaction") {
          assert.equal(injectedTransactionFailure, true);
        }
        assert.deepEqual(
          await Promise.all([
            db.translation.count({ where: { projectId: project.id } }),
            db.usageRecord.count({ where: { projectId: project.id } }),
            db.translationBatchLog.count({ where: { projectId: project.id } }),
          ]),
          [0, 0, 0],
        );

        const velocityBucket = await db.rateLimitBucket.findUnique({
          where: {
            scope_subjectHash: {
              scope: TRANSLATE_WORD_VELOCITY_SCOPE,
              subjectHash: hashRateLimitSubject(
                TRANSLATE_WORD_VELOCITY_SCOPE,
                organization.id,
              ),
            },
          },
        });
        assert.ok(velocityBucket, "the successful reservation must be observable");
        assert.equal(
          velocityBucket.count,
          0,
          "pre-provider failure must release the exact reservation",
        );
      } finally {
        database.$transaction = originalTransaction;
        fetchMock.mock.restore();
        if (previousProvider === undefined) {
          delete process.env.TRANSLATION_PROVIDER;
        } else {
          process.env.TRANSLATION_PROVIDER = previousProvider;
        }
        if (previousApiKey === undefined) {
          delete process.env.OPENAI_API_KEY;
        } else {
          process.env.OPENAI_API_KEY = previousApiKey;
        }
      }
    },
  );
}

test(
  "automatic translation disabled during provider work prevents every persistence side effect",
  { skip: skipWithoutDatabase },
  async () => {
    const { db } = await import("@/lib/db");
    const { POST } = await import("@/app/api/translate/route");
    const suffix = crypto.randomUUID();
    const organization = await db.organization.create({
      data: {
        name: `Automatic provider race ${suffix}`,
        slug: `automatic-provider-race-${suffix}`,
      },
    });
    organizationIds.push(organization.id);
    const project = await db.project.create({
      data: {
        organizationId: organization.id,
        name: "Automatic provider race",
        domain: `${suffix}.example.test`,
        originalLang: "de",
        languages: { create: [{ langCode: "en" }] },
        settings: { create: { automaticTranslation: true } },
      },
    });
    const endpoint = await db.webhookEndpoint.create({
      data: {
        projectId: project.id,
        url: "https://hooks.example.test/deepglot",
        secret: "integration-test-secret",
        eventTypes: ["translation.created", "translation.updated"],
      },
    });
    const { rawKey } = await generateApiKey({
      projectId: project.id,
      name: "Automatic provider race",
    });

    const previousProvider = process.env.TRANSLATION_PROVIDER;
    const previousApiKey = process.env.OPENAI_API_KEY;
    process.env.TRANSLATION_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "integration-test-key";
    let providerCalls = 0;
    let toggleKind: string | null = null;
    const fetchMock = mock.method(globalThis, "fetch", async () => {
      providerCalls += 1;
      if (toggleKind === null) {
        const current = await db.project.findUniqueOrThrow({
          where: { id: project.id },
        });
        const toggle = await updateProjectGeneralSettings(db, {
          projectId: project.id,
          expectedVersion: current.updatedAt.toISOString(),
          patch: { automaticTranslation: false },
        });
        toggleKind = toggle.kind;
      }

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  translations: [{ text: "Hello" }],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    try {
      const response = await POST(
        new NextRequest("https://deepglot.test/api/translate", {
          method: "POST",
          headers: {
            authorization: `Bearer ${rawKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            l_from: "de",
            l_to: "en",
            request_url: `https://${suffix}.example.test/provider-race`,
            words: [{ t: 1, w: "Hallo" }],
          }),
        }),
      );

      assert.equal(providerCalls, 1);
      assert.equal(toggleKind, "updated");
      assert.equal(response.status, 409);
      assert.equal(
        (await response.json()).code,
        "automatic_translation_disabled_during_request",
      );
      assert.deepEqual(
        await Promise.all([
          db.translation.count({ where: { projectId: project.id } }),
          db.usageRecord.count({ where: { projectId: project.id } }),
          db.translationBatchLog.count({ where: { projectId: project.id } }),
          db.translatedUrl.count({ where: { projectId: project.id } }),
          db.webhookDelivery.count({ where: { endpointId: endpoint.id } }),
        ]),
        [0, 0, 0, 0, 0],
      );
      const velocityBucket = await db.rateLimitBucket.findUnique({
        where: {
          scope_subjectHash: {
            scope: TRANSLATE_WORD_VELOCITY_SCOPE,
            subjectHash: hashRateLimitSubject(
              TRANSLATE_WORD_VELOCITY_SCOPE,
              organization.id,
            ),
          },
        },
      });
      assert.equal(
        velocityBucket?.count ?? 0,
        1,
        "successful provider work remains charged after automatic-translation drift",
      );
    } finally {
      fetchMock.mock.restore();
      if (previousProvider === undefined) {
        delete process.env.TRANSLATION_PROVIDER;
      } else {
        process.env.TRANSLATION_PROVIDER = previousProvider;
      }
      if (previousApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousApiKey;
      }
    }
  },
);

test(
  "translation persistence rejects a source-language migration that completed during provider work",
  { skip: skipWithoutDatabase },
  async () => {
    const { db } = await import("@/lib/db");
    const { POST } = await import("@/app/api/translate/route");
    const suffix = crypto.randomUUID();
    const organization = await db.organization.create({
      data: {
        name: `Translation race ${suffix}`,
        slug: `translation-race-${suffix}`,
      },
    });
    organizationIds.push(organization.id);
    const project = await db.project.create({
      data: {
        organizationId: organization.id,
        name: "Translation race",
        domain: `${suffix}.example.test`,
        originalLang: "de",
        languages: {
          create: [{ langCode: "en" }, { langCode: "fr" }],
        },
      },
    });
    const { rawKey } = await generateApiKey({
      projectId: project.id,
      name: "Translation race",
    });

    const previousProvider = process.env.TRANSLATION_PROVIDER;
    const previousApiKey = process.env.OPENAI_API_KEY;
    process.env.TRANSLATION_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "integration-test-key";
    let migrationKind: string | null = null;
    const fetchMock = mock.method(globalThis, "fetch", async () => {
      if (migrationKind === null) {
        const beforeMigration = await db.project.findUniqueOrThrow({
          where: { id: project.id },
        });
        const migrationResult = await updateProjectGeneralSettings(db, {
          projectId: project.id,
          expectedVersion: beforeMigration.updatedAt.toISOString(),
          patch: { originalLang: "en" },
        });
        migrationKind = migrationResult.kind;
      }

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  translations: [{ text: "Bonjour" }],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    try {
      const response = await POST(
        new NextRequest("https://deepglot.test/api/translate", {
          method: "POST",
          headers: {
            authorization: `Bearer ${rawKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            l_from: "de",
            l_to: "fr",
            words: [{ t: 1, w: "Hallo" }],
          }),
        }),
      );

      assert.equal(migrationKind, "updated");
      assert.equal(response.status, 409);
      assert.equal(
        (await response.json()).code,
        "project_language_configuration_changed",
      );
      assert.equal(
        await db.translation.count({ where: { projectId: project.id } }),
        0,
      );
      const velocityBucket = await db.rateLimitBucket.findUnique({
        where: {
          scope_subjectHash: {
            scope: TRANSLATE_WORD_VELOCITY_SCOPE,
            subjectHash: hashRateLimitSubject(
              TRANSLATE_WORD_VELOCITY_SCOPE,
              organization.id,
            ),
          },
        },
      });
      assert.equal(
        velocityBucket?.count ?? 0,
        1,
        "successful provider work remains charged after configuration drift",
      );
    } finally {
      fetchMock.mock.restore();
      if (previousProvider === undefined) {
        delete process.env.TRANSLATION_PROVIDER;
      } else {
        process.env.TRANSLATION_PROVIDER = previousProvider;
      }
      if (previousApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousApiKey;
      }
    }
  },
);

after(async () => {
  if (databaseUrl) {
    const { db } = await import("@/lib/db");
    if (organizationIds.length > 0) {
      await db.organization.deleteMany({
        where: { id: { in: organizationIds } },
      });
    }
    if (userIds.length > 0) {
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await db.$disconnect();
  }
});
