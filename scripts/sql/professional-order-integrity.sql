-- Apply after prisma db push, before enabling professional orders. Safe to rerun.
-- Financial/order evidence is retained; operational cancellation is a state change.
BEGIN;
CREATE OR REPLACE FUNCTION deepglot_professional_order_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'professional order evidence cannot be deleted';
  END IF;
  IF (NEW."projectId", NEW."requesterId", NEW."sourceLanguage", NEW."targetLanguage", NEW."scopeDigest", NEW."wordCount")
     IS DISTINCT FROM
     (OLD."projectId", OLD."requesterId", OLD."sourceLanguage", OLD."targetLanguage", OLD."scopeDigest", OLD."wordCount") THEN
    RAISE EXCEPTION 'professional order scope is immutable';
  END IF;
  IF OLD."quoteReference" IS NOT NULL AND
     (NEW."quoteAmountMinor", NEW."quoteCurrency", NEW."quoteTurnaroundDays", NEW."quoteExpiresAt", NEW."quoteReference", NEW."quoteTermsVersion", NEW."selectedVendorGrantId")
     IS DISTINCT FROM
     (OLD."quoteAmountMinor", OLD."quoteCurrency", OLD."quoteTurnaroundDays", OLD."quoteExpiresAt", OLD."quoteReference", OLD."quoteTermsVersion", OLD."selectedVendorGrantId") THEN
    RAISE EXCEPTION 'professional order quote is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS professional_order_immutable ON "ProfessionalTranslationOrder";
CREATE TRIGGER professional_order_immutable BEFORE UPDATE OR DELETE ON "ProfessionalTranslationOrder"
FOR EACH ROW EXECUTE FUNCTION deepglot_professional_order_immutable();

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

COMMIT;
