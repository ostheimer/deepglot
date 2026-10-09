import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { db } from "@/lib/db";
import { changeWorkspaceMember, listWorkspaceMembers } from "@/lib/workspace-members";
import { resolveBillingWorkspaceId } from "@/lib/billing-workspace";

test("workspace member controls enforce known-user, seat, role and last-owner boundaries with audit", async () => {
  const suffix = randomUUID();
  const users = await Promise.all(["actor", "candidate", "unknown", "second"].map((label) =>
    db.user.create({ data: { email: `${label}-${suffix}@example.invalid` } })));
  const [actor, candidate, unknown, second] = users;
  const source = await db.organization.create({ data: { name: "Known", slug: `known-${suffix}` } });
  const destination = await db.organization.create({ data: { name: "Target", slug: `target-${suffix}`, plan: "STARTER",
    subscription: { create: { stripeCustomerId: `member-${suffix}`, status: "ACTIVE", plan: "STARTER", wordsLimit: 25_000 } } } });
  try {
    await db.organizationMember.createMany({ data: [
      { userId: actor.id, organizationId: source.id, role: "OWNER" },
      { userId: actor.id, organizationId: destination.id, role: "OWNER" },
      { userId: candidate.id, organizationId: source.id, role: "MEMBER" },
      { userId: second.id, organizationId: source.id, role: "MEMBER" },
    ] });
    assert.equal(await resolveBillingWorkspaceId(actor.id, null, true), null);
    assert.equal(await resolveBillingWorkspaceId(actor.id, destination.id, true), destination.id);
    assert.equal(await resolveBillingWorkspaceId(unknown.id, destination.id, true), null);
    await assert.rejects(changeWorkspaceMember({ actorUserId: actor.id, workspaceId: destination.id,
      action: "ADD", targetUserId: unknown.id, role: "MEMBER" }), { code: "NOT_FOUND" });
    await assert.rejects(changeWorkspaceMember({ actorUserId: candidate.id, workspaceId: destination.id,
      action: "ADD", targetUserId: second.id, role: "MEMBER" }), { code: "NOT_FOUND" });
    const listing = await listWorkspaceMembers(actor.id, destination.id);
    assert.equal(listing.candidates.length, 2);
    assert.equal(listing.candidates.some((row) => row.id === unknown.id), false);
    await changeWorkspaceMember({ actorUserId: actor.id, workspaceId: destination.id,
      action: "ADD", targetUserId: candidate.id, role: "ADMIN" });
    await db.subscription.update({ where: { organizationId: destination.id }, data: { status: "INACTIVE" } });
    await assert.rejects(changeWorkspaceMember({ actorUserId: actor.id, workspaceId: destination.id,
      action: "ADD", targetUserId: second.id, role: "MEMBER" }), { code: "LIMIT" });
    await db.subscription.update({ where: { organizationId: destination.id }, data: { status: "ACTIVE" } });
    await assert.rejects(changeWorkspaceMember({ actorUserId: candidate.id, workspaceId: destination.id,
      action: "ROLE", targetUserId: candidate.id, role: "OWNER" }), { code: "NOT_FOUND" });
    await assert.rejects(changeWorkspaceMember({ actorUserId: candidate.id, workspaceId: destination.id,
      action: "REMOVE", targetUserId: actor.id }), { code: "NOT_FOUND" });
    await assert.rejects(changeWorkspaceMember({ actorUserId: actor.id, workspaceId: destination.id,
      action: "REMOVE", targetUserId: actor.id }), { code: "CONFLICT" });
    await changeWorkspaceMember({ actorUserId: actor.id, workspaceId: destination.id,
      action: "ROLE", targetUserId: candidate.id, role: "OWNER" });
    await changeWorkspaceMember({ actorUserId: actor.id, workspaceId: destination.id,
      action: "REMOVE", targetUserId: actor.id });
    assert.equal((await db.organizationMember.findUniqueOrThrow({ where: { userId_organizationId: {
      userId: candidate.id, organizationId: destination.id } } })).role, "OWNER");
    assert.equal(await db.workspaceAudit.count({ where: { workspaceId: destination.id } }), 3);
    await assert.rejects(changeWorkspaceMember({ actorUserId: candidate.id, workspaceId: destination.id,
      action: "ADD", targetUserId: second.id, role: "OWNER" }), { code: "NOT_FOUND" });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [source.id, destination.id] } } });
    await db.workspaceAudit.deleteMany({ where: { workspaceId: destination.id } });
    await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
    await db.$disconnect();
  }
});
