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

test("PDF route starts the provider budget before authentication and multipart parsing", async () => {
  const originalTimeout = AbortSignal.timeout;
  const events: string[] = [];
  const routeStartedAt = performance.now();
  AbortSignal.timeout = ((milliseconds: number) => {
    events.push(`deadline:${milliseconds}`);
    return originalTimeout(milliseconds);
  }) as typeof AbortSignal.timeout;

  try {
    const handler = createPdfTranslationPostHandler({
      getUserId: async () => {
        events.push("auth");
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "user-1";
      },
      translateProjectPdf: async (_input, dependencies) => {
        events.push("service");
        assert.ok(
          dependencies?.providerBudgetSignal instanceof AbortSignal,
          "the service must receive the route-owned abort signal"
        );
        assert.ok(
          typeof dependencies?.providerBudgetDeadlineAt === "number" &&
            dependencies.providerBudgetDeadlineAt >= routeStartedAt + 39_000 &&
            dependencies.providerBudgetDeadlineAt <= routeStartedAt + 40_100,
          "the service must receive the monotonic route-entry deadline"
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

test("PDF route exposes count-mismatch deadline rejection as a stable 503", async () => {
  const handler = createPdfTranslationPostHandler({
    getUserId: async () => "user-1",
    translateProjectPdf: async () => {
      throw new PdfTranslationError(
        "Count-mismatch singleton recovery cannot fit the remaining request deadline.",
        "translation_count_mismatch_deadline",
        503
      );
    },
  });

  const response = await handler(uploadRequest(), {
    params: Promise.resolve({ projektId: "project-1" }),
  });
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.deepEqual(body, {
    error:
      "Count-mismatch singleton recovery cannot fit the remaining request deadline.",
    code: "translation_count_mismatch_deadline",
  });
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

test("PDF velocity limits preserve Retry-After in the response contract", async () => {
  const handler = createPdfTranslationPostHandler({
    getUserId: async () => "user_1",
    translateProjectPdf: async () => {
      throw new PdfTranslationError(
        "The translation velocity limit is currently reached. Try again later.",
        "velocity_limited",
        429,
        73,
      );
    },
  });

  const response = await handler(uploadRequest(), {
    params: Promise.resolve({ projektId: "project-1" }),
  });
  const body = await response.json();

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "73");
  assert.deepEqual(body, {
    error: "The translation velocity limit is currently reached. Try again later.",
    code: "velocity_limited",
    retry_after: 73,
  });
});

test("an oversized PDF request is non-retryable and has no Retry-After", async () => {
  const handler = createPdfTranslationPostHandler({
    getUserId: async () => "user-1",
    translateProjectPdf: async () => {
      throw new PdfTranslationError(
        "Split the PDF so each request fits the plan velocity cap.",
        "velocity_request_too_large",
        422,
      );
    },
  });

  const response = await handler(uploadRequest(), {
    params: Promise.resolve({ projektId: "project-1" }),
  });
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(response.headers.get("Retry-After"), null);
  assert.deepEqual(body, {
    error: "Split the PDF so each request fits the plan velocity cap.",
    code: "velocity_request_too_large",
  });
});
