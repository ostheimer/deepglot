import assert from "node:assert/strict";
import { after, test } from "node:test";

import type { NextRequest } from "next/server";

import { resolveDatabaseUrl } from "@/lib/database-url";
import { PAGE_VIEW_RATE_LIMIT_SCOPE } from "@/lib/page-views";
import { hashRateLimitSubject } from "@/lib/rate-limit";

const databaseUrl = resolveDatabaseUrl();
const skipWithoutDatabase = databaseUrl
  ? false
  : "requires a prepared PostgreSQL database via DATABASE_URL or DEEPGLOT_DATABASE_URL";
const cleanupOrganizationIds = new Set<string>();
const cleanupProjectIds = new Set<string>();

function eventRequest(
  apiKey: string,
  event: { eventId: string; urlPath: string; langTo: string },
): NextRequest {
  return new Request("https://deepglot.example.test/api/plugin/page-views", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "user-agent": "WordPress/6.8; https://example.test",
    },
    body: JSON.stringify(event),
  }) as NextRequest;
}

test(
  "PostgreSQL stores consented real views independently, isolates tenants, deduplicates events and enforces retention",
  { skip: skipWithoutDatabase },
  async () => {
    const [{ db }, { generateApiKey }, collector, cleanup] = await Promise.all([
      import("@/lib/db"),
      import("@/lib/api-keys"),
      import("@/app/api/plugin/page-views/route"),
      import("@/app/api/cron/page-view-retention/route"),
    ]);
    const suffix = crypto.randomUUID();
    const organization = await db.organization.create({
      data: { name: `Page views ${suffix}`, slug: `page-views-${suffix}` },
    });
    cleanupOrganizationIds.add(organization.id);

    const project = await db.project.create({
      data: {
        name: "Page-view project",
        domain: `${suffix}.example.test`,
        originalLang: "de",
        organizationId: organization.id,
        languages: { create: [{ langCode: "en" }, { langCode: "fr" }] },
        settings: {
          create: {
            pageViewsEnabled: true,
            pageViewsConsentGrantedAt: null,
          },
        },
        translatedUrls: {
          create: {
            urlPath: "/preise",
            langTo: "en",
            requestCount: 37,
          },
        },
      },
    });
    cleanupProjectIds.add(project.id);
    const { rawKey } = await generateApiKey({
      projectId: project.id,
      name: "Integration-only page-view key",
    });
    const englishEvent = {
      eventId: crypto.randomUUID(),
      urlPath: "/en/pricing",
      langTo: "en",
    };

    const legacyResponse = await collector.POST(eventRequest(rawKey, englishEvent));
    assert.equal(legacyResponse.status, 200);
    assert.deepEqual(await legacyResponse.json(), {
      tracked: false,
      reason: "disabled",
    });
    assert.equal(await db.pageView.count({ where: { projectId: project.id } }), 0);

    await db.projectSettings.update({
      where: { projectId: project.id },
      data: { pageViewsConsentGrantedAt: new Date() },
    });

    const firstResponse = await collector.POST(eventRequest(rawKey, englishEvent));
    assert.equal(firstResponse.status, 201);
    assert.deepEqual(await firstResponse.json(), { tracked: true });
    assert.deepEqual(
      await db.pageView.findUnique({
        where: { eventId: englishEvent.eventId },
        select: { eventId: true, urlPath: true, langTo: true, projectId: true },
      }),
      { ...englishEvent, projectId: project.id },
    );

    const duplicateResponse = await collector.POST(eventRequest(rawKey, englishEvent));
    assert.equal(duplicateResponse.status, 200);
    assert.deepEqual(await duplicateResponse.json(), {
      tracked: false,
      reason: "duplicate",
    });

    const frenchEvent = {
      eventId: crypto.randomUUID(),
      urlPath: "/fr/services",
      langTo: "fr",
    };
    assert.equal(
      (await collector.POST(eventRequest(rawKey, frenchEvent))).status,
      201,
    );

    const foreignOrganization = await db.organization.create({
      data: {
        name: `Foreign page views ${suffix}`,
        slug: `foreign-page-views-${suffix}`,
      },
    });
    cleanupOrganizationIds.add(foreignOrganization.id);
    const foreignProject = await db.project.create({
      data: {
        name: "Foreign page-view project",
        domain: `foreign-${suffix}.example.test`,
        originalLang: "de",
        organizationId: foreignOrganization.id,
        languages: { create: [{ langCode: "en" }] },
        settings: {
          create: {
            pageViewsEnabled: true,
            pageViewsConsentGrantedAt: new Date(),
          },
        },
      },
    });
    cleanupProjectIds.add(foreignProject.id);
    const foreignKey = await generateApiKey({
      projectId: foreignProject.id,
      name: "Integration-only foreign key",
    });
    const foreignCollision = await collector.POST(
      eventRequest(foreignKey.rawKey, englishEvent),
    );
    assert.equal(foreignCollision.status, 409);
    assert.equal(
      await db.pageView.count({ where: { projectId: foreignProject.id } }),
      0,
    );

    const expiredEventId = crypto.randomUUID();
    await db.pageView.create({
      data: {
        eventId: expiredEventId,
        urlPath: "/en/expired",
        langTo: "en",
        projectId: project.id,
        createdAt: new Date(Date.now() - 91 * 86_400_000),
      },
    });

    const groups = await db.pageView.groupBy({
      by: ["urlPath", "langTo"],
      where: {
        projectId: project.id,
        createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
      },
      _count: { _all: true },
      orderBy: { urlPath: "asc" },
    });
    assert.deepEqual(
      groups.map(({ urlPath, langTo, _count }) => ({
        urlPath,
        langTo,
        views: _count._all,
      })),
      [
        { urlPath: "/en/pricing", langTo: "en", views: 1 },
        { urlPath: "/fr/services", langTo: "fr", views: 1 },
      ],
    );

    const previousCronSecret = process.env.CRON_SECRET;
    const testCronSecret = `integration-${suffix}`;
    process.env.CRON_SECRET = testCronSecret;

    try {
      const cleanupResponse = await cleanup.GET(
        new Request("https://deepglot.example.test/api/cron/page-view-retention", {
          headers: { authorization: `Bearer ${testCronSecret}` },
        }) as NextRequest,
      );
      assert.equal(cleanupResponse.status, 200);
      assert.equal((await cleanupResponse.json()).retentionDays, 90);
      assert.equal(
        await db.pageView.count({ where: { eventId: expiredEventId } }),
        0,
      );
    } finally {
      if (previousCronSecret === undefined) {
        delete process.env.CRON_SECRET;
      } else {
        process.env.CRON_SECRET = previousCronSecret;
      }
    }

    assert.equal(await db.pageView.count({ where: { projectId: project.id } }), 2);
    assert.equal(
      (
        await db.translatedUrl.findFirstOrThrow({
          where: { projectId: project.id },
          select: { requestCount: true },
        })
      ).requestCount,
      37,
    );

    await db.projectSettings.update({
      where: { projectId: project.id },
      data: { pageViewsEnabled: false, pageViewsConsentGrantedAt: null },
    });
    const revokedResponse = await collector.POST(
      eventRequest(rawKey, {
        eventId: crypto.randomUUID(),
        urlPath: "/en/revoked",
        langTo: "en",
      }),
    );
    assert.equal(revokedResponse.status, 200);
    assert.deepEqual(await revokedResponse.json(), {
      tracked: false,
      reason: "disabled",
    });
    assert.equal(await db.pageView.count({ where: { projectId: project.id } }), 2);
  },
);

after(async () => {
  if (databaseUrl && cleanupOrganizationIds.size > 0) {
    const { db } = await import("@/lib/db");
    await db.rateLimitBucket.deleteMany({
      where: {
        scope: PAGE_VIEW_RATE_LIMIT_SCOPE,
        subjectHash: {
          in: [...cleanupProjectIds].map((projectId) =>
            hashRateLimitSubject(PAGE_VIEW_RATE_LIMIT_SCOPE, projectId),
          ),
        },
      },
    });
    await db.organization.deleteMany({
      where: { id: { in: [...cleanupOrganizationIds] } },
    });
    await db.$disconnect();
  }
});
