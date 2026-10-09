import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

const testUrl = process.env.DEEPGLOT_ORDER_TEST_DATABASE_URL;
const allowed = testUrl?.startsWith("postgresql://andreas@127.0.0.1:55472/postgres");
after(async () => { if (allowed) await (await import("../../src/lib/db")).db.$disconnect(); });

test("local professional order lifecycle retains a draft until explicit adoption", { skip: !allowed }, async () => {
  process.env.DEEPGLOT_DATABASE_URL = testUrl;
  for (const key of ["PROFESSIONAL_ORDERS_ENABLED", "PROFESSIONAL_ORDERS_LEGAL_ACCEPTED", "PROFESSIONAL_ORDERS_PRIVACY_ACCEPTED", "PROFESSIONAL_ORDERS_BILLING_ACCEPTED", "PROFESSIONAL_ORDERS_PRODUCTION_ACCEPTED"]) process.env[key] = "true";
  const { db } = await import("../../src/lib/db");
  const { hashVendorToken } = await import("../../src/lib/professional-orders");
  const { createProfessionalOrder, issueVendorGrant, vendorQuote, acceptProfessionalQuote, recordProfessionalPayment, deliverProfessionalOrder, adoptProfessionalDelivery } = await import("../../src/lib/professional-order-service");
  const suffix = randomUUID();
  const user = await db.user.create({ data: { email: `${suffix}@example.invalid` } });
  const organization = await db.organization.create({ data: { name: "Order fixture", slug: suffix, members: { create: { userId: user.id, role: "OWNER" } } } });
  const project = await db.project.create({ data: { name: "Order fixture", domain: `${suffix}.example.invalid`, originalLang: "en", organizationId: organization.id, languages: { create: { langCode: "de" } } } });
  const translation = await db.translation.create({ data: { projectId: project.id, originalHash: `fixture-${suffix}`, originalText: "Hello world", translatedText: "Hallo Welt", langFrom: "en", langTo: "de", source: "MOCK" } });
  const order = await createProfessionalOrder({ projectId: project.id, requesterId: user.id, targetLanguage: "de", translationIds: [translation.id] });
  assert.equal(order.status, "QUOTE_REQUESTED");
  await assert.rejects(() => db.professionalTranslationOrder.update({ where: { id: order.id }, data: { wordCount: 999 } }));
  const grant = await issueVendorGrant({ orderId: order.id, projectId: project.id, actorId: user.id });
  const competingGrant = await issueVendorGrant({ orderId: order.id, projectId: project.id, actorId: user.id });
  const savedGrant = await db.professionalTranslationVendorGrant.findUniqueOrThrow({ where: { tokenHash: hashVendorToken(grant.token) } });
  const { NextRequest } = await import("next/server");
  const { GET: vendorGet } = await import("../../src/app/api/professional-orders/vendor/route");
  const vendorView = await vendorGet(new NextRequest("http://localhost/api/professional-orders/vendor", { headers: { authorization: `Bearer ${grant.token}` } }));
  assert.equal(vendorView.status, 200);
  const scoped = await vendorView.json();
  assert.equal(scoped.order.items.length, 1);
  assert.equal(JSON.stringify(scoped).includes(project.domain), false);
  assert.equal(JSON.stringify(scoped).includes(user.email), false);
  await vendorQuote({ orderId: order.id, vendorGrantId: savedGrant.id, amountMinor: 1200, currency: "EUR", turnaroundDays: 3, expiresAt: new Date(Date.now() + 86_400_000), reference: `quote-${suffix}`, termsVersion: "fixture-v1" });
  assert.equal((await vendorGet(new NextRequest("http://localhost/api/professional-orders/vendor", { headers: { authorization: `Bearer ${competingGrant.token}` } }))).status, 404);
  await acceptProfessionalQuote({ orderId: order.id, projectId: project.id, actorId: user.id, expectedScopeDigest: order.scopeDigest, expectedQuoteReference: `quote-${suffix}` });
  await assert.rejects(() => recordProfessionalPayment({ orderId: order.id, provider: "local_fixture", reference: `wrong-${suffix}`, amountMinor: 1, currency: "EUR", paid: true }));
  await recordProfessionalPayment({ orderId: order.id, provider: "local_fixture", reference: `payment-${suffix}`, amountMinor: 1200, currency: "EUR", paid: true });
  const item = await db.professionalTranslationOrderItem.findFirstOrThrow({ where: { orderId: order.id } });
  await assert.rejects(() => db.professionalTranslationOrderItem.update({ where: { id: item.id }, data: { originalText: "tampered" } }));
  await deliverProfessionalOrder({ orderId: order.id, vendorGrantId: savedGrant.id, items: [{ itemId: item.id, proposedText: "Guten Tag, Welt" }] });
  assert.equal((await db.translation.findUniqueOrThrow({ where: { id: translation.id } })).translatedText, "Hallo Welt");
  assert.equal((await db.professionalTranslationOrderItem.findUniqueOrThrow({ where: { id: item.id } })).proposedText, "Guten Tag, Welt");
  await adoptProfessionalDelivery({ orderId: order.id, projectId: project.id, itemId: item.id, actorId: user.id, expectedUpdatedAt: translation.updatedAt });
  const adopted = await db.translation.findUniqueOrThrow({ where: { id: translation.id } });
  assert.equal(adopted.translatedText, "Guten Tag, Welt");
  assert.equal(adopted.workflowStatus, "APPROVED");
  assert.equal((await db.professionalTranslationOrderItem.findUniqueOrThrow({ where: { id: item.id } })).adoptedById, user.id);
  await db.$disconnect();
});

