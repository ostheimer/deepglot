import { Prisma, type PrismaClient } from "@prisma/client";

import { withBoundedMediaRuntimeMutation } from "@/lib/media-runtime-limits";
import {
  isProjectRuntimeSerializationConflict,
  lockProjectRuntimeConfiguration,
} from "@/lib/project-runtime-configuration-lock";

const PROJECT_LANGUAGE_MUTATION_ATTEMPTS = 3;

class ProjectLanguageMutationConflictError extends Error {}

function nextProjectUpdatedAt(current: Date) {
  return new Date(Math.max(Date.now(), current.getTime() + 1));
}

function isProjectLanguageMutationConflict(error: unknown) {
  return (
    error instanceof ProjectLanguageMutationConflictError ||
    isProjectRuntimeSerializationConflict(error)
  );
}

async function runProjectLanguageMutation<T>(
  database: PrismaClient,
  mutation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  let lastConflict: unknown;

  for (
    let attempt = 0;
    attempt < PROJECT_LANGUAGE_MUTATION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await database.$transaction(mutation, {
        // See project-general-settings: after waiting on the shared Project
        // row lock this transaction must see child writes committed by the
        // preceding lock holder (not retain a pre-wait Serializable snapshot).
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      });
    } catch (error) {
      if (!isProjectLanguageMutationConflict(error)) {
        throw error;
      }
      lastConflict = error;
    }
  }

  throw lastConflict;
}

export type AddProjectTargetLanguagesResult =
  | { kind: "updated" }
  | { kind: "not_found" }
  | { kind: "source_language_cannot_be_target" };

export async function addProjectTargetLanguages(
  database: PrismaClient,
  {
    projectId,
    languages,
  }: {
    projectId: string;
    languages: string[];
  },
): Promise<AddProjectTargetLanguagesResult> {
  return runProjectLanguageMutation(database, async (tx) => {
    if (!(await lockProjectRuntimeConfiguration(tx, projectId))) {
      return { kind: "not_found" } as const;
    }

    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { originalLang: true, updatedAt: true },
    });
    if (!project) {
      return { kind: "not_found" } as const;
    }

    if (languages.includes(project.originalLang.toLowerCase())) {
      return { kind: "source_language_cannot_be_target" } as const;
    }

    return withBoundedMediaRuntimeMutation(tx, projectId, async () => {
      // Source migrations retain the source language row as inactive. If that
      // language later becomes a target again, createMany(skipDuplicates) alone
      // would silently leave the existing row inactive.
      await tx.projectLanguage.updateMany({
        where: { projectId, langCode: { in: languages } },
        data: { isActive: true },
      });
      await tx.projectLanguage.createMany({
        data: languages.map((langCode) => ({
          projectId,
          langCode,
          isActive: true,
        })),
        skipDuplicates: true,
      });
      const versionWrite = await tx.project.updateMany({
        where: { id: projectId, updatedAt: project.updatedAt },
        data: { updatedAt: nextProjectUpdatedAt(project.updatedAt) },
      });
      if (versionWrite.count !== 1) {
        throw new ProjectLanguageMutationConflictError();
      }

      return { kind: "updated" } as const;
    });
  });
}

export async function deleteProjectTargetLanguage(
  database: PrismaClient,
  {
    projectId,
    langCode,
  }: {
    projectId: string;
    langCode: string;
  },
): Promise<boolean> {
  return runProjectLanguageMutation(database, async (tx) => {
    if (!(await lockProjectRuntimeConfiguration(tx, projectId))) {
      return false;
    }

    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { updatedAt: true },
    });
    if (!project) {
      return false;
    }

    await tx.projectLanguage.deleteMany({
      where: { projectId, langCode },
    });
    await tx.projectDomainMapping.deleteMany({
      where: { projectId, langCode },
    });
    const versionWrite = await tx.project.updateMany({
      where: { id: projectId, updatedAt: project.updatedAt },
      data: { updatedAt: nextProjectUpdatedAt(project.updatedAt) },
    });
    if (versionWrite.count !== 1) {
      throw new ProjectLanguageMutationConflictError();
    }

    return true;
  });
}
