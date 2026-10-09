import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { projectPreviewUrl, requestPinnedPreview, VisualPreviewError } from "@/lib/exclusion-visual";
import { chooseVisualSelector, stableVisualToken } from "@/lib/exclusion-visual-selector";

test("visual preview path cannot change project origin or reach an internal host", () => {
  assert.equal(projectPreviewUrl("example.com", "/products?x=1").href, "https://example.com/products?x=1");
  for (const path of ["https://other.example/", "//other.example/", "/\\other.example/", "/\u0000admin"]) {
    assert.throws(() => projectPreviewUrl("example.com", path), VisualPreviewError);
  }
  assert.throws(() => projectPreviewUrl("127.0.0.1", "/"));
});

test("visual selector accepts semantic tokens and rejects volatile or generic rules", () => {
  for (const value of ["hero-title", "kontakt_bereich", "überblick", "product-42-description"]) {
    assert.equal(stableVisualToken(value), true, value);
  }
  for (const value of ["body", "row", "open", "wp-block-group", "menu", "x", "item-abcdef123456", "user_session_42", "a:b", "a b"]) {
    assert.equal(stableVisualToken(value), false, value);
  }
});

test("visual picker refuses structural roots and majority-page subtrees", () => {
  const document = { body: { textContent: "x".repeat(100) }, documentElement: {} } as unknown as Document;
  const main = { tagName: "MAIN", id: "unique-main", querySelectorAll: () => ({ length: 3 }), textContent: "x".repeat(70) } as unknown as Element;
  const largeSection = { tagName: "DIV", id: "unique-section", querySelectorAll: () => ({ length: 3 }), textContent: "x".repeat(70) } as unknown as Element;
  assert.equal(chooseVisualSelector(main, document), null);
  assert.equal(chooseVisualSelector(largeSection, document), null);
});

test("preview has an absolute deadline even while HTML keeps dripping", async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.write("<html>");
    const drip = setInterval(() => response.write("."), 25);
    response.on("close", () => clearInterval(drip));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const started = Date.now();
    const outcome = await Promise.race([
      requestPinnedPreview(new URL(`http://example.com:${address.port}/`), { address: "127.0.0.1", family: 4 }, 200)
        .then(() => "completed").catch((error: Error) => error.message),
      new Promise<string>((resolve) => setTimeout(() => resolve("still running"), 700)),
    ]);
    assert.match(outcome, /timed out/i);
    assert.ok(Date.now() - started < 1000, "drip response must not extend the deadline");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
