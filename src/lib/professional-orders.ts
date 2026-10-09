import { createHash, timingSafeEqual } from "node:crypto";
import type { ProfessionalTranslationOrderStatus } from "@prisma/client";

export const MAX_ORDER_SEGMENTS = 100;
export const MAX_QUOTE_DAYS = 30;
export const MAX_VENDOR_TOKEN_DAYS = 14;

export type OrderSnapshotItem = {
  translationId: string;
  originalHash: string;
  originalText: string;
  sourceUpdatedAt: Date;
};

export class ProfessionalOrderError extends Error {
  constructor(public readonly code: "DISABLED" | "INVALID" | "CONFLICT" | "FORBIDDEN" | "NOT_FOUND", message: string) {
    super(message);
    this.name = "ProfessionalOrderError";
  }
}

export function professionalOrdersEnabled() {
  return [
    "PROFESSIONAL_ORDERS_ENABLED",
    "PROFESSIONAL_ORDERS_LEGAL_ACCEPTED",
    "PROFESSIONAL_ORDERS_PRIVACY_ACCEPTED",
    "PROFESSIONAL_ORDERS_BILLING_ACCEPTED",
    "PROFESSIONAL_ORDERS_PRODUCTION_ACCEPTED",
  ].every((key) => process.env[key] === "true");
}

export function requireProfessionalOrdersEnabled() {
  if (!professionalOrdersEnabled()) {
    throw new ProfessionalOrderError("DISABLED", "Professional translation ordering is not available.");
  }
}

export function scopeDigest(items: readonly OrderSnapshotItem[], sourceLanguage: string, targetLanguage: string) {
  const canonical = [...items]
    .sort((a, b) => a.translationId.localeCompare(b.translationId))
    .map((item) => [item.translationId, item.originalHash, item.originalText, item.sourceUpdatedAt.toISOString()]);
  return createHash("sha256").update(JSON.stringify([sourceLanguage, targetLanguage, canonical])).digest("hex");
}

export function quoteIsCurrent(status: ProfessionalTranslationOrderStatus, expiresAt: Date | null, now = new Date()) {
  return status === "QUOTED" && expiresAt !== null && expiresAt.getTime() > now.getTime();
}

export function canTransitionOrder(from: ProfessionalTranslationOrderStatus, to: ProfessionalTranslationOrderStatus) {
  const transitions: Record<ProfessionalTranslationOrderStatus, readonly ProfessionalTranslationOrderStatus[]> = {
    QUOTE_REQUESTED: ["QUOTED", "CANCELED", "FAILED"],
    QUOTED: ["EXPIRED", "PAYMENT_PENDING", "CANCELED", "FAILED"],
    EXPIRED: [],
    PAYMENT_PENDING: ["PAID", "CANCELED", "FAILED"],
    PAID: ["IN_PROGRESS", "REFUND_PENDING", "DISPUTED", "FAILED"],
    IN_PROGRESS: ["DELIVERED", "REFUND_PENDING", "DISPUTED", "FAILED"],
    DELIVERED: ["REFUND_PENDING", "DISPUTED"],
    CANCELED: [],
    REFUND_PENDING: ["REFUNDED", "DISPUTED", "FAILED"],
    REFUNDED: ["DISPUTED"],
    DISPUTED: ["REFUNDED", "FAILED"],
    FAILED: ["REFUND_PENDING", "REFUNDED", "DISPUTED"],
  };
  return transitions[from].includes(to);
}

export function assertOrderTransition(from: ProfessionalTranslationOrderStatus, to: ProfessionalTranslationOrderStatus) {
  if (!canTransitionOrder(from, to)) {
    throw new ProfessionalOrderError("CONFLICT", `Order cannot move from ${from} to ${to}.`);
  }
}

export function assertQuote(amountMinor: number, currency: string, turnaroundDays: number, expiresAt: Date, now = new Date()) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > 100_000_000 ||
      !/^[A-Z]{3}$/.test(currency) || !Number.isInteger(turnaroundDays) || turnaroundDays < 1 || turnaroundDays > 365 ||
      !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime() ||
      expiresAt.getTime() > now.getTime() + MAX_QUOTE_DAYS * 86_400_000) {
    throw new ProfessionalOrderError("INVALID", "Invalid price, currency, turnaround, or quote expiry.");
  }
}

export function hashVendorToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function vendorTokenMatches(token: string, storedHash: string) {
  if (!/^[a-f0-9]{64}$/.test(storedHash) || !/^dgpo_[a-f0-9]{64}$/.test(token)) return false;
  return timingSafeEqual(Buffer.from(hashVendorToken(token), "hex"), Buffer.from(storedHash, "hex"));
}

export function countOrderWords(text: string) {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}
