import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateApiKey } from "@/lib/api-keys";
import { recordSourcePageSnapshot, SourceSnapshotError } from "@/lib/source-page-snapshot-workflow";
import { SOURCE_SNAPSHOT_MAX_HASHES } from "@/lib/source-page-snapshot";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 100_000;
const schema = z.object({
  requestUrl: z.string().url().max(4_096),
  langFrom: z.string().min(2).max(12),
  langTo: z.string().min(2).max(12),
  originalHashes: z.array(z.string().regex(/^[a-f0-9]{32}$/)).max(SOURCE_SNAPSHOT_MAX_HASHES),
  complete: z.boolean(),
  dynamicPossible: z.boolean(),
  capturedMicros: z.string().regex(/^\d{15,17}$/),
}).strict();

export async function POST(request: NextRequest) {
  const match = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return NextResponse.json({ error: "API key required" }, { status: 401 });
  const apiKey = await validateApiKey(match[1].trim());
  if (!apiKey) return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return NextResponse.json({ error: "Source snapshot is too large" }, { status: 413 });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES)
    return NextResponse.json({ error: "Source snapshot is too large" }, { status: 413 });
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch {
    return NextResponse.json({ error: "Invalid source snapshot" }, { status: 400 });
  }
  const payload = schema.safeParse(parsed);
  if (!payload.success || (!payload.data.complete && payload.data.originalHashes.length > 0))
    return NextResponse.json({ error: "Invalid source snapshot" }, { status: 400 });
  try {
    const result = await recordSourcePageSnapshot({ ...payload.data,
      capturedMicros: BigInt(payload.data.capturedMicros),
      apiKeyId: apiKey.id, projectId: apiKey.projectId });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SourceSnapshotError)
      return NextResponse.json({ error: error.message, code: error.code },
        { status: error.code === "FORBIDDEN" ? 403 : 400 });
    console.error("[source-inventory] failed:", error);
    return NextResponse.json({ error: "Source snapshot unavailable" }, { status: 503 });
  }
}
