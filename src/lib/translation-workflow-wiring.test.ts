import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("translation workflow schema stores status and a project-member assignment", () => {
  const schema = source("prisma/schema.prisma");
  assert.match(schema, /enum TranslationWorkflowStatus[\s\S]*MACHINE[\s\S]*ASSIGNED[\s\S]*IN_REVIEW[\s\S]*APPROVED/);
  assert.match(schema, /model Translation[\s\S]*workflowStatus\s+TranslationWorkflowStatus\s+@default\(MACHINE\)/);
  assert.match(schema, /model Translation[\s\S]*assignedToId\s+String\?/);
  assert.match(schema, /model Translation[\s\S]*assignedTo\s+ProjectMember\?/);
});

test("project APIs expose list/filter and tenant-scoped workflow updates", () => {
  const collection = source(
    "src/app/api/projects/[projektId]/translations/route.ts",
  );
  const item = source(
    "src/app/api/projects/[projektId]/translations/[translationId]/route.ts",
  );

  assert.match(collection, /export async function GET/);
  assert.match(collection, /getProjectAccess/);
  assert.match(collection, /listProjectTranslationWorkflow/);
  assert.match(item, /export async function PATCH/);
  assert.match(item, /getProjectAccess/);
  assert.match(item, /updateProjectTranslationWorkflow/);
});

test("dashboard replaces the redirect with filters, assignment, review, and existing handoff links", () => {
  const page = source(
    "src/app/(dashboard)/projekte/[projektId]/uebersetzungen/profis/page.tsx",
  );
  const panel = source(
    "src/components/projekte/translation-workflow-panel.tsx",
  );
  const sidebar = source("src/components/projekte/project-sidebar.tsx");

  assert.doesNotMatch(page, /redirect\(/);
  assert.match(page, /TranslationWorkflowPanel/);
  assert.match(panel, /status/);
  assert.match(panel, /assignedToId/);
  assert.match(panel, /translations\/visual/);
  assert.match(panel, /translations\/import-export/);
  assert.match(panel, /Marktplatz/);
  assert.match(panel, /Bezahlung/);
  assert.match(sidebar, /translations\/pros/);
});

test("dashboard pagination reaches every filtered segment and resets on filter changes", () => {
  const panel = source(
    "src/components/projekte/translation-workflow-panel.tsx",
  );

  assert.match(panel, /search\.set\("page", String\(page\)\)/);
  assert.match(panel, /setPage\(1\)/);
  assert.match(panel, /data\.page > 1/);
  assert.match(panel, /data\.page < data\.totalPages/);
});

test("member removal and language changes reset assignments before they become invalid", () => {
  const memberRoute = source(
    "src/app/api/projects/[projektId]/members/[memberId]/route.ts",
  );
  const workflow = source("src/lib/translation-workflow.ts");

  assert.match(memberRoute, /db\.\$transaction/);
  assert.match(memberRoute, /resetProjectMemberWorkflowAssignments/);
  assert.match(workflow, /translation\.updateMany/);
  assert.match(workflow, /workflowStatus:\s*"MACHINE"/);
  assert.match(workflow, /assignedToId:\s*null/);
});

test("visual-editor and import content writes invalidate stale approval", () => {
  const manualRoute = source(
    "src/app/api/projects/[projektId]/manual-translations/route.ts",
  );
  const importRoute = source(
    "src/app/api/projects/[projektId]/import/route.ts",
  );

  assert.match(manualRoute, /resetTranslationWorkflowAfterContentEdit/);
  assert.match(manualRoute, /workflowStatus:\s*true/);
  assert.match(manualRoute, /assignedToId:\s*true/);
  assert.match(importRoute, /resetTranslationWorkflowAfterContentEdit/);
  assert.ok(
    importRoute.match(/workflowStatus:\s*true/g)?.length === 2,
    "both PO and CSV translation imports must load workflow state",
  );
  const importUpserts = importRoute
    .split("const translation = await tx.translation.upsert")
    .slice(1);
  assert.equal(importUpserts.length, 2, "expected PO and CSV import upserts");
  for (const upsert of importUpserts) {
    assert.ok(
      upsert.indexOf("resetTranslationWorkflowAfterContentEdit(existing)") >
        upsert.indexOf("update:"),
      "each import update must invalidate stale workflow approval",
    );
  }
});
