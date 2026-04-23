import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createEditorSessionToken } from "@/lib/editor-session";
import { getProjectUrl } from "@/lib/project-url";

export const runtime = "nodejs";

function buildEditorLaunchUrl({
  domain,
  routingMode,
  domainMappings,
  langTo,
  projectId,
  token,
}: {
  domain: string;
  routingMode: "PATH_PREFIX" | "SUBDOMAIN";
  domainMappings: Array<{ langCode: string; host: string }>;
  langTo: string;
  projectId: string;
  token: string;
}) {
  const baseUrl =
    routingMode === "SUBDOMAIN"
      ? (() => {
          const mapping = domainMappings.find((item) => item.langCode === langTo);
          return mapping ? getProjectUrl(mapping.host) : getProjectUrl(domain);
        })()
      : getProjectUrl(domain);

  const url = new URL(baseUrl);

  if (routingMode === "PATH_PREFIX") {
    const pathname = url.pathname.replace(/\/$/, "");
    url.pathname = `${pathname}/${langTo}`.replace(/\/{2,}/g, "/");
  }

  url.searchParams.set("deepglot_editor", "1");
  url.searchParams.set("deepglot_editor_project", projectId);
  url.searchParams.set("deepglot_editor_token", token);

  return url.toString();
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const session = await auth();
  const { projektId } = await params;

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const project = await db.project.findFirst({
    where: {
      id: projektId,
      organization: {
        members: {
          some: { userId: session.user.id },
        },
      },
    },
    include: {
      languages: {
        where: { isActive: true },
        orderBy: { langCode: "asc" },
      },
      settings: true,
      domainMappings: {
        orderBy: { langCode: "asc" },
      },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as
    | { langTo?: string; path?: string }
    | null;
  const langTo =
    body?.langTo?.toLowerCase() ?? project.languages[0]?.langCode.toLowerCase();

  if (!langTo) {
    return NextResponse.json(
      { error: "Project has no active target language." },
      { status: 400 }
    );
  }

  const token = createEditorSessionToken({
    projectId: project.id,
    domain: project.domain,
  });
  const launchUrl = buildEditorLaunchUrl({
    domain: project.domain,
    routingMode: project.settings?.routingMode ?? "PATH_PREFIX",
    domainMappings: project.domainMappings,
    langTo,
    projectId: project.id,
    token,
  });

  return NextResponse.json({
    token,
    launchUrl,
    langTo,
    expiresInSeconds: 900,
  });
}
