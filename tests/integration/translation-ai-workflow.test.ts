import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { resolveDatabaseUrl } from "@/lib/database-url";
import { previewWorkspaceAi, runWorkspaceAi } from "@/lib/translation-ai-workflow";
import { TranslationWorkflowError } from "@/lib/translation-workflow";
import { hashRateLimitSubject, TRANSLATE_WORD_VELOCITY_SCOPE } from "@/lib/rate-limit";
import { getUsageMonthKey } from "@/lib/translation-batches";
import { NextRequest } from "next/server";
import { createAiSuggestionPostHandler } from "@/app/api/projects/[projektId]/translations/[translationId]/ai-suggestion/route";
import { getProjectAccess } from "@/lib/project-access";

async function approveFixtureBudget(db: typeof import("@/lib/db").db,
  organizationId: string, projectId: string | null, ownerId: string,
  provider: "mock" | "openai-compatible", model: string) {
  await db.aiBudget.create({ data: {
    organizationId, projectId, currency: "USD", capMicros: BigInt(1_000_000),
    perCallCapMicros: BigInt(1_000_000), warningPercent: 80, period: "MONTHLY_UTC",
    approvedByUserId: ownerId, models: { create: [{ provider, model,
      unit: provider === "mock" ? "ZERO_COST" : "TOKEN",
      inputMicrosPerMillion: BigInt(provider === "mock" ? 0 : 100_000),
      outputMicrosPerMillion: BigInt(provider === "mock" ? 0 : 100_000),
      maxInputUnits: 100_000, maxOutputUnits: 100,
      outputCapVerified: provider !== "mock",
      priceExpiresAt: new Date(Date.now() + 86_400_000) }] },
  } });
}

