import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { NextRequest } from "next/server";
import { generateApiKey } from "@/lib/api-keys";
import { resolveDatabaseUrl } from "@/lib/database-url";
import { db } from "@/lib/db";
import { hashRateLimitSubject, TRANSLATE_WORD_VELOCITY_SCOPE } from "@/lib/rate-limit";

test("automatic context translation preflights the full configured fallback before first HTTP", {
  skip: resolveDatabaseUrl() ? false : "requires isolated PostgreSQL",
}, async () => {
  const original = { enforcement: process.env.AI_BUDGET_ENFORCEMENT,
    fallbacks: process.env.TRANSLATION_FALLBACK_PROVIDERS,
    apiKey: process.env.TRANSLATION_API_KEY };
  process.env.AI_BUDGET_ENFORCEMENT = "on";
  process.env.TRANSLATION_FALLBACK_PROVIDERS = "mock";
  process.env.TRANSLATION_API_KEY = "synthetic-fixture-only";
  const suffix = crypto.randomUUID();
  const owner = await db.user.create({ data: { email: `whole-action-${suffix}@example.invalid` } });
  const org = await db.organization.create({ data: { name: "Whole action", slug: `whole-${suffix}`,
    members: { create: { userId: owner.id, role: "OWNER" } } } });
  const project = await db.project.create({ data: { organizationId: org.id,
    name: "Whole action", domain: `whole-${suffix}.invalid`, originalLang: "de",
    languages: { create: { langCode: "en" } },
    settings: { create: { translationProvider: "openai-compatible", translationModel: "fixture",
      translationBaseUrl: "http://127.0.0.1:1/v1", websiteDescription: "Fixture context" } } } });
  const { rawKey } = await generateApiKey({ projectId: project.id, name: "Fixture" });
  for (const projectId of [null, project.id]) await db.aiBudget.create({ data: {
    organizationId: org.id, projectId, currency: "USD", capMicros: BigInt(1_000_000),
    perCallCapMicros: BigInt(1_000_000), warningPercent: 80, period: "MONTHLY_UTC",
    approvedByUserId: owner.id,
    models: { create: { provider: "openai-compatible", model: "fixture", unit: "TOKEN",
      inputMicrosPerMillion: BigInt(0), outputMicrosPerMillion: BigInt(0),
      maxInputUnits: 100_000, maxOutputUnits: 100, outputCapVerified: true,
      priceExpiresAt: new Date(Date.now() + 86_400_000) } },
  } });
  let providerCalls = 0;
  const fetchMock = mock.method(globalThis, "fetch", async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content:
      JSON.stringify({ translations: [{ text: "Hello fixture" }] }) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    { headers: { "Content-Type": "application/json" } });
  });
  try {
    const { POST } = await import("@/app/api/translate/route");
    const request = (text: string) => POST(new NextRequest("https://deepglot.test/api/translate", {
      method: "POST", headers: { authorization: `Bearer ${rawKey}`,
        "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ l_from: "de", l_to: "en", words: [{ t: 1, w: text }] }),
    }));
    const denied = await request("Noch nicht übersetzt");
    assert.equal(denied.status, 409);
    assert.equal((await denied.json()).code, "model_not_approved");
    assert.equal(providerCalls, 0);
    assert.equal(await db.aiSpendReservation.count({ where: { organizationId: org.id } }), 0);
    assert.equal(await db.usageRecord.count({ where: { organizationId: org.id } }), 0);
    const velocity = await db.rateLimitBucket.findUnique({ where: { scope_subjectHash: {
      scope: TRANSLATE_WORD_VELOCITY_SCOPE,
      subjectHash: hashRateLimitSubject(TRANSLATE_WORD_VELOCITY_SCOPE, org.id),
    } } });
    assert.equal(velocity?.count ?? 0, 0);
    for (const budget of await db.aiBudget.findMany({ where: { organizationId: org.id } }))
      await db.aiBudgetModel.create({ data: { budgetId: budget.id, provider: "mock", model: "mock",
        unit: "ZERO_COST", inputMicrosPerMillion: BigInt(0), outputMicrosPerMillion: BigInt(0),
        maxInputUnits: 100_000, maxOutputUnits: 100,
        priceExpiresAt: new Date(Date.now() + 86_400_000) } });
    const accepted = await request("Frischer Kontexttext");
    assert.equal(accepted.status, 200);
    assert.equal(providerCalls, 1);
    const spend = await db.aiSpendReservation.findMany({ where: { organizationId: org.id } });
    assert.equal(spend.length, 1);
    assert.equal(spend[0].action, "CONTEXT_TRANSLATION");
    assert.equal(spend[0].state, "SETTLED");
    const bucketBeforeRace = await db.rateLimitBucket.findUniqueOrThrow({ where: { scope_subjectHash: {
      scope: TRANSLATE_WORD_VELOCITY_SCOPE,
      subjectHash: hashRateLimitSubject(TRANSLATE_WORD_VELOCITY_SCOPE, org.id),
    } } });
    const key = await db.apiKey.findFirstOrThrow({ where: { projectId: project.id } });
    const database = db as unknown as { $transaction: (...args: unknown[]) => Promise<unknown> };
    const originalTransaction = database.$transaction.bind(db);
    let revokedAtQuote = false;
    database.$transaction = async (...args: unknown[]) => {
      const result = await originalTransaction(...args);
      if (!revokedAtQuote && result && typeof result === "object" && "attempts" in result) {
        revokedAtQuote = true;
        await db.apiKey.update({ where: { id: key.id }, data: { isActive: false } });
      }
      return result;
    };
    try {
      const revoked = await request("Neuer Text nach Schlüsselwiderruf");
      assert.equal(revoked.status, 409);
      assert.equal((await revoked.json()).code, "actor_revoked");
      assert.equal(providerCalls, 1);
      assert.equal(await db.aiSpendReservation.count({ where: { organizationId: org.id } }), 1);
      const bucketAfterRace = await db.rateLimitBucket.findUniqueOrThrow({ where: { scope_subjectHash: {
        scope: TRANSLATE_WORD_VELOCITY_SCOPE,
        subjectHash: hashRateLimitSubject(TRANSLATE_WORD_VELOCITY_SCOPE, org.id),
      } } });
      assert.equal(bucketAfterRace.count, bucketBeforeRace.count);
    } finally { database.$transaction = originalTransaction; }
  } finally {
    fetchMock.mock.restore();
    await db.rateLimitBucket.deleteMany({ where: { scope: TRANSLATE_WORD_VELOCITY_SCOPE,
      subjectHash: hashRateLimitSubject(TRANSLATE_WORD_VELOCITY_SCOPE, org.id) } });
    await db.organization.delete({ where: { id: org.id } });
    await db.user.delete({ where: { id: owner.id } });
    for (const [key, value] of [["AI_BUDGET_ENFORCEMENT", original.enforcement],
      ["TRANSLATION_FALLBACK_PROVIDERS", original.fallbacks],
      ["TRANSLATION_API_KEY", original.apiKey]] as const)
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
