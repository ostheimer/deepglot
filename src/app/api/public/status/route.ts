import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiProblem } from "@/lib/problem-details";

export const runtime = "nodejs";

/**
 * GET /api/public/status
 * Health check endpoint – returns 200 if API is up, 503 if DB is unreachable.
 */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return new NextResponse(null, { status: 200 });
  } catch {
    return apiProblem({
      status: 503,
      title: "Service unavailable",
      detail: "The Deepglot API cannot reach its database.",
      code: "service_unavailable",
      instance: "/api/public/status",
    });
  }
}