test("manager write is denied after the API gate when membership is revoked", { skip: !allowed }, async () => {
  process.env.DEEPGLOT_DATABASE_URL = testUrl;
  for (const key of ["PROFESSIONAL_ORDERS_ENABLED", "PROFESSIONAL_ORDERS_LEGAL_ACCEPTED", "PROFESSIONAL_ORDERS_PRIVACY_ACCEPTED", "PROFESSIONAL_ORDERS_BILLING_ACCEPTED", "PROFESSIONAL_ORDERS_PRODUCTION_ACCEPTED"]) process.env[key] = "true";
  const { db } = await import("../../src/lib/db");
  const { userCanManageProject } = await import("../../src/lib/project-access");
  const { createProfessionalOrder } = await import("../../src/lib/professional-order-service");
  const suffix = randomUUID();
  const user = await db.user.create({ data: { email: `${suffix}@example.invalid` } });
  const organization = await db.organization.create({ data: { name: "Revocation fixture", slug: suffix, members: { create: { userId: user.id, role: "OWNER" } } } });
  const project = await db.project.create({ data: { name: "Revocation fixture", domain: `${suffix}.example.invalid`, originalLang: "en", organizationId: organization.id, languages: { create: { langCode: "de" } } } });
  const translation = await db.translation.create({ data: { projectId: project.id, originalHash: `fixture-${suffix}`, originalText: "Hello world", translatedText: "Hallo Welt", langFrom: "en", langTo: "de", source: "MOCK" } });
  assert.equal(await userCanManageProject(user.id, project.id), true); // API gate passed.
  await db.organizationMember.delete({ where: { userId_organizationId: { userId: user.id, organizationId: organization.id } } });
  await assert.rejects(() => createProfessionalOrder({ projectId: project.id, requesterId: user.id, targetLanguage: "de", translationIds: [translation.id] }));
  assert.equal(await db.professionalTranslationOrder.count({ where: { projectId: project.id } }), 0);
  await db.$disconnect();
});

