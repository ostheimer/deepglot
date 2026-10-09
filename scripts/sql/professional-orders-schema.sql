-- Generated additive Prisma diff from main ed215bb1a7c49cf0814e85a35b1d1e6a5c55259b
-- to the reviewed #272 schema. Install together with professional-order-integrity.sql
-- in one externally controlled transaction, after a read-only zero-order preflight.
-- CreateEnum
CREATE TYPE "ProfessionalTranslationOrderStatus" AS ENUM ('QUOTE_REQUESTED', 'QUOTED', 'EXPIRED', 'PAYMENT_PENDING', 'PAID', 'IN_PROGRESS', 'DELIVERED', 'CANCELED', 'REFUND_PENDING', 'REFUNDED', 'DISPUTED', 'FAILED');

-- CreateTable
CREATE TABLE "ProfessionalTranslationOrder" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activeProjectId" TEXT,
    "projectDetachedAt" TIMESTAMP(3),
    "organizationId" TEXT,
    "requesterId" TEXT NOT NULL,
    "status" "ProfessionalTranslationOrderStatus" NOT NULL DEFAULT 'QUOTE_REQUESTED',
    "sourceLanguage" TEXT NOT NULL,
    "targetLanguage" TEXT NOT NULL,
    "scopeDigest" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "quoteAmountMinor" INTEGER,
    "quoteCurrency" TEXT,
    "quoteTurnaroundDays" INTEGER,
    "quoteExpiresAt" TIMESTAMP(3),
    "quoteReference" TEXT,
    "quoteTermsVersion" TEXT,
    "selectedVendorGrantId" TEXT,
    "checkoutRequestKey" TEXT,
    "checkoutAttemptedAt" TIMESTAMP(3),
    "stripeCheckoutSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "paymentReference" TEXT,
    "paymentProvider" TEXT,
    "paidAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "refundReference" TEXT,
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessionalTranslationOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalTranslationOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "translationId" TEXT NOT NULL,
    "originalHash" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "proposedText" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "adoptedAt" TIMESTAMP(3),
    "adoptedById" TEXT,

    CONSTRAINT "ProfessionalTranslationOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalTranslationOrderEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalTranslationOrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalTranslationVendorGrant" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalTranslationVendorGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalTranslationOrder_checkoutRequestKey_key" ON "ProfessionalTranslationOrder"("checkoutRequestKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalTranslationOrder_stripeCheckoutSessionId_key" ON "ProfessionalTranslationOrder"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalTranslationOrder_stripePaymentIntentId_key" ON "ProfessionalTranslationOrder"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalTranslationOrder_paymentReference_key" ON "ProfessionalTranslationOrder"("paymentReference");

-- CreateIndex
CREATE INDEX "ProfessionalTranslationOrder_projectId_createdAt_idx" ON "ProfessionalTranslationOrder"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProfessionalTranslationOrder_activeProjectId_status_idx" ON "ProfessionalTranslationOrder"("activeProjectId", "status");

-- CreateIndex
CREATE INDEX "ProfessionalTranslationOrder_status_quoteExpiresAt_idx" ON "ProfessionalTranslationOrder"("status", "quoteExpiresAt");

-- CreateIndex
CREATE INDEX "ProfessionalTranslationOrderItem_translationId_idx" ON "ProfessionalTranslationOrderItem"("translationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalTranslationOrderItem_orderId_translationId_key" ON "ProfessionalTranslationOrderItem"("orderId", "translationId");

-- CreateIndex
CREATE INDEX "ProfessionalTranslationOrderEvent_orderId_createdAt_idx" ON "ProfessionalTranslationOrderEvent"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalTranslationOrderEvent_orderId_kind_reference_key" ON "ProfessionalTranslationOrderEvent"("orderId", "kind", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalTranslationVendorGrant_tokenHash_key" ON "ProfessionalTranslationVendorGrant"("tokenHash");

-- CreateIndex
CREATE INDEX "ProfessionalTranslationVendorGrant_orderId_idx" ON "ProfessionalTranslationVendorGrant"("orderId");

-- AddForeignKey
ALTER TABLE "ProfessionalTranslationOrder" ADD CONSTRAINT "ProfessionalTranslationOrder_activeProjectId_fkey" FOREIGN KEY ("activeProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalTranslationOrder" ADD CONSTRAINT "ProfessionalTranslationOrder_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalTranslationOrderItem" ADD CONSTRAINT "ProfessionalTranslationOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProfessionalTranslationOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalTranslationOrderEvent" ADD CONSTRAINT "ProfessionalTranslationOrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProfessionalTranslationOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalTranslationVendorGrant" ADD CONSTRAINT "ProfessionalTranslationVendorGrant_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProfessionalTranslationOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
