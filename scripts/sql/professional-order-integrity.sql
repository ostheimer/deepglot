-- Apply after professional-orders-schema.sql, in the same externally controlled
-- transaction. No customer rows are migrated by this first-install artifact.
-- Financial/order evidence is retained; operational cancellation is a state change.
-- A terminal historical receipt can outlive its live project. A Checkout
-- dispatch with an unknown outcome is never considered terminal by age alone.
CREATE OR REPLACE FUNCTION deepglot_professional_order_unresolved(o "ProfessionalTranslationOrder") RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT NOT (o."organizationId" IS NOT NULL AND (
    (o."status" IN ('EXPIRED', 'CANCELED') AND
     o."checkoutRequestKey" IS NULL AND o."checkoutAttemptedAt" IS NULL AND
     o."stripeCheckoutSessionId" IS NULL AND o."stripePaymentIntentId" IS NULL AND
     o."paymentReference" IS NULL AND o."paidAt" IS NULL)
    OR
    (o."status" = 'REFUNDED' AND o."checkoutRequestKey" IS NOT NULL AND
     o."checkoutAttemptedAt" IS NOT NULL AND
     o."stripeCheckoutSessionId" IS NOT NULL AND o."stripePaymentIntentId" IS NOT NULL AND
     o."paymentReference" IS NOT NULL AND o."paidAt" IS NOT NULL AND
     o."refundReference" IS NOT NULL)
    OR
    (o."status" = 'COMPLETED' AND o."checkoutRequestKey" IS NOT NULL AND
     o."checkoutAttemptedAt" IS NOT NULL AND
     o."stripeCheckoutSessionId" IS NOT NULL AND o."stripePaymentIntentId" IS NOT NULL AND
     o."paymentProvider" = 'stripe' AND o."quoteAmountMinor" > 0 AND o."quoteCurrency" IS NOT NULL AND
     o."paymentReference" = o."stripePaymentIntentId" AND
     o."paidAt" IS NOT NULL AND o."completedAt" IS NOT NULL AND o."completedById" IS NOT NULL AND
     EXISTS (SELECT 1 FROM "ProfessionalTranslationOrderItem" i WHERE i."orderId" = o."id") AND
     NOT EXISTS (SELECT 1 FROM "ProfessionalTranslationOrderItem" i WHERE i."orderId" = o."id"
       AND (i."adoptedAt" IS NULL OR i."proposedText" IS NULL)))
  ))
$$;

