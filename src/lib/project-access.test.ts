import test from "node:test";
import assert from "node:assert/strict";

import {
  canAccessProject,
  canAccessProjectArea,
  canAccessProjectLanguage,
  canManageProject,
  type ProjectAccessContext,
} from "@/lib/project-access";

const orgOwner: ProjectAccessContext = {
  organizationRole: "OWNER",
  projectRole: null,
  langCode: null,
};
const orgAdmin: ProjectAccessContext = {
  organizationRole: "ADMIN",
  projectRole: null,
  langCode: null,
};
const orgMemberOnly: ProjectAccessContext = {
  organizationRole: "MEMBER",
  projectRole: null,
  langCode: null,
};
const projectAdmin: ProjectAccessContext = {
  organizationRole: "MEMBER",
  projectRole: "ADMIN",
  langCode: null,
};
const enTranslator: ProjectAccessContext = {
  organizationRole: "MEMBER",
  projectRole: "TRANSLATOR",
  langCode: "en",
};
const allLanguageTranslator: ProjectAccessContext = {
  organizationRole: "MEMBER",
  projectRole: "TRANSLATOR",
  langCode: null,
};

test("org owners/admins and project members can access the project", () => {
  assert.equal(canAccessProject(orgOwner), true);
  assert.equal(canAccessProject(orgAdmin), true);
  assert.equal(canAccessProject(projectAdmin), true);
  assert.equal(canAccessProject(enTranslator), true);
  assert.equal(canAccessProject(orgMemberOnly), false);
  assert.equal(canAccessProject(null), false);
});

test("project management is limited to org owners/admins and project admins", () => {
  assert.equal(canManageProject(orgOwner), true);
  assert.equal(canManageProject(orgAdmin), true);
  assert.equal(canManageProject(projectAdmin), true);
  assert.equal(canManageProject(enTranslator), false);
  assert.equal(canManageProject(orgMemberOnly), false);
});

test("translators are limited to assigned translation/editor language areas", () => {
  assert.equal(canAccessProjectArea(enTranslator, "translations", "en"), true);
  assert.equal(canAccessProjectArea(enTranslator, "visual-editor", "en"), true);
  assert.equal(canAccessProjectArea(enTranslator, "translations", "fr"), false);
  assert.equal(canAccessProjectArea(enTranslator, "analytics", "en"), false);
  assert.equal(canAccessProjectArea(enTranslator, "settings", "en"), false);
  assert.equal(canAccessProjectArea(allLanguageTranslator, "translations", "fr"), true);
});

test("language access is unrestricted for managers and scoped for translators", () => {
  assert.equal(canAccessProjectLanguage(projectAdmin, "fr"), true);
  assert.equal(canAccessProjectLanguage(enTranslator, "en"), true);
  assert.equal(canAccessProjectLanguage(enTranslator, "de"), false);
  assert.equal(canAccessProjectLanguage(allLanguageTranslator, "de"), true);
});
