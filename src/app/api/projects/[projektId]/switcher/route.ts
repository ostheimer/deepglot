import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userCanManageProject } from "@/lib/project-access";
import { lockProjectRuntimeConfiguration } from "@/lib/project-runtime-configuration-lock";
import { switcherConfigSchema, validateSwitcherLanguages } from "@/lib/switcher-contract";

const saveSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), expectedRevision: z.number().int().nonnegative(), expectedPluginSyncedAt: z.string().datetime({ offset: true }).nullable(), config: switcherConfigSchema }).strict(),
  z.object({ action: z.literal("returnToWordPress"), expectedRevision: z.number().int().nonnegative() }).strict(),
]);

type Context = { params: Promise<{ projektId: string }> };

async function managerId(context: Context) {
  const session = await auth();
  if (!session?.user?.id) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const { projektId } = await context.params;
  if (!(await userCanManageProject(session.user.id, projektId))) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { projektId };
}

export async function GET(_request: Request, context: Context) {
  const access = await managerId(context);
  if ("error" in access) return access.error;
  const project = await db.project.findUnique({
    where: { id: access.projektId },
    select: { originalLang: true, languages: { where: { isActive: true }, select: { langCode: true } }, settings: {
      select: { switcherOwner: true, switcherRevision: true, switcherConfig: true, switcherBaseConfig: true,
        switcherPluginConfig: true, switcherPluginRevision: true, switcherPluginSyncedAt: true, switcherConflict: true },
    } },
  });
  return project ? NextResponse.json(project) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(request: Request, context: Context) {
  const access = await managerId(context);
  if ("error" in access) return access.error;
  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid switcher settings", issues: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;
  const result = await db.$transaction(async (tx) => {
    if (!(await lockProjectRuntimeConfiguration(tx, access.projektId))) return { status: 404 };
    const project = await tx.project.findUnique({
      where: { id: access.projektId },
      select: { originalLang: true, languages: { where: { isActive: true }, select: { langCode: true } }, settings: true },
    });
    if (!project) return { status: 404 };
    const settings = project.settings;
    if ((settings?.switcherRevision ?? 0) !== body.expectedRevision) return { status: 409, code: "stale_editor" };
    if (body.action === "returnToWordPress") {
      if (settings?.switcherOwner !== "saas") return { status: 409, code: "already_wordpress" };
      const updated = await tx.projectSettings.update({ where: { projectId: access.projektId }, data: {
        switcherOwner: "wordpress", switcherRevision: { increment: 1 }, switcherConflict: false,
        switcherPluginSyncedAt: null,
      } });
      return { status: 200, revision: updated.switcherRevision };
    }
    if (!validateSwitcherLanguages(body.config, [project.originalLang, ...project.languages.map((lang) => lang.langCode)])) {
      return { status: 400, code: "invalid_languages" };
    }
    if (settings?.switcherOwner !== "saas") {
      if (!settings?.switcherPluginConfig || !settings.switcherPluginSyncedAt ||
          settings.switcherPluginSyncedAt.toISOString() !== body.expectedPluginSyncedAt) {
        return { status: 409, code: "stale_plugin_snapshot" };
      }
    }
    const updated = await tx.projectSettings.upsert({
      where: { projectId: access.projektId },
      create: { projectId: access.projektId, switcherOwner: "saas", switcherRevision: 1,
        switcherConfig: body.config, switcherBaseConfig: settings?.switcherPluginConfig ?? body.config,
        switcherBaseRevision: settings?.switcherPluginRevision ?? null },
      update: { switcherOwner: "saas", switcherRevision: { increment: 1 }, switcherConfig: body.config,
        ...(settings?.switcherOwner !== "saas" ? {
          switcherBaseConfig: settings?.switcherPluginConfig ?? body.config,
          switcherBaseRevision: settings?.switcherPluginRevision ?? null,
        } : {}),
        switcherConflict: false },
    });
    return { status: 200, revision: updated.switcherRevision };
  });
  return NextResponse.json(result.status === 200 ? result : { error: result.code ?? "Not found", ...result }, { status: result.status });
}
