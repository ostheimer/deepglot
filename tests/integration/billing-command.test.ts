import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { db } from "@/lib/db";
import { authorizeBillingCommand, resolveBillingWorkspaceId } from "@/lib/billing-workspace";
import { changeWorkspaceMember } from "@/lib/workspace-members";

test("a billing action selected as OWNER cannot dispatch after a role downgrade", async () => {
  const suffix = randomUUID();
  const actor = await db.user.create({ data: { email: `billing-actor-${suffix}@example.invalid` } });
  const owner = await db.user.create({ data: { email: `billing-owner-${suffix}@example.invalid` } });
  const workspace = await db.organization.create({ data: { name: "Billing race fixture", slug: `billing-race-${suffix}`,
    subscription: { create: { stripeCustomerId: `cus_fixture_${suffix}`, status: "ACTIVE", plan: "STARTER", wordsLimit: 25_000 } },
  } });
  try {
    await db.organizationMember.createMany({ data: [
      { userId: actor.id, organizationId: workspace.id, role: "OWNER" },
      { userId: owner.id, organizationId: workspace.id, role: "OWNER" },
    ] });
    const selected = await resolveBillingWorkspaceId(actor.id, workspace.id, true);
    assert.equal(selected, workspace.id);
    await changeWorkspaceMember({ actorUserId: owner.id, workspaceId: workspace.id,
      action: "ROLE", targetUserId: actor.id, role: "MEMBER" });

    // The route cannot dispatch after a downgrade, even when an earlier
    // workspace selection succeeded. No Stripe network client is used.
    const mockStripe = { calls: 0, async dispatch() { this.calls += 1; } };
    const denied = await authorizeBillingCommand({ actorUserId: actor.id,
      workspaceId: selected!, action: "PORTAL" });
    if (denied?.targetRef) await mockStripe.dispatch();
    assert.equal(mockStripe.calls, 0);
    assert.equal(denied, null);
    assert.equal(await db.billingCommand.count({ where: { workspaceId: workspace.id } }), 0);

    // Once an OWNER receives a command, a subsequent downgrade cannot erase
    // the factual authorization for the already-issued external dispatch.
    await changeWorkspaceMember({ actorUserId: owner.id, workspaceId: workspace.id,
      action: "ROLE", targetUserId: actor.id, role: "OWNER" });
    const issued = await authorizeBillingCommand({ actorUserId: actor.id,
      workspaceId: workspace.id, action: "PORTAL" });
    assert.equal(issued?.targetRef, `cus_fixture_${suffix}`);
    await changeWorkspaceMember({ actorUserId: owner.id, workspaceId: workspace.id,
      action: "ROLE", targetUserId: actor.id, role: "MEMBER" });
    if (issued?.targetRef) await mockStripe.dispatch();
    assert.equal(mockStripe.calls, 1);
    const receipt = await db.billingCommand.findUniqueOrThrow({ where: { id: issued!.commandId } });
    assert.equal(receipt.actorRole, "OWNER");
    assert.equal(receipt.action, "PORTAL");
    assert.equal(receipt.targetRef, `cus_fixture_${suffix}`);
  } finally {
    await db.billingCommand.deleteMany({ where: { workspaceId: workspace.id } });
    await db.organization.delete({ where: { id: workspace.id } });
    await db.workspaceAudit.deleteMany({ where: { workspaceId: workspace.id } });
    await db.user.deleteMany({ where: { id: { in: [actor.id, owner.id] } } });
    await db.$disconnect();
  }
});
