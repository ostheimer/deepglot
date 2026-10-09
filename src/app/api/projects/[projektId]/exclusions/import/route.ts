import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { exclusionCsvText } from "@/lib/exclusion-csv-copy";
import {
  MAX_EXCLUSION_CSV_BYTES,
  parseExclusionCsv,
  planExclusionImport,
} from "@/lib/exclusion-csv";
import { getAuthenticatedUserId, userCanManageProject, canManageProjectForWrite } from "@/lib/project-access";
import { getCookieLocale } from "@/lib/request-locale";
import { uiText } from "@/lib/static-copy";

export const runtime = "nodejs";
const MAX_MULTIPART_BYTES = MAX_EXCLUSION_CSV_BYTES + 16 * 1024;

async function readBoundedFormData(request: NextRequest): Promise<FormData | "too-large" | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_MULTIPART_BYTES) { await reader.cancel(); return "too-large"; }
      chunks.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return await new Response(body, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return null;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const locale = await getCookieLocale();
  const userId = await getAuthenticatedUserId();
  const { projektId } = await params;
  if (!userId) return NextResponse.json({ error: uiText(locale, "Not authenticated", "Nicht authentifiziert") }, { status: 401 });
  if (!(await userCanManageProject(userId, projektId))) {
    return NextResponse.json({ error: uiText(locale, "Project not found", "Projekt nicht gefunden") }, { status: 404 });
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
    return NextResponse.json({ error: exclusionCsvText(locale, "Upload exceeds size limit", "Upload überschreitet die Größengrenze") }, { status: 413 });
  }

  const formData = await readBoundedFormData(request);
  if (formData === "too-large") {
    return NextResponse.json({ error: exclusionCsvText(locale, "Upload exceeds size limit", "Upload überschreitet die Größengrenze") }, { status: 413 });
  }
  const file = formData?.get("file");
  const dryRun = formData?.get("dryRun") === "true";
  if (!(file instanceof File)) return NextResponse.json({ error: exclusionCsvText(locale, "Choose a CSV file", "CSV-Datei auswählen") }, { status: 400 });
  if (file.size > MAX_EXCLUSION_CSV_BYTES) {
    return NextResponse.json({ error: exclusionCsvText(locale, "CSV file exceeds 128 KiB", "CSV-Datei überschreitet 128 KiB") }, { status: 413 });
  }

  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: exclusionCsvText(locale, "CSV must be valid UTF-8", "CSV muss gültiges UTF-8 sein") }, { status: 400 });
  }
  const parsed = parseExclusionCsv(content);
  const existing = await db.translationExclusion.findMany({
    where: { projectId: projektId },
    select: { type: true, value: true },
  });
  const plan = planExclusionImport(parsed.rows, existing);
  const issues = [...parsed.issues, ...plan.conflicts];
  const summary = { creates: plan.creates.length, updates: 0, skips: plan.skips.length, conflicts: issues.length };
  if (dryRun || issues.length) {
    return NextResponse.json({ dryRun, summary, issues, importedRows: 0 }, { status: issues.length && !dryRun ? 400 : 200 });
  }

  try {
    const committed = await db.$transaction(async (tx) => {
      if (!(await canManageProjectForWrite(tx, userId, projektId))) throw new Error("not_found");
      // Recheck inside the transaction so a concurrent import cannot turn a
      // previewed create into an accidental overwrite or partial commit.
      const current = await tx.translationExclusion.findMany({
        where: { projectId: projektId }, select: { type: true, value: true },
      });
      const fresh = planExclusionImport(parsed.rows, current);
      if (fresh.conflicts.length) throw new Error("CSV_CONFLICT");
      for (const row of fresh.creates) {
        await tx.translationExclusion.create({
          data: { projectId: projektId, type: row.type, value: row.value },
        });
      }
      return { creates: fresh.creates.length, updates: 0, skips: fresh.skips.length, conflicts: 0 };
    }, { maxWait: 10_000, timeout: 30_000 });
    return NextResponse.json({ dryRun: false, summary: committed, issues: [], importedRows: committed.creates });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: exclusionCsvText(locale, "Rules changed during import. Preview again.", "Regeln wurden während des Imports geändert. Bitte erneut prüfen.") }, { status: 409 });
    }
    console.error("[POST exclusions/import] Failed:", error);
    return NextResponse.json({ error: uiText(locale, "Import failed", "Import fehlgeschlagen") }, { status: 500 });
  }
}
