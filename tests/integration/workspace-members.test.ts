import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { db } from "@/lib/db";
import { changeWorkspaceMember, listWorkspaceMembers } from "@/lib/workspace-members";
import { resolveBillingWorkspaceId } from "@/lib/billing-workspace";
import { canManageProjectForWrite } from "@/lib/project-access";

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

test("workspace revocation linearizes with a project write after its permission check", async () => {
  const suffix = randomUUID();
  const owner = await db.user.create({ data: { email: `owner-${suffix}@example.invalid` } });
  const admin = await db.user.create({ data: { email: `admin-${suffix}@example.invalid` } });
  const workspace = await db.organization.create({ data: { name: "Race fixture", slug: `race-${suffix}` } });
  const project = await db.project.create({ data: { organizationId: workspace.id, name: "Race", domain: `${suffix}.invalid`,
    settings: { create: {} } } });
  let releaseWrite!: () => void;
  let reportAuthorized!: () => void;
  const held = new Promise<void>((resolve) => { releaseWrite = resolve; });
  const authorized = new Promise<void>((resolve) => { reportAuthorized = resolve; });
  try {
    await db.organizationMember.createMany({ data: [
      { userId: owner.id, organizationId: workspace.id, role: "OWNER" },
      { userId: admin.id, organizationId: workspace.id, role: "ADMIN" },
    ] });
    await db.projectMember.create({ data: { projectId: project.id, userId: admin.id,
      email: admin.email, role: "ADMIN" } });
    await db.projectInvitation.create({ data: { projectId: project.id, inviterId: owner.id,
      email: admin.email.toUpperCase(), tokenHash: `revocation-${suffix}`, expiresAt: new Date(Date.now() + 86_400_000) } });
    const write = db.$transaction(async (tx) => {
      assert.equal(await canManageProjectForWrite(tx, admin.id, project.id), true);
      reportAuthorized();
      await held;
      await tx.projectSettings.update({ where: { projectId: project.id }, data: { translationTone: "formal" } });
    }, { timeout: 10_000 });
    await authorized;
    const removal = changeWorkspaceMember({ actorUserId: owner.id, workspaceId: workspace.id,
      action: "REMOVE", targetUserId: admin.id });
    try {
      const outcome = await Promise.race([
        removal.then(() => "removed"),
        new Promise<string>((resolve) => setTimeout(() => resolve("waiting"), 150)),
      ]);
      assert.equal(outcome, "waiting", "membership removal must wait until the authorized write commits");
    } finally {
      releaseWrite();
      await write;
      await removal;
    }
    assert.equal((await db.projectSettings.findUniqueOrThrow({ where: { projectId: project.id } })).translationTone, "formal");
    assert.equal(await db.organizationMember.count({ where: { userId: admin.id, organizationId: workspace.id } }), 0);
    const stillManaged = await db.$transaction((tx) => canManageProjectForWrite(tx, admin.id, project.id));
    assert.equal(stillManaged, false, "removing a workspace member also revokes their project grant");
    assert.equal(await db.projectInvitation.count({ where: { projectId: project.id, email: { equals: admin.email, mode: "insensitive" },
      acceptedAt: null } }), 0);
  } finally {
    await db.project.delete({ where: { id: project.id } });
    await db.organization.delete({ where: { id: workspace.id } });
    await db.workspaceAudit.deleteMany({ where: { workspaceId: workspace.id } });
    await db.user.deleteMany({ where: { id: { in: [owner.id, admin.id] } } });
    await db.$disconnect();
  }
});
