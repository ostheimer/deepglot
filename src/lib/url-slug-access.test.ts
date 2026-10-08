import assert from "node:assert/strict";
import test from "node:test";
import { selectReadableSlugLanguages } from "@/lib/url-slug-access";

test("language-bound translators only see their own slug language", () => {
  const access = { organizationRole: "MEMBER" as const, projectRole: "TRANSLATOR" as const, langCode: "fr" };
  const languages = [{ langCode: "en", isActive: true }, { langCode: "fr", isActive: true }];
  assert.deepEqual(selectReadableSlugLanguages(access, languages).map((item) => item.langCode), ["fr"]);
});

test("managers can read every active slug language, but inactive languages stay hidden", () => {
  const access = { organizationRole: "ADMIN" as const, projectRole: null };
  const languages = [
    { langCode: "en", isActive: true },
    { langCode: "fr", isActive: false },
    { langCode: "sv", isActive: true },
  ];
  assert.deepEqual(selectReadableSlugLanguages(access, languages).map((item) => item.langCode), ["en", "sv"]);
});
