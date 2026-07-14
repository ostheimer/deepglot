import crypto from "node:crypto";

import { NextRequest } from "next/server";

import {
  createEditorSessionToken,
  verifyEditorSessionToken,
} from "@/lib/editor-session";
import {
  hashRateLimitSubject,
  PLUGIN_RATE_LIMIT_SCOPE,
} from "@/lib/rate-limit";
import { computeTranslationHash } from "@/lib/translation-hash";

const ORIGINAL_TEXT = "Ein isolierter Editor-Satz.";
const TRANSLATED_TEXT = "An isolated editor sentence.";

export type VisualEditorPersistenceAcceptanceResult = {
  projectId: string;
  verificationStatus: number;
  verifiedProjectId: string | null;
  verifiedLanguage: string | null;
  saveStatus: number;
  persistedTranslation: {
    originalText: string;
    translatedText: string;
    langFrom: string;
    langTo: string;
    isManual: boolean;
    source: string;
  } | null;
  crossProjectStatus: number;
  crossLanguageStatus: number;
  deniedTranslationCount: number;
};

type ManualTranslationPayload = {
  token: string;
  originalText: string;
  translatedText: string;
  langFrom: string;
  langTo: string;
  requestUrl: string;
};

function manualTranslationRequest(
  projectId: string,
  payload: ManualTranslationPayload
) {
  return new NextRequest(
    `http://127.0.0.1/api/projects/${projectId}/manual-translations`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://visual-editor-acceptance.invalid",
      },
      body: JSON.stringify(payload),
    }
  );
}

/**
 * Exercises the implemented Visual Editor capability against an isolated pair
 * of projects. The function intentionally calls the real token verification and
 * manual-translation route handlers, reloads the row through Prisma, and then
 * removes all created rows (including the non-relational rate-limit bucket).
 */
export async function runVisualEditorPersistenceAcceptance(): Promise<VisualEditorPersistenceAcceptanceResult> {
  const [
    { db },
    { POST: saveManualTranslation },
    { GET: verifyEditorSession },
  ] = await Promise.all([
    import("@/lib/db"),
    import("@/app/api/projects/[projektId]/manual-translations/route"),
    import("@/app/api/projects/[projektId]/editor-sessions/verify/route"),
  ]);
  const runId = crypto.randomUUID();
  const previousEditorSecret = process.env.DEEPGLOT_EDITOR_SECRET;
  const editorSecret = `visual-editor-acceptance-${runId}`;
  let organizationId: string | null = null;
  let projectId: string | null = null;

  process.env.DEEPGLOT_EDITOR_SECRET = editorSecret;

  try {
    const organization = await db.organization.create({
      data: {
        name: `Visual editor acceptance ${runId}`,
        slug: `visual-editor-acceptance-${runId}`,
      },
    });
    organizationId = organization.id;

    const project = await db.project.create({
      data: {
        name: "Visual editor acceptance source",
        domain: `visual-editor-${runId}.invalid`,
        originalLang: "de",
        organizationId,
        languages: {
          create: [
            { langCode: "en", isActive: true },
            { langCode: "fr", isActive: true },
          ],
        },
      },
    });
    projectId = project.id;

    const otherProject = await db.project.create({
      data: {
        name: "Visual editor acceptance boundary",
        domain: `visual-editor-boundary-${runId}.invalid`,
        originalLang: "de",
        organizationId,
        languages: {
          create: [{ langCode: "en", isActive: true }],
        },
      },
    });

    const token = createEditorSessionToken({
      projectId,
      domain: project.domain,
      langTo: "en",
    });
    const claims = verifyEditorSessionToken(token);

    const verificationResponse = await verifyEditorSession(
      new NextRequest(
        `http://127.0.0.1/api/projects/${projectId}/editor-sessions/verify?token=${encodeURIComponent(token)}`,
        { headers: { Origin: `https://${project.domain}` } }
      ),
      { params: Promise.resolve({ projektId: projectId }) }
    );
    const verificationBody = (await verificationResponse.json()) as {
      ok?: boolean;
      project?: { id?: string };
    };

    const payload: ManualTranslationPayload = {
      token,
      originalText: ORIGINAL_TEXT,
      translatedText: TRANSLATED_TEXT,
      langFrom: "de",
      langTo: "en",
      requestUrl: `https://${project.domain}/beispiel`,
    };
    const saveResponse = await saveManualTranslation(
      manualTranslationRequest(projectId, payload),
      { params: Promise.resolve({ projektId: projectId }) }
    );

    const originalHash = computeTranslationHash(ORIGINAL_TEXT, "de", "en");
    const persistedTranslation = await db.translation.findUnique({
      where: {
        projectId_originalHash: { projectId, originalHash },
      },
      select: {
        originalText: true,
        translatedText: true,
        langFrom: true,
        langTo: true,
        isManual: true,
        source: true,
      },
    });

    const crossProjectResponse = await saveManualTranslation(
      manualTranslationRequest(otherProject.id, payload),
      { params: Promise.resolve({ projektId: otherProject.id }) }
    );
    const crossLanguageResponse = await saveManualTranslation(
      manualTranslationRequest(projectId, {
        ...payload,
        langTo: "fr",
        translatedText: "Une phrase isolée de l’éditeur.",
      }),
      { params: Promise.resolve({ projektId: projectId }) }
    );

    const deniedTranslationCount = await db.translation.count({
      where: {
        OR: [
          { projectId: otherProject.id },
          { projectId, langTo: "fr" },
        ],
      },
    });

    return {
      projectId,
      verificationStatus: verificationResponse.status,
      verifiedProjectId:
        verificationBody.ok === true ? verificationBody.project?.id ?? null : null,
      verifiedLanguage: claims?.langTo ?? null,
      saveStatus: saveResponse.status,
      persistedTranslation,
      crossProjectStatus: crossProjectResponse.status,
      crossLanguageStatus: crossLanguageResponse.status,
      deniedTranslationCount,
    };
  } finally {
    if (projectId) {
      await db.rateLimitBucket.deleteMany({
        where: {
          scope: PLUGIN_RATE_LIMIT_SCOPE,
          subjectHash: hashRateLimitSubject(
            PLUGIN_RATE_LIMIT_SCOPE,
            `manual-translations:${projectId}`
          ),
        },
      });
    }

    if (organizationId) {
      await db.organization.deleteMany({ where: { id: organizationId } });
    }

    if (previousEditorSecret === undefined) {
      delete process.env.DEEPGLOT_EDITOR_SECRET;
    } else {
      process.env.DEEPGLOT_EDITOR_SECRET = previousEditorSecret;
    }
  }
}
