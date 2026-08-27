const environment = process.env.VERCEL_ENV?.trim() ?? "";
const pullRequestId = process.env.VERCEL_GIT_PULL_REQUEST_ID?.trim() ?? "";
const commitRef = process.env.VERCEL_GIT_COMMIT_REF?.trim() ?? "";

let shouldBuild = true;
let reason = "non-preview environment";

if (environment === "production") {
  reason = "production deployment";
} else if (environment === "preview" && pullRequestId) {
  reason = `pull request #${pullRequestId}`;
} else if (environment === "preview" && commitRef) {
  shouldBuild = false;
  reason = `branch ${commitRef} has no pull request`;
} else if (environment === "preview") {
  reason = "manual preview without a Git branch";
}

console.log(
  `[vercel-preview-policy] ${shouldBuild ? "build" : "skip"}: ${reason}`,
);

// Vercel's Ignored Build Step uses exit 1 to continue and exit 0 to skip.
process.exitCode = shouldBuild ? 1 : 0;