test("mock-provider AI requires a fresh quota preview and returns a non-authoritative suggestion", {
  skip: resolveDatabaseUrl() ? false : "requires isolated PostgreSQL",
}, async () => {
  const priorEnforcement = process.env.AI_BUDGET_ENFORCEMENT;
  process.env.AI_BUDGET_ENFORCEMENT = "on";
  const { db } = await import("@/lib/db");
  const suffix = crypto.randomUUID();
  const organization = await db.organization.create({ data: { name: "AI test", slug: `ai-${suffix}` } });
  try {
    const user = await db.user.create({ data: { email: `ai-${suffix}@example.test` } });
    const membership = await db.organizationMember.create({ data: { organizationId: organization.id, userId: user.id, role: "OWNER" } });
    const project = await db.project.create({ data: {
      organizationId: organization.id, name: "AI", domain: `ai-${suffix}.test`, originalLang: "de",
      languages: { create: { langCode: "en" } },
      settings: { create: { translationProvider: "mock" } },
    } });
    for (const projectId of [null, project.id]) await db.aiBudget.create({ data: {
      organizationId: organization.id, projectId, currency: "USD", capMicros: BigInt(1_000_000),
      perCallCapMicros: BigInt(1_000_000), warningPercent: 80, period: "MONTHLY_UTC",
      approvedByUserId: user.id, models: { create: [{ provider: "mock", model: "mock",
        unit: "ZERO_COST", inputMicrosPerMillion: BigInt(0), outputMicrosPerMillion: BigInt(0),
        maxInputUnits: 100_000, maxOutputUnits: 100,
        priceExpiresAt: new Date(Date.now() + 86_400_000) }] },
    } });
    const row = await db.translation.create({ data: {
      projectId: project.id, originalHash: `ai-${suffix}`, originalText: "Hallo {name}",
      translatedText: "Hello {name}", langFrom: "de", langTo: "en", source: "MOCK",
      typeObservations: { create: { wordType: 1 } },
    } });
    const translator = await db.user.create({ data: { email: `ai-translator-${suffix}@example.test` } });
    const assigned = await db.projectMember.create({ data: { projectId: project.id,
      userId: translator.id, email: translator.email, role: "TRANSLATOR", langCode: "en" } });
    await db.translation.update({ where: { id: row.id }, data: { assignedToId: assigned.id } });
    const assignedRow = await db.translation.findUniqueOrThrow({ where: { id: row.id } });
    const previewRoute = createAiSuggestionPostHandler({ getUserId: async () => translator.id,
      getProjectAccess, preview: previewWorkspaceAi, run: runWorkspaceAi });
    const previewResponse = await previewRoute(new NextRequest(
      `http://127.0.0.1/api/projects/${project.id}/translations/${row.id}/ai-suggestion`, {
        method: "POST", body: JSON.stringify({ mode: "preview", action: "rephrase",
          expectedUpdatedAt: assignedRow.updatedAt.toISOString() }),
        headers: { "Content-Type": "application/json" },
      }), { params: Promise.resolve({ projektId: project.id, translationId: row.id }) });
    assert.equal(previewResponse.status, 200);
    const translatorBody = await previewResponse.json() as { budget: Record<string, unknown> };
    assert.equal(translatorBody.budget.organizationRemainingMicros, undefined);
    assert.equal(translatorBody.budget.projectRemainingMicros, undefined);
    const input = { projectId: project.id, userId: user.id, translationId: row.id,
      expectedUpdatedAt: assignedRow.updatedAt, action: "rephrase" as const };
    const preview = await previewWorkspaceAi(input);
    assert.equal(preview.provider, "mock");
    assert.equal(preview.canRun, true);
    assert.equal(preview.price?.estimatedMaxMicros, "0");
    assert.equal(preview.budget.allowed, true);
    await assert.rejects(runWorkspaceAi({ ...input, fingerprint: "0".repeat(64),
      previewExpiresAt: new Date(preview.previewExpiresAt) }),
      (error) => error instanceof TranslationWorkflowError && error.code === "STALE_UPDATE");
    assert.equal((await db.usageRecord.aggregate({ where: { organizationId: organization.id }, _sum: { words: true } }))._sum.words, null);
    const saturated = await db.usageRecord.create({ data: { organizationId: organization.id,
      projectId: project.id, month: getUsageMonthKey(), words: preview.wordsLimit } });
    await assert.rejects(runWorkspaceAi({ ...input, fingerprint: preview.fingerprint,
      previewExpiresAt: new Date(preview.previewExpiresAt) }),
    (error) => error instanceof TranslationWorkflowError && error.code === "INVALID_TRANSITION");
    assert.equal((await db.usageRecord.findUniqueOrThrow({ where: { id: saturated.id } })).words, preview.wordsLimit);
    const bucket = await db.rateLimitBucket.findUniqueOrThrow({ where: { scope_subjectHash: {
      scope: TRANSLATE_WORD_VELOCITY_SCOPE,
      subjectHash: hashRateLimitSubject(TRANSLATE_WORD_VELOCITY_SCOPE, organization.id),
    } } });
    assert.equal(bucket.count, 0);
    await db.usageRecord.delete({ where: { id: saturated.id } });
    const result = await runWorkspaceAi({ ...input, fingerprint: preview.fingerprint,
      previewExpiresAt: new Date(preview.previewExpiresAt) });
    assert.equal(result.suggestion, "Hello {name}");
    assert.equal((await db.translation.findUniqueOrThrow({ where: { id: row.id } })).isManual, false);
    assert.equal(await db.translationContentRevision.count({ where: { translationId: row.id } }), 0);
    assert.equal((await db.usageRecord.aggregate({ where: { organizationId: organization.id }, _sum: { words: true } }))._sum.words, preview.quotaWords);
    const spend = await db.aiSpendReservation.findMany({ where: { projectId: project.id } });
    assert.equal(spend.length, 1, "AI suggestion must reserve before its provider attempt");
    assert.equal(spend[0].action, "AI_EDIT");
    assert.equal(spend[0].state, "SETTLED");
    const replay = await runWorkspaceAi({ ...input, fingerprint: preview.fingerprint,
      previewExpiresAt: new Date(preview.previewExpiresAt) });
    assert.deepEqual(replay, result);
    assert.equal((await db.usageRecord.aggregate({ where: { organizationId: organization.id }, _sum: { words: true } }))._sum.words, preview.quotaWords);
    await db.organizationMember.delete({ where: { id: membership.id } });
    await assert.rejects(runWorkspaceAi({ ...input, fingerprint: preview.fingerprint,
      previewExpiresAt: new Date(preview.previewExpiresAt) }),
      (error) => error instanceof TranslationWorkflowError && error.code === "FORBIDDEN");
  } finally {
    await db.organization.delete({ where: { id: organization.id } });
    await db.$disconnect();
    if (priorEnforcement === undefined) delete process.env.AI_BUDGET_ENFORCEMENT;
    else process.env.AI_BUDGET_ENFORCEMENT = priorEnforcement;
  }
});

