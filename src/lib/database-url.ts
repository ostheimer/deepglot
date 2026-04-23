export function resolveDatabaseUrl(
  env: Record<string, string | undefined> = process.env
): string | undefined {
  const deepglotDatabaseUrl = env["DEEPGLOT_DATABASE_URL"]?.trim();

  return deepglotDatabaseUrl || env["DATABASE_URL"];
}

export function isNeonDatabaseUrl(connectionString: string): boolean {
  try {
    const hostname = new URL(connectionString).hostname.toLowerCase();
    return hostname === "neon.tech" || hostname.endsWith(".neon.tech");
  } catch {
    return connectionString.toLowerCase().includes(".neon.tech");
  }
}
