"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { deletePasskeyForUser } from "@/lib/passkey-management";

export type DeletePasskeyResult =
  | { success: true }
  | { success: false; reason: "invalid" | "not_found" | "unauthorized" };

export async function deletePasskeyAction(
  credentialID: string
): Promise<DeletePasskeyResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, reason: "unauthorized" };
  }

  try {
    const deleted = await deletePasskeyForUser(
      db.authenticator,
      session.user.id,
      credentialID
    );
    if (!deleted) {
      return { success: false, reason: "not_found" };
    }
  } catch {
    return { success: false, reason: "invalid" };
  }

  revalidatePath("/einstellungen");
  return { success: true };
}