test("delayed local provider receives one call for concurrent replay, with one quota charge", {
  skip: resolveDatabaseUrl() ? false : "requires isolated PostgreSQL",
}, async () => {
  let receive!: () => void;
  let release!: () => void;
  const received = new Promise<void>((resolve) => { receive = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const server = createServer(async (_request, response) => {
    calls += 1;
    receive();
    await gate;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      translations: [{ text: "Hi {name}" }],
    }) } }] }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const priorKey = process.env.TRANSLATION_API_KEY;
  const priorEnforcement = process.env.AI_BUDGET_ENFORCEMENT;
  process.env.TRANSLATION_API_KEY = "local-fixture-key";
  process.env.AI_BUDGET_ENFORCEMENT = "on";
  const { db } = await import("@/lib/db");
  const suffix = crypto.randomUUID();
  const organization = await db.organization.create({ data: { name: "AI replay", slug: `ai-replay-${suffix}` } });
  try {
    const user = await db.user.create({ data: { email: `ai-replay-${suffix}@example.test` } });
    await db.organizationMember.create({ data: { organizationId: organization.id, userId: user.id, role: "OWNER" } });
    const project = await db.project.create({ data: {
      organizationId: organization.id, name: "AI replay", domain: `ai-replay-${suffix}.test`,
      originalLang: "de", languages: { create: { langCode: "en" } },
      settings: { create: { translationProvider: "openai-compatible", translationModel: "local-test",
        translationBaseUrl: `http://127.0.0.1:${address.port}/v1` } },
    } });
    for (const projectId of [null, project.id]) await db.aiBudget.create({ data: {
      organizationId: organization.id, projectId, currency: "USD", capMicros: BigInt(1_000_000),
      perCallCapMicros: BigInt(1_000_000), warningPercent: 80, period: "MONTHLY_UTC",
      approvedByUserId: user.id, models: { create: [{ provider: "openai-compatible", model: "local-test",
        unit: "TOKEN", inputMicrosPerMillion: BigInt(100_000), outputMicrosPerMillion: BigInt(100_000),
        maxInputUnits: 100_000, maxOutputUnits: 100, outputCapVerified: true,
        priceExpiresAt: new Date(Date.now() + 86_400_000) }] },
    } });
    const row = await db.translation.create({ data: {
      projectId: project.id, originalHash: suffix, originalText: "Hallo {name}",
      translatedText: "Hello {name}", langFrom: "de", langTo: "en", source: "MOCK",
      typeObservations: { create: { wordType: 1 } },
    } });
    const input = { projectId: project.id, userId: user.id, translationId: row.id,
      expectedUpdatedAt: row.updatedAt, action: "shorten" as const };
    const preview = await previewWorkspaceAi(input);
    const runInput = { ...input, fingerprint: preview.fingerprint,
      previewExpiresAt: new Date(preview.previewExpiresAt) };
    const first = runWorkspaceAi(runInput);
    await received;
    const spendAtHttp = await db.aiSpendReservation.findMany({ where: { projectId: project.id } });
    assert.equal(spendAtHttp.length, 1, "reservation must be durable before HTTP reaches the mock");
    assert.equal(spendAtHttp[0].state, "DISPATCHED");
    assert.equal(spendAtHttp[0].action, "AI_EDIT");
    const receipt = await db.apiIdempotencyRecord.findFirstOrThrow({ where: {
      scope: `workspace-ai:${project.id}:${row.id}:${user.id}`,
    } });
    assert.equal(receipt.status, "DISPATCHED");
    // Simulate a process crash after the HTTP request and a stale lease/retention clock.
    await db.apiIdempotencyRecord.update({ where: { id: receipt.id }, data: {
      leaseExpiresAt: new Date(Date.now() - 1_000), expiresAt: new Date(Date.now() - 1_000),
    } });
    await assert.rejects(runWorkspaceAi(runInput),
      (error) => error instanceof TranslationWorkflowError && error.code === "STALE_UPDATE");
    release();
    const result = await first;
    assert.equal(result.suggestion, "Hi {name}");
    assert.equal((await runWorkspaceAi(runInput)).suggestion, "Hi {name}");
    assert.equal(calls, 1);
    assert.equal((await db.aiSpendReservation.findUniqueOrThrow({ where: { id: spendAtHttp[0].id } })).state,
      "UNKNOWN", "missing provider usage must retain the full reservation");
    assert.equal((await db.usageRecord.aggregate({ where: { organizationId: organization.id },
      _sum: { words: true } }))._sum.words, preview.quotaWords);
    assert.equal((await db.translation.findUniqueOrThrow({ where: { id: row.id } })).translatedText, "Hello {name}");
  } finally {
    release();
    await db.organization.delete({ where: { id: organization.id } });
    await db.$disconnect();
    server.close();
    if (priorKey === undefined) delete process.env.TRANSLATION_API_KEY;
    else process.env.TRANSLATION_API_KEY = priorKey;
    if (priorEnforcement === undefined) delete process.env.AI_BUDGET_ENFORCEMENT;
    else process.env.AI_BUDGET_ENFORCEMENT = priorEnforcement;
  }
});

