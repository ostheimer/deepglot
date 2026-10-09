import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteProjectWithAiSpendGuard } from "@/lib/ai-budget-project-deletion";
import { AiBudgetError } from "@/lib/ai-budget-math";
import {
  userCanManageProject,
  userHasProjectAccess,
} from "@/lib/project-access";
import {
  getProjectGeneralSettings,
  projectGeneralSettingsPatchSchema,
  updateProjectGeneralSettings,
} from "@/lib/project-general-settings";

// Reading basic project info stays available to every organization or explicit
// project member.
// Mutating actions (PATCH/DELETE) are management-only — see the
// `userCanManageProject` checks below — so the API mirrors the settings pages,
// which all gate on `requireProjectManagement`.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const { projektId } = await params;
  if (!(await userHasProjectAccess(session.user.id, projektId)))
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const project = await getProjectGeneralSettings(db, projektId);
  if (!project)
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  return NextResponse.json(project);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const { projektId } = await params;
  // Deleting a project is destructive and irreversible (the project and its
  // translations are removed). Restrict to project managers, not any member.
  if (!(await userCanManageProject(session.user.id, projektId))) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  try {
    await deleteProjectWithAiSpendGuard(projektId, session.user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AiBudgetError) {
      if (error.code === "ai_spend_pending") {
        const de = request.headers.get("accept-language")?.toLowerCase().startsWith("de") ?? false;
        return NextResponse.json({ code: error.code,
          error: de
            ? "Dieses Projekt hat noch laufende oder ungeklärte KI-Anbieteraufrufe. Prüfe den Budgetstatus; unbekannte Nutzung muss eine Workspace-Inhaberin oder ein Workspace-Inhaber nach Anbieterbeleg klären."
            : "This project has in-flight or unresolved AI provider work. Review its budget status; an owner must resolve unknown usage after checking provider evidence." },
        { status: 409 });
      }
      if (error.code === "project_changed" || error.code === "actor_revoked") {
        return NextResponse.json({ code: "not_found" }, { status: 404 });
      }
    }
    return NextResponse.json({ code: "project_delete_unavailable" }, { status: 503 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projektId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const { projektId } = await params;
  if (!(await userCanManageProject(session.user.id, projektId))) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const parsed = projectGeneralSettingsPatchSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  }

  const { expectedVersion, ...patch } = parsed.data;
  const result = await updateProjectGeneralSettings(db, {
    projectId: projektId,
    expectedVersion,
    patch,
    actorUserId: session.user.id,
  });

  if (result.kind === "updated") {
    return NextResponse.json(result.project);
  }

  if (result.kind === "conflict") {
    return NextResponse.json(
      {
        error:
          "Die Projekteinstellungen wurden zwischenzeitlich geändert. Bitte lade die aktuellen Werte und versuche es erneut.",
        code: "project_settings_conflict",
        project: result.project,
      },
      { status: 409 }
    );
  }

  if (result.kind === "source_language_locked") {
    return NextResponse.json(
      {
        error:
          "Die Originalsprache kann nicht mehr geändert werden, nachdem sprachabhängige Inhalte erstellt wurden.",
        code: "original_language_locked",
        project: result.project,
      },
      { status: 409 }
    );
  }

  if (result.kind === "source_language_not_active_target") {
    return NextResponse.json(
      {
        error:
          "Als neue Originalsprache kann nur eine aktuell aktive Zielsprache gewählt werden.",
        code: "source_language_must_be_active_target",
        project: result.project,
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
}
