import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

type Client = typeof db | Prisma.TransactionClient;

/** Read only live or unmarked order references; detached origin receipts belong to the source merchant. */
export async function professionalOrderLifecycleState(client: Client, projectId: string) {
  const rows = await client.$queryRaw<Array<{
    id: string; status: string; organizationId: string | null;
    activeProjectId: string | null; projectDetachedAt: Date | null;
    checkoutRequestKey: string | null; checkoutAttemptedAt: Date | null;
    stripeCheckoutSessionId: string | null; stripePaymentIntentId: string | null;
    paymentReference: string | null; paidAt: Date | null; refundReference: string | null;
    paymentProvider: string | null; quoteAmountMinor: number | null; quoteCurrency: string | null;
    completedAt: Date | null; completedById: string | null;
    itemsComplete: boolean; updatedAt: Date;
  }>>`
    SELECT o."id", o."status", o."organizationId", o."activeProjectId",
      o."projectDetachedAt", o."checkoutRequestKey", o."checkoutAttemptedAt",
      o."stripeCheckoutSessionId", o."stripePaymentIntentId", o."paymentReference",
      o."paidAt", o."refundReference", o."paymentProvider", o."quoteAmountMinor", o."quoteCurrency",
      o."completedAt", o."completedById",
      (EXISTS (SELECT 1 FROM "ProfessionalTranslationOrderItem" i WHERE i."orderId" = o."id")
        AND NOT EXISTS (SELECT 1 FROM "ProfessionalTranslationOrderItem" i WHERE i."orderId" = o."id"
          AND (i."adoptedAt" IS NULL OR i."proposedText" IS NULL))) AS "itemsComplete", o."updatedAt"
    FROM "ProfessionalTranslationOrder" o
    WHERE o."projectId" = ${projectId}
      AND (o."activeProjectId" = ${projectId}
        OR (o."activeProjectId" IS NULL AND o."projectDetachedAt" IS NULL))
    ORDER BY o."id" FOR SHARE OF o
  `;
  const unresolved = (row: (typeof rows)[number]) => {
    if (row.organizationId === null) return true;
    if ((row.status === "EXPIRED" || row.status === "CANCELED") &&
      !row.checkoutRequestKey && !row.checkoutAttemptedAt && !row.stripeCheckoutSessionId &&
      !row.stripePaymentIntentId && !row.paymentReference && !row.paidAt) return false;
    if (row.status === "REFUNDED" && row.checkoutRequestKey && row.checkoutAttemptedAt &&
      row.stripeCheckoutSessionId && row.stripePaymentIntentId && row.paymentReference &&
      row.paidAt && row.refundReference) return false;
    if (row.status === "COMPLETED" && row.checkoutRequestKey && row.checkoutAttemptedAt &&
      row.stripeCheckoutSessionId && row.stripePaymentIntentId && row.paymentProvider === "stripe_checkout" &&
      row.quoteAmountMinor !== null && row.quoteAmountMinor > 0 && row.quoteCurrency &&
      row.paymentReference === row.stripePaymentIntentId && row.paidAt && row.completedAt &&
      row.completedById && row.itemsComplete) return false;
    return true;
  };
  const pendingCount = rows.filter((row) => unresolved(row) || row.activeProjectId === null).length;
  const version = createHash("sha256").update(JSON.stringify(rows.map((row) => [
    row.id, row.status, row.organizationId, row.activeProjectId,
    row.projectDetachedAt?.toISOString() ?? null, row.updatedAt.toISOString(), unresolved(row),
  ]))).digest("hex");
  return { pendingCount, liveCount: rows.length, version };
}
