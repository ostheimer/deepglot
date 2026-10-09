import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { db } from "@/lib/db";
import { dispatchOptionalNotification, NotificationNotAcceptedError } from "@/lib/notification-delivery";

test.after(async () => { await db.$disconnect(); });

test("optional notification claims are isolated, retryable before acceptance, and revocation-safe", async () => {
  const suffix = randomUUID();
  const user = await db.user.create({ data: { email: `issue268-${suffix}@example.invalid` } });
  const org = await db.organization.create({ data: { name: "Fixture Workspace", slug: `issue268-${suffix}` } });
  const otherOrg = await db.organization.create({ data: { name: "Other Fixture", slug: `issue268-other-${suffix}` } });
  try {
    await db.organizationMember.create({ data: { userId: user.id, organizationId: org.id, role: "OWNER" } });
    const periodStart = new Date("2026-10-01T00:00:00.000Z");
    const base = { userId: user.id, organizationId: org.id, category: "PRODUCT_UPDATE" as const, frequency: "MONTHLY" as const, periodStart };
    let sends = 0;
    assert.equal(await dispatchOptionalNotification({ ...base, send: async () => { sends++; } }), "ineligible");
    assert.equal(sends, 0);

    const preference = await db.notificationPreference.upsert({
      where: { userId_organizationId_category: { userId: user.id, organizationId: org.id, category: "PRODUCT_UPDATE" } },
      create: { userId: user.id, organizationId: org.id, category: "PRODUCT_UPDATE", frequency: "MONTHLY", locale: "de" },
      update: { frequency: "MONTHLY" },
    });
    assert.equal(preference.locale, "de");
    assert.equal(await db.notificationPreference.count({ where: { userId: user.id, organizationId: otherOrg.id } }), 0);
    const foreignProject = await db.project.create({ data: { name: "Foreign", domain: `foreign-${suffix}.invalid`, organizationId: otherOrg.id } });
    await db.notificationPreference.create({ data: { userId: user.id, organizationId: org.id, category: "PROJECT_ACTIVITY", frequency: "WEEKLY" } });
    const projectBase = { userId: user.id, organizationId: org.id, category: "PROJECT_ACTIVITY" as const, frequency: "WEEKLY" as const, periodStart: new Date("2026-10-05T00:00:00Z") };
    assert.equal(await dispatchOptionalNotification({ ...projectBase, projectIds: [foreignProject.id], send: async () => { sends++; } }), "ineligible");
    assert.equal(await dispatchOptionalNotification({ ...projectBase, send: async () => { sends++; } }), "ineligible");
    assert.equal(sends, 0);
    const ownProject = await db.project.create({ data: { name: "Own", domain: `own-${suffix}.invalid`, organizationId: org.id } });
    assert.equal(await dispatchOptionalNotification({ ...projectBase, projectIds: [ownProject.id, foreignProject.id], send: async () => { sends++; } }), "ineligible");
    assert.equal(await dispatchOptionalNotification({ ...base, send: async () => { throw new NotificationNotAcceptedError("provider rejected before acceptance"); } }), "notAccepted");
    assert.equal(await db.notificationDelivery.count({ where: { userId: user.id, organizationId: org.id } }), 0);

    const unknownPeriod = new Date("2026-09-01T00:00:00Z");
    assert.equal(await dispatchOptionalNotification({ ...base, periodStart: unknownPeriod, send: async () => { throw new Error("timeout after possible acceptance"); } }), "unknown");
    assert.equal(await dispatchOptionalNotification({ ...base, periodStart: unknownPeriod, send: async () => { sends++; } }), "duplicate");
    assert.equal(sends, 0);

    const outcomes = await Promise.all(Array.from({ length: 5 }, () => dispatchOptionalNotification({
      ...base, send: async () => { sends++; await new Promise((resolve) => setTimeout(resolve, 30)); },
    })));
    assert.equal(outcomes.filter((outcome) => outcome === "sent").length, 1);
    assert.equal(outcomes.filter((outcome) => outcome === "duplicate").length, 4);
    assert.equal(sends, 1);
    assert.equal(await dispatchOptionalNotification({ ...base, send: async () => { sends++; } }), "duplicate");

    await db.notificationPreference.update({ where: { id: preference.id }, data: { frequency: "OFF" } });
    assert.equal(await dispatchOptionalNotification({ ...base, periodStart: new Date("2026-11-01T00:00:00Z"), send: async () => { sends++; } }), "ineligible");
    assert.equal(sends, 1);

    await db.notificationPreference.create({ data: { userId: user.id, organizationId: org.id, category: "BILLING_SUMMARY", frequency: "MONTHLY" } });
    await db.organizationMember.update({ where: { userId_organizationId: { userId: user.id, organizationId: org.id } }, data: { role: "MEMBER" } });
    assert.equal(await dispatchOptionalNotification({ ...base, category: "BILLING_SUMMARY", periodStart: new Date("2026-11-01T00:00:00Z"), send: async () => { sends++; } }), "ineligible");

    await db.organizationMember.delete({ where: { userId_organizationId: { userId: user.id, organizationId: org.id } } });
    assert.equal(await db.notificationPreference.count({ where: { userId: user.id, organizationId: org.id } }), 0);
    assert.equal(await db.notificationDelivery.count({ where: { userId: user.id, organizationId: org.id } }), 0);
    assert.equal(await dispatchOptionalNotification({ ...base, periodStart: new Date("2026-12-01T00:00:00Z"), send: async () => { sends++; } }), "ineligible");
    assert.equal(sends, 1);
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [org.id, otherOrg.id] } } });
    await db.user.delete({ where: { id: user.id } });
  }
});