test("two projects in one organization cannot overspend the shared monthly quota", {
  skip: resolveDatabaseUrl() ? false : "requires isolated PostgreSQL",
}, async () => {
  const priorEnforcement = process.env.AI_BUDGET_ENFORCEMENT;
  process.env.AI_BUDGET_ENFORCEMENT = "on";
  const { db } = await import("@/lib/db");
  const suffix = crypto.randomUUID();
  const organization = await db.organization.create({ data: { name: "AI shared quota", slug: `ai-quota-${suffix}` } });
  try {
    const user = await db.user.create({ data: { email: `ai-quota-${suffix}@example.test` } });
    await db.organizationMember.create({ data: { organizationId: organization.id, userId: user.id, role: "OWNER" } });
    await approveFixtureBudget(db, organization.id, null, user.id, "mock", "mock");
    await db.subscription.create({ data: { organizationId: organization.id,
      stripeCustomerId: `local-synthetic-${suffix}`, status: "ACTIVE", wordsLimit: 3 } });
    const inputs = [];
    for (const index of [1, 2]) {
      const project: { id: string } = await db.project.create({ data: { organizationId: organization.id,
        name: `AI ${index}`, domain: `ai-quota-${index}-${suffix}.test`, originalLang: "de",
        languages: { create: { langCode: "en" } }, settings: { create: { translationProvider: "mock" } },
      } });
      await approveFixtureBudget(db, organization.id, project.id, user.id, "mock", "mock");
      const row = await db.translation.create({ data: { projectId: project.id,
        originalHash: `ai-quota-${index}-${suffix}`, originalText: "Hallo {name}",
        translatedText: "Hello {name}", langFrom: "de", langTo: "en", source: "MOCK",
        typeObservations: { create: { wordType: 1 } },
      } });
      const base = { projectId: project.id, userId: user.id, translationId: row.id,
        expectedUpdatedAt: row.updatedAt, action: "improve" as const };
      const preview = await previewWorkspaceAi(base);
      assert.equal(preview.canRun, true);
      inputs.push({ ...base, fingerprint: preview.fingerprint,
        previewExpiresAt: new Date(preview.previewExpiresAt) });
    }
    const outcomes = await Promise.allSettled(inputs.map((input) => runWorkspaceAi(input)));
    assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((result) => result.status === "rejected").length, 1);
    assert.equal((await db.usageRecord.aggregate({ where: { organizationId: organization.id },
      _sum: { words: true } }))._sum.words, 2);
    const bucket = await db.rateLimitBucket.findUniqueOrThrow({ where: { scope_subjectHash: {
      scope: TRANSLATE_WORD_VELOCITY_SCOPE,
      subjectHash: hashRateLimitSubject(TRANSLATE_WORD_VELOCITY_SCOPE, organization.id),
    } } });
    assert.equal(bucket.count, 2);
  } finally {
    await db.organization.delete({ where: { id: organization.id } });
    await db.$disconnect();
    if (priorEnforcement === undefined) delete process.env.AI_BUDGET_ENFORCEMENT;
    else process.env.AI_BUDGET_ENFORCEMENT = priorEnforcement;
  }
});

