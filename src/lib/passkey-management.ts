type PasskeyDeleteStore = {
  deleteMany: (args: {
    where: { credentialID: string; userId: string };
  }) => Promise<{ count: number }>;
};

export async function deletePasskeyForUser(
  store: PasskeyDeleteStore,
  userId: string,
  credentialID: string
) {
  if (!userId.trim()) {
    throw new Error("A user ID is required to delete a passkey.");
  }
  if (!credentialID.trim() || credentialID.length > 2048) {
    throw new Error("A valid credential ID is required to delete a passkey.");
  }

  const result = await store.deleteMany({
    where: { credentialID, userId },
  });

  return result.count === 1;
}
