export type NeonRestoreDrillEnv = {
  NEON_API_KEY?: string;
  NEON_PROJECT_ID?: string;
};

export type NeonRestoreDrillValidationInput = {
  env: NeonRestoreDrillEnv;
  create: boolean;
  sourceBranch: string;
  branchName: string;
};

export function buildNeonRestoreDrillBranchName(now = new Date()) {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "")
    .replace(/\.\d{3}Z$/, "");

  return `restore-drill-prod-${stamp}`;
}

export function getNeonRestoreDrillValidation({
  env,
  create,
  sourceBranch,
  branchName,
}: NeonRestoreDrillValidationInput) {
  const errors: string[] = [];

  if (create && !env.NEON_API_KEY) {
    errors.push("NEON_API_KEY is required when creating a restore-drill branch.");
  }

  if (!sourceBranch.trim()) {
    errors.push("Source branch is required.");
  }

  if (!branchName.trim()) {
    errors.push("Branch name is required.");
  } else if (!/^[A-Za-z0-9._-]+$/.test(branchName)) {
    errors.push(
      "Branch name may contain only letters, numbers, dots, underscores, and hyphens."
    );
  }

  if (branchName === sourceBranch) {
    errors.push("Restore-drill branch name must differ from the source branch.");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function getNeonRestoreDrillExpiresAt(now = new Date(), hours = 24) {
  const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 24;
  return new Date(now.getTime() + safeHours * 60 * 60 * 1000).toISOString();
}
