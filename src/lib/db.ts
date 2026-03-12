import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { isNeonDatabaseUrl } from "@/lib/database-url";

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    // During build time without a real DB, return a stub
    if (process.env.NODE_ENV === "production") {
      throw new Error("DATABASE_URL ist nicht konfiguriert");
    }
    // Development: allow build to succeed without DB
    return new PrismaClient() as unknown as PrismaClient;
  }

  if (isNeonDatabaseUrl(connectionString)) {
    const adapter = new PrismaNeon({ connectionString });
    return new PrismaClient({ adapter });
  }

  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
