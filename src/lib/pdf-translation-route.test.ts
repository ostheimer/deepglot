import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { createPdfTranslationPostHandler } from "@/app/api/projects/[projektId]/pdf-translations/route";
import { PdfTranslationError } from "@/lib/pdf-translation";

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

test("PDF route rejects unauthenticated uploads before invoking the service", async () => {
  let serviceCalls = 0;
  const handler = createPdfTranslationPostHandler({
    getUserId: async () => null,
    translateProjectPdf: async () => {
      serviceCalls += 1;
      throw new Error("must not run");
    },
  });

  const response = await handler(uploadRequest(), {
    params: Promise.resolve({ projektId: "project-1" }),
  });

  assert.equal(response.status, 401);
  assert.equal(serviceCalls, 0);
});

test("PDF route returns the generated PDF as an attachment", async () => {
  const handler = createPdfTranslationPostHandler({
    getUserId: async () => "user-1",
    translateProjectPdf: async (input) => {
      assert.equal(input.userId, "user-1");
      assert.equal(input.projectId, "project-1");
      assert.equal(input.langTo, "en");
      assert.equal(input.file.name, "source.pdf");

      return {
        bytes: new Uint8Array([37, 80, 68, 70]),
        filename: "source-deepglot-en.pdf",
        pageCount: 2,
        wordCount: 7,
      };
    },
  });

  const response = await handler(uploadRequest(), {
    params: Promise.resolve({ projektId: "project-1" }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(
    response.headers.get("content-disposition"),
    'attachment; filename="source-deepglot-en.pdf"'
  );
  assert.equal(response.headers.get("x-deepglot-pdf-pages"), "2");
  assert.equal(response.headers.get("x-deepglot-pdf-words"), "7");
});

test("PDF route preserves safe service error codes and statuses", async () => {
  const handler = createPdfTranslationPostHandler({
    getUserId: async () => "user-1",
    translateProjectPdf: async () => {
      throw new PdfTranslationError(
        "Monthly word quota exceeded.",
        "quota_exhausted",
        402
      );
    },
  });

  const response = await handler(uploadRequest(), {
    params: Promise.resolve({ projektId: "project-1" }),
  });
  const body = (await response.json()) as { code?: string; error?: string };

  assert.equal(response.status, 402);
  assert.equal(body.code, "quota_exhausted");
  assert.equal(body.error, "Monthly word quota exceeded.");
});
