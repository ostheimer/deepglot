import { db } from "@/lib/db";
import { appendProjectAuditEvent } from "@/lib/audit-events";
import { lockAiSpendScope } from "@/lib/ai-budget";
import { AiBudgetError } from "@/lib/ai-budget-math";
import { canManageProject } from "@/lib/project-access-policy";
import { professionalOrderLifecycleState } from "@/lib/professional-order-lifecycle";

/** Deletion must share admission's Organization→Project lock order. */
export async function deleteProjectWithAiSpendGuard(projectId: string, userId: string) {
  const scope = await db.project.findUnique({ where: { id: projectId }, select: { organizationId: true } });
  if (!scope) throw new AiBudgetError("project_changed", "Project is unavailable.");
  return db.$transaction(async (tx) => {
    await lockAiSpendScope(tx, scope.organizationId, projectId);
    const [membership, projectMember] = await Promise.all([
      tx.organizationMember.findUnique({ where: { userId_organizationId: {
        userId, organizationId: scope.organizationId,
      } }, select: { role: true } }),
      tx.projectMember.findFirst({ where: { userId, projectId }, select: { role: true } }),
    ]);
    if (!canManageProject({ organizationRole: membership?.role ?? null,
      projectRole: projectMember?.role ?? null })) {
      throw new AiBudgetError("actor_revoked", "Project management access changed.");
    }
    const pending = await tx.aiSpendReservation.count({ where: {
      organizationId: scope.organizationId, projectId,
      state: { in: ["DISPATCHED", "UNKNOWN"] },
    } });
    if (pending > 0) {
      throw new AiBudgetError("ai_spend_pending", "Project has in-flight or unresolved AI provider work.");
    }
    const orders = await professionalOrderLifecycleState(tx, projectId);
    if (orders.pendingCount) {
      throw new AiBudgetError("professional_order_pending", "Project has unresolved professional order or payment obligations.");
    }
    await appendProjectAuditEvent(tx, { projectId, actorUserId: userId,
      action: "project.deleted", category: "project" });
    await tx.project.delete({ where: { id: projectId } });
    // AiSpendReservation.projectId is immutable historical text, without a
    // live Project FK; settled organization spend survives this deletion.
  }, { timeout: 20000 });
}
