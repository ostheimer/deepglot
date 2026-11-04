import { expect, test } from "@playwright/test";
import { db } from "@/lib/db";
import { changeWorkspaceMember } from "@/lib/workspace-members";
import { signInAsTestUser } from "./helpers";

test("production mutation writers record tenant, actor, action and bounded context", async ({ page }) => {
  await signInAsTestUser(page);
  const owner = await db.organizationMember.findFirstOrThrow({ where: { user: { email: "preview@deepglot.local" } },
    select: { userId: true, organizationId: true } });
  const token = crypto.randomUUID();
  const project = await db.project.create({ data: { organizationId: owner.organizationId,
    name: "Audit writer fixture", domain: `audit-writers-${token}.example.test`, originalLang: "de",
    languages: { create: [{ langCode: "en" }] } } });
  const target = await db.user.create({ data: { email: `audit-member-${token}@example.test` } });
  const billingWorkspace = await db.organization.create({ data: { name: "Audit billing fixture",
    slug: `audit-billing-${token}` } });
  try {
    await db.organizationMember.create({ data: { organizationId: owner.organizationId, userId: target.id, role: "MEMBER" } });
    await changeWorkspaceMember({ actorUserId: owner.userId, workspaceId: owner.organizationId,
      targetUserId: target.id, action: "ROLE", role: "ADMIN" });
    const memberEvent = await db.auditEvent.findFirstOrThrow({ where: { organizationId: owner.organizationId,
      actorUserId: owner.userId, action: "workspace.member_role", metadata: { path: ["affectedId"], equals: target.id } } });
    expect(memberEvent.projectId).toBeNull();
    expect(memberEvent.metadata).toMatchObject({ role: "ADMIN" });

    const keyResponse = await page.request.post(`/api/projects/${project.id}/api-keys`, { data: { name: "Audit fixture key" } });
    expect(keyResponse.status(), await keyResponse.text()).toBe(200);
    const key = await keyResponse.json() as { rawKey: string; apiKey: { id: string } };
    const keyEvent = await db.auditEvent.findFirstOrThrow({ where: { projectId: project.id, actorUserId: owner.userId,
      action: "api_key.created" } });
    expect(keyEvent.organizationId).toBe(owner.organizationId);
    expect(keyEvent.metadata).toMatchObject({ affectedId: key.apiKey.id });

    const webhookResponse = await page.request.post(`/api/projects/${project.id}/webhooks`, { data: {
      url: "https://example.com/deepglot-audit-fixture", eventTypes: ["translation.created"], enabled: true,
    } });
    expect(webhookResponse.status(), await webhookResponse.text()).toBe(201);
    const { endpoint } = await webhookResponse.json() as { endpoint: { id: string } };
    const webhookEvent = await db.auditEvent.findFirstOrThrow({ where: { projectId: project.id,
      actorUserId: owner.userId, action: "webhook.created" } });
    expect(webhookEvent.organizationId).toBe(owner.organizationId);
    expect(webhookEvent.metadata).toMatchObject({ affectedId: endpoint.id });

    const translateResponse = await page.request.post("/api/translate", {
      headers: { Authorization: `Bearer ${key.rawKey}` },
      data: { l_from: "de", l_to: "en", words: [{ w: `Audit source ${token}`, t: 1 }] },
    });
    expect(translateResponse.status(), await translateResponse.text()).toBe(200);
    const translationEvent = await db.auditEvent.findFirstOrThrow({ where: { projectId: project.id,
      action: "translation.machine_saved" } });
    expect(translationEvent.organizationId).toBe(owner.organizationId);
    expect(translationEvent.actorUserId).toBeNull();
    expect(translationEvent.metadata).toMatchObject({ count: 1 });

    await db.organizationMember.create({ data: { organizationId: billingWorkspace.id,
      userId: owner.userId, role: "OWNER" } });
    await db.autoUpgradePreference.create({ data: { organizationId: billingWorkspace.id,
      enabled: true, maxPlan: "BUSINESS", maxPriceCents: 2500, updatedByUserId: owner.userId } });
    const billingResponse = await page.request.put("/api/billing/auto-upgrade", { data: {
      workspaceId: billingWorkspace.id, enabled: false,
    } });
    expect(billingResponse.status(), await billingResponse.text()).toBe(200);
    const billingEvent = await db.auditEvent.findFirstOrThrow({ where: { organizationId: billingWorkspace.id,
      actorUserId: owner.userId, action: "billing.auto_upgrade_updated" } });
    expect(billingEvent.projectId).toBeNull();
    expect(billingEvent.metadata).toMatchObject({ status: "disabled" });
  } finally {
    await db.auditEvent.deleteMany({ where: { organizationId: owner.organizationId,
      OR: [{ projectId: project.id }, { action: "workspace.member_role", actorUserId: owner.userId,
        metadata: { path: ["affectedId"], equals: target.id } }] } });
    await db.project.delete({ where: { id: project.id } });
    await db.organizationMember.deleteMany({ where: { organizationId: owner.organizationId, userId: target.id } });
    await db.user.delete({ where: { id: target.id } });
    await db.organization.delete({ where: { id: billingWorkspace.id } });
  }
});
