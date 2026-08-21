import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { createPdfTranslationPostHandler } from "@/app/api/projects/[projektId]/pdf-translations/route";

function uploadRequest() {
  const formData = new FormData();
  formData.set(
    "file",
    new File(["%PDF-1.7\n%%EOF"], "source.pdf", {
      type: "application/pdf",
    })
  );
  formData.set("langTo", "en");

  return new NextRequest(
    "http://127.0.0.1/api/projects/project-1/pdf-translations",
    { method: "POST", body: formData }
  );
}

test("PDF route starts a 40-second provider budget before authentication and parsing", async () => {
  const originalTimeout = AbortSignal.timeout;
  const events: string[] = [];

  AbortSignal.timeout = ((milliseconds: number) => {
    events.push(`deadline:${milliseconds}`);
    return originalTimeout(milliseconds);
  }) as typeof AbortSignal.timeout;

  try {
    const handler = createPdfTranslationPostHandler({
      getUserId: async () => {
        events.push("auth");
        return "user-1";
      },
      translateProjectPdf: async (_input, dependencies) => {
        events.push("service");
        assert.ok(
          dependencies?.providerBudgetSignal instanceof AbortSignal,
          "the service must receive the route-owned absolute deadline"
        );
        return {
          bytes: new Uint8Array([37, 80, 68, 70]),
          filename: "source-deepglot-en.pdf",
          pageCount: 1,
          wordCount: 1,
        };
      },
    });

    const response = await handler(uploadRequest(), {
      params: Promise.resolve({ projektId: "project-1" }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(events, ["deadline:40000", "auth", "service"]);
  } finally {
    AbortSignal.timeout = originalTimeout;
  }
});
