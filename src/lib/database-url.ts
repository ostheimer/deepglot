export function isNeonDatabaseUrl(connectionString: string): boolean {
  try {
    const hostname = new URL(connectionString).hostname.toLowerCase();
    return hostname === "neon.tech" || hostname.endsWith(".neon.tech");
  } catch {
    return connectionString.toLowerCase().includes(".neon.tech");
  }
}
