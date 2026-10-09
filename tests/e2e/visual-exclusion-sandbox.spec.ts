import { expect, test } from "@playwright/test";
import { build } from "esbuild";

test("parsing and srcdoc display never request off-project resources", async ({ page }) => {
  const bundle = await build({
    entryPoints: ["src/lib/exclusion-visual-sandbox.ts"],
    bundle: true, write: false, platform: "browser", format: "iife", globalName: "VisualSandbox",
  });
  const requests: string[] = [];
  await page.route("**/*", async (route) => {
    requests.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "image/png", body: "" });
  });
  await page.goto("about:blank");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  const html = `<html><head><link rel="stylesheet" href="https://attacker.example/style.css"><style>p{color:red;background-image:url(https://attacker.example/background)}</style></head><body>
    <img src="https://attacker.example/pixel"><iframe src="https://attacker.example/frame"></iframe>
    <img src="/allowed.png"><script>window.previewScriptRan = true</script><p id="hero-copy">Keep this visible</p>
    <meta http-equiv="refresh" content="0;url=https://attacker.example/redirect"></body></html>`;
  const preview = await page.evaluate(({ html }) => {
    const sandbox = (window as unknown as { VisualSandbox: { sandboxHtml: (source: string, url: string) => string } }).VisualSandbox;
    return sandbox.sandboxHtml(html, "https://project.example/page");
  }, { html });
  await page.waitForTimeout(200);
  expect(requests, "DOMParser phase").toEqual([]);
  expect(preview).not.toContain("attacker.example/frame");
  expect(preview).not.toContain("previewScriptRan");

  const frame = await page.evaluate(async (srcdoc) => {
    const element = document.createElement("iframe");
    element.setAttribute("sandbox", "allow-same-origin");
    element.srcdoc = srcdoc;
    document.body.append(element);
    await new Promise<void>((resolve) => element.addEventListener("load", () => resolve(), { once: true }));
    return element.contentDocument?.getElementById("hero-copy")?.textContent;
  }, preview);
  await page.waitForTimeout(300);
  expect(frame).toBe("Keep this visible");
  expect(requests).toEqual(["https://project.example/allowed.png"]);
  expect(page.url()).toBe("about:blank");
  expect(page.frames().map((item) => item.url())).toEqual(["about:blank", "about:srcdoc"]);
});
