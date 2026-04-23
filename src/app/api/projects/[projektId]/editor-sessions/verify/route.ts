import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { verifyEditorSessionToken } from "@/lib/editor-session";

export const runtime = "nodejs";

function corsHeaders(request: NextRequest) {
  const origin = request.headers.get("origin") ?? "*";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const { projektId } = await params;
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const claims = verifyEditorSessionToken(token);

  if (!claims || claims.projectId !== projektId) {
    return NextResponse.json(
      { ok: false, error: "Invalid or expired editor token." },
      {
        status: 401,
        headers: corsHeaders(request),
      }
    );
  }

  const project = await db.project.findUnique({
    where: { id: projektId },
    include: {
      languages: {
        where: { isActive: true },
        orderBy: { langCode: "asc" },
      },
      settings: true,
    },
  });

  if (!project) {
    return NextResponse.json(
      { ok: false, error: "Project not found." },
      {
        status: 404,
        headers: corsHeaders(request),
      }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      project: {
        id: project.id,
        domain: project.domain,
        originalLang: project.originalLang,
        targetLanguages: project.languages.map((language) => language.langCode),
        routingMode: project.settings?.routingMode ?? "PATH_PREFIX",
      },
    },
    {
      headers: corsHeaders(request),
    }
  );
}