CREATE OR REPLACE FUNCTION deepglot_professional_order_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'professional order evidence cannot be deleted';
  END IF;
  IF (NEW."projectId", NEW."organizationId", NEW."requesterId", NEW."sourceLanguage", NEW."targetLanguage", NEW."scopeDigest", NEW."wordCount")
     IS DISTINCT FROM
     (OLD."projectId", OLD."organizationId", OLD."requesterId", OLD."sourceLanguage", OLD."targetLanguage", OLD."scopeDigest", OLD."wordCount") THEN
    RAISE EXCEPTION 'professional order scope is immutable';
  END IF;
  IF OLD."quoteReference" IS NOT NULL AND
     (NEW."quoteAmountMinor", NEW."quoteCurrency", NEW."quoteTurnaroundDays", NEW."quoteExpiresAt", NEW."quoteReference", NEW."quoteTermsVersion", NEW."selectedVendorGrantId")
     IS DISTINCT FROM
     (OLD."quoteAmountMinor", OLD."quoteCurrency", OLD."quoteTurnaroundDays", OLD."quoteExpiresAt", OLD."quoteReference", OLD."quoteTermsVersion", OLD."selectedVendorGrantId") THEN
    RAISE EXCEPTION 'professional order quote is immutable';
  END IF;
  IF (OLD."checkoutRequestKey" IS NOT NULL AND NEW."checkoutRequestKey" IS DISTINCT FROM OLD."checkoutRequestKey") OR
     (OLD."checkoutAttemptedAt" IS NOT NULL AND NEW."checkoutAttemptedAt" IS DISTINCT FROM OLD."checkoutAttemptedAt") OR
     (OLD."stripeCheckoutSessionId" IS NOT NULL AND NEW."stripeCheckoutSessionId" IS DISTINCT FROM OLD."stripeCheckoutSessionId") OR
     (OLD."stripePaymentIntentId" IS NOT NULL AND NEW."stripePaymentIntentId" IS DISTINCT FROM OLD."stripePaymentIntentId") OR
     (OLD."paymentReference" IS NOT NULL AND NEW."paymentReference" IS DISTINCT FROM OLD."paymentReference") OR
     (OLD."paidAt" IS NOT NULL AND NEW."paidAt" IS DISTINCT FROM OLD."paidAt") THEN
    RAISE EXCEPTION 'professional order payment identity is immutable';
  END IF;
  IF (OLD."completedAt" IS NOT NULL AND NEW."completedAt" IS DISTINCT FROM OLD."completedAt") OR
     (OLD."completedById" IS NOT NULL AND NEW."completedById" IS DISTINCT FROM OLD."completedById") THEN
    RAISE EXCEPTION 'professional order completion evidence is immutable';
  END IF;
  IF NEW."activeProjectId" IS NOT NULL AND
     (NEW."activeProjectId" IS DISTINCT FROM NEW."projectId" OR NEW."projectDetachedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'professional order live project reference is invalid';
  END IF;
  IF OLD."projectDetachedAt" IS NOT NULL AND
     (NEW."projectDetachedAt" IS DISTINCT FROM OLD."projectDetachedAt" OR NEW."activeProjectId" IS NOT NULL) THEN
    RAISE EXCEPTION 'professional order detachment is immutable';
  END IF;
  IF OLD."activeProjectId" IS NOT NULL AND NEW."activeProjectId" IS NULL AND
     (NEW."projectDetachedAt" IS NULL OR deepglot_professional_order_unresolved(OLD)) THEN
    RAISE EXCEPTION 'unresolved professional order cannot detach';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS professional_order_immutable ON "ProfessionalTranslationOrder";
CREATE TRIGGER professional_order_immutable BEFORE UPDATE OR DELETE ON "ProfessionalTranslationOrder"
FOR EACH ROW EXECUTE FUNCTION deepglot_professional_order_immutable();

-- Org -> Project locks in manager writes serialize with this Project mutation.
-- Detach only terminal receipts; unresolved orders keep the live project and
-- must be settled/reconciled by their originating merchant first.
CREATE OR REPLACE FUNCTION deepglot_professional_order_project_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    NULL;
  ELSIF NEW."organizationId" IS NOT DISTINCT FROM OLD."organizationId" THEN
    RETURN NEW;
  END IF;
    IF EXISTS (
      SELECT 1 FROM "ProfessionalTranslationOrder" o
      WHERE o."projectId" = OLD."id" AND
        ((o."activeProjectId" = OLD."id" AND deepglot_professional_order_unresolved(o)) OR
         (o."activeProjectId" IS NULL AND o."projectDetachedAt" IS NULL))
    ) THEN
      RAISE EXCEPTION 'unresolved professional order blocks project lifecycle change';
    END IF;
    UPDATE "ProfessionalTranslationOrder"
      SET "activeProjectId" = NULL, "projectDetachedAt" = now()
      WHERE "projectId" = OLD."id" AND "activeProjectId" = OLD."id";
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS professional_order_transfer_guard ON "Project";
DROP TRIGGER IF EXISTS professional_order_project_guard ON "Project";
CREATE TRIGGER professional_order_project_guard BEFORE UPDATE OF "organizationId" OR DELETE ON "Project"
FOR EACH ROW EXECUTE FUNCTION deepglot_professional_order_project_guard();

CREATE OR REPLACE FUNCTION deepglot_professional_order_item_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'professional order item evidence cannot be deleted';
  END IF;
  IF (NEW."orderId", NEW."translationId", NEW."originalHash", NEW."originalText", NEW."sourceUpdatedAt")
     IS DISTINCT FROM
     (OLD."orderId", OLD."translationId", OLD."originalHash", OLD."originalText", OLD."sourceUpdatedAt") THEN
    RAISE EXCEPTION 'professional order item scope is immutable';
  END IF;
  IF OLD."proposedText" IS NOT NULL AND NEW."proposedText" IS DISTINCT FROM OLD."proposedText" THEN
    RAISE EXCEPTION 'professional order delivery is immutable';
  END IF;
  IF OLD."adoptedAt" IS NOT NULL AND NEW."adoptedAt" IS DISTINCT FROM OLD."adoptedAt" THEN
    RAISE EXCEPTION 'professional order adoption is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS professional_order_item_immutable ON "ProfessionalTranslationOrderItem";
CREATE TRIGGER professional_order_item_immutable BEFORE UPDATE OR DELETE ON "ProfessionalTranslationOrderItem"
FOR EACH ROW EXECUTE FUNCTION deepglot_professional_order_item_immutable();

CREATE OR REPLACE FUNCTION deepglot_professional_order_event_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'professional order events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS professional_order_event_immutable ON "ProfessionalTranslationOrderEvent";
CREATE TRIGGER professional_order_event_immutable BEFORE UPDATE OR DELETE ON "ProfessionalTranslationOrderEvent"
FOR EACH ROW EXECUTE FUNCTION deepglot_professional_order_event_immutable();