test("revocation, provider change and glossary change during HTTP dispatch invalidate a paid draft", {
  skip: resolveDatabaseUrl() ? false : "requires isolated PostgreSQL",
}, async () => {
  let received!: () => void;
  let release!: () => void;
  let arrival = new Promise<void>((resolve) => { received = resolve; });
  let gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const server = createServer(async (_request, response) => {
    calls += 1;
    received();
    await gate;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      translations: [{ text: "Hi {name}" }],
    }) } }] }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const priorKey = process.env.TRANSLATION_API_KEY;
  const priorEnforcement = process.env.AI_BUDGET_ENFORCEMENT;
  process.env.TRANSLATION_API_KEY = "local-fixture-key";
  process.env.AI_BUDGET_ENFORCEMENT = "on";
  const { db } = await import("@/lib/db");
  const suffix = crypto.randomUUID();
  const organization = await db.organization.create({ data: { name: "AI races", slug: `ai-races-${suffix}` } });
  try {
    const user = await db.user.create({ data: { email: `ai-races-${suffix}@example.test` } });
    await approveFixtureBudget(db, organization.id, null, user.id, "openai-compatible", "local-test");
    for (const scenario of ["revocation", "settings", "glossary"] as const) {
      const membership = await db.organizationMember.create({ data: { organizationId: organization.id,
        userId: user.id, role: "OWNER" } });
      const project: { id: string } = await db.project.create({ data: { organizationId: organization.id,
        name: `AI ${scenario}`, domain: `ai-${scenario}-${suffix}.test`, originalLang: "de",
        languages: { create: { langCode: "en" } }, settings: { create: {
          translationProvider: "openai-compatible", translationModel: "local-test",
          translationBaseUrl: `http://127.0.0.1:${address.port}/v1`,
        } },
      } });
      await approveFixtureBudget(db, organization.id, project.id, user.id,
        "openai-compatible", "local-test");
      const row = await db.translation.create({ data: { projectId: project.id,
        originalHash: `ai-${scenario}-${suffix}`, originalText: "Hallo {name}",
        translatedText: "Hello {name}", langFrom: "de", langTo: "en", source: "MOCK",
        typeObservations: { create: { wordType: 1 } },
      } });
      const base = { projectId: project.id, userId: user.id, translationId: row.id,
        expectedUpdatedAt: row.updatedAt, action: "shorten" as const };
      const preview = await previewWorkspaceAi(base);
      const runInput = { ...base, fingerprint: preview.fingerprint,
        previewExpiresAt: new Date(preview.previewExpiresAt) };
      const run = runWorkspaceAi(runInput);
      await arrival;
      if (scenario === "revocation") await db.organizationMember.delete({ where: { id: membership.id } });
      if (scenario === "settings") await db.projectSettings.update({ where: { projectId: project.id },
        data: { translationModel: "changed-during-call" } });
      if (scenario === "glossary") await db.glossaryRule.create({ data: { projectId: project.id,
        langFrom: "de", langTo: "en", originalTerm: "Hallo", translatedTerm: "Hello" } });
      release();
      await assert.rejects(run, (error) => error instanceof TranslationWorkflowError);
      assert.equal((await db.apiIdempotencyRecord.findFirstOrThrow({ where: {
        scope: `workspace-ai:${project.id}:${row.id}:${user.id}`,
      } })).responseStatus, 503);
      assert.equal((await db.translation.findUniqueOrThrow({ where: { id: row.id } })).translatedText, "Hello {name}");
      assert.equal(await db.translationContentRevision.count({ where: { translationId: row.id } }), 0);
      if (scenario !== "revocation") await db.organizationMember.delete({ where: { id: membership.id } });
      arrival = new Promise<void>((resolve) => { received = resolve; });
      gate = new Promise<void>((resolve) => { release = resolve; });
    }
    assert.equal(calls, 3);
    assert.equal((await db.usageRecord.aggregate({ where: { organizationId: organization.id },
      _sum: { words: true } }))._sum.words, 6);
  } finally {
    release();
    await db.organization.delete({ where: { id: organization.id } });
    await db.$disconnect();
    server.close();
    if (priorKey === undefined) delete process.env.TRANSLATION_API_KEY;
    else process.env.TRANSLATION_API_KEY = priorKey;
    if (priorEnforcement === undefined) delete process.env.AI_BUDGET_ENFORCEMENT;
    else process.env.AI_BUDGET_ENFORCEMENT = priorEnforcement;
  }
});
