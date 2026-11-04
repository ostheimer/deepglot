import { expect, test } from "@playwright/test";
import { db } from "@/lib/db";
import { signInAsTestUser } from "./helpers";

test("activity digest records only changed preferences", async ({ page }) => {
  await signInAsTestUser(page);
  const member = await db.organizationMember.findFirstOrThrow({ where: { user: { email: "preview@deepglot.local" } },
    select: { id: true, organizationId: true, activityDigestEnabled: true, activityDigestLocale: true } });
  const before = await db.auditEvent.count({ where: { organizationId: member.organizationId,
    action: "workspace.activity_digest_updated" } });
  const url = "/api/user/activity-digest";
  const unchanged = { organizationId: member.organizationId, enabled: member.activityDigestEnabled,
    locale: member.activityDigestLocale };
  expect((await page.request.patch(url, { data: unchanged })).ok()).toBeTruthy();
  expect(await db.auditEvent.count({ where: { organizationId: member.organizationId,
    action: "workspace.activity_digest_updated" } })).toBe(before);
  expect((await page.request.patch(url, { data: unchanged })).ok()).toBeTruthy();
  expect(await db.auditEvent.count({ where: { organizationId: member.organizationId,
    action: "workspace.activity_digest_updated" } })).toBe(before);
});

test("page-view activation distinguishes consent renewal from an unchanged disable", async ({ page }) => {
  await signInAsTestUser(page);
  const member = await db.organizationMember.findFirstOrThrow({ where: { user: { email: "preview@deepglot.local" } },
    select: { organizationId: true } });
  const token = crypto.randomUUID();
  const project = await db.project.create({ data: { organizationId: member.organizationId,
    name: "Audit consent fixture", domain: `audit-consent-${token}.example.test` } });
  const url = `/api/projects/${project.id}/page-views/activate`;
  try {
    expect((await page.request.post(url)).ok()).toBeTruthy();
    const first = await db.projectSettings.findUniqueOrThrow({ where: { projectId: project.id } });
    expect(first.pageViewsEnabled).toBe(true);
    expect((await page.request.post(url)).ok()).toBeTruthy();
    const renewed = await db.projectSettings.findUniqueOrThrow({ where: { projectId: project.id } });
    expect(renewed.pageViewsConsentGrantedAt).toBeTruthy();
    expect(renewed.pageViewsConsentGrantedAt!.getTime()).toBeGreaterThanOrEqual(first.pageViewsConsentGrantedAt!.getTime());
    expect((await page.request.delete(url)).ok()).toBeTruthy();
    expect((await page.request.delete(url)).ok()).toBeTruthy();
    const actions = (await db.auditEvent.findMany({ where: { projectId: project.id }, select: { action: true } })).map((row) => row.action);
    expect(actions.filter((action) => action === "project.page_views_enabled")).toHaveLength(1);
    expect(actions.filter((action) => action === "project.page_views_consent_renewed")).toHaveLength(1);
    expect(actions.filter((action) => action === "project.page_views_disabled")).toHaveLength(1);
  } finally {
    await db.auditEvent.deleteMany({ where: { projectId: project.id } });
    await db.project.delete({ where: { id: project.id } });
  }
});
