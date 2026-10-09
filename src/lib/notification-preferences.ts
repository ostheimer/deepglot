import type { NotificationCategory, NotificationFrequency, OrganizationRole } from "@prisma/client";

export const OPTIONAL_NOTIFICATION_CATEGORIES = [
  "PRODUCT_UPDATE",
  "PROJECT_ACTIVITY",
  "BILLING_SUMMARY",
] as const satisfies readonly NotificationCategory[];

export const OPTIONAL_NOTIFICATION_FREQUENCIES = ["OFF", "WEEKLY", "MONTHLY"] as const satisfies readonly NotificationFrequency[];

export type OptionalNotificationCategory = typeof OPTIONAL_NOTIFICATION_CATEGORIES[number];
export type OptionalNotificationFrequency = typeof OPTIONAL_NOTIFICATION_FREQUENCIES[number];

export function allowedNotificationFrequencies(category: OptionalNotificationCategory): readonly OptionalNotificationFrequency[] {
  return category === "PRODUCT_UPDATE" ? ["OFF", "MONTHLY"] :
    category === "PROJECT_ACTIVITY" ? ["OFF", "WEEKLY"] : ["OFF", "MONTHLY"];
}

export function mayReceiveOptionalNotification({
  category,
  frequency,
  role,
  hasProjectAccess = false,
}: {
  category: OptionalNotificationCategory;
  frequency: OptionalNotificationFrequency;
  role: OrganizationRole | null;
  hasProjectAccess?: boolean;
}): boolean {
  if (!role || frequency === "OFF" || !allowedNotificationFrequencies(category).includes(frequency)) return false;
  if (category === "BILLING_SUMMARY") return role === "OWNER" || role === "ADMIN";
  if (category === "PROJECT_ACTIVITY") return role !== "MEMBER" || hasProjectAccess;
  return true;
}

/** One UTC period key per scheduled run; a delayed run keeps its original key. */
export function notificationPeriodStart(frequency: Exclude<OptionalNotificationFrequency, "OFF">, now: Date): Date {
  if (frequency === "WEEKLY") {
    const day = now.getUTCDay();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((day + 6) % 7)));
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