test("vendor access, quote acceptance, cancellation and adoption recheck manager scope", { skip: !allowed }, async () => {
  process.env.DEEPGLOT_DATABASE_URL = testUrl;
  for (const key of ["PROFESSIONAL_ORDERS_ENABLED", "PROFESSIONAL_ORDERS_LEGAL_ACCEPTED", "PROFESSIONAL_ORDERS_PRIVACY_ACCEPTED", "PROFESSIONAL_ORDERS_BILLING_ACCEPTED", "PROFESSIONAL_ORDERS_PRODUCTION_ACCEPTED"]) process.env[key] = "true";
  const { db } = await import("../../src/lib/db");
  const { hashVendorToken } = await import("../../src/lib/professional-orders");
  const { userCanManageProject } = await import("../../src/lib/project-access");
  const { createProfessionalOrder, issueVendorGrant, vendorQuote, acceptProfessionalQuote, recordProfessionalPayment, deliverProfessionalOrder, adoptProfessionalDelivery, cancelProfessionalOrder } = await import("../../src/lib/professional-order-service");
  const suffix = randomUUID();
  const user = await db.user.create({ data: { email: `${suffix}@example.invalid` } });
  const organization = await db.organization.create({ data: { name: "Lifecycle revocation", slug: suffix, members: { create: { userId: user.id, role: "OWNER" } } } });
  const project = await db.project.create({ data: { name: "Lifecycle revocation", domain: `${suffix}.example.invalid`, originalLang: "en", organizationId: organization.id, languages: { create: { langCode: "de" } } } });
  const translation = await db.translation.create({ data: { projectId: project.id, originalHash: `fixture-${suffix}`, originalText: "Hello world", translatedText: "Hallo Welt", langFrom: "en", langTo: "de", source: "MOCK" } });
  const order = await createProfessionalOrder({ projectId: project.id, requesterId: user.id, targetLanguage: "de", translationIds: [translation.id] });
  const revoke = () => db.organizationMember.delete({ where: { userId_organizationId: { userId: user.id, organizationId: organization.id } } });
  const restore = () => db.organizationMember.create({ data: { userId: user.id, organizationId: organization.id, role: "OWNER" } });

  assert.equal(await userCanManageProject(user.id, project.id), true);
  await db.projectLanguage.update({ where: { projectId_langCode: { projectId: project.id, langCode: "de" } }, data: { isActive: false } });
  await assert.rejects(() => issueVendorGrant({ orderId: order.id, projectId: project.id, actorId: user.id }));
  await db.projectLanguage.update({ where: { projectId_langCode: { projectId: project.id, langCode: "de" } }, data: { isActive: true } });
  await revoke();
  await assert.rejects(() => issueVendorGrant({ orderId: order.id, projectId: project.id, actorId: user.id }));
  assert.equal(await db.professionalTranslationVendorGrant.count({ where: { orderId: order.id } }), 0);

  await restore();
  const grant = await issueVendorGrant({ orderId: order.id, projectId: project.id, actorId: user.id });
  const savedGrant = await db.professionalTranslationVendorGrant.findUniqueOrThrow({ where: { tokenHash: hashVendorToken(grant.token) } });
  await vendorQuote({ orderId: order.id, vendorGrantId: savedGrant.id, amountMinor: 1200, currency: "EUR", turnaroundDays: 3, expiresAt: new Date(Date.now() + 86_400_000), reference: `quote-${suffix}`, termsVersion: "fixture-v1" });
  assert.equal(await userCanManageProject(user.id, project.id), true);
  await revoke();
  await assert.rejects(() => acceptProfessionalQuote({ orderId: order.id, projectId: project.id, actorId: user.id, expectedScopeDigest: order.scopeDigest, expectedQuoteReference: `quote-${suffix}` }));
  assert.equal((await db.professionalTranslationOrder.findUniqueOrThrow({ where: { id: order.id } })).status, "QUOTED");

  await restore();
  await acceptProfessionalQuote({ orderId: order.id, projectId: project.id, actorId: user.id, expectedScopeDigest: order.scopeDigest, expectedQuoteReference: `quote-${suffix}` });
  await recordProfessionalPayment({ orderId: order.id, provider: "local_fixture", reference: `payment-${suffix}`, amountMinor: 1200, currency: "EUR", paid: true });
  const item = await db.professionalTranslationOrderItem.findFirstOrThrow({ where: { orderId: order.id } });
  await deliverProfessionalOrder({ orderId: order.id, vendorGrantId: savedGrant.id, items: [{ itemId: item.id, proposedText: "Guten Tag, Welt" }] });
  assert.equal(await userCanManageProject(user.id, project.id), true);
  await revoke();
  await assert.rejects(() => adoptProfessionalDelivery({ orderId: order.id, projectId: project.id, itemId: item.id, actorId: user.id, expectedUpdatedAt: translation.updatedAt }));
  await assert.rejects(() => cancelProfessionalOrder({ orderId: order.id, projectId: project.id, actorId: user.id }));
  assert.equal((await db.translation.findUniqueOrThrow({ where: { id: translation.id } })).translatedText, "Hallo Welt");
  assert.equal((await db.professionalTranslationOrder.findUniqueOrThrow({ where: { id: order.id } })).status, "DELIVERED");
});

test("a project transfer invalidates the previous workspace manager scope", { skip: !allowed }, async () => {
  process.env.DEEPGLOT_DATABASE_URL = testUrl;
  for (const key of ["PROFESSIONAL_ORDERS_ENABLED", "PROFESSIONAL_ORDERS_LEGAL_ACCEPTED", "PROFESSIONAL_ORDERS_PRIVACY_ACCEPTED", "PROFESSIONAL_ORDERS_BILLING_ACCEPTED", "PROFESSIONAL_ORDERS_PRODUCTION_ACCEPTED"]) process.env[key] = "true";
  const { db } = await import("../../src/lib/db");
  const { userCanManageProject } = await import("../../src/lib/project-access");
  const { createProfessionalOrder, issueVendorGrant } = await import("../../src/lib/professional-order-service");
  const suffix = randomUUID();
  const user = await db.user.create({ data: { email: `${suffix}@example.invalid` } });
  const source = await db.organization.create({ data: { name: "Source workspace", slug: `${suffix}-a`, members: { create: { userId: user.id, role: "OWNER" } } } });
  const target = await db.organization.create({ data: { name: "Target workspace", slug: `${suffix}-b` } });
  const project = await db.project.create({ data: { name: "Transfer fixture", domain: `${suffix}.example.invalid`, originalLang: "en", organizationId: source.id, languages: { create: { langCode: "de" } } } });
  const translation = await db.translation.create({ data: { projectId: project.id, originalHash: `fixture-${suffix}`, originalText: "Hello world", translatedText: "Hallo Welt", langFrom: "en", langTo: "de", source: "MOCK" } });
  const order = await createProfessionalOrder({ projectId: project.id, requesterId: user.id, targetLanguage: "de", translationIds: [translation.id] });
  assert.equal(await userCanManageProject(user.id, project.id), true);
  await assert.rejects(() => db.project.update({ where: { id: project.id }, data: { organizationId: target.id } }));
  assert.equal((await db.project.findUniqueOrThrow({ where: { id: project.id } })).organizationId, source.id);
  await db.organizationMember.delete({ where: { userId_organizationId: { userId: user.id, organizationId: source.id } } });
  await assert.rejects(() => issueVendorGrant({ orderId: order.id, projectId: project.id, actorId: user.id }));
  assert.equal(await db.professionalTranslationVendorGrant.count({ where: { orderId: order.id } }), 0);
});
